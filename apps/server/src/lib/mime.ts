import addressparser from "nodemailer/lib/addressparser";
import MailComposer from "nodemailer/lib/mail-composer";

import type { AttachmentMeta, Mailbox, OutgoingPayload } from "../providers/types";

export function decodeEncodedWords(value: string): string {
  if (!value.includes("=?")) return value;
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(
              text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))),
              "latin1",
            );
      try {
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return bytes.toString("utf8");
      }
    });
}

export function parseMailboxes(value: string | undefined | null): Mailbox[] {
  if (!value) return [];
  const out: Mailbox[] = [];
  const walk = (entries: ReturnType<typeof addressparser>) => {
    for (const e of entries) {
      if ("group" in e && e.group) walk(e.group);
      else if (e.address?.includes("@")) {
        const name = decodeEncodedWords(e.name ?? "").trim();
        out.push({ email: e.address.toLowerCase(), name: name || e.address });
      }
    }
  };
  walk(addressparser(value));
  return out;
}

export function base64UrlDecode(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function snippetFrom(text: string | undefined, html: string | undefined): string {
  const source = text ?? (html ? htmlToText(html) : "");
  return source.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface InlineImage {
  cid: string;
  contentType: string;
  content: Buffer;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const DATA_IMAGE_RE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\2/gi;

/**
 * Most mail clients refuse data: URIs in received mail, so embedded pictures (a signature
 * logo, a pasted screenshot) travel as related parts and are referenced by Content-ID.
 */
export function inlineDataImages(html: string): { html: string; images: InlineImage[] } {
  const byData = new Map<string, InlineImage>();
  const out = html.replace(DATA_IMAGE_RE, (_match, prefix: string, quote: string, contentType: string, data: string) => {
    const clean = data.replace(/\s+/g, "");
    let image = byData.get(clean);
    if (!image) {
      image = { cid: `img${byData.size + 1}.${crypto.randomUUID()}@gunes-mail`, contentType: contentType.toLowerCase(), content: Buffer.from(clean, "base64") };
      byData.set(clean, image);
    }
    return `${prefix}${quote}cid:${image.cid}${quote}`;
  });
  return { html: out, images: [...byData.values()] };
}

export function buildRawMessage(payload: OutgoingPayload): Promise<Buffer> {
  const address = (m: Mailbox) => ({ name: m.name === m.email ? "" : m.name, address: m.email });
  const { html, images } = inlineDataImages(payload.html);
  const composer = new MailComposer({
    from: address(payload.from),
    to: payload.to.map(address),
    cc: payload.cc.map(address),
    bcc: payload.bcc.map(address),
    subject: payload.subject,
    html,
    text: payload.text,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    attachments: [
      ...payload.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.mimeType,
        content: Buffer.from(a.data, "base64"),
      })),
      ...images.map((img, i) => ({
        filename: `image${i + 1}.${IMAGE_EXTENSIONS[img.contentType] ?? "img"}`,
        contentType: img.contentType,
        content: img.content,
        cid: img.cid,
        contentDisposition: "inline" as const,
      })),
    ],
  });
  const node = composer.compile();
  // Gmail and Graph read Bcc from the header and strip it before delivery.
  node.keepBcc = true;
  return new Promise((resolve, reject) => node.build((err, message) => (err ? reject(err) : resolve(message))));
}

export function isInlineAttachment(a: Pick<AttachmentMeta, "contentId">, disposition: string): boolean {
  return !!a.contentId && !disposition.toLowerCase().startsWith("attachment");
}
