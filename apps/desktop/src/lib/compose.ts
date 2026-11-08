import { fullDate } from "./format";
import { base64UrlToBytes, bytesToBase64, formatMailbox, textToHtml } from "./mime";
import type { Account, Mailbox, Message, OutgoingAttachment, Thread } from "./types";
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

export function signatureHtml(signature: string): string {
  if (!signature.trim()) return "";
  const lines = signature.trim().split("\n").map(escapeHtml).join("<br>");
  return `<p></p><p>${lines}</p>`;
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
