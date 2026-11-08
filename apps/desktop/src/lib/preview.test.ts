import { describe, expect, test } from "bun:test";
import { strToU8, unzipSync, zipSync } from "fflate";

import { looksLikeText, parseDelimited, type PreviewKind, previewKind, textFromOfficeXml } from "./preview";

describe("previewKind", () => {
  test.each<[string, string, PreviewKind]>([
    ["application/pdf", "invoice.pdf", "pdf"],
    ["application/octet-stream", "photo.HEIC", "image"],
    ["image/png", "x", "image"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "contract.docx", "docx"],
    ["application/octet-stream", "budget.xlsx", "xlsx"],
    ["application/octet-stream", "deck.pptx", "office-text"],
    ["text/csv", "export.csv", "csv"],
    ["application/octet-stream", "data.tsv", "csv"],
    ["application/json", "x.json", "json"],
    ["text/html", "page.html", "html"],
    ["video/quicktime", "clip.mov", "video"],
    ["audio/mpeg", "memo.mp3", "audio"],
    ["application/zip", "files.zip", "zip"],
    ["application/octet-stream", "server.log", "text"],
    ["application/octet-stream", "invite.ics", "text"],
    ["application/octet-stream", "blob.bin", "unknown"],
  ])("%s %s is %s", (mime, name, kind) => expect(previewKind(mime, name)).toBe(kind));
});

describe("looksLikeText", () => {
  test("accepts UTF-8 text and rejects binary", () => {
    expect(looksLikeText(new TextEncoder().encode("hello\nwörld\tok"))).toBe(true);
    expect(looksLikeText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))).toBe(false);
    expect(looksLikeText(new Uint8Array([]))).toBe(false);
  });
});

describe("parseDelimited", () => {
  test("handles quotes, escaped quotes and newlines in fields", () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\r\n"multi\nline",2', ",")).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["multi\nline", "2"],
    ]);
  });
});

describe("textFromOfficeXml", () => {
  test("extracts slide text in order", () => {
    const files = zipSync({
      "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>"),
      "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:t>Hello &amp; welcome</a:t></a:p><a:p><a:t>Line two</a:t></a:p></p:sld>"),
    });
    expect(textFromOfficeXml(unzipSync(files))).toBe("Slide 1\nHello & welcome\nLine two\n\nSlide 2\nSecond");
  });
});
