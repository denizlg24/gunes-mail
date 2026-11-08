import { and, asc, eq, lte, sql } from "drizzle-orm";

import { db, schema } from "../db";
import { env } from "../env";
import { publish } from "../lib/events";
import { buildRawMessage } from "../lib/mime";
import { type AccountRow, providerFor } from "./providers";
import { applyIncomingRules } from "./rules";
import { MessageStore } from "./store";

const { accounts, contacts, outbox } = schema;
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

async function runSync(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) return;
  const provider = providerFor(account);
  const store = new MessageStore(context(account));
  publish(account.userId, { type: "sync", accountId, status: "syncing" });
  try {
    const { _contactsAt, ...providerState } = account.syncState as { _contactsAt?: number } & Record<string, unknown>;
    const nextState = await provider.sync(providerState, store);
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
    publish(account.userId, { type: "sync", accountId, status: "ready" });
    if (store.changed) publish(account.userId, { type: "changed", accountId });
    if (nextState.pending === true) setTimeout(() => void syncAccount(accountId), 2_000);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("sync failed", accountId, message);
    await db.update(accounts).set({ status: "error", lastError: message }).where(eq(accounts.id, accountId));
    publish(account.userId, { type: "sync", accountId, status: "error", error: message });
  }
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
      await providerFor(account).send(raw, item.payload);
      await db.update(outbox).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(outbox.id, item.id));
      publish(item.userId, { type: "outbox", id: item.id, status: "sent" });
      void syncAccount(account.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
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
