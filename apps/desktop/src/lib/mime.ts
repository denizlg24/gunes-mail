import type { Attachment, Mailbox, Message, OutgoingMessage } from "./types";

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function decodeBase64Url(data: string): string {
  const bytes = base64UrlToBytes(data);
  return new TextDecoder("utf-8").decode(bytes);
}

export function base64UrlToBytes(data: string): Uint8Array {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeWord(charset: string, encoding: string, text: string): string {
  let bytes: Uint8Array;
  if (encoding.toUpperCase() === "B") {
    bytes = base64UrlToBytes(text);
  } else {
    const qp = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    bytes = Uint8Array.from(qp, (c) => c.charCodeAt(0));
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeEncodedWords(value: string): string {
  if (!value.includes("=?")) return value;
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) =>
      decodeWord(charset, enc, text),
    );
}

export function header(headers: GmailHeader[] | undefined, name: string): string {
  const lower = name.toLowerCase();
  return decodeEncodedWords(headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "");
}

function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") depth++;
    else if (!inQuotes && ch === ">") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && !inQuotes && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function parseMailbox(raw: string): Mailbox {
  const match = raw.match(/^\s*(?:"?([^"]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) {
    const email = match[2].trim();
    const name = (match[1] ?? "").replace(/\\"/g, '"').trim();
    return { name: name || email, email };
  }
  const email = raw.replace(/[<>"]/g, "").trim();
  return { name: email, email };
}

export function parseMailboxes(value: string): Mailbox[] {
  if (!value) return [];
  return splitAddressList(value).map(parseMailbox).filter((m) => m.email.includes("@"));
}

function walkParts(part: GmailPart | undefined, visit: (p: GmailPart) => void) {
  if (!part) return;
  visit(part);
  part.parts?.forEach((p) => walkParts(p, visit));
}

export function parseGmailMessage(msg: GmailMessage): Message {
  const headers = msg.payload?.headers;
  let html: string | undefined;
  let text: string | undefined;
  const attachments: Attachment[] = [];

  walkParts(msg.payload, (part) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    const disposition = header(part.headers, "Content-Disposition").toLowerCase();
    const contentId = header(part.headers, "Content-ID").replace(/[<>]/g, "") || undefined;
    const isAttachment =
      !!part.filename || !!part.body?.attachmentId || disposition.startsWith("attachment");

    if (isAttachment && !mime.startsWith("multipart/")) {
      attachments.push({
        attachmentId: part.body?.attachmentId,
        data: part.body?.data,
        filename: part.filename || "attachment",
        mimeType: mime || "application/octet-stream",
        size: part.body?.size ?? 0,
        contentId,
        inline: !!contentId && !disposition.startsWith("attachment"),
      });
      return;
    }
    if (!part.body?.data) return;
    if (mime === "text/html" && html === undefined) html = decodeBase64Url(part.body.data);
    else if (mime === "text/plain" && text === undefined) text = decodeBase64Url(part.body.data);
  });

  const labelIds = msg.labelIds ?? [];
  const from = parseMailboxes(header(headers, "From"))[0] ?? { name: "(unknown)", email: "" };
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds,
    from,
    to: parseMailboxes(header(headers, "To")),
    cc: parseMailboxes(header(headers, "Cc")),
    bcc: parseMailboxes(header(headers, "Bcc")),
    replyTo: parseMailboxes(header(headers, "Reply-To")),
    subject: header(headers, "Subject"),
    date: Number(msg.internalDate ?? 0) || Date.parse(header(headers, "Date")) || 0,
    snippet: decodeEntities(msg.snippet ?? ""),
    html,
    text,
    attachments,
    messageIdHeader: header(headers, "Message-ID") || header(headers, "Message-Id") || undefined,
    references: header(headers, "References") || undefined,
    unread: labelIds.includes("UNREAD"),
    flagged: labelIds.includes("STARRED"),
    draft: labelIds.includes("DRAFT"),
  };
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function encodeHeaderWord(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

export function formatMailbox(m: Mailbox): string {
  if (!m.name || m.name === m.email) return m.email;
  const name = /^[\x20-\x7e]*$/.test(m.name)
    ? `"${m.name.replace(/"/g, '\\"')}"`
    : encodeHeaderWord(m.name);
  return `${name} <${m.email}>`;
}

function wrap76(base64: string): string {
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function boundary(): string {
  return `----=_Part_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function buildRawMessage(msg: OutgoingMessage): string {
  const lines: string[] = [];
  lines.push(`From: ${formatMailbox(msg.from)}`);
  if (msg.to.length) lines.push(`To: ${msg.to.map(formatMailbox).join(", ")}`);
  if (msg.cc.length) lines.push(`Cc: ${msg.cc.map(formatMailbox).join(", ")}`);
  if (msg.bcc.length) lines.push(`Bcc: ${msg.bcc.map(formatMailbox).join(", ")}`);
  lines.push(`Subject: ${encodeHeaderWord(msg.subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push("MIME-Version: 1.0");
  if (msg.inReplyTo) lines.push(`In-Reply-To: ${msg.inReplyTo}`);
  if (msg.references) lines.push(`References: ${msg.references}`);

  const altBoundary = boundary();
  const alternative = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8ToBase64(msg.text)),
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(utf8ToBase64(msg.html)),
    `--${altBoundary}--`,
  ];

  if (msg.attachments.length === 0) {
    lines.push(...alternative);
  } else {
    const mixed = boundary();
    lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, ...alternative);
    for (const a of msg.attachments) {
      const name = encodeHeaderWord(a.filename);
      lines.push(
        `--${mixed}`,
        `Content-Type: ${a.mimeType || "application/octet-stream"}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(a.data),
      );
    }
    lines.push(`--${mixed}--`);
  }

  return toBase64Url(utf8ToBase64(lines.join("\r\n")));
}

export function htmlToText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p, div, li, blockquote, h1, h2, h3, tr").forEach((el) => el.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="white-space:pre-wrap;font-family:inherit">${escaped}</div>`;
}
