import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { env } from "./env";

const COOKIE = "gm_admin";
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Buffer.from(sig).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function passwordMatches(candidate: string): Promise<boolean> {
  // Compare digests so the comparison time doesn't depend on the password length.
  return constantTimeEqual(await hmac(`pw:${candidate}`), await hmac(`pw:${env.ADMIN_PASSWORD}`));
}

export async function startSession(c: Context) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  setCookie(c, COOKIE, `${expires}.${await hmac(`session:${expires}`)}`, {
    httpOnly: true,
    secure: env.SECURE_COOKIES,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function endSession(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
}

async function validSession(c: Context): Promise<boolean> {
  const value = getCookie(c, COOKIE);
  if (!value) return false;
  const [expires, sig] = value.split(".");
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return constantTimeEqual(sig, await hmac(`session:${expires}`));
}

export async function requireAdmin(c: Context, next: Next) {
  if (await validSession(c)) return next();
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Sign in again" }, 401);
  return c.redirect("/login");
}

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Five tries per address per 15 minutes. */
export function loginAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 5;
}
