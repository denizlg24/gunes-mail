import type { TriageCategory } from "@gunes/shared";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "../db";
import { env } from "../env";
import { publish } from "../lib/events";
import { mapLimit } from "../lib/http";
import { htmlToText } from "../lib/mime";
import { recomputeThreads } from "../sync/store";
import { ClassifierUnavailable, classifierEnabled, classify } from "./classifier";

const { accounts, messages, users } = schema;

const BATCH = 50;
const CONCURRENCY = 6;
const IDLE_MS = 15_000;
const BACKOFF_MS = 5 * 60_000;

/**
 * Classifies one batch of recent, unclassified inbox mail, optionally only for some
 * accounts. Returns how many rows it settled.
 */
export async function triageBatch(scope?: { accountIds: string[] }): Promise<number> {
  const rows = await db
    .select({
      accountId: messages.accountId,
      id: messages.id,
      threadId: messages.threadId,
      userId: accounts.userId,
      from: messages.from,
      subject: messages.subject,
      snippet: messages.snippet,
      text: messages.text,
      html: messages.html,
      attachments: messages.attachments,
      hasAttachments: messages.hasAttachments,
    })
    .from(messages)
    .innerJoin(accounts, eq(accounts.id, messages.accountId))
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(
      and(
        sql`${messages.triagedAt} is null`,
        sql`${messages.date} > now() - make_interval(days => ${env.CLASSIFY_DAYS})`,
        sql`${messages.labelIds} @> array['INBOX']::text[]`,
        sql`not (${messages.labelIds} && array['SENT','DRAFT'])`,
        sql`lower(${messages.from}->>'email') <> lower(${accounts.email})`,
        sql`(${users.settings}->>'smartCategories')::boolean is true`,
        scope ? inArray(messages.accountId, scope.accountIds) : undefined,
      ),
    )
    .orderBy(sql`${messages.date} desc`)
    .limit(BATCH);
  if (!rows.length) return 0;

  let unavailable: ClassifierUnavailable | null = null;
  const settled = await mapLimit(rows, CONCURRENCY, async (m) => {
    if (unavailable) return null;
    const body = m.text?.trim() || (m.html ? htmlToText(m.html) : "") || m.snippet;
    try {
      const result = await classify({
        subject: m.subject,
        body,
        senderName: m.from.name,
        senderAddress: m.from.email,
        attachmentCount: m.attachments.filter((a) => !a.inline).length || (m.hasAttachments ? 1 : 0),
        hasHtml: !!m.html,
      });
      return { ...m, triage: result.category, confidence: result.confidence };
    } catch (e) {
      if (e instanceof ClassifierUnavailable) {
        unavailable = e;
        return null;
      }
      return { ...m, triage: null, confidence: null };
    }
  });

  const done = settled.filter((r) => r !== null);
  for (const r of done) {
    await db
      .update(messages)
      .set({
        triage: sql`case when ${messages.triageSource} = 'user' then ${messages.triage} else ${r.triage} end`,
        triageConfidence: r.confidence,
        triageSource: sql`coalesce(${messages.triageSource}, ${r.triage ? "model" : null})`,
        triagedAt: new Date(),
      })
      .where(and(eq(messages.accountId, r.accountId), eq(messages.id, r.id)));
  }
  const byAccount = new Map<string, { userId: string; threads: string[] }>();
  for (const r of done) {
    const entry = byAccount.get(r.accountId) ?? { userId: r.userId, threads: [] };
    entry.threads.push(r.threadId);
    byAccount.set(r.accountId, entry);
  }
  for (const [accountId, { userId, threads }] of byAccount) {
    await recomputeThreads(accountId, threads);
    publish(userId, { type: "changed", accountId });
  }
  if (unavailable) throw unavailable;
  return done.length;
}

/** A user's pick overrides the model for every message in the conversation. */
export async function setThreadTriage(accountId: string, threadIds: string[], category: TriageCategory | null) {
  await db
    .update(messages)
    .set({
      triage: category,
      triageSource: category ? "user" : null,
      triagedAt: new Date(),
    })
    .where(and(eq(messages.accountId, accountId), inArray(messages.threadId, threadIds)));
  await recomputeThreads(accountId, threadIds);
}

let started = false;

export function startTriageWorker() {
  if (started || !classifierEnabled()) return;
  started = true;
  const loop = async () => {
    let wait = IDLE_MS;
    try {
      // Drain the backlog quickly, then idle until new mail arrives.
      wait = (await triageBatch()) >= BATCH ? 0 : IDLE_MS;
    } catch (e) {
      console.warn("classifier unavailable, backing off", e instanceof Error ? e.message : e);
      wait = BACKOFF_MS;
    }
    setTimeout(() => void loop(), wait);
  };
  void loop();
}
