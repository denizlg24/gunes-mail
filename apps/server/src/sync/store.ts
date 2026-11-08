import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db, schema } from "../db";
import type { Mailbox, MessageRef, NormalizedLabel, NormalizedMessage, SyncSink } from "../providers/types";

const { messages, threads, labels, contacts } = schema;

const FOLDER_LABELS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE"];

export function isFolderLabel(id: string): boolean {
  return FOLDER_LABELS.includes(id) || id.startsWith("folder:") || id.startsWith("mailbox:");
}

/**
 * Applies a label change the way the providers will: moving into a folder
 * replaces the current folder, and a message with no folder left is archived.
 * Gmail user labels are not folders, so they are added alongside.
 */
export function applyLabelChange(current: string[], add: string[], remove: string[], provider: string): string[] {
  let next = current.filter((l) => !remove.includes(l));
  const movingTo = add.find((l) => isFolderLabel(l) && l !== "DRAFT" && l !== "SENT");
  if (movingTo && provider !== "gmail") next = next.filter((l) => !isFolderLabel(l));
  if (movingTo && provider === "gmail") {
    next = next.filter((l) => l !== "ARCHIVE" && !(movingTo === "ARCHIVE" && l === "INBOX"));
  }
  next = Array.from(new Set([...next, ...add]));
  if (provider === "gmail") {
    const hasFolder = next.some((l) => ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "CHAT"].includes(l));
    next = hasFolder ? next.filter((l) => l !== "ARCHIVE") : Array.from(new Set([...next, "ARCHIVE"]));
  }
  return next;
}

export function threadSummary(rows: (typeof messages.$inferSelect)[]) {
  const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const senders = new Map<string, Mailbox>();
  for (const m of sorted) if (m.from.email) senders.set(m.from.email, m.from);
  const labelIds = Array.from(new Set(sorted.flatMap((m) => m.labelIds)));
  const latestCategory = [...sorted].reverse().find((m) => m.category)?.category ?? null;
  return {
    subject: first.subject,
    snippet: last.snippet,
    lastDate: last.date,
    labelIds,
    senders: Array.from(senders.values()),
    recipients: last.to,
    messageCount: sorted.length,
    unread: sorted.some((m) => m.labelIds.includes("UNREAD")),
    flagged: sorted.some((m) => m.labelIds.includes("STARRED")),
    draft: sorted.some((m) => m.labelIds.includes("DRAFT")),
    hasAttachments: sorted.some((m) => m.hasAttachments),
    category: latestCategory,
  };
}

export async function recomputeThreads(accountId: string, threadIds: string[]) {
  const ids = Array.from(new Set(threadIds));
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.accountId, accountId), inArray(messages.threadId, batch)));
    const grouped = new Map<string, (typeof messages.$inferSelect)[]>();
    for (const r of rows) grouped.set(r.threadId, [...(grouped.get(r.threadId) ?? []), r]);
    const empty = batch.filter((id) => !grouped.has(id));
    if (empty.length) {
      await db.delete(threads).where(and(eq(threads.accountId, accountId), inArray(threads.id, empty)));
    }
    const values = [...grouped].map(([id, list]) => ({ accountId, id, ...threadSummary(list) }));
    if (!values.length) continue;
    await db
      .insert(threads)
      .values(values)
      .onConflictDoUpdate({
        target: [threads.accountId, threads.id],
        set: {
          subject: sql`excluded.subject`,
          snippet: sql`excluded.snippet`,
          lastDate: sql`excluded.last_date`,
          labelIds: sql`excluded.label_ids`,
          senders: sql`excluded.senders`,
          recipients: sql`excluded.recipients`,
          messageCount: sql`excluded.message_count`,
          unread: sql`excluded.unread`,
          flagged: sql`excluded.flagged`,
          draft: sql`excluded.draft`,
          hasAttachments: sql`excluded.has_attachments`,
          category: sql`excluded.category`,
        },
      });
  }
}

async function recordContacts(userId: string, ownEmails: string[], inserted: NormalizedMessage[]) {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const tally = new Map<string, { name: string; sent: number; last: Date }>();
  for (const m of inserted) {
    const sent = m.labelIds.includes("SENT");
    const people = sent ? [...m.to, ...m.cc, ...m.bcc] : [m.from];
    for (const p of people) {
      const email = p.email.toLowerCase();
      if (!email || own.has(email)) continue;
      const prev = tally.get(email);
      const name = p.name && p.name !== p.email ? p.name : (prev?.name ?? "");
      tally.set(email, {
        name,
        sent: (prev?.sent ?? 0) + (sent ? 1 : 0),
        last: prev && prev.last > m.date ? prev.last : m.date,
      });
    }
  }
  const values = [...tally].map(([email, t]) => ({
    userId,
    email,
    name: t.name,
    source: "history" as const,
    timesContacted: t.sent,
    lastContactedAt: t.sent ? t.last : null,
  }));
  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(contacts)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.email],
        set: {
          name: sql`case when ${contacts.name} = '' then excluded.name else ${contacts.name} end`,
          timesContacted: sql`${contacts.timesContacted} + excluded.times_contacted`,
          lastContactedAt: sql`greatest(${contacts.lastContactedAt}, excluded.last_contacted_at)`,
        },
      });
  }
}

export interface AccountContext {
  id: string;
  userId: string;
  email: string;
  provider: string;
}

export class MessageStore implements SyncSink {
  /** Ids of messages first seen during this sync run, for rules. */
  readonly inserted: string[] = [];
  changed = false;

  constructor(
    private readonly account: AccountContext,
    private readonly onInserted?: (count: number) => void,
  ) {}

  async upsertMessages(list: NormalizedMessage[]) {
    if (!list.length) return;
    this.changed = true;
    const accountId = this.account.id;
    const rows = list.map((m) => ({
      accountId,
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds,
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      replyTo: m.replyTo,
      subject: m.subject,
      date: m.date,
      snippet: m.snippet,
      html: m.html ?? null,
      text: m.text ?? null,
      bodyFetched: m.bodyFetched,
      attachments: m.attachments,
      hasAttachments: m.hasAttachments,
      messageIdHeader: m.messageIdHeader ?? null,
      inReplyTo: m.inReplyTo ?? null,
      references: m.references ?? null,
      providerRef: m.providerRef ?? null,
      category: m.category ?? null,
    }));
    const result = await db
      .insert(messages)
      .values(rows)
      .onConflictDoUpdate({
        target: [messages.accountId, messages.id],
        set: {
          threadId: sql`excluded.thread_id`,
          labelIds: sql`excluded.label_ids`,
          subject: sql`excluded.subject`,
          snippet: sql`excluded.snippet`,
          from: sql`excluded."from"`,
          to: sql`excluded."to"`,
          cc: sql`excluded.cc`,
          bcc: sql`excluded.bcc`,
          date: sql`excluded.date`,
          providerRef: sql`excluded.provider_ref`,
          html: sql`coalesce(excluded.html, ${messages.html})`,
          text: sql`coalesce(excluded.text, ${messages.text})`,
          attachments: sql`case when excluded.body_fetched then excluded.attachments else ${messages.attachments} end`,
          hasAttachments: sql`case when ${messages.bodyFetched} and not excluded.body_fetched then ${messages.hasAttachments} else excluded.has_attachments end`,
          bodyFetched: sql`${messages.bodyFetched} or excluded.body_fetched`,
          category: sql`coalesce(${messages.category}, excluded.category)`,
        },
      })
      .returning({ id: messages.id, inserted: sql<boolean>`(xmax = 0)` });
    const insertedIds = new Set(result.filter((r) => r.inserted).map((r) => r.id));
    this.inserted.push(...insertedIds);
    await recomputeThreads(
      accountId,
      list.map((m) => m.threadId),
    );
    await recordContacts(
      this.account.userId,
      [this.account.email],
      list.filter((m) => insertedIds.has(m.id)),
    );
    if (insertedIds.size) this.onInserted?.(insertedIds.size);
  }

  async updateLabels(updates: { id: string; labelIds: string[] }[]) {
    if (!updates.length) return;
    this.changed = true;
    const threadIds: string[] = [];
    for (const u of updates) {
      const [row] = await db
        .update(messages)
        .set({ labelIds: u.labelIds })
        .where(and(eq(messages.accountId, this.account.id), eq(messages.id, u.id)))
        .returning({ threadId: messages.threadId });
      if (row) threadIds.push(row.threadId);
    }
    await recomputeThreads(this.account.id, threadIds);
  }

  async deleteMessages(ids: string[]) {
    if (!ids.length) return;
    this.changed = true;
    const removed = await db
      .delete(messages)
      .where(and(eq(messages.accountId, this.account.id), inArray(messages.id, ids)))
      .returning({ threadId: messages.threadId });
    await recomputeThreads(
      this.account.id,
      removed.map((r) => r.threadId),
    );
  }

  async replaceLabels(list: NormalizedLabel[]) {
    const accountId = this.account.id;
    if (list.length) {
      await db
        .insert(labels)
        .values(list.map((l) => ({ accountId, ...l, color: l.color ?? null, providerRef: l.providerRef ?? null })))
        .onConflictDoUpdate({
          target: [labels.accountId, labels.id],
          set: { name: sql`excluded.name`, type: sql`excluded.type`, color: sql`excluded.color`, providerRef: sql`excluded.provider_ref` },
        });
    }
    await db.delete(labels).where(
      and(
        eq(labels.accountId, accountId),
        list.length ? notInArray(labels.id, list.map((l) => l.id)) : sql`true`,
      ),
    );
  }

  async threadForMessageIds(ids: string[]): Promise<string | undefined> {
    const clean = ids.filter(Boolean);
    if (!clean.length) return undefined;
    const [row] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.accountId, this.account.id), inArray(messages.messageIdHeader, clean)))
      .limit(1);
    return row?.threadId;
  }
}

export async function messageRefs(accountId: string, threadIds: string[]): Promise<MessageRef[]> {
  if (!threadIds.length) return [];
  return db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      labelIds: messages.labelIds,
      providerRef: messages.providerRef,
    })
    .from(messages)
    .where(and(eq(messages.accountId, accountId), inArray(messages.threadId, threadIds)));
}

/** Optimistically mirror a provider change locally; the next sync reconciles. */
export async function applyLocally(account: AccountContext, refs: MessageRef[], add: string[], remove: string[]) {
  for (const ref of refs) {
    await db
      .update(messages)
      .set({ labelIds: applyLabelChange(ref.labelIds, add, remove, account.provider) })
      .where(and(eq(messages.accountId, account.id), eq(messages.id, ref.id)));
  }
  await recomputeThreads(
    account.id,
    refs.map((r) => r.threadId),
  );
}
