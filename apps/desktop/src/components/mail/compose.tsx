import { useQueryClient } from "@tanstack/react-query";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ClockIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  Loader2Icon,
  PaperclipIcon,
  RemoveFormattingIcon,
  SendIcon,
  Trash2Icon,
  UnderlineIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { addDays, addHours, format, nextMonday, setHours, startOfHour } from "date-fns";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { registerComposeFlush } from "@/hooks/use-commands";
import { keys, useAccounts } from "@/hooks/use-mail";
import { errorMessage, getApi } from "@/lib/api";
import { fileToAttachment, signatureHtml } from "@/lib/compose";
import { fileSize, shortcut } from "@/lib/format";
import { htmlToText } from "@/lib/mime";
import type { OutgoingAttachment, OutgoingMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type ComposeDraft, useUi } from "@/store/ui";

import { confirmDialog, prompt } from "./dialog-host";
import { EmailFrame } from "./email-frame";
import { RecipientInput } from "./recipient-input";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function scheduleOptions() {
  const morning = (d: Date) => startOfHour(setHours(d, 8));
  const now = new Date();
  const options = [
    { label: "Later today", at: startOfHour(addHours(now, 3)).getTime() },
    { label: "Tomorrow morning", at: morning(addDays(now, 1)).getTime() },
    { label: "Monday morning", at: morning(nextMonday(now)).getTime() },
  ];
  return now.getHours() >= 18 ? options.slice(1) : options;
}

function outgoingToDraft(accountId: string, payload: OutgoingMessage, previous: ComposeDraft): ComposeDraft {
  return {
    ...previous,
    key: crypto.randomUUID(),
    accountId,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    body: previous.quoted ? payload.html.replace(previous.quoted, "") : payload.html,
    attachments: payload.attachments,
    draftId: payload.draftId,
  };
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-foreground [&_svg]:size-4",
              active && "bg-selected text-foreground hover:bg-selected-hover",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Compose({ inline = false }: { inline?: boolean }) {
  const initial = useUi((s) => s.compose) as ComposeDraft;
  const setCompose = useUi((s) => s.setCompose);
  const { data: accounts = [] } = useAccounts();
  const qc = useQueryClient();

  const [accountId, setAccountId] = useState(initial.accountId);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [attachments, setAttachments] = useState<OutgoingAttachment[]>(initial.attachments);
  const [showQuoted, setShowQuoted] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draftIdRef = useRef(initial.draftId);
  const savedSnapshotRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  const snapshot = useCallback(
    (html: string) =>
      JSON.stringify([accountId, to, cc, bcc, subject, attachments.map((a) => a.filename), html]),
    [accountId, to, cc, bcc, subject, attachments],
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: inline ? "Type your reply…" : "Type / to insert files and more" }),
    ],
    content: initial.body || (initial.mode === "draft" ? "" : signatureHtml(useUi.getState().signature)),
    editorProps: {
      attributes: { class: "selectable text-[14px]", spellcheck: "true" },
    },
    onCreate: ({ editor: e }) => {
      savedSnapshotRef.current ??= snapshot(e.getHTML());
      if (initial.mode !== "new") requestAnimationFrame(() => e.commands.focus("start"));
    },
  });

  const marks = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
    }),
  });


  const build = useCallback((): OutgoingMessage | null => {
    if (!account || !editor) return null;
    const bodyHtml = editor.getHTML();
    const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px">${bodyHtml}</div>${initial.quoted ?? ""}`;
    return {
      from: { name: account.name, email: account.email },
      to,
      cc,
      bcc,
      subject,
      html,
      text: htmlToText(html),
      attachments,
      threadId: account.id === initial.accountId ? initial.threadId : undefined,
      inReplyTo: initial.inReplyTo,
      references: initial.references,
      draftId: draftIdRef.current,
    };
  }, [account, editor, initial, to, cc, bcc, subject, attachments]);

  const hasContent = useCallback(() => {
    const text = editor?.getText().trim() ?? "";
    return !!(text || subject.trim() || to.length || cc.length || bcc.length || attachments.length);
  }, [editor, subject, to, cc, bcc, attachments]);

  const invalidate = useCallback(
    (id: string) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.threads(id) }),
        qc.invalidateQueries({ queryKey: keys.labels(id) }),
        ...(initial.threadId ? [qc.invalidateQueries({ queryKey: keys.thread(id, initial.threadId) })] : []),
      ]),
    [qc, initial.threadId],
  );

  const saveDraft = useCallback(async () => {
    const message = build();
    if (!message || !account) return;
    const current = snapshot(editor?.getHTML() ?? "");
    if (current === savedSnapshotRef.current || !hasContent()) return;
    try {
      draftIdRef.current = await getApi().saveDraft(account.id, message);
      savedSnapshotRef.current = current;
      toast("Draft saved", { description: subject || "(no subject)" });
      await invalidate(account.id);
    } catch (e) {
      toast.error("Couldn't save draft", { description: errorMessage(e) });
    }
  }, [account, build, editor, hasContent, invalidate, snapshot, subject]);

  const close = useCallback(
    async (save: boolean) => {
      if (closedRef.current) return;
      closedRef.current = true;
      registerComposeFlush(null);
      if (useUi.getState().compose?.key === initial.key) setCompose(null);
      document.getElementById("message-list")?.focus({ preventScroll: true });
      if (save) await saveDraft();
    },
    [initial.key, saveDraft, setCompose],
  );

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    registerComposeFlush(() => closeRef.current(true));
    return () => registerComposeFlush(null);
  }, []);

  useEffect(() => {
    const startIds = useUi.getState().selectedIds.join();
    return useUi.subscribe((s, prev) => {
      if (s.selectedIds === prev.selectedIds) return;
      const changed = s.selectedIds.join() !== startIds;
      const leftThread = inline ? s.selectedIds[0] !== initial.threadId : changed;
      if (leftThread && s.selectedIds.length > 0) void closeRef.current(true);
    });
  }, [inline, initial.threadId]);

  const discard = async () => {
    closedRef.current = true;
    registerComposeFlush(null);
    setCompose(null);
    if (draftIdRef.current && account) {
      try {
        await getApi().deleteDraft(account.id, draftIdRef.current);
        await invalidate(account.id);
      } catch (e) {
        toast.error("Couldn't discard draft", { description: errorMessage(e) });
      }
    }
  };

  const send = async (sendAt?: number) => {
    const message = build();
    if (!message || !account || sending) return;
    if (!to.length && !cc.length && !bcc.length) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!subject.trim()) {
      const ok = await confirmDialog({
        title: "Send without a subject?",
        description: "This message has no subject.",
        confirmLabel: "Send anyway",
      });
      if (!ok) return;
    }
    setSending(true);
    try {
      const undoSeconds = useUi.getState().undoSendSeconds;
      const result = await getApi().send(account.id, message, { sendAt, undoSeconds });
      closedRef.current = true;
      registerComposeFlush(null);
      setCompose(null);
      const scheduled = result.sendAt - Date.now() > (undoSeconds + 5) * 1000;
      const undo = async () => {
        try {
          const { payload, accountId } = await getApi().cancelOutbox(result.id);
          useUi.getState().setCompose(outgoingToDraft(accountId, payload, initial));
        } catch (e) {
          toast.error("Too late to undo", { description: errorMessage(e) });
        }
      };
      if (scheduled) {
        toast.success(`Scheduled for ${format(result.sendAt, "EEE d MMM, HH:mm")}`, {
          description: result.delayedByRule ? `Delayed ${result.delayedByRule} min by a sending rule` : undefined,
          action: { label: "Undo", onClick: () => void undo() },
        });
      } else if (undoSeconds > 0) {
        toast("Sending…", { action: { label: "Undo", onClick: () => void undo() }, duration: undoSeconds * 1000 });
      } else {
        toast.success("Message sent");
      }
      await qc.invalidateQueries({ queryKey: ["outbox"] });
    } catch (e) {
      toast.error("Couldn't send the message", { description: errorMessage(e) });
    } finally {
      setSending(false);
    }
  };

  const scheduleCustom = async () => {
    const value = await prompt({
      title: "Schedule send",
      description: "Pick when this message should be sent. It goes out even if this app is closed.",
      inputType: "datetime-local",
      initial: format(addHours(new Date(), 1), "yyyy-MM-dd'T'HH:00"),
      confirmLabel: "Schedule",
    });
    if (!value) return;
    const at = new Date(value).getTime();
    if (!Number.isFinite(at) || at < Date.now()) {
      toast.error("Pick a time in the future");
      return;
    }
    await send(at);
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const tooBig = list.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) toast.error(`${tooBig.map((f) => f.name).join(", ")} exceeds the 25 MB limit`);
    const ok = await Promise.all(list.filter((f) => f.size <= MAX_ATTACHMENT_BYTES).map(fileToAttachment));
    setAttachments((a) => [...a, ...ok]);
  };

  const setLink = async () => {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const url = await prompt({ title: "Insert link", initial: current ?? "https://", confirmLabel: "Insert" });
    if (url === null) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void send();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      void close(true);
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void saveDraft();
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      void setLink();
    }
  };

  const title =
    initial.mode === "reply" || initial.mode === "replyAll"
      ? "Reply"
      : initial.mode === "forward"
        ? "Forward"
        : initial.mode === "draft"
          ? "Draft"
          : "New message";

  return (
    <div
      data-compose
      onKeyDown={onKeyDown}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col rounded-lg border bg-pane shadow-sm",
        inline ? "border-brand/40" : "border-border",
        dragging && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <div className="inline-flex h-8 overflow-hidden rounded-md bg-brand-strong text-white">
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="inline-flex items-center gap-2 px-3.5 text-[13px] font-semibold transition-colors hover:bg-brand-strong-hover disabled:opacity-60"
          >
            {sending ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
            Send
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Schedule send"
              disabled={sending}
              className="inline-flex w-7 items-center justify-center border-l border-white/25 transition-colors hover:bg-brand-strong-hover data-popup-open:bg-brand-strong-hover"
            >
              <ChevronDownIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Schedule send</DropdownMenuLabel>
                {scheduleOptions().map((o) => (
                  <DropdownMenuItem key={o.label} onClick={() => void send(o.at)}>
                    <ClockIcon />
                    <span className="flex-1 whitespace-nowrap">{o.label}</span>
                    <span className="whitespace-nowrap text-[12px] text-muted-foreground">{format(o.at, "EEE HH:mm")}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => void scheduleCustom()}>
                  <CalendarClockIcon />
                  Custom time…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <span className="ml-1 text-[11px] text-subtle">{shortcut("Ctrl+Enter")}</span>
        <div className="mx-2 h-5 w-px bg-border" />
        <ToolButton label="Attach file" onClick={() => fileRef.current?.click()}>
          <PaperclipIcon />
        </ToolButton>
        <ToolButton label="Bold" active={marks?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <BoldIcon />
        </ToolButton>
        <ToolButton label="Italic" active={marks?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <ItalicIcon />
        </ToolButton>
        <ToolButton label="Underline" active={marks?.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon />
        </ToolButton>
        <ToolButton label="Bullets" active={marks?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <ListIcon />
        </ToolButton>
        <ToolButton label="Numbering" active={marks?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <ListOrderedIcon />
        </ToolButton>
        <ToolButton label={`Link (${shortcut("Ctrl+K")})`} active={marks?.link} onClick={() => void setLink()}>
          <LinkIcon />
        </ToolButton>
        <ToolButton label="Clear formatting" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>
          <RemoveFormattingIcon />
        </ToolButton>
        <div className="flex-1" />
        <span className="mr-1 text-[12px] text-subtle">{title}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Discard"
                onClick={() => void discard()}
                className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground"
              />
            }
          >
            <Trash2Icon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Discard</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Close and save draft"
                onClick={() => void close(true)}
                className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground"
              />
            }
          >
            <XIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Close (saves draft) · Esc</TooltipContent>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="px-4">
        {accounts.length > 1 && !inline ? (
          <div className="flex h-10 items-center gap-2 border-b border-border">
            <span className="w-12 shrink-0 text-[13px] text-subtle">From</span>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] hover:bg-hover data-popup-open:bg-hover">
                {account?.email}
                <ChevronDownIcon className="size-3.5 text-subtle" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {accounts.map((a) => (
                  <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
                    <span className="flex flex-col">
                      <span>{a.email}</span>
                      <span className="text-xs text-muted-foreground">{a.name}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        <RecipientInput
          label="To"
          value={to}
          onChange={setTo}
          autoFocus={initial.mode === "new" || (initial.mode === "forward" && !to.length)}
          trailing={
            !showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="mt-0.5 h-7 shrink-0 rounded-sm px-1.5 text-[13px] text-subtle hover:bg-hover hover:text-foreground"
              >
                Cc &amp; Bcc
              </button>
            )
          }
        />
        {showCc && (
          <>
            <RecipientInput label="Cc" value={cc} onChange={setCc} />
            <RecipientInput label="Bcc" value={bcc} onChange={setBcc} />
          </>
        )}
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Add a subject"
          aria-label="Subject"
          className="h-10 w-full border-b border-border bg-transparent text-[14px] outline-none placeholder:text-subtle"
        />
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {attachments.map((a, i) => (
            <span
              key={`${a.filename}-${i}`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-pane pr-1 pl-2.5 text-[13px]"
            >
              <PaperclipIcon className="size-3.5 text-subtle" />
              <span className="max-w-48 truncate">{a.filename}</span>
              <span className="text-[11px] text-subtle">{fileSize(a.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${a.filename}`}
                onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                className="inline-flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="compose-editor cursor-text px-4 py-3" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>

      {initial.quoted && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="inline-flex h-6 items-center rounded-sm bg-muted px-2 text-[12px] text-subtle hover:bg-hover hover:text-foreground"
            aria-label={showQuoted ? "Hide original message" : "Show original message"}
            title={showQuoted ? "Hide original message" : "Show original message"}
          >
            •••
          </button>
          {showQuoted && (
            <div className="mt-2 overflow-hidden rounded-md border border-border bg-pane p-3">
              <EmailFrame html={initial.quoted} />
            </div>
          )}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-brand-soft/80 text-[14px] font-semibold text-brand">
          Drop files to attach
        </div>
      )}
    </div>
  );
}
