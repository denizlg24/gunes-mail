import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  FlagIcon,
  ForwardIcon,
  MailOpenIcon,
  MoreHorizontalIcon,
  ReplyAllIcon,
  ReplyIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/hooks/use-commands";
import { useAccounts, useLabels, useMailActions, useThread, useVisibleThreads } from "@/hooks/use-mail";
import { getApi } from "@/lib/api";
import { leafName } from "@/lib/folders";
import { displayName, fullDate, listDate, shortcut } from "@/lib/format";
import type { Label, Mailbox, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { AttachmentList } from "./attachment-list";
import { Compose } from "./compose";
import { EmailFrame } from "./email-frame";
import { ErrorReference } from "./error-reference";
import { PersonAvatar } from "./person-avatar";

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
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
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="inline-flex size-8 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-brand [&_svg]:size-[18px]"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Recipients({ label, people }: { label: string; people: Mailbox[] }) {
  if (!people.length) return null;
  return (
    <div className="truncate text-[12px] text-subtle">
      <span className="mr-1">{label}:</span>
      {people.map((p, i) => (
        <span key={p.email + i} title={p.email}>
          {displayName(p)}
          {i < people.length - 1 && "; "}
        </span>
      ))}
    </div>
  );
}

function useCidMap(accountId: string, message: Message, enabled: boolean) {
  const inline = message.attachments.filter((a) => a.contentId && (a.attachmentId || a.data));
  return useQuery({
    queryKey: ["cid", accountId, message.id],
    enabled: enabled && inline.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const entries = await Promise.all(
        inline.map(async (a) => {
          const data = a.data ?? (await getApi().getAttachmentData(accountId, message.id, a.attachmentId!));
          const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
          return [a.contentId!, `data:${a.mimeType};base64,${b64}`] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });
}

function MessageCard({
  accountId,
  message,
  expanded,
  onToggle,
}: {
  accountId: string;
  message: Message;
  expanded: boolean;
  onToggle: () => void;
}) {
  const commands = useCommands();
  const { setRead, setFlag } = useMailActions();
  const { data: cidMap } = useCidMap(accountId, message, expanded);

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-pane shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <header
        onClick={onToggle}
        className={cn("flex gap-3 px-4 py-3", !expanded && "hover:bg-hover")}
      >
        <PersonAvatar name={message.from.name} email={message.from.email} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="selectable truncate text-[14px]">
                <span className="font-semibold">{displayName(message.from)}</span>
                {expanded && <span className="ml-1.5 text-[12px] text-subtle">&lt;{message.from.email}&gt;</span>}
              </div>
              {expanded ? (
                <>
                  <Recipients label="To" people={message.to} />
                  <Recipients label="Cc" people={message.cc} />
                  <Recipients label="Bcc" people={message.bcc} />
                </>
              ) : (
                <div className="truncate text-[13px] text-subtle">
                  {message.draft && <span className="mr-1 text-flag">[Draft]</span>}
                  {message.snippet}
                </div>
              )}
            </div>
            {expanded ? (
              <div className="-mt-1 -mr-2 flex shrink-0 items-center">
                <IconAction label={`Reply (${shortcut("Ctrl+R")})`} onClick={() => void commands.reply("reply", message.threadId, message.id)}>
                  <ReplyIcon />
                </IconAction>
                <IconAction label={`Reply all (${shortcut("Ctrl+Shift+R")})`} onClick={() => void commands.reply("replyAll", message.threadId, message.id)}>
                  <ReplyAllIcon />
                </IconAction>
                <IconAction label={`Forward (${shortcut("Ctrl+F")})`} onClick={() => void commands.reply("forward", message.threadId, message.id)}>
                  <ForwardIcon />
                </IconAction>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="More actions"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex size-8 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground data-popup-open:bg-hover"
                  >
                    <MoreHorizontalIcon className="size-[18px]" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void setRead(accountId, [message.threadId], false)}>
                      <MailOpenIcon />
                      Mark as unread
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void setFlag(accountId, [message.threadId], !message.flagged)}>
                      <FlagIcon />
                      {message.flagged ? "Clear flag" : "Flag"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => commands.archive([message.threadId])}>
                      <ArchiveIcon />
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => commands.remove([message.threadId])}>
                      <Trash2Icon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
          {expanded && <div className="mt-0.5 text-[12px] text-subtle">{fullDate(message.date)}</div>}
        </div>
        {!expanded && <div className="shrink-0 text-[12px] text-subtle">{listDate(message.date)}</div>}
      </header>
      {expanded && (
        <>
          <AttachmentList accountId={accountId} messageId={message.id} attachments={message.attachments} />
          <div className="selectable px-4 pb-4">
            <EmailFrame html={message.html} text={message.text ?? message.snippet} cidMap={cidMap} />
          </div>
        </>
      )}
    </article>
  );
}

function CategoryChips({ labelIds, labels }: { labelIds: string[]; labels: Label[] }) {
  const chips = labels.filter((l) => l.type === "user" && labelIds.includes(l.id));
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((l) => (
        <span
          key={l.id}
          className="inline-flex h-5 items-center rounded-sm px-1.5 text-[11px] font-semibold"
          style={{
            background: l.color?.backgroundColor ?? "var(--brand-soft)",
            color: l.color?.textColor ?? "var(--brand)",
          }}
        >
          {leafName(l.name)}
        </span>
      ))}
    </div>
  );
}

function ThreadView({ accountId, threadId }: { accountId: string; threadId: string }) {
  const { data: thread, isLoading, isError, error } = useThread(accountId, threadId);
  const { data: labels = [] } = useLabels(accountId);
  const compose = useUi((s) => s.compose);
  const markReadOnOpen = useUi((s) => s.markReadOnOpen);
  const { setRead } = useMailActions();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const markedRef = useRef<string | null>(null);

  const messages = useMemo(() => [...(thread?.messages ?? [])].reverse(), [thread]);

  useEffect(() => {
    if (!thread || !markReadOnOpen || markedRef.current === thread.id) return;
    markedRef.current = thread.id;
    if (thread.messages.some((m) => m.unread)) void setRead(accountId, [thread.id], true);
  }, [thread, accountId, markReadOnOpen, setRead]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="h-6 w-2/3 animate-pulse rounded bg-foreground/8" />
        <div className="h-40 animate-pulse rounded-lg bg-foreground/6" />
      </div>
    );
  }
  if (isError || !thread) {
    return (
      <div className="flex flex-col items-start gap-2 p-6 text-[13px] text-subtle">
        <div>Couldn&apos;t load this conversation. {error?.message}</div>
        <ErrorReference error={error} />
      </div>
    );
  }

  const isExpanded = (m: Message, index: number) =>
    expanded[m.id] ?? (index === 0 || m.unread || messages.length <= 2);
  const inlineCompose = compose && compose.threadId === thread.id && compose.mode !== "new" && compose.mode !== "draft";

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[960px] flex-col gap-3 px-5 pt-4 pb-8">
        <div className="px-1">
          <h1 className="selectable text-[20px] leading-tight font-semibold break-words">{thread.subject || "(no subject)"}</h1>
          <CategoryChips labelIds={thread.labelIds} labels={labels} />
        </div>
        {inlineCompose && <Compose key={compose.key} inline />}
        {messages.map((m, i) => (
          <MessageCard
            key={m.id}
            accountId={accountId}
            message={m}
            expanded={isExpanded(m, i)}
            onToggle={() => setExpanded((s) => ({ ...s, [m.id]: !isExpanded(m, i) }))}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyReadingPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 pb-12 text-center">
      <svg width="120" height="88" viewBox="0 0 120 88" aria-hidden className="text-brand">
        <rect x="14" y="18" width="92" height="62" rx="8" fill="currentColor" opacity="0.08" />
        <rect x="22" y="8" width="76" height="56" rx="6" fill="var(--pane)" stroke="currentColor" strokeOpacity="0.35" />
        <path d="M22 14l38 26 38-26" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
        <rect x="36" y="46" width="48" height="4" rx="2" fill="currentColor" opacity="0.25" />
        <rect x="44" y="54" width="32" height="4" rx="2" fill="currentColor" opacity="0.18" />
      </svg>
      <div className="text-[15px] font-semibold">Select an item to read</div>
      <div className="text-[13px] text-subtle">Nothing is selected</div>
    </div>
  );
}

function MultiSelection({ count }: { count: number }) {
  const commands = useCommands();
  const threads = useVisibleThreads((s) => s.threads);
  const selectedIds = useUi((s) => s.selectedIds);
  const anyUnread = threads.some((t) => selectedIds.includes(t.id) && t.unread);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 pb-12 text-center">
      <div className="text-[18px] font-semibold">{count} items selected</div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => commands.remove()} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-pane px-3 text-[13px] hover:bg-hover">
          <Trash2Icon className="size-4 text-subtle" /> Delete
        </button>
        <button type="button" onClick={() => commands.archive()} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-pane px-3 text-[13px] hover:bg-hover">
          <ArchiveIcon className="size-4 text-subtle" /> Archive
        </button>
        <button type="button" onClick={() => commands.setRead(anyUnread)} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-pane px-3 text-[13px] hover:bg-hover">
          <MailOpenIcon className="size-4 text-subtle" /> {anyUnread ? "Mark as read" : "Mark as unread"}
        </button>
        <button type="button" onClick={() => commands.toggleFlag()} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-pane px-3 text-[13px] hover:bg-hover">
          <FlagIcon className="size-4 text-subtle" /> Flag
        </button>
      </div>
      <button type="button" onClick={() => useUi.getState().select([], null)} className="text-[13px] text-brand hover:underline">
        Clear selection
      </button>
    </div>
  );
}

export function ReadingPane() {
  const accountId = useUi((s) => s.accountId);
  const selectedIds = useUi((s) => s.selectedIds);
  const compose = useUi((s) => s.compose);
  const { data: accounts } = useAccounts();

  const standalone = compose && (compose.mode === "new" || compose.mode === "draft" || compose.threadId !== selectedIds[0] || selectedIds.length !== 1);

  let content: React.ReactNode;
  if (compose && standalone && accounts?.some((a) => a.id === compose.accountId)) {
    content = (
      <div className="thin-scroll h-full overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-5 pt-4 pb-8">
          <Compose key={compose.key} />
        </div>
      </div>
    );
  } else if (!accountId || selectedIds.length === 0) {
    content = <EmptyReadingPane />;
  } else if (selectedIds.length > 1) {
    content = <MultiSelection count={selectedIds.length} />;
  } else {
    content = <ThreadView key={selectedIds[0]} accountId={accountId} threadId={selectedIds[0]} />;
  }

  return (
    <section aria-label="Reading pane" className="h-full min-w-0 bg-app/40">
      {content}
    </section>
  );
}
