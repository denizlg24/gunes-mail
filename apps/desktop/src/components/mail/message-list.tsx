import { CheckCheckIcon, FilterIcon, Loader2Icon, MailXIcon, SearchXIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/hooks/use-commands";
import { useContextTarget } from "@/hooks/use-context-target";
import { useLabels, useListParams, useThreadList, useVisibleThreads } from "@/hooks/use-mail";
import { folderName } from "@/lib/folders";
import { dateGroup } from "@/lib/format";
import type { ListFilter, ThreadSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { ErrorReference } from "./error-reference";
import { DRAG_MIME, type DragPayload } from "./folder-pane";
import { ContextMenuEntries, useMessageMenu } from "./menu-entries";
import { MessageRow, type RowHandlers } from "./message-row";

export const MESSAGE_LIST_ID = "message-list";

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "flagged", label: "Flagged" },
  { value: "tome", label: "To me" },
  { value: "attachments", label: "Has files" },
];

function ListSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex gap-3 border-b border-border/60 px-3 py-3">
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-foreground/8" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-foreground/8" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-foreground/8" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-foreground/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ searching, filtered }: { searching: boolean; filtered: boolean }) {
  const Icon = searching ? SearchXIcon : filtered ? MailXIcon : CheckCheckIcon;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 pb-16 text-center">
      <Icon className="size-10 text-brand/70" strokeWidth={1.4} />
      <div className="text-[15px] font-semibold">
        {searching ? "We didn't find anything" : filtered ? "Nothing matches this filter" : "All done for the day"}
      </div>
      <div className="text-[13px] text-subtle">
        {searching ? "Try different keywords." : filtered ? "Try a different filter." : "Enjoy your empty folder."}
      </div>
    </div>
  );
}

export function MessageList() {
  const accountId = useUi((s) => s.accountId);
  const folder = useUi((s) => s.folder);
  const selectedIds = useUi((s) => s.selectedIds);
  const anchorId = useUi((s) => s.anchorId);
  const select = useUi((s) => s.select);
  const density = useUi((s) => s.density);
  const inboxTab = useUi((s) => s.inboxTab);
  const setInboxTab = useUi((s) => s.setInboxTab);
  const filter = useUi((s) => s.filter);
  const setFilter = useUi((s) => s.setFilter);
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const focusedInbox = useUi((s) => s.focusedInbox);
  const params = useListParams();
  const { data: labels } = useLabels(accountId);
  const query = useThreadList(accountId, params);
  const commands = useCommands();
  const setVisible = useVisibleThreads((s) => s.setThreads);
  const scope = `${accountId}|${folder}|${search}`;
  const [selectionState, setSelectionState] = useState({ scope, on: false });
  const selectionMode = selectionState.on && selectionState.scope === scope;
  const setSelectionMode = useCallback((on: boolean) => setSelectionState({ scope, on }), [scope]);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const menu = useContextTarget<string>();

  const threads = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((p) => p.threads).filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }, [query.data]);

  useEffect(() => setVisible(threads), [threads, setVisible]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { root: listRef.current, rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, threads.length]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const multi = selectionMode || selectedIds.length > 1;

  const scrollIntoView = useCallback((id: string) => {
    listRef.current
      ?.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const handlers = useMemo<RowHandlers>(() => {
    const ids = () => useVisibleThreads.getState().threads.map((t) => t.id);
    const toggleOne = (id: string) => {
      const current = useUi.getState().selectedIds;
      select(current.includes(id) ? current.filter((x) => x !== id) : [...current, id], id);
    };
    return {
      onClick: (e, id) => {
        listRef.current?.focus({ preventScroll: true });
        const mod = e.metaKey || e.ctrlKey;
        const state = useUi.getState();
        if (e.shiftKey && state.anchorId) {
          const all = ids();
          const a = all.indexOf(state.anchorId);
          const b = all.indexOf(id);
          if (a >= 0 && b >= 0) {
            const range = all.slice(Math.min(a, b), Math.max(a, b) + 1);
            select(mod ? Array.from(new Set([...state.selectedIds, ...range])) : range, state.anchorId);
            return;
          }
        }
        if (mod || selectionMode) {
          toggleOne(id);
          return;
        }
        select([id], id);
        const thread = useVisibleThreads.getState().threads.find((t) => t.id === id);
        if (thread?.draft && state.folder === "DRAFT") void commands.editDraft(id);
      },
      onDoubleClick: (id) => {
        const thread = useVisibleThreads.getState().threads.find((t) => t.id === id);
        if (thread?.draft) void commands.editDraft(id);
      },
      onContextMenu: (id) => {
        menu.setTarget(id);
        if (!useUi.getState().selectedIds.includes(id)) select([id], id);
      },
      onDragStart: (e, id) => {
        const state = useUi.getState();
        let dragIds = state.selectedIds;
        if (!dragIds.includes(id)) {
          dragIds = [id];
          select([id], id);
        }
        if (!state.accountId) return;
        const payload: DragPayload = { accountId: state.accountId, ids: dragIds, source: state.folder };
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
        const ghost = document.createElement("div");
        ghost.textContent = dragIds.length === 1 ? "1 item" : `${dragIds.length} items`;
        ghost.style.cssText =
          "position:fixed;top:-100px;left:-100px;padding:6px 12px;border-radius:6px;background:#0f6cbd;color:#fff;font:600 13px Segoe UI,-apple-system,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.2)";
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, -12, -12);
        setTimeout(() => ghost.remove(), 0);
      },
      onToggleCheck: (id) => {
        setSelectionMode(true);
        toggleOne(id);
      },
      onDelete: (id) => commands.remove([id]),
      onToggleRead: (id) => commands.toggleRead([id]),
      onToggleFlag: (id) => commands.toggleFlag([id]),
    };
  }, [commands, menu, select, selectionMode, setSelectionMode]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = threads.map((t) => t.id);
    if (!all.length) return;
    const current = anchorId && all.includes(anchorId) ? all.indexOf(anchorId) : -1;
    const focusId = selectedIds[selectedIds.length - 1];
    const cursor = focusId ? all.indexOf(focusId) : current;
    const go = (index: number) => {
      const clamped = Math.max(0, Math.min(all.length - 1, index));
      const id = all[clamped];
      if (e.shiftKey && anchorId) {
        const a = all.indexOf(anchorId);
        const range = all.slice(Math.min(a, clamped), Math.max(a, clamped) + 1);
        select(a <= clamped ? range : range.reverse(), anchorId);
      } else {
        select([id], id);
      }
      scrollIntoView(id);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(cursor + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        go(cursor <= 0 ? 0 : cursor - 1);
        break;
      case "Home":
        e.preventDefault();
        go(0);
        break;
      case "End":
        e.preventDefault();
        go(all.length - 1);
        break;
      case "PageDown":
        e.preventDefault();
        go(cursor + 10);
        break;
      case "PageUp":
        e.preventDefault();
        go(cursor - 10);
        break;
      case "Enter": {
        const t = threads.find((x) => x.id === focusId);
        if (t?.draft) void commands.editDraft(t.id);
        break;
      }
      case "Escape":
        setSelectionMode(false);
        if (selectedIds.length > 1 && focusId) select([focusId], focusId);
        break;
    }
  };

  const menuIds = menu.target && selectedSet.has(menu.target) ? selectedIds : menu.target ? [menu.target] : [];
  const menuThreads = threads.filter((t) => menuIds.includes(t.id));
  const entries = useMessageMenu(commands, menuIds, menuThreads);

  const title = search ? "Search results" : folderName(folder, labels);
  const showTabs = folder === "INBOX" && focusedInbox && !search;
  const showRecipients = folder === "SENT" || folder === "DRAFT";
  const allSelected = threads.length > 0 && threads.every((t) => selectedSet.has(t.id));

  let lastGroup = "";

  return (
    <section aria-label="Message list" className="flex h-full min-w-0 flex-col bg-pane">
      <div className="flex shrink-0 flex-col border-b border-border px-3 pt-2.5">
        <div className="flex h-8 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={allSelected ? "Deselect all" : "Select all"}
                  onClick={() => {
                    if (allSelected) {
                      select([], null);
                      setSelectionMode(false);
                    } else {
                      setSelectionMode(true);
                      commands.selectAll();
                    }
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-hover"
                />
              }
            >
              <span
                className={cn(
                  "flex size-[18px] items-center justify-center rounded-full border-[1.5px]",
                  allSelected ? "border-brand bg-brand-strong text-white" : "border-subtle",
                )}
              >
                {allSelected && <CheckCheckIcon className="size-3" strokeWidth={3} />}
              </span>
            </TooltipTrigger>
            <TooltipContent>{allSelected ? "Deselect all" : "Select all"}</TooltipContent>
          </Tooltip>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
          {query.isFetching && !query.isLoading && <Loader2Icon className="size-3.5 animate-spin text-subtle" />}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-hover data-popup-open:bg-hover",
                      filter !== "all" && "text-brand",
                    )}
                  />
                }
              >
                <FilterIcon className="size-4" />
                {filter !== "all" && FILTERS.find((f) => f.value === filter)?.label}
              </TooltipTrigger>
              <TooltipContent>Filter</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Filter</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as ListFilter)}>
                  {FILTERS.map((f) => (
                    <DropdownMenuRadioItem key={f.value} value={f.value}>
                      {f.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {showTabs ? (
          <div role="tablist" className="mt-1 flex gap-4 pl-1">
            {(["focused", "other"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                type="button"
                aria-selected={inboxTab === tab}
                onClick={() => setInboxTab(tab)}
                className={cn(
                  "relative h-9 text-[13px] capitalize transition-colors",
                  inboxTab === tab ? "font-semibold text-foreground" : "text-subtle hover:text-foreground",
                )}
              >
                {tab}
                {inboxTab === tab && <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-brand" />}
              </button>
            ))}
          </div>
        ) : search ? (
          <div className="mt-1 mb-2 flex items-center gap-2 pl-1 text-[13px] text-subtle">
            <span className="min-w-0 flex-1 truncate">
              Results for <span className="font-semibold text-foreground">&ldquo;{search}&rdquo;</span> in all folders
            </span>
            <button
              type="button"
              onClick={() => setSearch("")}
              className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 hover:bg-hover hover:text-foreground"
            >
              <XIcon className="size-3.5" />
              Exit search
            </button>
          </div>
        ) : (
          <div className="h-2" />
        )}
      </div>

      <ContextMenu open={menu.open} onOpenChange={menu.onOpenChange}>
        <ContextMenuTrigger
          onContextMenuCapture={menu.resetCapture}
          render={
            <div
              id={MESSAGE_LIST_ID}
              ref={listRef}
              role="listbox"
              aria-multiselectable
              aria-label={title}
              tabIndex={0}
              onKeyDown={onKeyDown}
              className="thin-scroll min-h-0 flex-1 overflow-y-auto outline-none"
            />
          }
        >
          {query.isLoading ? (
            <ListSkeleton />
          ) : query.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-subtle">
              <div className="font-semibold text-foreground">Couldn&apos;t load messages</div>
              <div>{query.error.message}</div>
              <ErrorReference error={query.error} />
              <button type="button" onClick={() => void query.refetch()} className="mt-1 text-brand hover:underline">
                Try again
              </button>
            </div>
          ) : threads.length === 0 ? (
            query.data?.pages[0]?.syncing ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 pb-16 text-center">
                <Loader2Icon className="size-8 animate-spin text-brand" />
                <div className="text-[15px] font-semibold">Syncing your mail…</div>
                <div className="text-[13px] text-subtle">Recent messages show up here as they arrive.</div>
              </div>
            ) : (
              <EmptyState searching={!!search} filtered={filter !== "all"} />
            )
          ) : (
            threads.map((thread: ThreadSummary) => {
              const group = dateGroup(thread.date);
              const header = group !== lastGroup;
              lastGroup = group;
              const selected = selectedSet.has(thread.id);
              return (
                <div key={thread.id}>
                  {header && (
                    <div className="sticky top-0 z-[1] bg-pane/95 px-3 pt-3 pb-1 text-xs font-semibold text-subtle backdrop-blur-sm">
                      {group}
                    </div>
                  )}
                  <MessageRow
                    thread={thread}
                    selected={selected}
                    checked={multi && selected}
                    selectionMode={multi}
                    showRecipients={showRecipients}
                    density={density}
                    handlers={handlers}
                  />
                </div>
              );
            })
          )}
          <div ref={sentinelRef} className="h-px" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-3">
              <Loader2Icon className="size-4 animate-spin text-subtle" />
            </div>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuEntries entries={entries} />
        </ContextMenuContent>
      </ContextMenu>
    </section>
  );
}
