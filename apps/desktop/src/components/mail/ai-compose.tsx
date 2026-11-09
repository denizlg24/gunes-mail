import type { AiComposeRequest } from "@gunes/shared";
import { ArrowUpIcon, RotateCcwIcon, SparklesIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { errorMessage, getApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface AiComposeContext {
  accountId: string;
  threadId?: string;
  mode: "new" | "reply" | "replyAll" | "forward";
  subject: string;
}

const DRAFT_STARTERS: Record<AiComposeContext["mode"], string[]> = {
  new: ["Ask for a meeting next week", "Follow up on my last email", "Say thanks"],
  reply: ["Say yes", "Politely decline", "Ask for more details", "Suggest a call"],
  replyAll: ["Say yes", "Politely decline", "Ask for more details", "Suggest a call"],
  forward: ["Ask them to take a look", "Just FYI"],
};

const REWRITES = [
  { label: "Shorter", instruction: "Make it noticeably shorter and more direct." },
  { label: "More formal", instruction: "Make the tone more formal and professional." },
  { label: "Friendlier", instruction: "Make the tone warmer and friendlier." },
  { label: "Fix grammar", instruction: "Only fix spelling, grammar and punctuation. Change nothing else." },
];

type Phase = { kind: "idle" } | { kind: "running"; text: string } | { kind: "done"; text: string } | { kind: "error"; message: string };

export function AiComposePanel({
  context,
  draftText,
  onApply,
  onClose,
}: {
  context: AiComposeContext;
  /** The user's own words in the editor, without signature or quoted text. */
  draftText: () => string;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hasDraft] = useState(() => draftText().trim().length > 0);
  const lastRequest = useRef<AiComposeRequest | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abort.current?.abort();
  }, []);

  const run = async (request: AiComposeRequest) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    lastRequest.current = request;
    setPhase({ kind: "running", text: "" });
    try {
      const text = await getApi().aiCompose(
        context.accountId,
        request,
        (partial) => setPhase({ kind: "running", text: partial }),
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPhase(text.trim() ? { kind: "done", text: text.trim() } : { kind: "error", message: "Nothing came back. Try again." });
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  };

  const draft = (wish: string) =>
    void run({
      action: "draft",
      instruction: wish,
      threadId: context.threadId,
      mode: context.mode,
      subject: context.subject || undefined,
    });

  const rewrite = (wish: string) =>
    void run({ action: "rewrite", instruction: wish, draft: draftText(), threadId: context.threadId });

  const stop = () => {
    abort.current?.abort();
    setPhase((p) => (p.kind === "running" && p.text.trim() ? { kind: "done", text: p.text.trim() } : { kind: "idle" }));
  };

  const busy = phase.kind === "running";
  const preview = phase.kind === "running" || phase.kind === "done" ? phase.text : "";

  return (
    <div
      className="mx-4 mt-3 overflow-hidden rounded-lg border border-brand/30 bg-brand-soft/30"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (busy) stop();
          else onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <SparklesIcon className="size-4 text-brand" />
        <span className="flex-1 text-[13px] font-semibold">{hasDraft ? "Draft or rewrite with AI" : "Draft with AI"}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {preview || phase.kind === "running" ? (
        <div className="px-3 pt-2 pb-3">
          <div
            aria-live="polite"
            className="selectable max-h-72 min-h-16 overflow-y-auto rounded-md border border-border bg-pane px-3 py-2 text-[14px] leading-relaxed whitespace-pre-wrap"
          >
            {preview}
            {busy && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-brand align-text-bottom" />}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-pane px-2.5 text-[12px] hover:bg-hover"
              >
                <SquareIcon className="size-3 fill-current" />
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onApply(preview);
                    onClose();
                  }}
                  className="inline-flex h-7 items-center rounded-md bg-brand-strong px-3 text-[12px] font-semibold text-white hover:bg-brand-strong-hover"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={() => lastRequest.current && void run(lastRequest.current)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-pane px-2.5 text-[12px] hover:bg-hover"
                >
                  <RotateCcwIcon className="size-3.5" />
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "idle" })}
                  className="inline-flex h-7 items-center rounded-md px-2.5 text-[12px] text-subtle hover:bg-hover hover:text-foreground"
                >
                  Discard
                </button>
              </>
            )}
            <span className="ml-auto text-[11px] text-subtle">AI can make mistakes. Review before sending.</span>
          </div>
        </div>
      ) : (
        <form
          className="px-3 pt-2 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            draft(instruction);
          }}
        >
          <div className="flex items-end gap-2 rounded-md border border-border bg-pane px-2.5 py-1.5 focus-within:border-brand">
            <textarea
              ref={inputRef}
              rows={1}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  draft(instruction);
                }
              }}
              placeholder={context.mode === "new" ? "Describe what you want to write" : "What should the reply say?"}
              aria-label="Instructions for the AI"
              className="max-h-32 min-h-6 flex-1 resize-none bg-transparent py-0.5 text-[13px] outline-none field-sizing-content placeholder:text-subtle"
            />
            <button
              type="submit"
              aria-label="Generate"
              title="Generate"
              disabled={context.mode === "new" && !instruction.trim()}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-strong text-white hover:bg-brand-strong-hover disabled:opacity-40"
            >
              <ArrowUpIcon className="size-3.5" />
            </button>
          </div>
          {phase.kind === "error" && <p className="mt-2 text-[12px] text-destructive">{phase.message}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {hasDraft &&
              REWRITES.map((r) => (
                <Chip key={r.label} onClick={() => rewrite(r.instruction)}>
                  {r.label}
                </Chip>
              ))}
            {hasDraft && <span className="mx-1 h-4 w-px bg-border" />}
            {DRAFT_STARTERS[context.mode].map((s) => (
              <Chip key={s} muted={hasDraft} onClick={() => draft(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </form>
      )}
    </div>
  );
}

function Chip({ children, onClick, muted }: { children: React.ReactNode; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center rounded-full border border-border bg-pane px-2.5 text-[12px] transition-colors hover:border-brand/50 hover:text-brand",
        muted && "text-subtle",
      )}
    >
      {children}
    </button>
  );
}
