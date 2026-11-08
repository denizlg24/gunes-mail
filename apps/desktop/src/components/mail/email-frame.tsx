import DOMPurify from "dompurify";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

import { getApi } from "@/lib/api";
import { textToHtml } from "@/lib/mime";
import { cn } from "@/lib/utils";

type FrameMode = "light" | "dark" | "paper";

const PALETTE: Record<FrameMode, { bg: string; fg: string; link: string; rule: string; pad: string }> = {
  light: { bg: "#ffffff", fg: "#242424", link: "#0f6cbd", rule: "#d1d1d1", pad: "0" },
  dark: { bg: "#292929", fg: "#e6e6e6", link: "#479ef5", rule: "#525252", pad: "0" },
  paper: { bg: "#ffffff", fg: "#242424", link: "#0f6cbd", rule: "#d1d1d1", pad: "16px" },
};

function baseStyle(mode: FrameMode): string {
  const p = PALETTE[mode];
  return `
  html, body { margin: 0; padding: 0; background: ${p.bg}; }
  body {
    padding: ${p.pad};
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.45; color: ${p.fg};
    overflow-wrap: anywhere; word-break: normal;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${p.link}; }
  blockquote { margin: 0 0 0 0.8ex; border-left: 2px solid ${p.rule}; padding-left: 1ex; }
  hr { border: none; border-top: 1px solid ${p.rule}; }
  pre { white-space: pre-wrap; }
  ::selection { background: #b4d6fa; color: #242424; }
`;
}

const STYLED_RE = /(background(-color)?\s*:|bgcolor\s*=|color\s*:\s*#(?!fff)|<font[^>]+color)/i;

function buildDocument(html: string, mode: FrameMode): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "meta"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ADD_ATTR: ["target"],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseStyle(mode)}</style></head><body>${clean}</body></html>`;
}

interface EmailFrameProps {
  html?: string;
  text?: string;
  cidMap?: Record<string, string>;
}

export function EmailFrame({ html, text, cidMap }: EmailFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { doc, mode } = useMemo(() => {
    let source = html ?? textToHtml(text ?? "");
    const frameMode: FrameMode = !isDark ? "light" : html && STYLED_RE.test(html) ? "paper" : "dark";
    if (cidMap) {
      source = source.replace(/(["'(])cid:([^"')]+)(["')])/gi, (match, open: string, cid: string, close: string) => {
        const url = cidMap[cid.trim()];
        return url ? `${open}${url}${close}` : match;
      });
    }
    return { doc: buildDocument(source, frameMode), mode: frameMode };
  }, [html, text, cidMap, isDark]);

  const observerRef = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const onLoad = () => {
    const d = ref.current?.contentDocument;
    if (!d?.documentElement) return;
    const measure = () => setHeight(Math.max(40, d.documentElement.scrollHeight));
    measure();
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(d.documentElement);
    d.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    d.addEventListener("click", (e) => {
      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!anchor || !href) return;
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) void getApi().openExternal(href);
    });
    d.addEventListener("contextmenu", (e) => {
      if (!d.getSelection()?.toString()) e.preventDefault();
    });
    d.addEventListener("keydown", (e) => {
      const { key, code, ctrlKey, metaKey, shiftKey, altKey } = e;
      const forwarded = new KeyboardEvent("keydown", { key, code, ctrlKey, metaKey, shiftKey, altKey, bubbles: true, cancelable: true });
      document.body.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) e.preventDefault();
    });
  };

  return (
    <iframe
      ref={ref}
      title="Message body"
      srcDoc={doc}
      onLoad={onLoad}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className={cn("block w-full border-0", mode === "paper" && "rounded-md")}
      style={{ height, background: PALETTE[mode].bg }}
    />
  );
}
