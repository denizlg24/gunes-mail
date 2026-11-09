import { expect, test } from "bun:test";

import { resolveCidImages, signatureBody, signatureHtml, textToParagraphs, withoutSignature } from "./compose";

test("plain-text signatures from older versions become escaped HTML", () => {
  expect(signatureBody("Best,\nDeniz <deniz@x.com>")).toBe("<p>Best,<br>Deniz &lt;deniz@x.com&gt;</p>");
  expect(signatureBody('<p><strong>Deniz</strong></p><img src="data:image/png;base64,AA==">')).toBe(
    '<p><strong>Deniz</strong></p><img src="data:image/png;base64,AA==">',
  );
  expect(signatureHtml("   ")).toBe("");
  expect(signatureHtml("Deniz")).toBe("<p></p><p>Deniz</p>");
});

test("generated text keeps its paragraphs and line breaks, escaped", () => {
  expect(textToParagraphs("Hi Sam,\n\nSounds good.\nSee you <then>.\n\n")).toBe(
    "<p>Hi Sam,</p><p>Sounds good.<br>See you &lt;then&gt;.</p>",
  );
});

test("the signature is left out of what the assistant rewrites", () => {
  const sig = "<p>Deniz Günes</p>";
  expect(withoutSignature("Thanks, will do.\n\nDeniz Günes", sig)).toBe("Thanks, will do.");
  expect(withoutSignature("Thanks, will do.\n\nDeniz Günes, edited", sig)).toBe("Thanks, will do.\n\nDeniz Günes, edited");
  expect(withoutSignature("No signature here", "")).toBe("No signature here");
});

test("cid pictures in a reopened draft are inlined again", async () => {
  const html = '<p>Hi</p><img src="cid:logo@x"><img src="cid:gone@x">';
  const out = await resolveCidImages(
    html,
    [
      { filename: "logo.png", mimeType: "image/png", size: 3, contentId: "logo@x", inline: true, attachmentId: "a1" },
      { filename: "unused.png", mimeType: "image/png", size: 3, contentId: "unused@x", inline: true, attachmentId: "a2" },
      { filename: "gone.png", mimeType: "image/png", size: 3, contentId: "gone@x", inline: true, attachmentId: "a3" },
    ],
    async (a) => {
      if (a.attachmentId === "a3") throw new Error("missing");
      return "AQID";
    },
  );
  expect(out).toBe('<p>Hi</p><img src="data:image/png;base64,AQID"><img src="cid:gone@x">');
});
