import type { SyncProgress } from "@gunes/shared";
import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db, schema } from "../db";
import { env } from "../env";
import { publish } from "../lib/events";
import { ProviderError } from "../lib/http";
import { recordError } from "../lib/observe";
import { inBackground } from "../lib/quota";
import { buildRawMessage } from "../lib/mime";
import type { SyncProgressHint, WriteOutcome } from "../providers/types";
import { type AccountRow, providerFor } from "./providers";
import { applyIncomingRules } from "./rules";
import { MessageStore } from "./store";

const { accounts, contacts, messages, outbox } = schema;
const CONTACTS_EVERY_MS = 6 * 60 * 60 * 1000;
const running = new Map<string, Promise<void>>();

function context(account: AccountRow) {
  return { id: account.id, userId: account.userId, email: account.email, provider: account.provider };
}

async function refreshContacts(account: AccountRow) {
  const provider = providerFor(account);
  if (!provider.listContacts) return;
  const list = await provider.listContacts();
  const byEmail = new Map(list.map((c) => [c.email, c]));
  const values = [...byEmail.values()].map((c) => ({
    userId: account.userId,
    email: c.email,
    name: c.name,
    photoUrl: c.photoUrl ?? null,
    source: "directory" as const,
  }));
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(contacts)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.email],
        set: {
          name: sql`case when excluded.name <> '' then excluded.name else ${contacts.name} end`,
          photoUrl: sql`coalesce(excluded.photo_url, ${contacts.photoUrl})`,
          source: sql`'directory'`,
        },
      });
  }
}

type EngineState = { _contactsAt?: number; pending?: boolean } & SyncProgressHint & Record<string, unknown>;

export async function countMessages(accountId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.accountId, accountId));
  return row?.n ?? 0;
}

/** Null once the account has finished its first full download. */
export function progressFrom(state: EngineState, synced: number): SyncProgress | null {
  if (!state.pending) return null;
  return { synced, total: state.total ?? null, phase: state.phase ?? "recent" };
}

const PROGRESS_EVERY_MS = 1_000;
const CHANGED_EVERY_MS = 5_000;

function isRateLimit(e: unknown) {
  return e instanceof ProviderError && (e.status === 429 || (e.status === 403 && /rate ?limit|quota/i.test(e.message)));
}

async function runSync(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) return;
  const provider = providerFor(account);
  const state = account.syncState as EngineState;
  const downloading = !account.lastSyncedAt || state.pending === true;
  let synced = downloading ? await countMessages(accountId) : 0;
  let lastPublished = 0;
  let lastChanged = Date.now();
  const report = (status: "syncing" | "ready", s: EngineState) =>
    publish(account.userId, { type: "sync", accountId, status, progress: progressFrom(s, synced) });
  const store = new MessageStore(context(account), (count) => {
    synced += count;
    // A long backfill run would otherwise hold back new mail until it finishes.
    if (Date.now() - lastChanged > CHANGED_EVERY_MS) {
      lastChanged = Date.now();
      publish(account.userId, { type: "changed", accountId });
    }
    if (downloading && Date.now() - lastPublished > PROGRESS_EVERY_MS) {
      lastPublished = Date.now();
      report("syncing", { ...state, pending: true });
    }
  });
  if (downloading) report("syncing", { ...state, pending: true });
  else publish(account.userId, { type: "sync", accountId, status: "syncing" });
  try {
    const { _contactsAt, ...providerState } = state;
    const nextState: EngineState = await inBackground(() => provider.sync(providerState, store));
    let contactsAt = _contactsAt ?? 0;
    if (Date.now() - contactsAt > CONTACTS_EVERY_MS) {
      await refreshContacts(account).catch((e: unknown) => console.warn("contacts refresh failed", accountId, e));
      contactsAt = Date.now();
    }
    await applyIncomingRules(context(account), provider, store.inserted);
    await db
      .update(accounts)
      .set({ syncState: { ...nextState, _contactsAt: contactsAt }, status: "ready", lastError: null, lastSyncedAt: new Date() })
      .where(eq(accounts.id, accountId));
    report(nextState.pending ? "syncing" : "ready", nextState);
    if (store.changed) publish(account.userId, { type: "changed", accountId });
    if (nextState.pending === true) setTimeout(() => void syncAccount(accountId), 2_000);
  } catch (e) {
    if (isRateLimit(e)) {
      // Not the account's fault: the provider wants us to slow down. Keep what was
      // stored, say nothing alarming and pick up again once the window has passed.
      console.warn("sync rate limited", accountId);
      if (store.changed) publish(account.userId, { type: "changed", accountId });
      report("syncing", { ...state, pending: true });
      setTimeout(() => void syncAccount(accountId), 65_000);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    const ref = recordError({
      kind: "sync",
      userId: account.userId,
      accountId,
      status: e instanceof ProviderError ? e.status : null,
      message,
      stack: e instanceof Error ? e.stack : null,
    });
    const lastError = `${message} (ref ${ref})`;
    await db.update(accounts).set({ status: "error", lastError }).where(eq(accounts.id, accountId));
    publish(account.userId, { type: "sync", accountId, status: "error", error: lastError });
  }
}

/**
 * Mirrors a draft save, delete or send into the local store right away. The provider is
 * the source of truth and the next sync confirms it, but users expect Drafts and Sent to
 * change the moment they act.
 */
export async function reflectWrite(account: AccountRow, outcome: WriteOutcome | void) {
  const provider = providerFor(account);
  const store = new MessageStore(context(account));
  try {
    if (outcome?.removed?.length) await store.deleteMessages(outcome.removed);
    if (outcome?.stored?.length && provider.fetchMessages) await store.upsertMessages(await provider.fetchMessages(outcome.stored));
  } catch (e) {
    console.warn("reflect write failed", account.id, e instanceof Error ? e.message : e);
  }
  publish(account.userId, { type: "changed", accountId: account.id });
  void syncAccount(account.id);
}

/** Coalesces concurrent requests so an account never syncs twice at once. */
export function syncAccount(accountId: string): Promise<void> {
  const existing = running.get(accountId);
  if (existing) return existing;
  const task = runSync(accountId).finally(() => running.delete(accountId));
  running.set(accountId, task);
  return task;
}

async function sendDue() {
  const due = await db
    .update(outbox)
    .set({ status: "sending", attempts: sql`${outbox.attempts} + 1` })
    .where(
      sql`${outbox.id} in (select id from outbox where status = 'scheduled' and send_at <= now() order by send_at limit 10 for update skip locked)`,
    )
    .returning();
  for (const item of due) {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, item.accountId));
    if (!account) continue;
    try {
      const raw = await buildRawMessage(item.payload);
      const outcome = await providerFor(account).send(raw, item.payload);
      await db.update(outbox).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(outbox.id, item.id));
      publish(item.userId, { type: "outbox", id: item.id, status: "sent" });
      await reflectWrite(account, outcome);
    } catch (e) {
      const ref = recordError({
        kind: "send",
        userId: item.userId,
        accountId: item.accountId,
        status: e instanceof ProviderError ? e.status : null,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      });
      const message = `${e instanceof Error ? e.message : String(e)} (ref ${ref})`;
      const retry = item.attempts < 3;
      await db
        .update(outbox)
        .set({
          status: retry ? "scheduled" : "failed",
          error: message,
          sendAt: retry ? new Date(Date.now() + item.attempts * 60_000) : item.sendAt,
        })
        .where(eq(outbox.id, item.id));
      publish(item.userId, { type: "outbox", id: item.id, status: retry ? "scheduled" : "failed", error: message });
    }
  }
}

let started = false;

export function startWorkers() {
  if (started) return;
  started = true;
  // A crash mid-send leaves rows in "sending"; retry them after a grace period.
  void db
    .update(outbox)
    .set({ status: "scheduled" })
    .where(and(eq(outbox.status, "sending"), lte(outbox.sendAt, sql`now() - interval '5 minutes'`)));

  setInterval(() => void sendDue().catch((e: unknown) => console.error("outbox", e)), 5_000);

  let cursor = 0;
  const tick = async () => {
    const list = await db.select({ id: accounts.id }).from(accounts).orderBy(asc(accounts.createdAt));
    if (!list.length) return;
    // Spread accounts across the interval instead of syncing them all at once.
    const account = list[cursor % list.length];
    cursor++;
    await syncAccount(account.id);
  };
  const run = () => {
    void db
      .select({ n: sql<number>`count(*)::int` })
      .from(accounts)
      .then(([row]) => {
        const count = Math.max(1, row?.n ?? 1);
        setTimeout(run, (env.SYNC_INTERVAL_SECONDS * 1000) / count);
      });
    void tick().catch((e: unknown) => console.error("sync tick", e));
  };
  run();
}
