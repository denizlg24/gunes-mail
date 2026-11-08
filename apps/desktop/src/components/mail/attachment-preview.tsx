import DOMPurify from "dompurify";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExternalLinkIcon, FileQuestionIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, getApi } from "@/lib/api";
import { fileSize } from "@/lib/format";
import { looksLikeText, parseDelimited, type PreviewKind, previewKind, textFromOfficeXml } from "@/lib/preview";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ErrorReference } from "./error-reference";

const MAX_TEXT_CHARS = 2_000_000;
const MAX_PDF_PAGES = 60;

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: unknown }
  | { state: "ready"; blob: Blob; kind: PreviewKind };

function useAttachmentBlob(accountId: string, messageId: string, attachment: Attachment): Loaded {
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded }>({ key: "", value: { state: "loading" } });
  const key = `${messageId}/${attachment.attachmentId ?? attachment.filename}`;

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<Loaded> => {
      if (attachment.data) {
        const bytes = Uint8Array.from(atob(attachment.data), (c) => c.charCodeAt(0));
        return { state: "ready", blob: new Blob([bytes], { type: attachment.mimeType }), kind: previewKind(attachment.mimeType, attachment.filename) };
      }
      if (!attachment.attachmentId) return { state: "error", error: new Error("This attachment can't be downloaded") };
      const raw = await getApi().getAttachmentBlob(accountId, messageId, attachment.attachmentId);
      const blob = raw.type ? raw : new Blob([raw], { type: attachment.mimeType });
      return { state: "ready", blob, kind: previewKind(attachment.mimeType, attachment.filename) };
    };
    load()
      .catch((error: unknown): Loaded => ({ state: "error", error }))
      .then((value) => !cancelled && setLoaded({ key, value }));
    return () => {
      cancelled = true;
    };
  }, [accountId, messageId, attachment, key]);

  return loaded.key === key ? loaded.value : { state: "loading" };
}

function useObjectUrl(blob: Blob) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

/** Runs `fn` once per blob; results for a previous blob are never returned. */
function useBlobTask<T>(blob: Blob, fn: (blob: Blob) => Promise<T>): { value?: T; error?: unknown } {
  const [result, setResult] = useState<{ blob: Blob | null; value?: T; error?: unknown }>({ blob: null });
  const task = useRef(fn);
  useEffect(() => {
    let cancelled = false;
    task.current(blob).then(
      (value) => !cancelled && setResult({ blob, value }),
      (error: unknown) => !cancelled && setResult({ blob, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return result.blob === blob ? result : {};
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[13px] text-subtle">{children}</div>;
}

function Spinner() {
  return (
    <Centered>
      <Loader2Icon className="size-6 animate-spin text-brand" />
    </Centered>
  );
}

function NoPreview({ attachment, onOpen, onDownload, reason }: { attachment: Attachment; onOpen: () => void; onDownload: () => void; reason?: string }) {
  return (
    <Centered>
      <FileQuestionIcon className="size-12 text-subtle/60" strokeWidth={1.2} />
      <div className="text-[15px] font-semibold text-foreground">No preview available</div>
      <div className="max-w-sm">{reason ?? `${attachment.filename} can't be shown here, but you can open it with another app.`}</div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={onOpen}>
          <ExternalLinkIcon />
          Open
        </Button>
        <Button size="sm" variant="outline" onClick={onDownload}>
          <DownloadIcon />
          Download
        </Button>
      </div>
    </Centered>
  );
}

function TextView({ text }: { text: string }) {
  const truncated = text.length > MAX_TEXT_CHARS;
  return (
    <div className="thin-scroll h-full overflow-auto bg-pane">
      <pre className="selectable p-5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {truncated ? text.slice(0, MAX_TEXT_CHARS) : text}
      </pre>
      {truncated && <div className="px-5 pb-5 text-[12px] text-subtle">Showing the first 2 million characters.</div>}
    </div>
  );
}

function TableView({ rows, note }: { rows: string[][]; note?: string }) {
  const [header, ...body] = rows;
  if (!header) return <Centered>This sheet is empty.</Centered>;
  return (
    <div className="thin-scroll h-full overflow-auto bg-pane">
      <table className="selectable min-w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="border border-border px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="even:bg-muted/40">
              {header.map((_, c) => (
                <td key={c} className="max-w-[420px] truncate border border-border px-2.5 py-1 align-top" title={row[c]}>
                  {row[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div className="p-3 text-[12px] text-subtle">{note}</div>}
    </div>
  );
}

/** HTML from attachments and Word documents is sanitized and rendered with scripts disabled. */
function HtmlView({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, FORBID_TAGS: ["script", "iframe", "object", "embed", "form"] });
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:32px 40px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f1f1f;background:#fff;word-wrap:break-word}
    img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}
  </style></head><body>${clean}</body></html>`;
  return <iframe title="Attachment preview" sandbox="" srcDoc={doc} className="h-full w-full rounded-b-xl bg-white" />;
}

function ImageView({ url, alt, onFail }: { url: string; alt: string; onFail: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className={cn("thin-scroll flex h-full items-center justify-center overflow-auto bg-[conic-gradient(#0000000a_25%,transparent_0_50%,#0000000a_0_75%,transparent_0)] bg-[length:20px_20px] p-4", zoomed && "items-start justify-start")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        onError={onFail}
        onClick={() => setZoomed((z) => !z)}
        className={cn("shadow-sm", zoomed ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
      />
    </div>
  );
}

function PdfView({ blob }: { blob: Blob }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ pages: number; error?: unknown } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    const host = container.current;
    if (!host) return;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const loading = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        task = loading;
        const doc = await loading.promise;
        if (cancelled) return;
        setStatus({ pages: doc.numPages });
        const width = Math.min(host.clientWidth - 48, 1100);
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES) && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * window.devicePixelRatio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.className = "mx-auto mb-4 block bg-white shadow-md";
          host.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
        }
      } catch (error) {
        if (!cancelled) setStatus({ pages: 0, error });
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
      host.replaceChildren();
    };
  }, [blob]);

  if (status?.error) return <Centered>Couldn&apos;t render this PDF. {errorMessage(status.error)}</Centered>;
  return (
    <div className="thin-scroll relative h-full overflow-auto bg-muted/60 py-6">
      {!status && <Spinner />}
      <div ref={container} />
      {status && status.pages > MAX_PDF_PAGES && (
        <div className="pb-4 text-center text-[12px] text-subtle">
          Showing the first {MAX_PDF_PAGES} of {status.pages} pages. Open the file to see the rest.
        </div>
      )}
    </div>
  );
}

function DocxView({ blob }: { blob: Blob }) {
  const { value, error } = useBlobTask(blob, async (b) => {
    const mammoth = await import("mammoth");
    return (await mammoth.convertToHtml({ arrayBuffer: await b.arrayBuffer() })).value;
  });
  if (error) return <TextFallback blob={blob} />;
  if (value === undefined) return <Spinner />;
  return <HtmlView html={value} />;
}

function XlsxView({ blob }: { blob: Blob }) {
  const [sheet, setSheet] = useState(0);
  const { value: sheets, error } = useBlobTask(blob, async (b) => {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    return readXlsxFile(b);
  });
  if (error) return <Centered>Couldn&apos;t read this spreadsheet. {errorMessage(error)}</Centered>;
  if (!sheets) return <Spinner />;
  const current = sheets[sheet] ?? sheets[0];
  const rows = (current?.data ?? []).slice(0, 2000).map((row) => row.map((cell) => (cell === null ? "" : String(cell))));
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <TableView rows={rows} note={(current?.data.length ?? 0) > 2000 ? "Showing the first 2,000 rows." : undefined} />
      </div>
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border bg-muted/40 px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.sheet}
              type="button"
              onClick={() => setSheet(i)}
              className={cn("rounded-md px-3 py-1 text-[12px]", i === sheet ? "bg-pane font-semibold shadow-sm" : "text-subtle hover:bg-hover")}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OfficeTextView({ blob, attachment, onOpen, onDownload }: { blob: Blob; attachment: Attachment; onOpen: () => void; onDownload: () => void }) {
  const { value, error } = useBlobTask(blob, async (b) => {
    const { unzipSync } = await import("fflate");
    return textFromOfficeXml(unzipSync(new Uint8Array(await b.arrayBuffer())));
  });
  if (error || value === "") return <NoPreview attachment={attachment} onOpen={onOpen} onDownload={onDownload} />;
  if (value === undefined) return <Spinner />;
  return <TextView text={value} />;
}

function ZipView({ blob, attachment, onOpen, onDownload }: { blob: Blob; attachment: Attachment; onOpen: () => void; onDownload: () => void }) {
  const { value, error } = useBlobTask(blob, async (b) => {
    const { unzipSync } = await import("fflate");
    const files = unzipSync(new Uint8Array(await b.arrayBuffer()));
    return Object.entries(files)
      .filter(([name]) => !name.endsWith("/"))
      .map(([name, data]) => [name, fileSize(data.length)]);
  });
  if (error) return <NoPreview attachment={attachment} onOpen={onOpen} onDownload={onDownload} reason="This archive is encrypted or uses a format that can't be listed here." />;
  if (!value) return <Spinner />;
  return <TableView rows={[["Name", "Size"], ...value]} note={`${value.length} file${value.length === 1 ? "" : "s"}`} />;
}

function TextFallback({ blob, onUnreadable }: { blob: Blob; onUnreadable?: React.ReactNode }) {
  const { value } = useBlobTask(blob, async (b) => {
    const bytes = new Uint8Array(await b.arrayBuffer());
    return looksLikeText(bytes) ? new TextDecoder().decode(bytes) : null;
  });
  if (value === undefined) return <Spinner />;
  if (value === null) return <>{onUnreadable ?? <Centered>No preview available</Centered>}</>;
  return <TextView text={value} />;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function TextKindView({ blob, kind }: { blob: Blob; kind: "text" | "csv" | "json" }) {
  const { value } = useBlobTask(blob, (b) => b.text());
  if (value === undefined) return <Spinner />;
  if (kind === "csv") {
    const tab = value.split("\n", 1)[0].includes("\t") && !value.split("\n", 1)[0].includes(",");
    const rows = parseDelimited(value, tab ? "\t" : ",");
    return <TableView rows={rows} note={rows.length >= 2000 ? "Showing the first 2,000 rows." : undefined} />;
  }
  if (kind === "json") return <TextView text={prettyJson(value)} />;
  return <TextView text={value} />;
}

function PreviewBody({ loaded, attachment, onOpen, onDownload }: { loaded: Extract<Loaded, { state: "ready" }>; attachment: Attachment; onOpen: () => void; onDownload: () => void }) {
  const url = useObjectUrl(loaded.blob);
  const [mediaFailed, setMediaFailed] = useState(false);
  const noPreview = <NoPreview attachment={attachment} onOpen={onOpen} onDownload={onDownload} />;
  if (mediaFailed) return <TextFallback blob={loaded.blob} onUnreadable={noPreview} />;

  switch (loaded.kind) {
    case "image":
      return url ? <ImageView url={url} alt={attachment.filename} onFail={() => setMediaFailed(true)} /> : <Spinner />;
    case "video":
      return url ? (
        <div className="flex h-full items-center justify-center bg-black">
          <video src={url} controls autoPlay={false} onError={() => setMediaFailed(true)} className="max-h-full max-w-full" />
        </div>
      ) : (
        <Spinner />
      );
    case "audio":
      return url ? (
        <Centered>
          <div className="text-[15px] font-semibold text-foreground">{attachment.filename}</div>
          <audio src={url} controls onError={() => setMediaFailed(true)} className="w-full max-w-md" />
        </Centered>
      ) : (
        <Spinner />
      );
    case "pdf":
      return <PdfView blob={loaded.blob} />;
    case "docx":
      return <DocxView blob={loaded.blob} />;
    case "xlsx":
      return <XlsxView blob={loaded.blob} />;
    case "html":
      return <HtmlFromBlob blob={loaded.blob} />;
    case "csv":
    case "json":
    case "text":
      return <TextKindView blob={loaded.blob} kind={loaded.kind} />;
    case "office-text":
      return <OfficeTextView blob={loaded.blob} attachment={attachment} onOpen={onOpen} onDownload={onDownload} />;
    case "zip":
      return <ZipView blob={loaded.blob} attachment={attachment} onOpen={onOpen} onDownload={onDownload} />;
    case "unknown":
      return <TextFallback blob={loaded.blob} onUnreadable={noPreview} />;
  }
}

function HtmlFromBlob({ blob }: { blob: Blob }) {
  const { value } = useBlobTask(blob, (b) => b.text());
  return value === undefined ? <Spinner /> : <HtmlView html={value} />;
}

export function AttachmentPreview({
  accountId,
  messageId,
  attachments,
  index,
  onIndexChange,
  onClose,
  onSave,
}: {
  accountId: string;
  messageId: string;
  attachments: Attachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onSave: (attachment: Attachment, open: boolean) => void;
}) {
  const attachment = attachments[index];
  const loaded = useAttachmentBlob(accountId, messageId, attachment);
  const many = attachments.length > 1;
  const go = (delta: number) => onIndexChange((index + delta + attachments.length) % attachments.length);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
        className="flex h-[88vh] w-[min(1200px,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          {many && (
            <div className="flex items-center">
              <Button variant="ghost" size="icon-sm" aria-label="Previous attachment" onClick={() => go(-1)}>
                <ChevronLeftIcon />
              </Button>
              <span className="w-12 text-center text-[12px] text-subtle tabular-nums">
                {index + 1} / {attachments.length}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next attachment" onClick={() => go(1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
          <div className="min-w-0 flex-1 px-1">
            <DialogTitle className="truncate text-[14px] font-semibold">{attachment.filename}</DialogTitle>
            <div className="text-[11px] text-subtle">{fileSize(attachment.size)}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onSave(attachment, true)}>
            <ExternalLinkIcon />
            Open
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSave(attachment, false)}>
            <DownloadIcon />
            Download
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
            <XIcon />
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          {loaded.state === "loading" && <Spinner />}
          {loaded.state === "error" && (
            <Centered>
              <div className="font-semibold text-foreground">Couldn&apos;t load {attachment.filename}</div>
              <div>{errorMessage(loaded.error)}</div>
              <ErrorReference error={loaded.error} />
            </Centered>
          )}
          {loaded.state === "ready" && (
            <PreviewBody
              key={`${messageId}/${index}`}
              loaded={loaded}
              attachment={attachment}
              onOpen={() => onSave(attachment, true)}
              onDownload={() => onSave(attachment, false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
