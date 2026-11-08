export type PreviewKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "html"
  | "csv"
  | "json"
  | "text"
  | "docx"
  | "xlsx"
  | "office-text"
  | "zip"
  | "unknown";

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "heic", "heif", "tif", "tiff"]);
const VIDEO = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);
const AUDIO = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"]);
const TEXT = new Set([
  "txt", "text", "log", "md", "markdown", "rtf", "eml", "ics", "vcf", "xml", "yml", "yaml", "toml", "ini", "cfg", "conf",
  "env", "sql", "sh", "bash", "zsh", "ps1", "bat", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "less", "py",
  "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "pl", "r", "lua", "dart", "scala",
  "gradle", "properties", "srt", "vtt", "diff", "patch", "tex", "bib", "gpx", "kml", "plist",
]);
/** Office and OpenDocument formats are zip archives of XML; their text can still be shown. */
const OFFICE_TEXT = new Set(["pptx", "ppsx", "potx", "odt", "ods", "odp", "docm", "dotx", "xlsm"]);

export function previewKind(mimeType: string, filename: string): PreviewKind {
  const mime = mimeType.toLowerCase();
  const e = ext(filename);
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (e === "docx" || mime.includes("wordprocessingml.document")) return "docx";
  if (e === "xlsx" || mime.includes("spreadsheetml.sheet")) return "xlsx";
  if (e === "csv" || e === "tsv" || mime === "text/csv" || mime === "text/tab-separated-values") return "csv";
  if (e === "json" || e === "geojson" || mime === "application/json" || mime.endsWith("+json")) return "json";
  if (e === "html" || e === "htm" || mime === "text/html") return "html";
  if (IMAGE.has(e) || mime.startsWith("image/")) return "image";
  if (VIDEO.has(e) || mime.startsWith("video/")) return "video";
  if (AUDIO.has(e) || mime.startsWith("audio/")) return "audio";
  if (OFFICE_TEXT.has(e) || mime.includes("presentationml") || mime.includes("opendocument")) return "office-text";
  if (e === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed") return "zip";
  if (TEXT.has(e) || mime.startsWith("text/") || mime.endsWith("+xml") || mime === "application/xml") return "text";
  return "unknown";
}

/**
 * Decides whether unknown bytes are readable text: valid-looking UTF-8 with no NUL bytes
 * and almost no control characters.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 64 * 1024);
  if (!sample.length) return false;
  if (sample.includes(0)) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sample);
  let suspicious = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "�" || (code < 32 && ch !== "\n" && ch !== "\r" && ch !== "\t" && ch !== "\f")) suspicious++;
  }
  return suspicious / text.length < 0.02;
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes and newlines inside quotes. */
export function parseDelimited(text: string, delimiter: string, maxRows = 2000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if ((field || row.length) && rows.length < maxRows) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Pulls readable text out of the XML parts of an Office/OpenDocument file, in document order. */
export function textFromOfficeXml(entries: Record<string, Uint8Array>): string {
  const decoder = new TextDecoder();
  const order = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const parts = Object.keys(entries)
    .filter((n) => /^(ppt\/slides\/slide\d+\.xml|word\/document\.xml|xl\/sharedStrings\.xml|content\.xml)$/.test(n))
    .sort((a, b) => order(a) - order(b));
  return parts
    .map((name, i) => {
      const xml = decoder.decode(entries[name]);
      const paragraphs = xml
        .split(/<\/(?:a:p|w:p|text:p|text:h|si)>/)
        .map((p) =>
          p
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&")
            .trim(),
        )
        .filter(Boolean);
      const heading = name.startsWith("ppt/slides/") ? `Slide ${i + 1}\n` : "";
      return heading + paragraphs.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
