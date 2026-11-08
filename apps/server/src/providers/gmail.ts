import { env } from "../env";
import { ProviderError, chunk, mapLimit } from "../lib/http";
import { QuotaBucket } from "../lib/quota";
import { base64UrlDecode, decodeEncodedWords, parseMailboxes } from "../lib/mime";
import { OAuthToken, type OAuthCredentials } from "./oauth-token";
import type {
  AttachmentMeta,
  Body,
  Contact,
  MailProvider,
  MessageRef,
  NormalizedLabel,
  NormalizedMessage,
  OutgoingPayload,
  SyncProgressHint,
  SyncSink,
  WriteOutcome,
} from "./types";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE = "https://people.googleapis.com/v1";
const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Bcc",
  "Reply-To",
  "Subject",
  "Date",
  "Message-ID",
  "In-Reply-To",
  "References",
  "Content-Type",
];
const SYSTEM_IDS = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD", "IMPORTANT", "CHAT"]);
const FOLDER_LABELS = ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "CHAT"];
const OTHER_CATEGORIES = ["CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];
/** Messages fetched per sync cycle while backfilling older mail, to stay well under quota. */
const BACKFILL_PAGE = 200;

/**
 * Gmail allows 15,000 quota units per user per minute. Background sync is held to half of
 * that so opening, sending and moving mail always have room.
 */
const BACKGROUND_UNITS_PER_SECOND = 125;
const BACKGROUND_BURST = 500;

/** https://developers.google.com/workspace/gmail/api/reference/quota */
function quotaCost(path: string, method: string): number {
  if (path === "messages/send") return 100;
  if (path === "messages/batchModify" || path === "messages/batchDelete") return 50;
  if (path === "profile" || (path.startsWith("labels") && method === "GET")) return 1;
  if (path === "history") return 2;
  if (path.startsWith("drafts")) return method === "PUT" ? 15 : method === "GET" ? 5 : 10;
  return 5;
}

function isQuotaError(e: ProviderError) {
  return e.status === 403 && /rate ?limit|quota/i.test(e.message);
}
/** Messages per initial-sync run: ~2,500 quota units, well under Gmail's 15,000/min per user. */
const INITIAL_PAGE = 500;

interface Header {
  name: string;
  value: string;
}

interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: Part[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: Part;
}

interface HistoryRecord {
  messagesAdded?: { message: GmailMessage }[];
  messagesDeleted?: { message: GmailMessage }[];
  labelsAdded?: { message: GmailMessage }[];
  labelsRemoved?: { message: GmailMessage }[];
}

type GmailState = {
  historyId?: string;
  initial?: { historyId: string; pageToken: string | null };
  backfillPageToken?: string | null;
  backfillDone?: boolean;
  /** Set when the run stopped early to stay within quota; the engine re-runs soon. */
  pending?: boolean;
} & SyncProgressHint;

function header(headers: Header[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return decodeEncodedWords(headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "");
}

/** Gmail has no Archive label: a message is archived when it sits in no folder. */
export function withArchive(labelIds: string[]): string[] {
  const ids = labelIds.filter((l) => l !== "ARCHIVE");
  return FOLDER_LABELS.some((f) => ids.includes(f)) ? ids : [...ids, "ARCHIVE"];
}

function walk(part: Part | undefined, visit: (p: Part) => void) {
  if (!part) return;
  visit(part);
  part.parts?.forEach((p) => walk(p, visit));
}

export function parseParts(payload: Part | undefined): Body {
  let html: string | undefined;
  let text: string | undefined;
  const attachments: AttachmentMeta[] = [];
  let inlineIndex = 0;
  walk(payload, (part) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    const disposition = header(part.headers, "Content-Disposition").toLowerCase();
    const contentId = header(part.headers, "Content-ID").replace(/[<>]/g, "") || undefined;
    const isAttachment = !!part.filename || !!part.body?.attachmentId || disposition.startsWith("attachment");
    if (isAttachment && !mime.startsWith("multipart/")) {
      const id = part.body?.attachmentId ?? (part.body?.data ? `inline-data:${inlineIndex++}` : "");
      attachments.push({
        id,
        filename: decodeEncodedWords(part.filename || "attachment"),
        mimeType: mime || "application/octet-stream",
        size: part.body?.size ?? 0,
        contentId,
        inline: !!contentId && !disposition.startsWith("attachment"),
      });
      return;
    }
    if (!part.body?.data) return;
    if (mime === "text/html" && html === undefined) html = base64UrlDecode(part.body.data).toString("utf8");
    else if (mime === "text/plain" && text === undefined) text = base64UrlDecode(part.body.data).toString("utf8");
  });
  return { html, text, attachments };
}

function normalize(m: GmailMessage, body?: Body): NormalizedMessage {
  const h = m.payload?.headers;
  const labelIds = withArchive(m.labelIds ?? []);
  const contentType = header(h, "Content-Type").toLowerCase();
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds,
    from: parseMailboxes(header(h, "From"))[0] ?? { name: "(unknown)", email: "" },
    to: parseMailboxes(header(h, "To")),
    cc: parseMailboxes(header(h, "Cc")),
    bcc: parseMailboxes(header(h, "Bcc")),
    replyTo: parseMailboxes(header(h, "Reply-To")),
    subject: header(h, "Subject"),
    date: new Date(Number(m.internalDate ?? 0) || Date.parse(header(h, "Date")) || Date.now()),
    snippet: decodeHtmlEntities(m.snippet ?? ""),
    html: body?.html,
    text: body?.text,
    bodyFetched: !!body,
    attachments: body?.attachments ?? [],
    hasAttachments: body ? body.attachments.some((a) => !a.inline) : contentType.startsWith("multipart/mixed"),
    messageIdHeader: header(h, "Message-ID") || undefined,
    inReplyTo: header(h, "In-Reply-To") || undefined,
    references: header(h, "References") || undefined,
    category: labelIds.includes("INBOX")
      ? OTHER_CATEGORIES.some((c) => labelIds.includes(c))
        ? "other"
        : "focused"
      : undefined,
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** ARCHIVE is virtual on Gmail; translate it to INBOX removal. */
function toGmailLabels(add: string[], remove: string[]) {
  const addIds = add.filter((l) => l !== "ARCHIVE");
  const removeIds = remove.filter((l) => l !== "ARCHIVE");
  if (add.includes("ARCHIVE") && !removeIds.includes("INBOX")) removeIds.push("INBOX");
  return { addLabelIds: addIds, removeLabelIds: removeIds.filter((l) => !addIds.includes(l)) };
}

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  private readonly token: OAuthToken;
  private readonly quota = new QuotaBucket(BACKGROUND_BURST, BACKGROUND_UNITS_PER_SECOND);

  constructor(credentials: OAuthCredentials, onRotate: (c: OAuthCredentials) => Promise<void>) {
    this.token = new OAuthToken(
      credentials,
      {
        url: "https://oauth2.googleapis.com/token",
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      onRotate,
    );
  }

  private async api<T>(path: string, init?: RequestInit, query?: Record<string, string | string[]>): Promise<T> {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      for (const value of Array.isArray(v) ? v : [v]) url.searchParams.append(k, value);
    }
    await this.quota.take(quotaCost(path, init?.method ?? "GET"));
    try {
      return await this.token.request<T>(url.toString(), init);
    } catch (e) {
      if (e instanceof ProviderError && (e.status === 429 || isQuotaError(e))) this.quota.drain(60);
      throw e;
    }
  }

  private getMetadata(ids: string[]): Promise<GmailMessage[]> {
    return mapLimit(ids, 10, (id) =>
      this.api<GmailMessage>(`messages/${id}`, undefined, { format: "metadata", metadataHeaders: METADATA_HEADERS }).catch(
        (e: unknown) => {
          if (e instanceof ProviderError && e.status === 404) return null;
          throw e;
        },
      ),
    ).then((list) => list.filter((m): m is GmailMessage => m !== null));
  }

  private async listIds(q: string, pageToken?: string, maxResults = 500) {
    return this.api<{ messages?: { id: string }[]; nextPageToken?: string }>("messages", undefined, {
      q,
      maxResults: String(maxResults),
      includeSpamTrash: "true",
      ...(pageToken ? { pageToken } : {}),
    });
  }

  private async syncLabels(sink: SyncSink) {
    const { labels = [] } = await this.api<{
      labels?: { id: string; name: string; type: string; color?: NormalizedLabel["color"] }[];
    }>("labels");
    await sink.replaceLabels(
      labels
        .filter((l) => l.type === "user" || SYSTEM_IDS.has(l.id))
        .map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type === "user" ? "user" : "system",
          color: l.color,
        })),
    );
  }

  async sync(raw: Record<string, unknown>, sink: SyncSink): Promise<Record<string, unknown>> {
    const state = raw as GmailState;
    await this.syncLabels(sink);
    const downloading = !state.historyId || !state.backfillDone;
    const profile = downloading ? await this.api<{ historyId: string; messagesTotal: number }>("profile") : null;
    const total = profile?.messagesTotal;

    if (!state.historyId) {
      // Recent mail first, in quota-sized runs; history is replayed from the
      // snapshot taken before the first page, so nothing in between is lost.
      const initial = state.initial ?? { historyId: profile?.historyId ?? "", pageToken: null };
      const page = await this.listIds(
        `newer_than:${env.INITIAL_SYNC_DAYS}d`,
        initial.pageToken ?? undefined,
        INITIAL_PAGE,
      );
      const ids = (page.messages ?? []).map((m) => m.id);
      for (const batch of chunk(ids, 100)) {
        await sink.upsertMessages((await this.getMetadata(batch)).map((m) => normalize(m)));
      }
      if (page.nextPageToken) {
        return { initial: { ...initial, pageToken: page.nextPageToken }, pending: true, total, phase: "recent" } satisfies GmailState;
      }
      return {
        historyId: initial.historyId,
        backfillPageToken: null,
        backfillDone: false,
        pending: true,
        total,
        phase: "older",
      } satisfies GmailState;
    }

    let historyId = state.historyId;
    try {
      let pageToken: string | undefined;
      const added = new Set<string>();
      const deleted = new Set<string>();
      const relabeled = new Map<string, string[]>();
      do {
        const res = await this.api<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(
          "history",
          undefined,
          {
            startHistoryId: historyId,
            historyTypes: ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"],
            maxResults: "500",
            ...(pageToken ? { pageToken } : {}),
          },
        );
        for (const record of res.history ?? []) {
          record.messagesAdded?.forEach(({ message }) => added.add(message.id));
          record.messagesDeleted?.forEach(({ message }) => deleted.add(message.id));
          for (const { message } of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
            relabeled.set(message.id, withArchive(message.labelIds ?? []));
          }
        }
        pageToken = res.nextPageToken;
        if (!pageToken) historyId = res.historyId;
      } while (pageToken);

      for (const id of deleted) {
        added.delete(id);
        relabeled.delete(id);
      }
      for (const id of added) relabeled.delete(id);
      if (deleted.size) await sink.deleteMessages([...deleted]);
      for (const batch of chunk([...added], 100)) {
        await sink.upsertMessages((await this.getMetadata(batch)).map((m) => normalize(m)));
      }
      if (relabeled.size) {
        await sink.updateLabels([...relabeled].map(([id, labelIds]) => ({ id, labelIds })));
      }
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return {};
      throw e;
    }

    const next: GmailState = { ...state, historyId, pending: false, total: undefined, phase: undefined };
    if (!state.backfillDone) {
      const page = await this.listIds(
        `older_than:${env.INITIAL_SYNC_DAYS}d`,
        state.backfillPageToken ?? undefined,
        BACKFILL_PAGE,
      );
      const ids = (page.messages ?? []).map((m) => m.id);
      for (const batch of chunk(ids, 100)) {
        await sink.upsertMessages((await this.getMetadata(batch)).map((m) => normalize(m)));
      }
      next.backfillPageToken = page.nextPageToken ?? null;
      next.backfillDone = !page.nextPageToken;
      next.pending = !next.backfillDone;
      if (next.pending) {
        next.total = total;
        next.phase = "older";
      }
    }
    return next;
  }

  async fetchBody(message: MessageRef): Promise<Body> {
    const full = await this.api<GmailMessage>(`messages/${message.id}`, undefined, { format: "full" });
    return parseParts(full.payload);
  }

  async getAttachment(message: MessageRef, attachmentId: string): Promise<Uint8Array> {
    if (attachmentId.startsWith("inline-data:")) {
      const full = await this.api<GmailMessage>(`messages/${message.id}`, undefined, { format: "full" });
      const index = Number(attachmentId.slice("inline-data:".length));
      let seen = 0;
      let data: string | undefined;
      walk(full.payload, (p) => {
        if ((p.filename || p.body?.attachmentId) && !p.body?.attachmentId && p.body?.data) {
          if (seen++ === index) data = p.body.data;
        }
      });
      if (!data) throw new ProviderError(404, "Attachment not found");
      return base64UrlDecode(data);
    }
    const res = await this.api<{ data: string }>(`messages/${message.id}/attachments/${attachmentId}`);
    return base64UrlDecode(res.data);
  }

  async modify(messages: MessageRef[], add: string[], remove: string[]) {
    const labels = toGmailLabels(add, remove);
    if (!labels.addLabelIds.length && !labels.removeLabelIds.length) return;
    for (const batch of chunk(messages, 1000)) {
      await this.api("messages/batchModify", {
        method: "POST",
        body: JSON.stringify({ ids: batch.map((m) => m.id), ...labels }),
      });
    }
  }

  trash(messages: MessageRef[]) {
    return this.modify(messages, ["TRASH"], ["INBOX", "SPAM"]);
  }

  untrash(messages: MessageRef[]) {
    return this.modify(messages, [], ["TRASH"]);
  }

  async deleteForever(messages: MessageRef[]) {
    for (const batch of chunk(messages, 1000)) {
      await this.api("messages/batchDelete", { method: "POST", body: JSON.stringify({ ids: batch.map((m) => m.id) }) });
    }
  }

  async send(raw: Buffer, payload: OutgoingPayload): Promise<WriteOutcome> {
    const sent = await this.api<{ id: string }>("messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: raw.toString("base64url"), threadId: payload.threadId }),
    });
    const removed = payload.draftId ? await this.deleteDraft(payload.draftId).catch(() => ({ removed: [] })) : { removed: [] };
    return { stored: [sent.id], removed: removed.removed };
  }

  private async draftMessageId(draftId: string): Promise<string | undefined> {
    try {
      const draft = await this.api<{ message?: { id: string } }>(`drafts/${draftId}`, undefined, { format: "minimal" });
      return draft.message?.id;
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return undefined;
      throw e;
    }
  }

  /** Updating a Gmail draft replaces its message, so the old message id has to be dropped locally. */
  async saveDraft(raw: Buffer, payload: OutgoingPayload): Promise<{ draftId: string } & WriteOutcome> {
    const body = JSON.stringify({ message: { raw: raw.toString("base64url"), threadId: payload.threadId } });
    const previous = payload.draftId ? await this.draftMessageId(payload.draftId) : undefined;
    const res = payload.draftId
      ? await this.api<{ id: string; message: { id: string } }>(`drafts/${payload.draftId}`, { method: "PUT", body })
      : await this.api<{ id: string; message: { id: string } }>("drafts", { method: "POST", body });
    return {
      draftId: res.id,
      stored: [res.message.id],
      removed: previous && previous !== res.message.id ? [previous] : [],
    };
  }

  async deleteDraft(draftId: string): Promise<WriteOutcome> {
    const messageId = await this.draftMessageId(draftId);
    await this.api(`drafts/${draftId}`, { method: "DELETE" });
    return { removed: messageId ? [messageId] : [] };
  }

  async fetchMessages(ids: string[]): Promise<NormalizedMessage[]> {
    return (await this.getMetadata(ids)).map((m) => normalize(m));
  }

  async resolveDraftId(message: MessageRef): Promise<string | undefined> {
    let pageToken: string | undefined;
    do {
      const res = await this.api<{ drafts?: { id: string; message: { id: string } }[]; nextPageToken?: string }>(
        "drafts",
        undefined,
        { maxResults: "500", ...(pageToken ? { pageToken } : {}) },
      );
      const hit = res.drafts?.find((d) => d.message.id === message.id);
      if (hit) return hit.id;
      pageToken = res.nextPageToken;
    } while (pageToken);
    return undefined;
  }

  async createLabel(name: string): Promise<NormalizedLabel> {
    const l = await this.api<{ id: string; name: string }>("labels", {
      method: "POST",
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
    return { id: l.id, name: l.name, type: "user" };
  }

  async renameLabel(id: string, name: string) {
    await this.api(`labels/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  }

  async deleteLabel(id: string) {
    await this.api(`labels/${id}`, { method: "DELETE" });
  }

  async listContacts(): Promise<Contact[]> {
    const out: Contact[] = [];
    const collect = (people: Person[] | undefined) => {
      for (const p of people ?? []) {
        const name = p.names?.[0]?.displayName ?? "";
        const photo = p.photos?.find((ph) => !ph.default)?.url;
        for (const e of p.emailAddresses ?? []) {
          if (e.value) out.push({ email: e.value.toLowerCase(), name, photoUrl: photo });
        }
      }
    };
    const page = async (url: string, key: "connections" | "otherContacts") => {
      let pageToken: string | undefined;
      do {
        const u = new URL(url);
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        const res = await this.token.request<Record<string, unknown> & { nextPageToken?: string }>(u.toString());
        collect(res[key] as Person[] | undefined);
        pageToken = res.nextPageToken;
      } while (pageToken);
    };
    try {
      await page(`${PEOPLE}/people/me/connections?personFields=names,emailAddresses,photos&pageSize=1000`, "connections");
      await page(`${PEOPLE}/otherContacts?readMask=names,emailAddresses,photos&pageSize=1000`, "otherContacts");
    } catch (e) {
      // Accounts connected before contacts access was requested keep working without photos.
      if (e instanceof ProviderError && e.status === 403) return out;
      throw e;
    }
    return out;
  }
}

interface Person {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  photos?: { url?: string; default?: boolean }[];
}
