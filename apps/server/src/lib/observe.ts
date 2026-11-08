import { format } from "node:util";

import { lt, sql } from "drizzle-orm";

import { db, schema } from "../db";

const { errorEvents, logEntries, requestStats } = schema;

const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
const internalError = (...args: unknown[]) => original.error("[observe]", ...args);

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Short, unambiguous and easy to read aloud: GM-7K3QX9P2. */
export function newRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `GM-${Array.from(bytes, (b) => ALPHABET[b % 32]).join("")}`;
}

export interface ErrorRecord {
  kind: "request" | "provider" | "sync" | "send";
  message: string;
  stack?: string | null;
  userId?: string | null;
  accountId?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
}

export function recordError(record: ErrorRecord): string {
  const ref = newRef();
  console.error(`[${ref}] ${record.kind} ${record.method ?? ""} ${record.path ?? ""} ${record.status ?? ""}: ${record.message}`);
  void db
    .insert(errorEvents)
    .values({ ref, ...record, message: record.message.slice(0, 4000), stack: record.stack?.slice(0, 8000) ?? null })
    .catch((e: unknown) => internalError("could not store error", ref, e));
  return ref;
}

type Level = "info" | "warn" | "error";
const pendingLogs: { level: Level; message: string; createdAt: Date }[] = [];
const MAX_PENDING_LOGS = 5_000;

function capture(level: Level, args: unknown[]) {
  if (pendingLogs.length >= MAX_PENDING_LOGS) pendingLogs.shift();
  pendingLogs.push({ level, message: format(...args).slice(0, 4000), createdAt: new Date() });
}

async function flushLogs() {
  if (!pendingLogs.length) return;
  const batch = pendingLogs.splice(0, pendingLogs.length);
  await db.insert(logEntries).values(batch).catch((e: unknown) => internalError("could not store logs", e));
}

/**
 * Normalizes concrete paths so metrics group by route:
 * /v1/accounts/1f0c…/threads/18c2… becomes /v1/accounts/:id/threads/:id.
 */
export function routeOf(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
      (segment.length >= 10 && /\d/.test(segment) && /^[\w.~%=-]+$/.test(segment))
        ? ":id"
        : segment,
    )
    .join("/");
}

interface Bucket {
  minute: Date;
  route: string;
  statusClass: string;
  count: number;
  totalMs: number;
  maxMs: number;
}
const buckets = new Map<string, Bucket>();

export function recordRequest(path: string, status: number, ms: number) {
  const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const route = routeOf(path);
  const statusClass = `${Math.floor(status / 100)}xx`;
  const key = `${minute.getTime()}|${route}|${statusClass}`;
  const bucket = buckets.get(key) ?? { minute, route, statusClass, count: 0, totalMs: 0, maxMs: 0 };
  bucket.count++;
  bucket.totalMs += Math.round(ms);
  bucket.maxMs = Math.max(bucket.maxMs, Math.round(ms));
  buckets.set(key, bucket);
}

async function flushRequests() {
  if (!buckets.size) return;
  const batch = [...buckets.values()];
  buckets.clear();
  await db
    .insert(requestStats)
    .values(batch)
    .onConflictDoUpdate({
      target: [requestStats.minute, requestStats.route, requestStats.statusClass],
      set: {
        count: sql`${requestStats.count} + excluded.count`,
        totalMs: sql`${requestStats.totalMs} + excluded.total_ms`,
        maxMs: sql`greatest(${requestStats.maxMs}, excluded.max_ms)`,
      },
    })
    .catch((e: unknown) => internalError("could not store request stats", e));
}

async function prune() {
  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  await Promise.all([
    db.delete(errorEvents).where(lt(errorEvents.createdAt, days(30))),
    db.delete(logEntries).where(lt(logEntries.createdAt, days(14))),
    db.delete(requestStats).where(lt(requestStats.minute, days(14))),
  ]).catch((e: unknown) => internalError("prune failed", e));
}

let started = false;

/** Mirrors console output into Postgres for the admin dashboard and starts the flush timers. */
export function startObservability() {
  if (started) return;
  started = true;
  console.info = (...args: unknown[]) => {
    original.info(...args);
    capture("info", args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    capture("warn", args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    capture("error", args);
  };
  setInterval(() => void flushLogs(), 5_000);
  setInterval(() => void flushRequests(), 15_000);
  setInterval(() => void prune(), 6 * 60 * 60 * 1000);
  void prune();
}
