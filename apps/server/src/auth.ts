import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { db, schema } from "./db";
import { encryptJson, randomToken, sha256 } from "./lib/crypto";
import { forgetProvider } from "./sync/providers";
import { syncAccount } from "./sync/engine";

const { sessions, users, accounts } = schema;

export type AppEnv = { Variables: { userId: string } };

async function userForToken(token: string): Promise<string | null> {
  const [row] = await db
    .update(sessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256(token)))
    .returning({ userId: sessions.userId });
  return row?.userId ?? null;
}

function bearer(c: Context): string | null {
  const header = c.req.header("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c) ?? c.req.query("access_token") ?? null;
  const userId = token ? await userForToken(token) : null;
  if (!userId) throw new HTTPException(401, { message: "Sign in again" });
  c.set("userId", userId);
  await next();
};

export async function optionalUser(c: Context): Promise<string | null> {
  const token = bearer(c);
  return token ? userForToken(token) : null;
}

export function deviceName(c: Context): string | null {
  return c.req.header("x-device-name")?.slice(0, 80) ?? null;
}

export async function createSession(c: Context, userId: string): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    userAgent: c.req.header("user-agent") ?? null,
    deviceName: deviceName(c),
  });
  return token;
}

export function currentToken(c: Context): string | null {
  return bearer(c);
}

export async function revokeSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

interface ConnectedAccount {
  provider: "gmail" | "microsoft" | "imap";
  providerUserId: string;
  email: string;
  name: string;
  picture?: string | null;
  credentials: unknown;
}

/**
 * Connects a mailbox. Holding valid credentials for a mailbox proves ownership,
 * so it signs the caller in as the mailbox's user (or links it to the caller).
 */
export async function connectAccount(c: Context, data: ConnectedAccount) {
  const currentUser = await optionalUser(c);
  const [existing] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.provider, data.provider), eq(accounts.providerUserId, data.providerUserId)));

  const userId =
    currentUser ?? existing?.userId ?? (await db.insert(users).values({}).returning({ id: users.id }))[0].id;

  const values = {
    userId,
    email: data.email.toLowerCase(),
    name: data.name,
    picture: data.picture ?? null,
    credentials: encryptJson(data.credentials),
  };
  let accountId: string;
  if (existing) {
    await db.update(accounts).set(values).where(eq(accounts.id, existing.id));
    accountId = existing.id;
    forgetProvider(existing.id);
  } else {
    const position = (await db.select().from(accounts).where(eq(accounts.userId, userId))).length;
    const [row] = await db
      .insert(accounts)
      .values({ ...values, provider: data.provider, providerUserId: data.providerUserId, position })
      .returning({ id: accounts.id });
    accountId = row.id;
  }

  void syncAccount(accountId);
  const session = currentUser ? null : await createSession(c, userId);
  return { session, accountId };
}
