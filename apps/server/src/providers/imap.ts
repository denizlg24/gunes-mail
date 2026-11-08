import { createHash } from "node:crypto";

import { ImapFlow, type FetchMessageObject, type FetchQueryObject, type ListResponse, type MessageStructureObject, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject, type EmailAddress, type ParsedMail } from "mailparser";
import { createTransport } from "nodemailer";
import { z } from "zod";

import { env } from "../env";
import { ProviderError, chunk } from "../lib/http";
import { isInlineAttachment } from "../lib/mime";
import type {
  AttachmentMeta,
  Body,
  MailProvider,
  Mailbox,
  MessageRef,
  NormalizedLabel,
  NormalizedMessage,
  OutgoingPayload,
  SyncSink,
  WriteOutcome,
} from "./types";

interface ServerEndpoint {
  host: string;
  port: number;
  secure: boolean;
}

export interface ImapCredentials {
  email: string;
  name: string;
  username: string;
  password: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
}

export interface ImapPreset {
  label: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
  appPasswordUrl: string;
  usernameIsEmail: true;
}

/** Outlook.com is absent on purpose: Microsoft disabled basic auth for IMAP/SMTP, so app passwords do not work there. */
export const IMAP_PRESETS: Record<"icloud" | "yahoo" | "fastmail" | "zoho", ImapPreset> = {
  icloud: {
    label: "iCloud Mail",
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    appPasswordUrl: "https://account.apple.com/account/manage",
    usernameIsEmail: true,
  },
  yahoo: {
    label: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    appPasswordUrl: "https://login.yahoo.com/account/security",
    usernameIsEmail: true,
  },
  fastmail: {
    label: "Fastmail",
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
    appPasswordUrl: "https://app.fastmail.com/settings/security/apps",
    usernameIsEmail: true,
  },
  zoho: {
    label: "Zoho Mail",
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    appPasswordUrl: "https://accounts.zoho.com/home#security/app_password",
    usernameIsEmail: true,
  },
};

const HEADER_FIELDS = ["from", "to", "cc", "bcc", "reply-to", "subject", "date", "message-id", "in-reply-to", "references"];
const METADATA_QUERY = {
  uid: true,
  flags: true,
  size: true,
  internalDate: true,
  bodyStructure: true,
  headers: HEADER_FIELDS,
} satisfies FetchQueryObject;
const BATCH = 100;
/** Without CONDSTORE, flag changes are only detected for this many of the newest known messages. */
const FLAG_WINDOW = 500;
const DAY_MS = 86_400_000;

const SPECIAL_USE: Record<string, string> = {
  "\\inbox": "INBOX",
  "\\sent": "SENT",
  "\\drafts": "DRAFT",
  "\\trash": "TRASH",
  "\\junk": "SPAM",
  "\\archive": "ARCHIVE",
};
const FALLBACK_NAMES: Record<string, string> = {
  inbox: "INBOX",
  sent: "SENT",
  "sent messages": "SENT",
  "sent items": "SENT",
  "sent mail": "SENT",
  drafts: "DRAFT",
  draft: "DRAFT",
  trash: "TRASH",
  "deleted messages": "TRASH",
  "deleted items": "TRASH",
  bin: "TRASH",
  junk: "SPAM",
  "junk e-mail": "SPAM",
  "junk email": "SPAM",
  spam: "SPAM",
  "bulk mail": "SPAM",
  archive: "ARCHIVE",
  archives: "ARCHIVE",
};
const SYSTEM_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  TRASH: "Trash",
  SPAM: "Junk",
  ARCHIVE: "Archive",
  STARRED: "Starred",
  UNREAD: "Unread",
};
/** Virtual views that would duplicate every message they contain. */
const VIRTUAL_USES = new Set(["\\all", "\\flagged"]);
const UNSELECTABLE = new Set(["\\noselect", "\\nonexistent"]);
const MOVE_TARGETS = new Set(["INBOX", "ARCHIVE", "SPAM", "TRASH"]);
const USER_PREFIX = "mailbox:";

const refSchema = z.object({ mailbox: z.string(), uidValidity: z.string(), uid: z.number().int().positive() });
export type ImapRef = z.infer<typeof refSchema>;

const mailboxStateSchema = z.object({
  uidValidity: z.string(),
  lastUid: z.number(),
  /** Compressed UID set of every message synced from this mailbox. */
  uids: z.string(),
  highestModseq: z.string().optional(),
});
type MailboxState = z.infer<typeof mailboxStateSchema>;
const stateSchema = z.object({ mailboxes: z.record(z.string(), mailboxStateSchema) });
type ImapState = z.infer<typeof stateSchema>;

export type MailboxEntry = Pick<ListResponse, "path" | "name" | "delimiter" | "flags" | "specialUse" | "specialUseSource">;

export interface ResolvedMailbox {
  path: string;
  delimiter: string;
  labelId: string;
  name: string;
}

export function formatMessageId(ref: ImapRef): string {
  return `${ref.mailbox}:${ref.uidValidity}:${ref.uid}`;
}

export function parseMessageId(id: string): ImapRef | undefined {
  const match = /^([\s\S]+):(\d+):(\d+)$/.exec(id);
  if (!match) return undefined;
  return { mailbox: match[1], uidValidity: match[2], uid: Number(match[3]) };
}

function refOf(message: MessageRef): ImapRef {
  const ref = refSchema.safeParse(message.providerRef).data ?? parseMessageId(message.id);
  if (!ref) throw new ProviderError(400, `Unrecognized IMAP message id: ${message.id}`);
  return ref;
}

export function compressUids(uids: Iterable<number>): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}:${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

export function expandUids(set: string): number[] {
  if (!set) return [];
  return set.split(",").flatMap((part) => {
    const [start, end = start] = part.split(":").map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}

function hasFlag(flags: Iterable<string>, flag: string): boolean {
  for (const f of flags) if (f.toLowerCase() === flag) return true;
  return false;
}

export function displayName(path: string, delimiter: string): string {
  return delimiter ? path.split(delimiter).join("/") : path;
}

/** Lower rank wins when several mailboxes claim the same system role. */
function systemRole(entry: MailboxEntry): { labelId: string; rank: number } | undefined {
  if (entry.path.toUpperCase() === "INBOX") return { labelId: "INBOX", rank: 0 };
  const special = entry.specialUse ? SPECIAL_USE[entry.specialUse.toLowerCase()] : undefined;
  if (special) return { labelId: special, rank: entry.specialUseSource === "name" ? 1 : 0 };
  const segments = entry.delimiter ? entry.path.split(entry.delimiter) : [entry.path];
  const topLevel = segments.length === 1 || (segments.length === 2 && segments[0].toUpperCase() === "INBOX");
  const byName = topLevel ? FALLBACK_NAMES[entry.name.toLowerCase()] : undefined;
  return byName ? { labelId: byName, rank: 2 } : undefined;
}

export function resolveMailboxes(list: MailboxEntry[]): ResolvedMailbox[] {
  const selectable = list.filter(
    (e) =>
      ![...e.flags].some((f) => UNSELECTABLE.has(f.toLowerCase())) &&
      !(e.specialUse && VIRTUAL_USES.has(e.specialUse.toLowerCase())),
  );
  const owners = new Map<string, { path: string; rank: number }>();
  for (const entry of selectable) {
    const role = systemRole(entry);
    if (!role) continue;
    const current = owners.get(role.labelId);
    if (!current || role.rank < current.rank) owners.set(role.labelId, { path: entry.path, rank: role.rank });
  }
  const roleByPath = new Map([...owners].map(([labelId, { path }]) => [path, labelId]));
  return selectable.map((e) => {
    const role = roleByPath.get(e.path);
    return {
      path: e.path,
      delimiter: e.delimiter,
      labelId: role ?? `${USER_PREFIX}${e.path}`,
      name: role ? SYSTEM_NAMES[role] : displayName(e.path, e.delimiter),
    };
  });
}

export function labelsFor(mailboxes: ResolvedMailbox[]): NormalizedLabel[] {
  return [
    ...mailboxes.map((m) => ({
      id: m.labelId,
      name: m.name,
      type: m.labelId.startsWith(USER_PREFIX) ? ("user" as const) : ("system" as const),
      providerRef: m.path,
    })),
    { id: "STARRED", name: SYSTEM_NAMES.STARRED, type: "system" },
    { id: "UNREAD", name: SYSTEM_NAMES.UNREAD, type: "system" },
  ];
}

export function labelsFromFlags(folderLabel: string, flags: Iterable<string>): string[] {
  const list = [...flags];
  return [
    folderLabel,
    ...(hasFlag(list, "\\seen") ? [] : ["UNREAD"]),
    ...(hasFlag(list, "\\flagged") ? ["STARRED"] : []),
  ];
}

export function flagChanges(add: string[], remove: string[]): { add: string[]; remove: string[] } {
  const out = { add: [] as string[], remove: [] as string[] };
  if (add.includes("STARRED")) out.add.push("\\Flagged");
  if (remove.includes("STARRED")) out.remove.push("\\Flagged");
  if (add.includes("UNREAD")) out.remove.push("\\Seen");
  if (remove.includes("UNREAD")) out.add.push("\\Seen");
  return out;
}

export function moveTarget(add: string[]): string | undefined {
  return add.find((l) => MOVE_TARGETS.has(l) || l.startsWith(USER_PREFIX));
}

export function messageIdList(value: string | string[] | undefined): string[] {
  const joined = Array.isArray(value) ? value.join(" ") : (value ?? "");
  const bracketed = joined.match(/<[^<>\s]+>/g);
  if (bracketed) return bracketed;
  return joined
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => `<${id}>`);
}

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*(((re|fwd?|aw|wg|sv|vs|antw|tr)(\[\d+\])?\s*:\s*)+)/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ThreadHeaders {
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  subject: string;
  from: string;
}

/** Stable fallback when no related message is known yet: every reply hashes to the conversation root. */
export function deriveThreadId(h: ThreadHeaders): string {
  const root = h.references[0] ?? h.inReplyTo ?? h.messageId;
  const key = root
    ? `id:${root.replace(/^<|>$/g, "").trim()}`
    : `subject:${normalizeSubject(h.subject)}\n${h.from.toLowerCase()}`;
  return `t:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function addresses(value: AddressObject | AddressObject[] | undefined): Mailbox[] {
  const flatten = (list: EmailAddress[]): Mailbox[] =>
    list.flatMap((a) => {
      if (a.group) return flatten(a.group);
      if (!a.address?.includes("@")) return [];
      return [{ email: a.address.toLowerCase(), name: a.name.trim() || a.address }];
    });
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap((o) => flatten(o.value));
}

export type ParsedHeaders = Pick<
  ParsedMail,
  "from" | "to" | "cc" | "bcc" | "replyTo" | "subject" | "date" | "messageId" | "inReplyTo" | "references"
>;

export function threadHeadersOf(parsed: ParsedHeaders): ThreadHeaders {
  return {
    messageId: messageIdList(parsed.messageId)[0],
    inReplyTo: messageIdList(parsed.inReplyTo)[0],
    references: messageIdList(parsed.references),
    subject: parsed.subject ?? "",
    from: addresses(parsed.from)[0]?.email ?? "",
  };
}

export function bodyFromParsed(parsed: Pick<ParsedMail, "html" | "text" | "attachments">): Body {
  return {
    html: parsed.html || undefined,
    text: parsed.text || undefined,
    attachments: parsed.attachments.map(
      (a, index): AttachmentMeta => ({
        id: String(index),
        filename: a.filename || "attachment",
        mimeType: a.contentType || "application/octet-stream",
        size: a.size,
        contentId: a.cid,
        inline: isInlineAttachment({ contentId: a.cid }, a.contentDisposition ?? ""),
      }),
    ),
  };
}

export function structureHasAttachments(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.type.toLowerCase() === "message/rfc822") return true;
  if (node.childNodes?.length) return node.childNodes.some(structureHasAttachments);
  if (node.disposition?.toLowerCase() === "attachment") return true;
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  return !!filename && !node.id;
}

export interface MessageContext {
  ref: ImapRef;
  threadId: string;
  labelIds: string[];
  receivedAt?: Date;
  hasAttachments: boolean;
  body?: Body;
}

export function normalizeParsed(parsed: ParsedHeaders, ctx: MessageContext): NormalizedMessage {
  const references = messageIdList(parsed.references);
  const { body } = ctx;
  return {
    id: formatMessageId(ctx.ref),
    threadId: ctx.threadId,
    labelIds: ctx.labelIds,
    from: addresses(parsed.from)[0] ?? { name: "(unknown)", email: "" },
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    replyTo: addresses(parsed.replyTo),
    subject: parsed.subject ?? "",
    date: ctx.receivedAt ?? parsed.date ?? new Date(),
    snippet: "",
    html: body?.html,
    text: body?.text,
    bodyFetched: !!body,
    attachments: body?.attachments ?? [],
    hasAttachments: body ? body.attachments.some((a) => !a.inline) : ctx.hasAttachments,
    messageIdHeader: messageIdList(parsed.messageId)[0],
    inReplyTo: messageIdList(parsed.inReplyTo)[0],
    references: references.length ? references.join(" ") : undefined,
    providerRef: ctx.ref,
    category: ctx.labelIds.includes("INBOX") ? "focused" : undefined,
  };
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function maxOf(values: number[], floor: number): number {
  return values.reduce((max, v) => (v > max ? v : max), floor);
}

function rawHeader(raw: Buffer, name: string): string | undefined {
  const end = raw.indexOf("\r\n\r\n");
  const head = raw
    .subarray(0, end < 0 ? raw.length : end)
    .toString("utf8")
    .replace(/\r\n[ \t]+/g, " ");
  return new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(head)?.[1].trim() || undefined;
}

function errorCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);

function imapFailure(e: unknown, endpoint: ServerEndpoint): { auth: boolean; message: string } {
  if (e instanceof Error && "authenticationFailed" in e && e.authenticationFailed) {
    return { auth: true, message: "IMAP login failed. Check the username and use an app-specific password." };
  }
  if (e instanceof Error && "tlsFailed" in e && e.tlsFailed) {
    return { auth: false, message: `TLS negotiation with ${endpoint.host}:${endpoint.port} failed.` };
  }
  const code = errorCode(e);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { auth: false, message: `IMAP server ${endpoint.host} could not be found.` };
  }
  if (code && NETWORK_CODES.has(code)) {
    return { auth: false, message: `Could not connect to IMAP server ${endpoint.host}:${endpoint.port}.` };
  }
  const detail = e instanceof Error && "responseText" in e && typeof e.responseText === "string" ? e.responseText : undefined;
  return { auth: false, message: `IMAP error: ${detail ?? (e instanceof Error ? e.message : String(e))}` };
}

function smtpFailure(e: unknown, endpoint: ServerEndpoint): { status: number; message: string } {
  const code = errorCode(e);
  if (code === "EAUTH") {
    return { status: 401, message: "SMTP login failed. Check the username and use an app-specific password." };
  }
  if (code === "EENVELOPE") {
    return { status: 400, message: `The SMTP server rejected the recipients: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return { status: 502, message: `Could not connect to SMTP server ${endpoint.host}:${endpoint.port}.` };
  }
  return { status: 502, message: `SMTP error: ${e instanceof Error ? e.message : String(e)}` };
}

function imapClient(c: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: c.imap.host,
    port: c.imap.port,
    secure: c.imap.secure,
    doSTARTTLS: c.imap.secure ? undefined : true,
    auth: { user: c.username, pass: c.password },
    logger: false,
    disableAutoIdle: true,
  });
}

function smtpTransport(c: ImapCredentials) {
  return createTransport({
    host: c.smtp.host,
    port: c.smtp.port,
    secure: c.smtp.secure,
    requireTLS: !c.smtp.secure,
    auth: { user: c.username, pass: c.password },
  });
}

async function connect(c: ImapCredentials, authStatus: number): Promise<ImapFlow> {
  const client = imapClient(c);
  try {
    await client.connect();
    return client;
  } catch (e) {
    client.close();
    const failure = imapFailure(e, c.imap);
    throw new ProviderError(failure.auth ? authStatus : 502, failure.message);
  }
}

async function disconnect(client: ImapFlow) {
  await client.logout().catch(() => client.close());
}

export async function verifyImapCredentials(c: ImapCredentials): Promise<void> {
  const client = await connect(c, 400).catch((e: unknown) => {
    throw e instanceof ProviderError ? new ProviderError(400, e.message) : e;
  });
  await disconnect(client);
  const transport = smtpTransport(c);
  try {
    await transport.verify();
  } catch (e) {
    throw new ProviderError(400, smtpFailure(e, c.smtp).message);
  } finally {
    transport.close();
  }
}

const toAddress = (m: Mailbox) => ({ name: m.name, address: m.email });

interface SyncContext {
  client: ImapFlow;
  mailbox: ResolvedMailbox;
  uidValidity: string;
  sink: SyncSink;
  threads: Map<string, string>;
}

export class ImapProvider implements MailProvider {
  readonly kind = "imap" as const;

  constructor(private readonly credentials: ImapCredentials) {}

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = await connect(this.credentials, 401);
    try {
      return await fn(client);
    } finally {
      await disconnect(client);
    }
  }

  private async mailboxes(client: ImapFlow): Promise<ResolvedMailbox[]> {
    return resolveMailboxes(await client.list());
  }

  private async pathFor(client: ImapFlow, labelId: string): Promise<string | undefined> {
    if (labelId.startsWith(USER_PREFIX)) return labelId.slice(USER_PREFIX.length);
    return (await this.mailboxes(client)).find((m) => m.labelId === labelId)?.path;
  }

  private async requirePath(client: ImapFlow, labelId: string): Promise<string> {
    const path = await this.pathFor(client, labelId);
    if (!path) throw new ProviderError(400, `This account has no ${SYSTEM_NAMES[labelId] ?? labelId} folder`);
    return path;
  }

  private async searchUids(client: ImapFlow, query: SearchObject): Promise<number[]> {
    return (await client.search(query, { uid: true })) || [];
  }

  /** Runs `fn` per source mailbox with the UID set of refs whose UIDVALIDITY still matches; stale refs are dropped. */
  private async forEachMailbox(
    client: ImapFlow,
    messages: MessageRef[],
    fn: (path: string, uids: string) => Promise<void>,
  ) {
    const grouped = new Map<string, ImapRef[]>();
    for (const ref of messages.map(refOf)) grouped.set(ref.mailbox, [...(grouped.get(ref.mailbox) ?? []), ref]);
    for (const [path, refs] of grouped) {
      const lock = await client.getMailboxLock(path);
      try {
        const uidValidity = client.mailbox ? client.mailbox.uidValidity.toString() : undefined;
        const uids = refs.filter((r) => r.uidValidity === uidValidity).map((r) => r.uid);
        if (uids.length) await fn(path, compressUids(uids));
      } finally {
        lock.release();
      }
    }
  }

  private async threadFor(h: ThreadHeaders, ctx: SyncContext): Promise<string> {
    const related = [h.messageId, h.inReplyTo, ...h.references].filter((id): id is string => !!id);
    const local = related.map((id) => ctx.threads.get(id)).find((t) => t !== undefined);
    const threadId =
      local ?? (related.length ? await ctx.sink.threadForMessageIds(related) : undefined) ?? deriveThreadId(h);
    if (h.messageId) ctx.threads.set(h.messageId, threadId);
    return threadId;
  }

  private async toMessage(m: FetchMessageObject, ctx: SyncContext): Promise<NormalizedMessage> {
    const parsed = await simpleParser(m.headers ?? Buffer.alloc(0), {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
      skipTextLinks: true,
    });
    return normalizeParsed(parsed, {
      ref: { mailbox: ctx.mailbox.path, uidValidity: ctx.uidValidity, uid: m.uid },
      threadId: await this.threadFor(threadHeadersOf(parsed), ctx),
      labelIds: labelsFromFlags(ctx.mailbox.labelId, m.flags ?? []),
      receivedAt: toDate(m.internalDate),
      hasAttachments: structureHasAttachments(m.bodyStructure),
    });
  }

  private async fetchNew(ctx: SyncContext, uids: number[]) {
    for (const batch of chunk(uids, BATCH)) {
      const fetched = await ctx.client.fetchAll(compressUids(batch), METADATA_QUERY, { uid: true });
      const messages: NormalizedMessage[] = [];
      for (const m of fetched) messages.push(await this.toMessage(m, ctx));
      if (messages.length) await ctx.sink.upsertMessages(messages);
    }
  }

  private async refreshFlags(ctx: SyncContext, uids: number[], previousModseq?: string, highestModseq?: string) {
    if (!uids.length) return;
    let changed: FetchMessageObject[];
    if (previousModseq && highestModseq) {
      if (previousModseq === highestModseq) return;
      changed = await ctx.client.fetchAll(
        `${uids[0]}:${uids[uids.length - 1]}`,
        { uid: true, flags: true },
        { uid: true, changedSince: BigInt(previousModseq) },
      );
    } else {
      changed = await ctx.client.fetchAll(compressUids(uids.slice(-FLAG_WINDOW)), { uid: true, flags: true }, { uid: true });
    }
    const known = new Set(uids);
    const updates = changed
      .filter((m) => known.has(m.uid))
      .map((m) => ({
        id: formatMessageId({ mailbox: ctx.mailbox.path, uidValidity: ctx.uidValidity, uid: m.uid }),
        labelIds: labelsFromFlags(ctx.mailbox.labelId, m.flags ?? []),
      }));
    if (updates.length) await ctx.sink.updateLabels(updates);
  }

  private idsOf(path: string, state: MailboxState): string[] {
    return expandUids(state.uids).map((uid) => formatMessageId({ mailbox: path, uidValidity: state.uidValidity, uid }));
  }

  private async syncMailbox(
    client: ImapFlow,
    mailbox: ResolvedMailbox,
    previous: MailboxState | undefined,
    sink: SyncSink,
    threads: Map<string, string>,
  ): Promise<MailboxState> {
    const lock = await client.getMailboxLock(mailbox.path, { readOnly: true });
    try {
      const info = client.mailbox;
      if (!info) throw new ProviderError(502, `Could not open mailbox ${mailbox.path}`);
      const uidValidity = info.uidValidity.toString();
      const highestModseq = info.noModseq ? undefined : info.highestModseq?.toString();
      const ctx: SyncContext = { client, mailbox, uidValidity, sink, threads };

      if (!previous || previous.uidValidity !== uidValidity) {
        if (previous) await sink.deleteMessages(this.idsOf(mailbox.path, previous));
        const since = new Date(Date.now() - env.INITIAL_SYNC_DAYS * DAY_MS);
        const uids = info.exists ? await this.searchUids(client, { since }) : [];
        await this.fetchNew(ctx, uids);
        return { uidValidity, lastUid: maxOf(uids, info.uidNext - 1), uids: compressUids(uids), highestModseq };
      }

      const known = expandUids(previous.uids);
      const hasNew = !info.uidNext || info.uidNext - 1 > previous.lastUid;
      const fresh =
        hasNew && info.exists
          ? (await this.searchUids(client, { uid: `${previous.lastUid + 1}:*` })).filter((u) => u > previous.lastUid)
          : [];
      await this.fetchNew(ctx, fresh);

      const present = known.length
        ? new Set(await this.searchUids(client, { uid: `${known[0]}:${previous.lastUid}` }))
        : new Set<number>();
      const expunged = known.filter((u) => !present.has(u));
      if (expunged.length) {
        await sink.deleteMessages(expunged.map((uid) => formatMessageId({ mailbox: mailbox.path, uidValidity, uid })));
      }
      const remaining = known.filter((u) => present.has(u));
      await this.refreshFlags(ctx, remaining, previous.highestModseq, highestModseq);

      return {
        uidValidity,
        lastUid: maxOf(fresh, Math.max(previous.lastUid, info.uidNext - 1)),
        uids: compressUids([...remaining, ...fresh]),
        highestModseq,
      };
    } finally {
      lock.release();
    }
  }

  async sync(raw: Record<string, unknown>, sink: SyncSink): Promise<Record<string, unknown>> {
    const state: ImapState = stateSchema.safeParse(raw).data ?? { mailboxes: {} };
    return this.withClient(async (client) => {
      const mailboxes = await this.mailboxes(client);
      await sink.replaceLabels(labelsFor(mailboxes));
      const next: ImapState = { mailboxes: {} };
      const threads = new Map<string, string>();
      for (const mailbox of mailboxes) {
        next.mailboxes[mailbox.path] = await this.syncMailbox(
          client,
          mailbox,
          state.mailboxes[mailbox.path],
          sink,
          threads,
        );
      }
      for (const [path, previous] of Object.entries(state.mailboxes)) {
        if (!next.mailboxes[path]) await sink.deleteMessages(this.idsOf(path, previous));
      }
      return next;
    });
  }

  private async parseSource(message: MessageRef): Promise<ParsedMail> {
    const ref = refOf(message);
    const source = await this.withClient(async (client) => {
      const lock = await client.getMailboxLock(ref.mailbox, { readOnly: true });
      try {
        if (client.mailbox && client.mailbox.uidValidity.toString() !== ref.uidValidity) return undefined;
        const fetched = await client.fetchOne(String(ref.uid), { uid: true, source: true }, { uid: true });
        return fetched ? fetched.source : undefined;
      } finally {
        lock.release();
      }
    });
    if (!source) throw new ProviderError(404, "Message no longer exists on the server");
    return simpleParser(source, { keepCidLinks: true });
  }

  async fetchBody(message: MessageRef): Promise<Body> {
    return bodyFromParsed(await this.parseSource(message));
  }

  async getAttachment(message: MessageRef, attachmentId: string): Promise<Uint8Array> {
    const parsed = await this.parseSource(message);
    const attachment = parsed.attachments[Number(attachmentId)];
    if (!/^\d+$/.test(attachmentId) || !attachment) throw new ProviderError(404, "Attachment not found");
    return attachment.content;
  }

  async modify(messages: MessageRef[], add: string[], remove: string[]) {
    const flags = flagChanges(add, remove);
    const target = moveTarget(add);
    if (!messages.length || (!flags.add.length && !flags.remove.length && !target)) return;
    await this.withClient(async (client) => {
      const destination = target ? await this.requirePath(client, target) : undefined;
      await this.forEachMailbox(client, messages, async (path, uids) => {
        if (flags.add.length) await client.messageFlagsAdd(uids, flags.add, { uid: true });
        if (flags.remove.length) await client.messageFlagsRemove(uids, flags.remove, { uid: true });
        if (destination && destination !== path) await client.messageMove(uids, destination, { uid: true });
      });
    });
  }

  trash(messages: MessageRef[]) {
    return this.modify(messages, ["TRASH"], []);
  }

  untrash(messages: MessageRef[]) {
    return this.modify(messages, ["INBOX"], []);
  }

  async deleteForever(messages: MessageRef[]) {
    if (!messages.length) return;
    await this.withClient((client) =>
      this.forEachMailbox(client, messages, async (_path, uids) => {
        await client.messageDelete(uids, { uid: true });
      }),
    );
  }

  async send(raw: Buffer, payload: OutgoingPayload) {
    const transport = smtpTransport(this.credentials);
    try {
      await transport.sendMail({
        from: toAddress(payload.from),
        to: payload.to.map(toAddress),
        cc: payload.cc.map(toAddress),
        bcc: payload.bcc.map(toAddress),
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        inReplyTo: payload.inReplyTo,
        references: payload.references,
        messageId: rawHeader(raw, "Message-ID"),
        attachments: payload.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.mimeType,
          content: Buffer.from(a.data, "base64"),
        })),
        envelope: {
          from: payload.from.email,
          to: [...payload.to, ...payload.cc, ...payload.bcc].map((m) => m.email),
        },
      });
    } catch (e) {
      const failure = smtpFailure(e, this.credentials.smtp);
      throw new ProviderError(failure.status, failure.message);
    } finally {
      transport.close();
    }
    // The message is already delivered; failing here would invite a duplicate resend.
    await this.withClient(async (client) => {
      const sent = await this.pathFor(client, "SENT");
      if (sent) await client.append(sent, raw, ["\\Seen"]);
      if (payload.draftId) await this.removeDraft(client, payload.draftId);
    }).catch(() => undefined);
  }

  private async locateByMessageId(client: ImapFlow, path: string, messageId: string | undefined): Promise<ImapRef> {
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const uids = messageId ? await this.searchUids(client, { header: { "message-id": messageId } }) : [];
      if (!uids.length || !client.mailbox) throw new ProviderError(502, "Saved draft could not be located on the server");
      return { mailbox: path, uidValidity: client.mailbox.uidValidity.toString(), uid: maxOf(uids, 0) };
    } finally {
      lock.release();
    }
  }

  private async removeDraft(client: ImapFlow, draftId: string) {
    const ref = parseMessageId(draftId);
    if (!ref) throw new ProviderError(400, `Unrecognized IMAP draft id: ${draftId}`);
    await this.forEachMailbox(client, [{ id: draftId, threadId: "", labelIds: [], providerRef: ref }], async (_path, uids) => {
      await client.messageDelete(uids, { uid: true });
    });
  }

  async saveDraft(raw: Buffer, payload: OutgoingPayload): Promise<{ draftId: string } & WriteOutcome> {
    return this.withClient(async (client) => {
      const drafts = await this.requirePath(client, "DRAFT");
      const res = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
      if (!res) throw new ProviderError(502, "The server rejected the draft");
      const ref =
        res.uid !== undefined && res.uidValidity !== undefined
          ? { mailbox: drafts, uidValidity: res.uidValidity.toString(), uid: res.uid }
          : await this.locateByMessageId(client, drafts, rawHeader(raw, "Message-ID"));
      const id = formatMessageId(ref);
      const replaced = payload.draftId && payload.draftId !== id ? payload.draftId : undefined;
      if (replaced) await this.removeDraft(client, replaced).catch(() => undefined);
      return { draftId: id, removed: replaced ? [replaced] : [] };
    });
  }

  async deleteDraft(draftId: string): Promise<WriteOutcome> {
    await this.withClient((client) => this.removeDraft(client, draftId));
    return { removed: [draftId] };
  }

  private userPath(id: string): string {
    if (!id.startsWith(USER_PREFIX)) throw new ProviderError(400, "Only custom folders can be changed");
    return id.slice(USER_PREFIX.length);
  }

  async createLabel(name: string): Promise<NormalizedLabel> {
    return this.withClient(async (client) => {
      const created = await client.mailboxCreate(name.split("/"));
      const delimiter = (await client.list()).find((m) => m.path === created.path)?.delimiter ?? "/";
      return {
        id: `${USER_PREFIX}${created.path}`,
        name: displayName(created.path, delimiter),
        type: "user",
        providerRef: created.path,
      };
    });
  }

  async renameLabel(id: string, name: string) {
    const path = this.userPath(id);
    await this.withClient((client) => client.mailboxRename(path, name.split("/")));
  }

  async deleteLabel(id: string) {
    const path = this.userPath(id);
    await this.withClient((client) => client.mailboxDelete(path));
  }
}
