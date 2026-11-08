import { memo } from "react";
import { CheckIcon, FlagIcon, MailIcon, MailOpenIcon, PaperclipIcon, Trash2Icon } from "lucide-react";

import { displayName, listDate } from "@/lib/format";
import type { ThreadSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { Density } from "@/store/ui";

import { PersonAvatar } from "./person-avatar";

export interface RowHandlers {
  onClick: (e: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  onContextMenu: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onToggleCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleRead: (id: string) => void;
  onToggleFlag: (id: string) => void;
}

interface MessageRowProps {
  thread: ThreadSummary;
  selected: boolean;
  checked: boolean;
  selectionMode: boolean;
  showRecipients: boolean;
  density: Density;
  handlers: RowHandlers;
}

function HoverAction({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-sm text-subtle hover:bg-foreground/10 hover:text-foreground",
        active && "text-flag hover:text-flag",
      )}
    >
      {children}
    </button>
  );
}

function names(thread: ThreadSummary, showRecipients: boolean): string {
  const people = showRecipients && thread.recipients.length ? thread.recipients : thread.senders;
  const shown = people.slice(0, 3).map(displayName).join("; ");
  return people.length > 3 ? `${shown} +${people.length - 3}` : shown || "(no sender)";
}

export const MessageRow = memo(function MessageRow({
  thread,
  selected,
  checked,
  selectionMode,
  showRecipients,
  density,
  handlers,
}: MessageRowProps) {
  const lead = (showRecipients ? thread.recipients[0] : thread.senders[thread.senders.length - 1]) ??
    thread.senders[0] ?? { name: "?", email: "" };
  const compact = density === "compact";

  return (
    <div
      role="option"
      aria-selected={selected}
      data-thread-id={thread.id}
      draggable
      onClick={(e) => handlers.onClick(e, thread.id)}
      onDoubleClick={() => handlers.onDoubleClick(thread.id)}
      onContextMenu={() => handlers.onContextMenu(thread.id)}
      onDragStart={(e) => handlers.onDragStart(e, thread.id)}
      className={cn(
        "group/row relative flex gap-3 border-b border-border/60 pr-2 pl-3 transition-colors",
        compact ? "py-1.5" : "py-2.5",
        selected ? "bg-selected hover:bg-selected-hover" : "hover:bg-hover",
      )}
    >
      {thread.unread && <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-brand" />}

      <div
        className={cn("relative shrink-0", compact ? "size-6" : "size-8")}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onToggleCheck(thread.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <PersonAvatar
          name={lead.name}
          email={lead.email}
          size={compact ? 24 : 32}
          className={cn((selectionMode || checked) && "invisible", "group-hover/row:invisible")}
        />
        <span
          role="checkbox"
          aria-checked={checked}
          aria-label="Select conversation"
          className={cn(
            "absolute inset-0 m-auto flex size-[18px] items-center justify-center rounded-full border-[1.5px] transition-opacity",
            checked ? "border-brand bg-brand-strong text-white" : "border-subtle bg-pane",
            selectionMode || checked ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
          )}
        >
          {checked && <CheckIcon className="size-3" strokeWidth={3} />}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-1.5">
          <span className={cn("min-w-0 flex-1 truncate text-[14px]", thread.unread ? "font-semibold" : "font-normal")}>
            {names(thread, showRecipients)}
          </span>
          {thread.messageCount > 1 && (
            <span className="shrink-0 text-xs text-subtle tabular-nums">{thread.messageCount}</span>
          )}
          <div className="hidden shrink-0 items-center group-hover/row:flex">
            <HoverAction label="Delete" onClick={() => handlers.onDelete(thread.id)}>
              <Trash2Icon className="size-4" />
            </HoverAction>
            <HoverAction label={thread.unread ? "Mark as read" : "Mark as unread"} onClick={() => handlers.onToggleRead(thread.id)}>
              {thread.unread ? <MailOpenIcon className="size-4" /> : <MailIcon className="size-4" />}
            </HoverAction>
            <HoverAction label={thread.flagged ? "Clear flag" : "Flag this message"} active={thread.flagged} onClick={() => handlers.onToggleFlag(thread.id)}>
              <FlagIcon className={cn("size-4", thread.flagged && "fill-current")} />
            </HoverAction>
          </div>
          {thread.flagged && (
            <FlagIcon className="size-3.5 shrink-0 fill-flag text-flag group-hover/row:hidden" />
          )}
        </div>
        <div className="flex h-5 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              thread.unread ? "font-semibold text-brand" : "text-foreground",
            )}
          >
            {thread.subject || "(no subject)"}
          </span>
          {thread.hasAttachments && <PaperclipIcon className="size-3.5 shrink-0 text-subtle" />}
          <span className={cn("shrink-0 text-xs tabular-nums", thread.unread ? "font-semibold text-brand" : "text-subtle")}>
            {listDate(thread.date)}
          </span>
        </div>
        {!compact && (
          <div className="h-5 truncate text-[13px] text-subtle">
            {thread.draft && <span className="mr-1 text-flag">[Draft]</span>}
            {thread.snippet || "No preview is available."}
          </div>
        )}
      </div>
    </div>
  );
});
