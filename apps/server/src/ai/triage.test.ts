import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/** Runs against a real Postgres (DATABASE_URL), with a stub classifier on a local port. */
const enabled = !!process.env.DATABASE_URL;
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client";

describe.skipIf(!enabled)("triage worker", async () => {
  const { and, eq, inArray } = await import("drizzle-orm");
  const { db, schema } = await import("../db");
  const { runMigrations } = await import("../db/migrate");
  const { env } = await import("../env");
  const { recomputeThreads } = await import("../sync/store");
  const { setThreadTriage, triageBatch } = await import("./triage");

  const seen: { subject: string; sender_address: string; body: string }[] = [];
  const classifier = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { subject: string; sender_address: string; body: string };
      seen.push(body);
      if (req.headers.get("authorization") !== "Bearer test-token") return new Response("no", { status: 401 });
      const category = body.subject.includes("invoice") ? "action-needed" : "newsletter";
      return Response.json({ category, confidence: 0.9, probabilities: {}, model_version: "test" });
    },
  });

  const userIds: string[] = [];
  let accountId = "";
  let optedOutAccountId = "";
  const batch = () => triageBatch({ accountIds: [accountId, optedOutAccountId] });
  const day = 24 * 60 * 60 * 1000;

  const message = (account: string, id: string, threadId: string, extra: Partial<typeof schema.messages.$inferInsert> = {}) => ({
    accountId: account,
    id,
    threadId,
    labelIds: ["INBOX"],
    from: { name: "Shop", email: "shop@example.com" },
    subject: "Weekly deals",
    date: new Date(Date.now() - day),
    snippet: "snippet",
    text: "Hello there.\n\nOn Mon, 1 Jan 2026, Me <me@example.com> wrote:\n> quoted",
    bodyFetched: true,
    ...extra,
  });

  beforeAll(async () => {
    await runMigrations();
    env.EMAIL_CLASSIFIER_URL = `http://localhost:${classifier.port}/api/classify`;
    env.EMAIL_CLASSIFIER_API_TOKEN = "test-token";

    const [user] = await db.insert(schema.users).values({ name: "Triage", settings: { smartCategories: true } }).returning();
    const [optedOut] = await db.insert(schema.users).values({ name: "Never opted in" }).returning();
    userIds.push(user.id, optedOut.id);
    const account = (owner: string, email: string) =>
      db
        .insert(schema.accounts)
        .values({ userId: owner, provider: "imap", providerUserId: crypto.randomUUID(), email, name: email, credentials: "x" })
        .returning();
    accountId = (await account(user.id, "me@example.com"))[0].id;
    optedOutAccountId = (await account(optedOut.id, "other@example.com"))[0].id;

    await db.insert(schema.messages).values([
      message(accountId, "m1", "t1"),
      message(accountId, "m2", "t1", { subject: "Re: your invoice", date: new Date(Date.now() - day / 2) }),
      message(accountId, "own", "t2", { from: { name: "Me", email: "ME@example.com" } }),
      message(accountId, "sent", "t3", { labelIds: ["SENT"] }),
      message(accountId, "old", "t4", { date: new Date(Date.now() - 400 * day) }),
      message(optedOutAccountId, "x1", "tx"),
    ]);
    await recomputeThreads(accountId, ["t1", "t2", "t3", "t4"]);
  });

  afterAll(async () => {
    classifier.stop(true);
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  const row = async (id: string) =>
    (await db.select().from(schema.messages).where(and(eq(schema.messages.accountId, accountId), eq(schema.messages.id, id))))[0];
  const thread = async (id: string) =>
    (await db.select().from(schema.threads).where(and(eq(schema.threads.accountId, accountId), eq(schema.threads.id, id))))[0];

  test("classifies recent incoming inbox mail only, and rolls the newest category up to the thread", async () => {
    expect(await batch()).toBe(2);
    expect((await row("m1")).triage).toBe("newsletter");
    expect((await row("m2")).triage).toBe("action-needed");
    expect((await row("m2")).triageSource).toBe("model");
    expect((await thread("t1")).triage).toBe("action-needed");
    for (const id of ["own", "sent", "old"]) expect((await row(id)).triagedAt).toBeNull();
    expect(seen.map((s) => s.sender_address)).not.toContain("other@example.com");
    expect(seen[0].body).toBe("Hello there.\n\nOn Mon, 1 Jan 2026, Me <me@example.com> wrote:\n> quoted");
    expect(await batch()).toBe(0);
  });

  test("a category the user picks survives the model classifying new replies", async () => {
    await setThreadTriage(accountId, ["t1"], "scheduled");
    expect((await thread("t1")).triage).toBe("scheduled");

    await db.insert(schema.messages).values(message(accountId, "m3", "t1", { subject: "Re: invoice", date: new Date() }));
    await recomputeThreads(accountId, ["t1"]);
    expect(await batch()).toBe(1);
    expect((await row("m3")).triage).toBe("action-needed");
    expect((await thread("t1")).triage).toBe("scheduled");
  });

  test("an unreachable classifier leaves mail to retry later", async () => {
    await db.insert(schema.messages).values(message(accountId, "m4", "t5"));
    env.EMAIL_CLASSIFIER_URL = "http://localhost:1/api/classify";
    await expect(batch()).rejects.toThrow();
    expect((await row("m4")).triagedAt).toBeNull();
    env.EMAIL_CLASSIFIER_URL = `http://localhost:${classifier.port}/api/classify`;
    expect(await batch()).toBe(1);
  });
});
