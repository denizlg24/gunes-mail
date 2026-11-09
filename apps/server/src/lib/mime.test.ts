import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test";

const { buildRawMessage, parseMailboxes } = await import("./mime");

test("raw message carries all address headers, including Bcc for API senders", async () => {
  const raw = (
    await buildRawMessage({
      from: { name: "Güneş", email: "me@x.com" },
      to: [{ name: "Sarah Kim", email: "sarah@contoso.com" }],
      cc: [{ name: "c@x.com", email: "c@x.com" }],
      bcc: [{ name: "b@x.com", email: "b@x.com" }],
      subject: "Olá",
      html: "<p>hi</p>",
      text: "hi",
      attachments: [{ filename: "a.txt", mimeType: "text/plain", size: 2, data: Buffer.from("hi").toString("base64") }],
      inReplyTo: "<abc@x>",
      references: "<abc@x>",
    })
  ).toString();
  expect(raw).toMatch(/^From: =\?UTF-8\?\w\?.+\?= <me@x\.com>$/m);
  expect(raw).toContain("To: Sarah Kim <sarah@contoso.com>");
  expect(raw).toContain("Cc: c@x.com");
  expect(raw).toContain("Bcc: b@x.com");
  expect(raw).toContain("In-Reply-To: <abc@x>");
  expect(raw).toContain('filename=a.txt');
});

test("parses encoded and grouped address lists", () => {
  expect(parseMailboxes('=?UTF-8?B?w4lt?= <E@X.pt>, "Kim, Sarah" <s@c.com>')).toEqual([
    { name: "Ém", email: "e@x.pt" },
    { name: "Kim, Sarah", email: "s@c.com" },
  ]);
});

test("data: images become related parts referenced by Content-ID", async () => {
  const { inlineDataImages } = await import("./mime");
  const png = Buffer.from("png-bytes").toString("base64");
  const { html, images } = inlineDataImages(
    `<p>Hi</p><img src="data:image/png;base64,${png}" width="80"><img alt="again" src='data:image/png;base64,${png}'>`,
  );
  expect(images).toHaveLength(1);
  expect(html).not.toContain("data:");
  expect(html.match(/cid:/g)).toHaveLength(2);
  expect(images[0].content.toString()).toBe("png-bytes");

  const raw = (
    await buildRawMessage({
      from: { name: "Me", email: "me@x.com" },
      to: [{ name: "You", email: "you@x.com" }],
      cc: [],
      bcc: [],
      subject: "Logo",
      html: `<img src="data:image/png;base64,${png}">`,
      text: "",
      attachments: [],
    })
  ).toString();
  expect(raw).toContain("multipart/related");
  expect(raw).toContain("Content-ID: <img1.");
});
