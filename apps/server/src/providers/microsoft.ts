import { env } from "../env";
import { ProviderError, chunk, errorFrom, fetchWithRetry, mapLimit } from "../lib/http";
import { snippetFrom } from "../lib/mime";
import { OAuthToken, type OAuthCredentials } from "./oauth-token";
import type {
  AttachmentMeta,
  Body,
  Contact,
  MailProvider,
  Mailbox,
  MessageRef,
  NormalizedLabel,
  NormalizedMessage,
  OutgoingPayload,
  SyncSink,
  WriteOutcome,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = [
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Contacts.Read",
  "https://graph.microsoft.com/People.Read",
].join(" ");
/** Immutable ids keep message ids stable across folder moves, so local rows survive a move. */
const ID_TYPE = 'IdType="ImmutableId"';
const MESSAGE_FIELDS = [
  "id",
  "conversationId",
  "parentFolderId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "replyTo",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "isDraft",
  "flag",
  "categories",
  "hasAttachments",
  "internetMessageId",
  "inferenceClassification",
].join(",");
const FOLDER_FIELDS = "id,displayName,parentFolderId,childFolderCount";

export const WELL_KNOWN_FOLDERS = {
  inbox: "INBOX",
  sentitems: "SENT",
  drafts: "DRAFT",
  deleteditems: "TRASH",
  junkemail: "SPAM",
  archive: "ARCHIVE",
} as const;
type WellKnownName = keyof typeof WELL_KNOWN_FOLDERS;

const LABEL_TO_WELL_KNOWN: Record<string, WellKnownName> = {
  INBOX: "inbox",
  ARCHIVE: "archive",
  SPAM: "junkemail",
  TRASH: "deleteditems",
};
const FOLDER_PREFIX = "folder:";
const CATEGORY_PREFIX = "category:";
/** Delta pages per sync call; the rest resumes from the stored nextLink on the next call. */
const PAGE_BUDGET = 50;
const BATCH_SIZE = 20;

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  parentFolderId?: string;
  subject?: string | null;
  bodyPreview?: string;
  from?: GraphRecipient | null;
  sender?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string | null;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: "notFlagged" | "flagged" | "complete" };
  categories?: string[];
  hasAttachments?: boolean;
  internetMessageId?: string;
  inferenceClassification?: "focused" | "other";
  "@removed"?: { reason: string };
}

export interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
}

interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
}

interface GraphPage<T> {
  value: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface BatchRequest {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: Record<string, unknown>;
}

interface BatchResponse<T> {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: T & { error?: { code?: string; message?: string } };
}

interface FolderState {
  deltaLink?: string;
  nextLink?: string;
}

type MicrosoftState = {
  folders?: Record<string, FolderState>;
  categories?: string[];
};

export interface GraphPatch {
  isRead?: boolean;
  flag?: { flagStatus: "flagged" | "notFlagged" };
  categories?: string[];
}

export interface ModifyPlan {
  patch?: GraphPatch;
  destinationId?: string;
}

export function folderLabelId(folderId: string, wellKnown: Map<string, string>): string {
  return wellKnown.get(folderId) ?? `${FOLDER_PREFIX}${folderId}`;
}

/** Builds one label per folder, naming nested folders "Parent/Child" the way Gmail names nested labels. */
export function mapFolders(folders: GraphFolder[], wellKnown: Map<string, string>): NormalizedLabel[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (folder: GraphFolder, seen = new Set<string>()): string => {
    const parent = folder.parentFolderId ? byId.get(folder.parentFolderId) : undefined;
    if (!parent || seen.has(parent.id)) return folder.displayName;
    seen.add(folder.id);
    return `${pathOf(parent, seen)}/${folder.displayName}`;
  };
  return folders.map((f) => {
    const system = wellKnown.get(f.id);
    return system
      ? { id: system, name: f.displayName, type: "system", providerRef: f.id }
      : { id: `${FOLDER_PREFIX}${f.id}`, name: pathOf(f), type: "user", providerRef: f.id };
  });
}

export function categoryLabels(names: Iterable<string>): NormalizedLabel[] {
  return [...new Set(names)].sort().map((name) => ({ id: `${CATEGORY_PREFIX}${name}`, name, type: "user" }));
}

function toMailbox(r: GraphRecipient | null | undefined): Mailbox | undefined {
  const address = r?.emailAddress?.address?.trim();
  if (!address) return undefined;
  const name = r?.emailAddress?.name?.trim();
  return { email: address.toLowerCase(), name: name || address };
}

function toMailboxes(list: GraphRecipient[] | undefined): Mailbox[] {
  return (list ?? []).map(toMailbox).filter((m): m is Mailbox => !!m);
}

export function messageLabels(m: GraphMessage, folderLabel: string): string[] {
  const labels = [folderLabel];
  if (m.isRead === false) labels.push("UNREAD");
  if (m.flag?.flagStatus === "flagged") labels.push("STARRED");
  for (const c of m.categories ?? []) labels.push(`${CATEGORY_PREFIX}${c}`);
  return labels;
}

export function normalizeMessage(m: GraphMessage, folderLabel: string, body?: Body): NormalizedMessage {
  const date = Date.parse(m.receivedDateTime ?? m.sentDateTime ?? "");
  return {
    id: m.id,
    threadId: m.conversationId ?? m.id,
    labelIds: messageLabels(m, folderLabel),
    from: toMailbox(m.from) ?? toMailbox(m.sender) ?? { name: "(unknown)", email: "" },
    to: toMailboxes(m.toRecipients),
    cc: toMailboxes(m.ccRecipients),
    bcc: toMailboxes(m.bccRecipients),
    replyTo: toMailboxes(m.replyTo),
    subject: m.subject ?? "",
    date: new Date(Number.isNaN(date) ? Date.now() : date),
    snippet: snippetFrom(m.bodyPreview ?? "", undefined),
    html: body?.html,
    text: body?.text,
    bodyFetched: !!body,
    attachments: body?.attachments ?? [],
    hasAttachments: body ? body.attachments.some((a) => !a.inline) : !!m.hasAttachments,
    messageIdHeader: m.internetMessageId || undefined,
    providerRef: { folderId: m.parentFolderId ?? null },
    category: m.inferenceClassification,
  };
}

function folderDestination(label: string): string | undefined {
  if (label.startsWith(FOLDER_PREFIX)) return label.slice(FOLDER_PREFIX.length);
  return LABEL_TO_WELL_KNOWN[label];
}

/**
 * Translates Gmail-style label edits into one Graph PATCH and at most one move.
 * Removing the current folder without adding another follows Gmail semantics:
 * dropping INBOX archives, dropping TRASH or SPAM restores to the inbox.
 */
export function planModify(message: MessageRef, add: string[], remove: string[]): ModifyPlan {
  const patch: GraphPatch = {};
  if (add.includes("UNREAD")) patch.isRead = false;
  else if (remove.includes("UNREAD")) patch.isRead = true;
  if (add.includes("STARRED")) patch.flag = { flagStatus: "flagged" };
  else if (remove.includes("STARRED")) patch.flag = { flagStatus: "notFlagged" };

  const current = message.labelIds.filter((l) => l.startsWith(CATEGORY_PREFIX));
  const removed = new Set(remove.filter((l) => l.startsWith(CATEGORY_PREFIX)));
  const next = [...new Set([...current.filter((l) => !removed.has(l)), ...add.filter((l) => l.startsWith(CATEGORY_PREFIX))])];
  if (next.length !== current.length || next.some((l, i) => l !== current[i])) {
    patch.categories = next.map((l) => l.slice(CATEGORY_PREFIX.length));
  }

  let target = add.find((l) => folderDestination(l) !== undefined);
  if (!target) {
    if (remove.includes("INBOX") && message.labelIds.includes("INBOX")) target = "ARCHIVE";
    else if (remove.some((l) => (l === "TRASH" || l === "SPAM") && message.labelIds.includes(l))) target = "INBOX";
  }
  const destinationId = target && !message.labelIds.includes(target) ? folderDestination(target) : undefined;

  return { patch: Object.keys(patch).length ? patch : undefined, destinationId };
}

function isSyncStateLost(e: unknown): boolean {
  return (
    e instanceof ProviderError &&
    (e.status === 410 || /syncState(NotFound|Invalid)|resyncRequired/i.test(e.message))
  );
}

function batchError<T>(res: BatchResponse<T>): ProviderError {
  return new ProviderError(res.status, res.body?.error?.message ?? `Graph request failed (${res.status})`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MicrosoftProvider implements MailProvider {
  readonly kind = "microsoft" as const;
  private readonly token: OAuthToken;

  constructor(credentials: OAuthCredentials, onRotate: (c: OAuthCredentials) => Promise<void>) {
    this.token = new OAuthToken(
      credentials,
      {
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId: env.MICROSOFT_CLIENT_ID,
        scope: SCOPE,
      },
      onRotate,
    );
  }

  private api<T>(
    path: string,
    init: RequestInit = {},
    query?: Record<string, string>,
    prefer: string[] = [],
  ): Promise<T> {
    const url = new URL(path.startsWith("https://") ? path : `${GRAPH}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const headers = new Headers(init.headers);
    headers.set("prefer", [ID_TYPE, ...prefer].join(", "));
    return this.token.request<T>(url.toString(), { ...init, headers });
  }

  private async raw(path: string): Promise<Uint8Array> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token.get(attempt > 0);
      const res = await fetchWithRetry(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) throw await errorFrom(res);
      return new Uint8Array(await res.arrayBuffer());
    }
    throw new ProviderError(401, "Unauthorized");
  }

  private async paginate<T>(path: string, query?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let page = await this.api<GraphPage<T>>(path, {}, query);
    out.push(...page.value);
    while (page["@odata.nextLink"]) {
      page = await this.api<GraphPage<T>>(page["@odata.nextLink"]);
      out.push(...page.value);
    }
    return out;
  }

  /** JSON $batch with per-request retry on throttling; returns every response keyed by request id. */
  private async batch<T>(requests: BatchRequest[]): Promise<Map<string, BatchResponse<T>>> {
    const results = new Map<string, BatchResponse<T>>();
    let pending = requests;
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      const throttled: BatchRequest[] = [];
      let wait = 0;
      for (const group of chunk(pending, BATCH_SIZE)) {
        const res = await this.api<{ responses: BatchResponse<T>[] }>("/$batch", {
          method: "POST",
          body: JSON.stringify({
            requests: group.map((r) => ({
              ...r,
              headers: { prefer: ID_TYPE, ...(r.body ? { "content-type": "application/json" } : {}) },
            })),
          }),
        });
        for (const response of res.responses) {
          const request = group.find((r) => r.id === response.id);
          if (request && (response.status === 429 || response.status === 503) && attempt < 4) {
            throttled.push(request);
            const retryAfter = Number(response.headers?.["Retry-After"] ?? response.headers?.["retry-after"]);
            wait = Math.max(wait, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
          } else {
            results.set(response.id, response);
          }
        }
      }
      pending = throttled;
      if (pending.length) await sleep(Math.min(wait, 30_000));
    }
    return results;
  }

  private async batchAll(requests: BatchRequest[], allow: number[] = []) {
    const results = await this.batch<Record<string, unknown>>(requests);
    for (const res of results.values()) {
      if (res.status >= 400 && !allow.includes(res.status)) throw batchError(res);
    }
  }

  private async wellKnownFolders(): Promise<Map<string, string>> {
    const names: WellKnownName[] = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "archive"];
    const results = await this.batch<{ id: string }>(
      names.map((name) => ({ id: name, method: "GET", url: `/me/mailFolders/${name}?$select=id` })),
    );
    const map = new Map<string, string>();
    for (const name of names) {
      const res = results.get(name);
      if (res?.body?.id && res.status < 300) map.set(res.body.id, WELL_KNOWN_FOLDERS[name]);
      else if (res && res.status !== 404) throw batchError(res);
    }
    return map;
  }

  private async listFolders(): Promise<GraphFolder[]> {
    const all: GraphFolder[] = [];
    let level = await this.paginate<GraphFolder>("/me/mailFolders", { $select: FOLDER_FIELDS, $top: "100" });
    while (level.length) {
      all.push(...level);
      const parents = level.filter((f) => (f.childFolderCount ?? 0) > 0);
      level = (
        await mapLimit(parents, 4, (f) =>
          this.paginate<GraphFolder>(`/me/mailFolders/${encodeURIComponent(f.id)}/childFolders`, {
            $select: FOLDER_FIELDS,
            $top: "100",
          }),
        )
      ).flat();
    }
    return all;
  }

  private async replaceLabels(sink: SyncSink, folders: GraphFolder[], wellKnown: Map<string, string>, categories: string[]) {
    await sink.replaceLabels([
      ...mapFolders(folders, wellKnown),
      { id: "STARRED", name: "Flagged", type: "system" },
      { id: "UNREAD", name: "Unread", type: "system" },
      ...categoryLabels(categories),
    ]);
  }

  /** Delta reports moves as removals too; only drop messages that no longer exist anywhere. */
  private async confirmDeleted(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const results = await this.batch<{ id: string }>(
      ids.map((id, i) => ({ id: String(i), method: "GET", url: `/me/messages/${encodeURIComponent(id)}?$select=id` })),
    );
    return ids.filter((_, i) => results.get(String(i))?.status === 404);
  }

  async sync(raw: Record<string, unknown>, sink: SyncSink): Promise<Record<string, unknown>> {
    const state = raw as MicrosoftState;
    const [wellKnown, folders] = await Promise.all([this.wellKnownFolders(), this.listFolders()]);
    const categories = new Set(state.categories ?? []);
    await this.replaceLabels(sink, folders, wellKnown, [...categories]);

    const folderStates: Record<string, FolderState> = {};
    for (const f of folders) if (state.folders?.[f.id]) folderStates[f.id] = state.folders[f.id];
    const snapshot = (): MicrosoftState => ({ folders: { ...folderStates }, categories: [...categories].sort() });

    const priority = ["INBOX", "SENT", "DRAFT"];
    const rank = (f: GraphFolder) => {
      const i = priority.indexOf(wellKnown.get(f.id) ?? "");
      return i === -1 ? priority.length : i;
    };
    const ordered = [...folders].sort((a, b) => rank(a) - rank(b));
    const since = new Date(Date.now() - env.INITIAL_SYNC_DAYS * 86_400_000).toISOString();
    let pages = 0;
    let labelsDirty = false;

    for (const folder of ordered) {
      const label = folderLabelId(folder.id, wellKnown);
      const initial = (): [string, Record<string, string>] => [
        `/me/mailFolders/${encodeURIComponent(folder.id)}/messages/delta`,
        { $select: MESSAGE_FIELDS, $filter: `receivedDateTime ge ${since}` },
      ];
      let fs = folderStates[folder.id] ?? {};
      let [url, query] = fs.nextLink ?? fs.deltaLink ? [fs.nextLink ?? fs.deltaLink ?? "", {}] : initial();

      while (true) {
        if (pages >= PAGE_BUDGET) {
          if (labelsDirty) await this.replaceLabels(sink, folders, wellKnown, [...categories]);
          return snapshot();
        }
        let page: GraphPage<GraphMessage>;
        try {
          page = await this.api<GraphPage<GraphMessage>>(url, {}, query, ["odata.maxpagesize=100"]);
        } catch (e) {
          if (!isSyncStateLost(e) || (!fs.deltaLink && !fs.nextLink)) throw e;
          fs = {};
          delete folderStates[folder.id];
          [url, query] = initial();
          continue;
        }
        pages++;

        const removed = page.value.filter((m) => m["@removed"]).map((m) => m.id);
        const changed = page.value.filter((m) => !m["@removed"]);
        for (const m of changed) {
          for (const c of m.categories ?? []) {
            if (!categories.has(c)) {
              categories.add(c);
              labelsDirty = true;
            }
          }
        }
        if (changed.length) {
          await sink.upsertMessages(
            changed.map((m) => normalizeMessage(m, folderLabelId(m.parentFolderId ?? folder.id, wellKnown))),
          );
        }
        const gone = await this.confirmDeleted(removed);
        if (gone.length) await sink.deleteMessages(gone);

        const next = page["@odata.nextLink"];
        if (next) {
          fs = { ...fs, nextLink: next };
          folderStates[folder.id] = fs;
          [url, query] = [next, {}];
          continue;
        }
        fs = { deltaLink: page["@odata.deltaLink"] };
        folderStates[folder.id] = fs;
        break;
      }
    }

    if (labelsDirty) await this.replaceLabels(sink, folders, wellKnown, [...categories]);
    return snapshot();
  }

  async fetchBody(message: MessageRef): Promise<Body> {
    const id = encodeURIComponent(message.id);
    const [full, attachments] = await Promise.all([
      this.api<{ body?: { contentType?: string; content?: string } }>(
        `/me/messages/${id}`,
        {},
        { $select: "body,uniqueBody" },
        ['outlook.body-content-type="html"'],
      ),
      this.paginate<GraphAttachment>(`/me/messages/${id}/attachments`, {
        $select: "id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId",
      }).catch((e: unknown) => {
        // contentId exists only on fileAttachment; fall back if the type-cast select is rejected.
        if (e instanceof ProviderError && e.status === 400) {
          return this.paginate<GraphAttachment>(`/me/messages/${id}/attachments`, {});
        }
        throw e;
      }),
    ]);
    const content = full.body?.content;
    const isHtml = full.body?.contentType?.toLowerCase() === "html";
    return {
      html: isHtml ? content : undefined,
      text: isHtml ? undefined : content,
      attachments: attachments.map(toAttachmentMeta),
    };
  }

  getAttachment(message: MessageRef, attachmentId: string): Promise<Uint8Array> {
    return this.raw(
      `/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
    );
  }

  async modify(messages: MessageRef[], add: string[], remove: string[]) {
    const plans = messages.map((m) => ({ id: encodeURIComponent(m.id), plan: planModify(m, add, remove) }));
    const patches: BatchRequest[] = [];
    const moves: BatchRequest[] = [];
    plans.forEach(({ id, plan }, i) => {
      if (plan.patch) patches.push({ id: String(i), method: "PATCH", url: `/me/messages/${id}`, body: { ...plan.patch } });
      if (plan.destinationId) {
        moves.push({ id: String(i), method: "POST", url: `/me/messages/${id}/move`, body: { destinationId: plan.destinationId } });
      }
    });
    if (patches.length) await this.batchAll(patches);
    if (moves.length) await this.batchAll(moves);
  }

  private move(messages: MessageRef[], destinationId: string) {
    return this.batchAll(
      messages.map((m, i) => ({
        id: String(i),
        method: "POST",
        url: `/me/messages/${encodeURIComponent(m.id)}/move`,
        body: { destinationId },
      })),
    );
  }

  trash(messages: MessageRef[]) {
    return this.move(messages, "deleteditems");
  }

  untrash(messages: MessageRef[]) {
    return this.move(messages, "inbox");
  }

  deleteForever(messages: MessageRef[]) {
    return this.batchAll(
      messages.map((m, i) => ({
        id: String(i),
        method: "POST",
        url: `/me/messages/${encodeURIComponent(m.id)}/permanentDelete`,
      })),
      [404],
    );
  }

  async send(raw: Buffer, payload: OutgoingPayload) {
    await this.api("/me/sendMail", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: raw.toString("base64"),
    });
    if (payload.draftId) await this.deleteDraft(payload.draftId).catch(() => undefined);
  }

  async saveDraft(raw: Buffer, payload: OutgoingPayload): Promise<{ draftId: string } & WriteOutcome> {
    const draft = await this.api<{ id: string }>("/me/messages", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: raw.toString("base64"),
    });
    if (payload.draftId) {
      await this.deleteDraft(payload.draftId).catch((e: unknown) => {
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
      });
    }
    return { draftId: draft.id, removed: payload.draftId ? [payload.draftId] : [] };
  }

  async deleteDraft(draftId: string): Promise<WriteOutcome> {
    await this.api(`/me/messages/${encodeURIComponent(draftId)}`, { method: "DELETE" });
    return { removed: [draftId] };
  }

  async createLabel(name: string): Promise<NormalizedLabel> {
    const segments = name.split("/").map((s) => s.trim()).filter(Boolean);
    if (!segments.length) throw new ProviderError(400, "Folder name is required");
    let parentId: string | undefined;
    let folder: GraphFolder | undefined;
    for (const [i, segment] of segments.entries()) {
      const base = parentId ? `/me/mailFolders/${encodeURIComponent(parentId)}/childFolders` : "/me/mailFolders";
      const last = i === segments.length - 1;
      const existing = last
        ? undefined
        : (
            await this.api<GraphPage<GraphFolder>>(base, {}, {
              $filter: `displayName eq '${segment.replace(/'/g, "''")}'`,
              $select: FOLDER_FIELDS,
            })
          ).value[0];
      folder =
        existing ??
        (await this.api<GraphFolder>(base, { method: "POST", body: JSON.stringify({ displayName: segment }) }));
      parentId = folder.id;
    }
    if (!folder) throw new ProviderError(500, "Folder was not created");
    return { id: `${FOLDER_PREFIX}${folder.id}`, name: segments.join("/"), type: "user", providerRef: folder.id };
  }

  async renameLabel(id: string, name: string) {
    const displayName = name.split("/").pop()?.trim();
    if (!displayName) throw new ProviderError(400, "Folder name is required");
    await this.api(`/me/mailFolders/${encodeURIComponent(userFolderId(id))}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    });
  }

  async deleteLabel(id: string) {
    await this.api(`/me/mailFolders/${encodeURIComponent(userFolderId(id))}`, { method: "DELETE" });
  }

  async listContacts(): Promise<Contact[]> {
    const out = new Map<string, Contact>();
    const add = (email: string | undefined, name: string | undefined) => {
      const key = email?.trim().toLowerCase();
      if (key?.includes("@") && !out.has(key)) out.set(key, { email: key, name: name?.trim() || key });
    };
    try {
      const contacts = await this.paginate<{ displayName?: string; emailAddresses?: { address?: string; name?: string }[] }>(
        "/me/contacts",
        { $select: "displayName,emailAddresses", $top: "500" },
      );
      for (const c of contacts) for (const e of c.emailAddresses ?? []) add(e.address, c.displayName || e.name);
      const people = await this.paginate<{ displayName?: string; scoredEmailAddresses?: { address?: string }[] }>(
        "/me/people",
        { $select: "displayName,scoredEmailAddresses", $top: "500" },
      );
      for (const p of people) for (const e of p.scoredEmailAddresses ?? []) add(e.address, p.displayName);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 403) return [...out.values()];
      throw e;
    }
    return [...out.values()];
  }
}

function userFolderId(labelId: string): string {
  if (!labelId.startsWith(FOLDER_PREFIX)) throw new ProviderError(400, "Only custom folders can be renamed or deleted");
  return labelId.slice(FOLDER_PREFIX.length);
}

export function toAttachmentMeta(a: GraphAttachment): AttachmentMeta {
  return {
    id: a.id,
    filename: a.name || "attachment",
    mimeType: a.contentType || "application/octet-stream",
    size: a.size ?? 0,
    contentId: a.contentId?.replace(/[<>]/g, "") || undefined,
    inline: !!a.isInline,
  };
}
