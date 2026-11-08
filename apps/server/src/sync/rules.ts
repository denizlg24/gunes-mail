import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, schema } from "../db";
import type { MailProvider, OutgoingPayload, RuleAction, RuleCondition } from "../providers/types";
import { type AccountContext, applyLocally, recomputeThreads } from "./store";

const { rules, messages } = schema;

export interface RuleSubject {
  from: { email: string; name: string };
  to: { email: string; name: string }[];
  cc: { email: string; name: string }[];
  subject: string;
  body: string;
  hasAttachments: boolean;
}

function fieldValues(field: RuleCondition["field"], m: RuleSubject): string[] {
  const people = (list: { email: string; name: string }[]) => list.flatMap((p) => [p.email, p.name]);
  switch (field) {
    case "from":
      return [m.from.email, m.from.name];
    case "to":
      return people(m.to);
    case "cc":
      return people(m.cc);
    case "subject":
      return [m.subject];
    case "body":
      return [m.body];
    case "sender_domain":
      return [m.from.email.split("@")[1] ?? ""];
    case "recipient_domain":
      return [...m.to, ...m.cc].map((p) => p.email.split("@")[1] ?? "");
    case "has_attachment":
      return [String(m.hasAttachments)];
  }
}

export function conditionMatches(c: RuleCondition, m: RuleSubject): boolean {
  if (c.field === "has_attachment") return m.hasAttachments === (c.value !== "false");
  const needle = c.value.toLowerCase();
  const values = fieldValues(c.field, m).map((v) => v.toLowerCase());
  const test = (v: string) => {
    switch (c.operator) {
      case "contains":
      case "not_contains":
        return v.includes(needle);
      case "equals":
        return v === needle;
      case "starts_with":
        return v.startsWith(needle);
      case "ends_with":
        return v.endsWith(needle);
      case "matches":
        try {
          return new RegExp(c.value, "i").test(v);
        } catch {
          return false;
        }
    }
  };
  const hit = values.some(test);
  return c.operator === "not_contains" ? !hit : hit;
}

export function ruleMatches(rule: Pick<typeof rules.$inferSelect, "match" | "conditions">, m: RuleSubject): boolean {
  if (!rule.conditions.length) return true;
  return rule.match === "all"
    ? rule.conditions.every((c) => conditionMatches(c, m))
    : rule.conditions.some((c) => conditionMatches(c, m));
}

async function activeRules(userId: string, accountId: string, kind: "incoming" | "outgoing") {
  return db
    .select()
    .from(rules)
    .where(
      and(
        eq(rules.userId, userId),
        eq(rules.kind, kind),
        eq(rules.enabled, true),
        or(isNull(rules.accountId), eq(rules.accountId, accountId)),
      ),
    )
    .orderBy(asc(rules.position), asc(rules.createdAt));
}

export function labelChangesFor(actions: RuleAction[]) {
  const add: string[] = [];
  const remove: string[] = [];
  let category: "focused" | "other" | undefined;
  let trash = false;
  for (const a of actions) {
    switch (a.type) {
      case "move":
        add.push(a.folder);
        if (a.folder !== "INBOX") remove.push("INBOX");
        break;
      case "label":
        add.push(a.labelId);
        break;
      case "mark_read":
        remove.push("UNREAD");
        break;
      case "flag":
        add.push("STARRED");
        break;
      case "archive":
        add.push("ARCHIVE");
        remove.push("INBOX");
        break;
      case "mark_spam":
        add.push("SPAM");
        remove.push("INBOX");
        break;
      case "delete":
        trash = true;
        break;
      case "focus":
        category = a.category;
        break;
    }
  }
  return { add, remove, category, trash };
}

/** Runs incoming rules over the given messages (newly synced or "run now"). */
export async function applyIncomingRules(account: AccountContext, provider: MailProvider, messageIds: string[]) {
  if (!messageIds.length) return;
  const list = await activeRules(account.userId, account.id, "incoming");
  const candidates = await db
    .select()
    .from(messages)
    .where(and(eq(messages.accountId, account.id), inArray(messages.id, messageIds)));
  const ownEmail = account.email.toLowerCase();

  for (const m of candidates) {
    const incoming = m.labelIds.includes("INBOX") && m.from.email.toLowerCase() !== ownEmail;
    if (list.length && incoming) {
      const subject: RuleSubject = {
        from: m.from,
        to: m.to,
        cc: m.cc,
        subject: m.subject,
        body: m.text ?? m.snippet,
        hasAttachments: m.hasAttachments,
      };
      const actions: RuleAction[] = [];
      for (const rule of list) {
        if (!ruleMatches(rule, subject)) continue;
        actions.push(...rule.actions);
        if (rule.stopProcessing) break;
      }
      const change = labelChangesFor(actions);
      const ref = { id: m.id, threadId: m.threadId, labelIds: m.labelIds, providerRef: m.providerRef };
      if (change.trash) {
        await provider.trash([ref]);
        await applyLocally(account, [ref], ["TRASH"], ["INBOX"]);
      } else if (change.add.length || change.remove.length) {
        await provider.modify([ref], change.add, change.remove);
        await applyLocally(account, [ref], change.add, change.remove);
      }
      if (change.category) {
        await db
          .update(messages)
          .set({ category: change.category })
          .where(and(eq(messages.accountId, account.id), eq(messages.id, m.id)));
        await recomputeThreads(account.id, [m.threadId]);
      }
    }
    await db
      .update(messages)
      .set({ rulesApplied: true })
      .where(and(eq(messages.accountId, account.id), eq(messages.id, m.id)));
  }
}

/** Outgoing rules: returns the extra delay and the possibly amended payload. */
export async function applyOutgoingRules(account: AccountContext, payload: OutgoingPayload) {
  const list = await activeRules(account.userId, account.id, "outgoing");
  let delayMinutes = 0;
  const bcc = [...payload.bcc];
  const subject: RuleSubject = {
    from: payload.from,
    to: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    body: payload.text,
    hasAttachments: payload.attachments.length > 0,
  };
  for (const rule of list) {
    if (!ruleMatches(rule, subject)) continue;
    for (const a of rule.actions) {
      if (a.type === "delay_send") delayMinutes = Math.max(delayMinutes, a.minutes);
      if (a.type === "add_bcc" && !bcc.some((b) => b.email === a.email.toLowerCase())) {
        bcc.push({ email: a.email.toLowerCase(), name: a.email });
      }
    }
    if (rule.stopProcessing) break;
  }
  return { delayMinutes, payload: { ...payload, bcc } };
}
