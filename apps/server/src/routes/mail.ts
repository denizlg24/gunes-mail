import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppEnv } from "../auth";
import { db, schema } from "../db";
import { publish } from "../lib/events";
import { mapLimit } from "../lib/http";
import { buildRawMessage, snippetFrom } from "../lib/mime";
import type { MessageRef, OutgoingPayload } from "../providers/types";
import { syncAccount } from "../sync/engine";
import { forgetProvider, providerFor } from "../sync/providers";
import { applyIncomingRules, applyOutgoingRules } from "../sync/rules";
import { applyLocally, messageRefs, recomputeThreads } from "../sync/store";

const { accounts, labels, threads, messages, outbox } = schema;
const PAGE_SIZE = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedAccount(userId: string, accountId: string) {
  if (!UUID_RE.test(accountId)) throw new HTTPException(404, { message: "Account not found" });
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!account) throw new HTTPException(404, { message: "Account not found" });
  return account;
}

function ctx(account: typeof accounts.$inferSelect) {
  return { id: account.id, userId: account.userId, email: account.email, provider: account.provider };
}

const mailbox = z.object({ name: z.string(), email: z.string() });
const outgoing = z.object({
  from: mailbox,
  to: z.array(mailbox),
  cc: z.array(mailbox),
  bcc: z.array(mailbox),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  attachments: z.array(z.object({ filename: z.string(), mimeType: z.string(), size: z.number(), data: z.string() })),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  draftId: z.string().optional(),
});

const SEARCH_FIELDS: Record<string, (v: string) => SQL> = {
  from: (v) => sql`exists (select 1 from messages m where m.account_id = ${threads.accountId} and m.thread_id = ${threads.id} and (m."from"->>'email' ilike ${`%${v}%`} or m."from"->>'name' ilike ${`%${v}%`}))`,
  to: (v) => sql`exists (select 1 from messages m, jsonb_array_elements(m."to" || m.cc) r where m.account_id = ${threads.accountId} and m.thread_id = ${threads.id} and (r->>'email' ilike ${`%${v}%`} or r->>'name' ilike ${`%${v}%`}))`,
  subject: (v) => sql`${threads.subject} ilike ${`%${v}%`}`,
};

function searchConditions(q: string): SQL[] {
  const conditions: SQL[] = [];
  const words: string[] = [];
  for (const token of q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const [key, ...rest] = token.split(":");
    const value = rest.join(":").replace(/"/g, "");
    if (rest.length && SEARCH_FIELDS[key.toLowerCase()] && value) {
      conditions.push(SEARCH_FIELDS[key.toLowerCase()](value));
    } else if (token === "has:attachment") {
      conditions.push(sql`${threads.hasAttachments}`);
    } else if (token === "is:unread") {
      conditions.push(sql`${threads.unread}`);
    } else if (token === "is:flagged" || token === "is:starred") {
      conditions.push(sql`${threads.flagged}`);
    } else {
      words.push(...token.replace(/"/g, "").split(/[^\p{L}\p{N}@._-]+/u).filter(Boolean));
    }
  }
  if (words.length) {
    const tsquery = words.map((w) => `${w.replace(/[':&|!()<>\\]/g, "")}:*`).filter((w) => w !== ":*").join(" & ");
    if (tsquery) {
      conditions.push(
        sql`exists (select 1 from messages m where m.account_id = ${threads.accountId} and m.thread_id = ${threads.id} and m.search @@ to_tsquery('simple', ${tsquery}))`,
      );
    }
  }
  return conditions;
}

function encodeCursor(row: { lastDate: Date; id: string }) {
  return Buffer.from(`${row.lastDate.toISOString()}|${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string) {
  const [date, ...id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  return { date: new Date(date), id: id.join("|") };
}

function serializeThread(t: typeof threads.$inferSelect) {
  return {
    id: t.id,
    subject: t.subject,
    snippet: t.snippet,
    senders: t.senders,
    recipients: t.recipients,
    date: t.lastDate.getTime(),
    unread: t.unread,
    flagged: t.flagged,
    hasAttachments: t.hasAttachments,
    messageCount: t.messageCount,
    labelIds: t.labelIds,
    draft: t.draft,
  };
}

function serializeMessage(m: typeof messages.$inferSelect) {
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds,
    from: m.from,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    replyTo: m.replyTo,
    subject: m.subject,
    date: m.date.getTime(),
    snippet: m.snippet,
    html: m.html ?? undefined,
    text: m.text ?? undefined,
    attachments: m.attachments.map((a) => ({
      attachmentId: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      inline: a.inline,
    })),
    messageIdHeader: m.messageIdHeader ?? undefined,
    references: m.references ?? undefined,
    unread: m.labelIds.includes("UNREAD"),
    flagged: m.labelIds.includes("STARRED"),
    draft: m.labelIds.includes("DRAFT"),
  };
}

async function scheduleSend(
  account: typeof accounts.$inferSelect,
  payload: OutgoingPayload,
  options: { sendAt?: number; undoSeconds: number },
) {
  const ruled = await applyOutgoingRules(ctx(account), payload);
  const base = options.sendAt ?? Date.now() + options.undoSeconds * 1000;
  const sendAt = new Date(base + ruled.delayMinutes * 60_000);
  const [row] = await db
    .insert(outbox)
    .values({ userId: account.userId, accountId: account.id, payload: ruled.payload, sendAt })
    .returning();
  publish(account.userId, { type: "outbox", id: row.id, status: "scheduled" });
  return { id: row.id, sendAt: row.sendAt.getTime(), delayedByRule: ruled.delayMinutes };
}

export const mail = new Hono<AppEnv>()
  .get("/accounts", async (c) => {
    const rows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, c.get("userId")))
      .orderBy(asc(accounts.position), asc(accounts.createdAt));
    return c.json(
      rows.map((a) => ({
        id: a.id,
        provider: a.provider,
        email: a.email,
        name: a.name,
        picture: a.picture,
        status: a.status,
        lastError: a.lastError,
        lastSyncedAt: a.lastSyncedAt?.getTime() ?? null,
      })),
    );
  })
  .delete("/accounts/:id", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    await db.delete(accounts).where(eq(accounts.id, account.id));
    forgetProvider(account.id);
    return c.body(null, 204);
  })
  .post("/accounts/:id/sync", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    void syncAccount(account.id);
    return c.body(null, 202);
  })
  .get("/accounts/:id/labels", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const [rows, counts] = await Promise.all([
      db.select().from(labels).where(eq(labels.accountId, account.id)),
      db.execute<{ label: string; unread: number; total: number }>(sql`
        select l as label,
               count(*) filter (where unread)::int as unread,
               count(*)::int as total
        from threads, unnest(label_ids) as l
        where account_id = ${account.id}
          and (l in ('TRASH', 'SPAM') or not (label_ids && array['TRASH', 'SPAM']))
        group by l`),
    ]);
    const byLabel = new Map(counts.map((r) => [r.label, r]));
    const known = new Set(rows.map((l) => l.id));
    const list = [
      ...rows,
      ...["INBOX", "DRAFT", "SENT", "TRASH", "SPAM", "STARRED", "ARCHIVE"]
        .filter((id) => !known.has(id))
        .map((id) => ({ id, name: id, type: "system" as const, color: null })),
    ];
    return c.json(
      list.map((l) => {
        const count = byLabel.get(l.id);
        return {
          id: l.id,
          name: l.name,
          type: l.type,
          color: l.color ?? undefined,
          unread: l.id === "DRAFT" ? (count?.total ?? 0) : (count?.unread ?? 0),
          total: count?.total ?? 0,
        };
      }),
    );
  })
  .post("/accounts/:id/labels", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const { name } = z.object({ name: z.string().min(1) }).parse(await c.req.json());
    const label = await providerFor(account).createLabel(name);
    await db.insert(labels).values({ accountId: account.id, ...label, color: label.color ?? null }).onConflictDoNothing();
    return c.json({ ...label, unread: 0, total: 0 });
  })
  .patch("/accounts/:id/labels/:labelId", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const { name } = z.object({ name: z.string().min(1) }).parse(await c.req.json());
    await providerFor(account).renameLabel(c.req.param("labelId"), name);
    void syncAccount(account.id);
    return c.body(null, 204);
  })
  .delete("/accounts/:id/labels/:labelId", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const labelId = c.req.param("labelId");
    await providerFor(account).deleteLabel(labelId);
    await db.delete(labels).where(and(eq(labels.accountId, account.id), eq(labels.id, labelId)));
    void syncAccount(account.id);
    return c.body(null, 204);
  })
  .get("/accounts/:id/threads", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const { folder, tab, filter, q, cursor } = z
      .object({
        folder: z.string().default("INBOX"),
        tab: z.enum(["focused", "other"]).optional(),
        filter: z.enum(["all", "unread", "flagged", "attachments", "tome"]).default("all"),
        q: z.string().optional(),
        cursor: z.string().optional(),
      })
      .parse(c.req.query());

    const where: SQL[] = [eq(threads.accountId, account.id)];
    if (q?.trim()) {
      where.push(...searchConditions(q.trim()), sql`not (${threads.labelIds} && array['TRASH','SPAM'])`);
    } else {
      where.push(sql`${threads.labelIds} @> array[${folder}]::text[]`);
      if (folder !== "TRASH" && folder !== "SPAM") where.push(sql`not (${threads.labelIds} && array['TRASH','SPAM'])`);
      if (folder === "ARCHIVE") where.push(sql`not (${threads.labelIds} && array['INBOX'])`);
      if (folder === "INBOX" && tab) {
        where.push(tab === "other" ? sql`${threads.category} = 'other'` : sql`${threads.category} is distinct from 'other'`);
      }
    }
    if (filter === "unread") where.push(sql`${threads.unread}`);
    if (filter === "flagged") where.push(sql`${threads.flagged}`);
    if (filter === "attachments") where.push(sql`${threads.hasAttachments}`);
    if (filter === "tome") {
      where.push(
        sql`exists (select 1 from messages m where m.account_id = ${threads.accountId} and m.thread_id = ${threads.id} and m."to" @> ${JSON.stringify([{ email: account.email }])}::jsonb)`,
      );
    }
    if (cursor) {
      const after = decodeCursor(cursor);
      where.push(sql`(${threads.lastDate}, ${threads.id}) < (${after.date}, ${after.id})`);
    }
    const rows = await db
      .select()
      .from(threads)
      .where(and(...where))
      .orderBy(desc(threads.lastDate), desc(threads.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    return c.json({
      threads: page.map(serializeThread),
      nextPageToken: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : undefined,
      syncing: account.status === "syncing" && !account.lastSyncedAt,
    });
  })
  .get("/accounts/:id/threads/:threadId", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const threadId = c.req.param("threadId");
    let rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.accountId, account.id), eq(messages.threadId, threadId)))
      .orderBy(asc(messages.date));
    if (!rows.length) throw new HTTPException(404, { message: "Conversation not found" });
    const missing = rows.filter((m) => !m.bodyFetched);
    if (missing.length) {
      const provider = providerFor(account);
      await mapLimit(missing, 3, async (m) => {
        const body = await provider.fetchBody({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, providerRef: m.providerRef });
        await db
          .update(messages)
          .set({
            html: body.html ?? null,
            text: body.text ?? null,
            attachments: body.attachments,
            hasAttachments: body.attachments.some((a) => !a.inline),
            bodyFetched: true,
            snippet: m.snippet || snippetFrom(body.text, body.html),
          })
          .where(and(eq(messages.accountId, account.id), eq(messages.id, m.id)));
      });
      await recomputeThreads(account.id, [threadId]);
      rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.accountId, account.id), eq(messages.threadId, threadId)))
        .orderBy(asc(messages.date));
    }
    const list = rows.map(serializeMessage);
    return c.json({
      id: threadId,
      subject: list[0]?.subject ?? "",
      messages: list,
      labelIds: Array.from(new Set(list.flatMap((m) => m.labelIds))),
    });
  })
  .post("/accounts/:id/threads/:action{modify|trash|untrash|delete}", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const body = z
      .object({ ids: z.array(z.string()).min(1).max(1000), add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) })
      .parse(await c.req.json());
    const refs: MessageRef[] = await messageRefs(account.id, body.ids);
    const provider = providerFor(account);
    switch (c.req.param("action")) {
      case "modify":
        await provider.modify(refs, body.add, body.remove);
        await applyLocally(ctx(account), refs, body.add, body.remove);
        break;
      case "trash":
        await provider.trash(refs);
        await applyLocally(ctx(account), refs, ["TRASH"], ["INBOX", "SPAM"]);
        break;
      case "untrash":
        await provider.untrash(refs);
        await applyLocally(ctx(account), refs, account.provider === "gmail" ? [] : ["INBOX"], ["TRASH"]);
        break;
      case "delete":
        await provider.deleteForever(refs);
        await db.delete(messages).where(
          and(
            eq(messages.accountId, account.id),
            inArray(
              messages.id,
              refs.map((r) => r.id),
            ),
          ),
        );
        await recomputeThreads(account.id, body.ids);
        break;
    }
    publish(account.userId, { type: "changed", accountId: account.id });
    return c.body(null, 204);
  })
  .post("/accounts/:id/folders/:folder/:action{mark-read|empty}", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const folder = c.req.param("folder");
    const action = c.req.param("action");
    const rows = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.accountId, account.id),
          sql`${threads.labelIds} @> array[${folder}]::text[]`,
          action === "mark-read" ? sql`${threads.unread}` : sql`true`,
        ),
      );
    const refs = await messageRefs(
      account.id,
      rows.map((r) => r.id),
    );
    const provider = providerFor(account);
    if (action === "mark-read") {
      const unread = refs.filter((r) => r.labelIds.includes("UNREAD"));
      await provider.modify(unread, [], ["UNREAD"]);
      await applyLocally(ctx(account), unread, [], ["UNREAD"]);
    } else {
      if (folder !== "TRASH" && folder !== "SPAM") throw new HTTPException(400, { message: "Only Deleted Items and Junk can be emptied" });
      await provider.deleteForever(refs);
      await db.delete(messages).where(
        and(
          eq(messages.accountId, account.id),
          inArray(
            messages.id,
            refs.map((r) => r.id),
          ),
        ),
      );
      await recomputeThreads(
        account.id,
        rows.map((r) => r.id),
      );
    }
    publish(account.userId, { type: "changed", accountId: account.id });
    return c.body(null, 204);
  })
  .get("/accounts/:id/messages/:messageId/attachments/:attachmentId", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const [m] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.accountId, account.id), eq(messages.id, c.req.param("messageId"))));
    if (!m) throw new HTTPException(404, { message: "Message not found" });
    const attachmentId = c.req.param("attachmentId");
    const meta = m.attachments.find((a) => a.id === attachmentId);
    const bytes = await providerFor(account).getAttachment(
      { id: m.id, threadId: m.threadId, labelIds: m.labelIds, providerRef: m.providerRef },
      attachmentId,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": meta?.mimeType ?? "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(meta?.filename ?? "attachment")}`,
        "cache-control": "private, max-age=86400",
      },
    });
  })
  .get("/accounts/:id/messages/:messageId/draft-id", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const [m] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.accountId, account.id), eq(messages.id, c.req.param("messageId"))));
    if (!m) throw new HTTPException(404, { message: "Message not found" });
    const provider = providerFor(account);
    const ref = { id: m.id, threadId: m.threadId, labelIds: m.labelIds, providerRef: m.providerRef };
    const draftId = provider.resolveDraftId ? await provider.resolveDraftId(ref) : m.id;
    return c.json({ draftId: draftId ?? null });
  })
  .post("/accounts/:id/drafts", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const payload = outgoing.parse(await c.req.json());
    const draftId = await providerFor(account).saveDraft(await buildRawMessage(payload), payload);
    void syncAccount(account.id);
    return c.json({ draftId });
  })
  .delete("/accounts/:id/drafts/:draftId", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    await providerFor(account).deleteDraft(c.req.param("draftId"));
    void syncAccount(account.id);
    return c.body(null, 204);
  })
  .post("/accounts/:id/send", async (c) => {
    const account = await ownedAccount(c.get("userId"), c.req.param("id"));
    const body = z
      .object({ payload: outgoing, sendAt: z.number().optional(), undoSeconds: z.number().min(0).max(60).default(0) })
      .parse(await c.req.json());
    return c.json(await scheduleSend(account, body.payload, { sendAt: body.sendAt, undoSeconds: body.undoSeconds }));
  })
  .get("/outbox", async (c) => {
    const rows = await db
      .select()
      .from(outbox)
      .where(and(eq(outbox.userId, c.get("userId")), inArray(outbox.status, ["scheduled", "sending", "failed"])))
      .orderBy(asc(outbox.sendAt));
    return c.json(
      rows.map((r) => ({
        id: r.id,
        accountId: r.accountId,
        status: r.status,
        error: r.error,
        sendAt: r.sendAt.getTime(),
        subject: r.payload.subject,
        to: r.payload.to,
        payload: r.payload,
      })),
    );
  })
  .delete("/outbox/:id", async (c) => {
    const [row] = await db
      .update(outbox)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(outbox.id, c.req.param("id")),
          eq(outbox.userId, c.get("userId")),
          inArray(outbox.status, ["scheduled", "failed"]),
        ),
      )
      .returning();
    if (!row) throw new HTTPException(409, { message: "Already sent" });
    publish(row.userId, { type: "outbox", id: row.id, status: "cancelled" });
    return c.json({ payload: row.payload, accountId: row.accountId });
  })
  .post("/outbox/:id/send-now", async (c) => {
    await db
      .update(outbox)
      .set({ sendAt: new Date(), status: "scheduled" })
      .where(
        and(eq(outbox.id, c.req.param("id")), eq(outbox.userId, c.get("userId")), inArray(outbox.status, ["scheduled", "failed"])),
      );
    return c.body(null, 202);
  })
  .post("/rules/:ruleId/run", async (c) => {
    const userId = c.get("userId");
    const [rule] = await db
      .select()
      .from(schema.rules)
      .where(and(eq(schema.rules.id, c.req.param("ruleId")), eq(schema.rules.userId, userId)));
    if (!rule) throw new HTTPException(404, { message: "Rule not found" });
    const targets = rule.accountId
      ? [await ownedAccount(userId, rule.accountId)]
      : await db.select().from(accounts).where(eq(accounts.userId, userId));
    let processed = 0;
    for (const account of targets) {
      const inbox = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.accountId, account.id), sql`${messages.labelIds} @> array['INBOX']::text[]`))
        .orderBy(desc(messages.date))
        .limit(2000);
      processed += inbox.length;
      await applyIncomingRules(
        ctx(account),
        providerFor(account),
        inbox.map((m) => m.id),
      );
      publish(userId, { type: "changed", accountId: account.id });
    }
    return c.json({ processed });
  });
