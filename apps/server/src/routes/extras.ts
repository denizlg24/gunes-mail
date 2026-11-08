import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import type { AppEnv } from "../auth";
import { db, schema } from "../db";
import { subscribe } from "../lib/events";

const { contacts, rules, accounts } = schema;

const condition = z.object({
  field: z.enum(["from", "to", "cc", "subject", "body", "sender_domain", "recipient_domain", "has_attachment"]),
  operator: z.enum(["contains", "not_contains", "equals", "starts_with", "ends_with", "matches"]),
  value: z.string(),
});

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), folder: z.string().min(1) }),
  z.object({ type: z.literal("label"), labelId: z.string().min(1) }),
  z.object({ type: z.literal("mark_read") }),
  z.object({ type: z.literal("flag") }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("delete") }),
  z.object({ type: z.literal("mark_spam") }),
  z.object({ type: z.literal("focus"), category: z.enum(["focused", "other"]) }),
  z.object({ type: z.literal("delay_send"), minutes: z.number().int().min(1).max(10080) }),
  z.object({ type: z.literal("add_bcc"), email: z.email() }),
]);

const ruleBody = z
  .object({
    name: z.string().min(1),
    kind: z.enum(["incoming", "outgoing"]),
    accountId: z.uuid().nullable().default(null),
    enabled: z.boolean().default(true),
    match: z.enum(["all", "any"]).default("all"),
    conditions: z.array(condition),
    actions: z.array(action).min(1),
    stopProcessing: z.boolean().default(false),
  })
  .refine(
    (r) =>
      r.actions.every((a) =>
        r.kind === "outgoing" ? a.type === "delay_send" || a.type === "add_bcc" : a.type !== "delay_send" && a.type !== "add_bcc",
      ),
    "Action doesn't apply to this kind of rule",
  );

function serializeRule(r: typeof rules.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    accountId: r.accountId,
    enabled: r.enabled,
    position: r.position,
    match: r.match,
    conditions: r.conditions,
    actions: r.actions,
    stopProcessing: r.stopProcessing,
  };
}

async function assertAccount(userId: string, accountId: string | null) {
  if (!accountId) return;
  const [row] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!row) throw new HTTPException(404, { message: "Account not found" });
}

export const extras = new Hono<AppEnv>()
  .get("/contacts", async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const limit = Math.min(Number(c.req.query("limit") ?? 8), 50);
    const rows = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, c.get("userId")),
          q ? or(ilike(contacts.email, `${q}%`), ilike(contacts.name, `${q}%`), ilike(contacts.name, `% ${q}%`), ilike(contacts.email, `%${q}%`)) : sql`true`,
        ),
      )
      .orderBy(
        desc(sql`case when ${contacts.email} ilike ${`${q}%`} or ${contacts.name} ilike ${`${q}%`} then 1 else 0 end`),
        desc(contacts.timesContacted),
        desc(sql`${contacts.source} = 'directory'`),
        desc(contacts.lastContactedAt),
      )
      .limit(limit);
    return c.json(rows.map((r) => ({ email: r.email, name: r.name || r.email, photoUrl: r.photoUrl })));
  })
  .get("/contacts/photo", async (c) => {
    const email = (c.req.query("email") ?? "").toLowerCase();
    const [row] = await db
      .select({ photoUrl: contacts.photoUrl })
      .from(contacts)
      .where(and(eq(contacts.userId, c.get("userId")), eq(contacts.email, email)));
    return c.json({ photoUrl: row?.photoUrl ?? null });
  })
  .post("/contacts/photos", async (c) => {
    const { emails } = z.object({ emails: z.array(z.string()).max(200) }).parse(await c.req.json());
    if (!emails.length) return c.json({});
    const rows = await db
      .select({ email: contacts.email, photoUrl: contacts.photoUrl })
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, c.get("userId")),
          sql`${contacts.email} in ${emails.map((e) => e.toLowerCase())}`,
          sql`${contacts.photoUrl} is not null`,
        ),
      );
    return c.json(Object.fromEntries(rows.map((r) => [r.email, r.photoUrl])));
  })
  .get("/rules", async (c) => {
    const rows = await db
      .select()
      .from(rules)
      .where(eq(rules.userId, c.get("userId")))
      .orderBy(asc(rules.kind), asc(rules.position), asc(rules.createdAt));
    return c.json(rows.map(serializeRule));
  })
  .post("/rules", async (c) => {
    const userId = c.get("userId");
    const body = ruleBody.parse(await c.req.json());
    await assertAccount(userId, body.accountId);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rules)
      .where(and(eq(rules.userId, userId), eq(rules.kind, body.kind)));
    const [row] = await db.insert(rules).values({ ...body, userId, position: n }).returning();
    return c.json(serializeRule(row));
  })
  .put("/rules/:id", async (c) => {
    const userId = c.get("userId");
    const body = ruleBody.parse(await c.req.json());
    await assertAccount(userId, body.accountId);
    const [row] = await db
      .update(rules)
      .set(body)
      .where(and(eq(rules.id, c.req.param("id")), eq(rules.userId, userId)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Rule not found" });
    return c.json(serializeRule(row));
  })
  .patch("/rules/order", async (c) => {
    const { ids } = z.object({ ids: z.array(z.uuid()) }).parse(await c.req.json());
    const userId = c.get("userId");
    await db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.update(rules).set({ position }).where(and(eq(rules.id, id), eq(rules.userId, userId)));
      }
    });
    return c.body(null, 204);
  })
  .delete("/rules/:id", async (c) => {
    await db.delete(rules).where(and(eq(rules.id, c.req.param("id")), eq(rules.userId, c.get("userId"))));
    return c.body(null, 204);
  })
  .get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = subscribe(c.get("userId"), (event) => {
        queue.push(JSON.stringify(event));
        wake?.();
      });
      stream.onAbort(unsubscribe);
      await stream.writeSSE({ event: "ready", data: "{}" });
      while (!stream.aborted) {
        if (!queue.length) {
          await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(25_000)]);
          wake = null;
          if (!queue.length) await stream.writeSSE({ event: "ping", data: "{}" });
        }
        while (queue.length) await stream.writeSSE({ event: "message", data: queue.shift() ?? "{}" });
      }
      unsubscribe();
    }),
  );
