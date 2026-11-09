import { fullDate } from "./format";
import { base64UrlToBytes, bytesToBase64, formatMailbox, htmlToText, textToHtml } from "./mime";
import type { Account, Attachment, Mailbox, Message, OutgoingAttachment, Thread } from "./types";
import type { ComposeDraft, ComposeMode } from "@/store/ui";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function list(boxes: Mailbox[]): string {
  return escapeHtml(boxes.map(formatMailbox).join("; "));
}

function withPrefix(prefix: "RE" | "FW", subject: string): string {
  const stripped = subject.replace(/^((re|fw|fwd|aw|wg)\s*:\s*)+/i, "");
  return `${prefix}: ${stripped}`;
}

function dedupe(boxes: Mailbox[], exclude: string[]): Mailbox[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  return boxes.filter((b) => {
    const key = b.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function quoteMessage(m: Message): string {
  const body = m.html ?? textToHtml(m.text ?? m.snippet);
  const header = [
    `<b>From:</b> ${escapeHtml(formatMailbox(m.from))}`,
    `<b>Sent:</b> ${escapeHtml(fullDate(m.date))}`,
    m.to.length ? `<b>To:</b> ${list(m.to)}` : "",
    m.cc.length ? `<b>Cc:</b> ${list(m.cc)}` : "",
    `<b>Subject:</b> ${escapeHtml(m.subject)}`,
  ]
    .filter(Boolean)
    .join("<br>");
  return `<div><hr style="border:none;border-top:1px solid #e1e1e1;margin:16px 0 8px"><div style="font-size:13px">${header}</div><br><div>${body}</div></div>`;
}

/** The signature editor always emits a block element first; plain text may still hold "<name@x.com>". */
const HTML_RE = /^\s*<(p|div|h[1-6]|ul|ol|blockquote|img|table|span)[\s>/]/i;

/** Signatures are HTML now; ones saved by older versions are plain text. */
export function signatureBody(signature: string): string {
  if (!signature.trim()) return "";
  if (HTML_RE.test(signature)) return signature;
  return `<p>${signature.trim().split("\n").map(escapeHtml).join("<br>")}</p>`;
}

/** Leaves an empty line to type in above the signature. */
export function signatureHtml(signature: string): string {
  const body = signatureBody(signature);
  return body ? `<p></p>${body}` : "";
}

export function textToParagraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The editor's text minus a trailing, unchanged signature. */
export function withoutSignature(text: string, signature: string): string {
  const sigText = htmlToText(signature).trim();
  const firstLine = sigText.split("\n").find((l) => l.trim())?.trim();
  if (!firstLine) return text;
  const at = text.lastIndexOf(firstLine);
  if (at < 0 || squash(text.slice(at)) !== squash(sigText)) return text;
  return text.slice(0, at).trimEnd();
}

export function composeKey(): string {
  return crypto.randomUUID();
}

export function newCompose(accountId: string, to: Mailbox[] = []): ComposeDraft {
  return {
    key: composeKey(),
    accountId,
    mode: "new",
    to,
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    attachments: [],
  };
}

export function replyCompose(
  account: Account,
  thread: Thread,
  message: Message,
  mode: Extract<ComposeMode, "reply" | "replyAll" | "forward">,
  attachments: OutgoingAttachment[] = [],
): ComposeDraft {
  const me = account.email.toLowerCase();
  const fromMe = message.from.email.toLowerCase() === me;
  const replyTarget = message.replyTo.length ? message.replyTo : [message.from];
  let to: Mailbox[] = [];
  let cc: Mailbox[] = [];

  if (mode === "reply") {
    to = fromMe ? message.to : replyTarget;
  } else if (mode === "replyAll") {
    to = dedupe(fromMe ? message.to : [...replyTarget, ...message.to], [me]);
    cc = dedupe(message.cc, [me, ...to.map((t) => t.email)]);
  }

  const references = [message.references, message.messageIdHeader].filter(Boolean).join(" ") || undefined;
  return {
    key: composeKey(),
    accountId: account.id,
    mode,
    threadId: thread.id,
    to,
    cc,
    bcc: [],
    subject: withPrefix(mode === "forward" ? "FW" : "RE", message.subject || thread.subject),
    body: "",
    quoted: quoteMessage(message),
    inReplyTo: mode === "forward" ? undefined : message.messageIdHeader,
    references: mode === "forward" ? undefined : references,
    attachments,
  };
}

export function draftCompose(accountId: string, message: Message, draftId?: string): ComposeDraft {
  return {
    key: composeKey(),
    accountId,
    mode: "draft",
    threadId: message.threadId,
    draftId,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    body: message.html ?? textToHtml(message.text ?? ""),
    inReplyTo: undefined,
    references: message.references,
    attachments: [],
  };
}

/**
 * Saved drafts come back with pictures as cid: parts; the editor needs them inline again,
 * or a signature logo would turn into a broken image the moment a draft is reopened.
 */
export async function resolveCidImages(
  html: string,
  attachments: Attachment[],
  load: (attachment: Attachment) => Promise<string>,
): Promise<string> {
  const referenced = attachments.filter((a) => a.contentId && html.includes(`cid:${a.contentId}`));
  let out = html;
  for (const a of referenced) {
    try {
      const data = base64UrlToBase64(a.data ?? (await load(a)));
      out = out.split(`cid:${a.contentId}`).join(`data:${a.mimeType};base64,${data}`);
    } catch {
      // Leave this picture as it was; the rest of the draft still opens.
    }
  }
  return out;
}

export function base64UrlToBase64(data: string): string {
  return bytesToBase64(base64UrlToBytes(data));
}

export async function fileToAttachment(file: File): Promise<OutgoingAttachment> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  return {
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    data: bytesToBase64(buffer),
  };
}
