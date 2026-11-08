import type { DeviceSession, UserProfile, UserSettings } from "@gunes/shared";
import { DEFAULT_SETTINGS } from "@gunes/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { type AppEnv, createSession, currentToken, requireUser } from "../auth";
import { db, schema } from "../db";
import { decryptJson, sha256 } from "../lib/crypto";
import { publish } from "../lib/events";
import { allow } from "../lib/rate-limit";
import type { OAuthCredentials } from "../providers/oauth-token";
import { forgetProvider } from "../sync/providers";

const { users, sessions, accounts } = schema;

const credentials = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  accent: z.enum(["blue", "teal", "purple", "berry", "sunset", "green", "red", "graphite"]),
  density: z.enum(["comfortable", "compact"]),
  readingPane: z.enum(["right", "bottom", "off"]),
  focusedInbox: z.boolean(),
  markReadOnOpen: z.boolean(),
  undoSendSeconds: z.number().int().min(0).max(60),
  signature: z.string().max(10_000),
});

function clientIp(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

async function profile(userId: string): Promise<UserProfile> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new HTTPException(401, { message: "Sign in again" });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    hasPassword: !!user.passwordHash,
    createdAt: user.createdAt.getTime(),
  };
}

async function revokeProviderAccess(account: typeof accounts.$inferSelect) {
  if (account.provider !== "gmail") return;
  try {
    const { refreshToken } = decryptJson<OAuthCredentials>(account.credentials);
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    });
  } catch {
    // Revocation is best effort; the data is deleted either way.
  }
}

/** Public endpoints: create an account or sign in with email and password. */
export const publicAccount = new Hono()
  .post("/register", async (c) => {
    if (!allow(`register:${clientIp(c)}`, 10, 60 * 60_000)) {
      throw new HTTPException(429, { message: "Too many attempts. Try again later." });
    }
    const body = credentials.extend({ name: z.string().max(100).default("") }).parse(await c.req.json());
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (taken) throw new HTTPException(409, { message: "An account with this email already exists" });
    const [user] = await db
      .insert(users)
      .values({ email: body.email, name: body.name, passwordHash: await Bun.password.hash(body.password) })
      .returning({ id: users.id });
    return c.json({ session: await createSession(c, user.id), profile: await profile(user.id) });
  })
  .post("/login", async (c) => {
    const body = credentials.safeParse(await c.req.json());
    if (!body.success) throw new HTTPException(401, { message: "Wrong email or password" });
    const { email, password } = body.data;
    if (!allow(`login:${clientIp(c)}`, 20, 15 * 60_000) || !allow(`login:${email}`, 10, 15 * 60_000)) {
      throw new HTTPException(429, { message: "Too many attempts. Try again in a few minutes." });
    }
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const ok = user?.passwordHash ? await Bun.password.verify(password, user.passwordHash) : false;
    if (!user || !ok) throw new HTTPException(401, { message: "Wrong email or password" });
    return c.json({ session: await createSession(c, user.id), profile: await profile(user.id) });
  });

export const account = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => c.json(await profile(c.get("userId"))))
  .patch("/", async (c) => {
    const body = z
      .object({ name: z.string().max(100).optional(), email: z.email().optional() })
      .parse(await c.req.json());
    const userId = c.get("userId");
    const email = body.email?.toLowerCase().trim();
    if (email) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), ne(users.id, userId)));
      if (taken) throw new HTTPException(409, { message: "That email is already used by another account" });
    }
    await db.update(users).set({ name: body.name, email }).where(eq(users.id, userId));
    return c.json(await profile(userId));
  })
  .put("/password", async (c) => {
    const body = z
      .object({ current: z.string().optional(), password: z.string().min(10, "Use at least 10 characters").max(200) })
      .parse(await c.req.json());
    const userId = c.get("userId");
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.email) throw new HTTPException(400, { message: "Add an email address first" });
    if (user.passwordHash && !(body.current && (await Bun.password.verify(body.current, user.passwordHash)))) {
      throw new HTTPException(403, { message: "Your current password is wrong" });
    }
    await db.update(users).set({ passwordHash: await Bun.password.hash(body.password) }).where(eq(users.id, userId));
    const token = currentToken(c);
    if (token) {
      await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, sha256(token))));
    }
    return c.json(await profile(userId));
  })
  .get("/settings", async (c) => {
    const [user] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, c.get("userId")));
    const settings: UserSettings = { ...DEFAULT_SETTINGS, ...(user?.settings ?? {}) };
    return c.json(settings);
  })
  .put("/settings", async (c) => {
    const userId = c.get("userId");
    const settings = settingsSchema.partial().parse(await c.req.json());
    const [user] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    const next = { ...(user?.settings ?? {}), ...settings };
    await db.update(users).set({ settings: next }).where(eq(users.id, userId));
    publish(userId, { type: "settings" });
    return c.json({ ...DEFAULT_SETTINGS, ...next });
  })
  .get("/sessions", async (c) => {
    const token = currentToken(c);
    const current = token ? sha256(token) : "";
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, c.get("userId")))
      .orderBy(desc(sessions.lastUsedAt));
    const list: DeviceSession[] = rows.map((s) => ({
      id: s.id,
      name: s.deviceName?.replace(/^Gunes Mail/, "Güneş Mail") ?? describeAgent(s.userAgent),
      createdAt: s.createdAt.getTime(),
      lastUsedAt: s.lastUsedAt.getTime(),
      current: s.tokenHash === current,
    }));
    return c.json(list);
  })
  .delete("/sessions/:id", async (c) => {
    await db.delete(sessions).where(and(eq(sessions.id, c.req.param("id")), eq(sessions.userId, c.get("userId"))));
    return c.body(null, 204);
  })
  .delete("/", async (c) => {
    const userId = c.get("userId");
    const owned = await db.select().from(accounts).where(eq(accounts.userId, userId));
    await Promise.all(owned.map(revokeProviderAccess));
    owned.forEach((a) => forgetProvider(a.id));
    await db.delete(users).where(eq(users.id, userId));
    return c.body(null, 204);
  });

function describeAgent(agent: string | null): string {
  if (!agent) return "Unknown device";
  if (agent.includes("GunesMail")) return "Güneş Mail desktop";
  if (/Mozilla/.test(agent)) return /Mac OS X/.test(agent) ? "Browser on macOS" : /Windows/.test(agent) ? "Browser on Windows" : "Web browser";
  return agent.slice(0, 40);
}
