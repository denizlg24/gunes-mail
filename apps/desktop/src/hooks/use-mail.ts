"use client";

import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage, getApi } from "@/lib/api";
import { ARCHIVE, folderName } from "@/lib/folders";
import type { Label, ListParams, Thread, ThreadPage, ThreadSummary } from "@/lib/types";
import { useUi } from "@/store/ui";

/** Live updates arrive over server events; this is only a safety net. */
const SYNC_INTERVAL = 5 * 60_000;

export const keys = {
  accounts: ["accounts"] as const,
  labels: (accountId: string) => ["labels", accountId] as const,
  threads: (accountId: string) => ["threads", accountId] as const,
  list: (accountId: string, p: Omit<ListParams, "pageToken">) =>
    ["threads", accountId, p.folder, p.tab ?? "", p.filter, p.search ?? ""] as const,
  thread: (accountId: string, id: string) => ["thread", accountId, id] as const,
};

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => getApi().session(), staleTime: Infinity });
}

export function useAccounts() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: keys.accounts,
    queryFn: () => getApi().listAccounts(),
    enabled: !!session?.signedIn,
  });
}

export function useLabels(accountId: string | null) {
  return useQuery({
    queryKey: keys.labels(accountId ?? ""),
    queryFn: () => getApi().listLabels(accountId!),
    enabled: !!accountId,
    refetchInterval: SYNC_INTERVAL,
  });
}

export function useListParams(): Omit<ListParams, "pageToken"> {
  const folder = useUi((s) => s.folder);
  const inboxTab = useUi((s) => s.inboxTab);
  const focusedInbox = useUi((s) => s.focusedInbox);
  const filter = useUi((s) => s.filter);
  const search = useUi((s) => s.search);
  return {
    folder,
    tab: folder === "INBOX" && focusedInbox && !search ? inboxTab : undefined,
    filter,
    search: search || undefined,
  };
}

export function useThreadList(accountId: string | null, params: Omit<ListParams, "pageToken">) {
  return useInfiniteQuery({
    queryKey: keys.list(accountId ?? "", params),
    queryFn: ({ pageParam }) => getApi().listThreads(accountId!, { ...params, pageToken: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    enabled: !!accountId,
    refetchInterval: SYNC_INTERVAL,
  });
}

export function useThread(accountId: string | null, threadId: string | null) {
  return useQuery({
    queryKey: keys.thread(accountId ?? "", threadId ?? ""),
    queryFn: () => getApi().getThread(accountId!, threadId!),
    enabled: !!accountId && !!threadId,
  });
}

export const useVisibleThreads = create<{
  threads: ThreadSummary[];
  setThreads: (threads: ThreadSummary[]) => void;
}>()((set) => ({
  threads: [],
  setThreads: (threads) => set({ threads }),
}));

type ListData = InfiniteData<ThreadPage, string | undefined>;

function patchLists(qc: QueryClient, accountId: string, fn: (t: ThreadSummary) => ThreadSummary | null) {
  qc.setQueriesData<ListData>({ queryKey: keys.threads(accountId) }, (data) => {
    if (!data) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        threads: page.threads.flatMap((t) => {
          const next = fn(t);
          return next ? [next] : [];
        }),
      })),
    };
  });
}

function patchThread(qc: QueryClient, accountId: string, ids: string[], add: string[], remove: string[]) {
  for (const id of ids) {
    qc.setQueryData<Thread>(keys.thread(accountId, id), (t) => {
      if (!t) return t;
      const messages = t.messages.map((m) => {
        const labelIds = Array.from(new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add]));
        return {
          ...m,
          labelIds,
          unread: labelIds.includes("UNREAD"),
          flagged: labelIds.includes("STARRED"),
        };
      });
      return { ...t, messages, labelIds: Array.from(new Set(messages.flatMap((m) => m.labelIds))) };
    });
  }
}

function applyLabels(t: ThreadSummary, add: string[], remove: string[]): ThreadSummary {
  const labelIds = Array.from(new Set([...t.labelIds.filter((l) => !remove.includes(l)), ...add]));
  return {
    ...t,
    labelIds,
    unread: add.includes("UNREAD") ? true : remove.includes("UNREAD") ? false : t.unread,
    flagged: add.includes("STARRED") ? true : remove.includes("STARRED") ? false : t.flagged,
  };
}

function nextSelection(ids: string[]): string[] {
  const visible = useVisibleThreads.getState().threads.map((t) => t.id);
  const removed = new Set(ids);
  const lastIndex = Math.max(...ids.map((id) => visible.indexOf(id)));
  const after = visible.slice(lastIndex + 1).find((id) => !removed.has(id));
  const before = [...visible.slice(0, lastIndex)].reverse().find((id) => !removed.has(id));
  const next = after ?? before;
  return next ? [next] : [];
}

function isLabelFolder(folder: string): boolean {
  return !["SENT", "DRAFT", "STARRED", ARCHIVE, "TRASH"].includes(folder);
}

interface MoveOps {
  add: string[];
  remove: string[];
  trash?: boolean;
  untrash?: boolean;
}

export function moveOps(source: string, target: string): MoveOps {
  if (target === "TRASH") return { add: [], remove: [], trash: true };
  const untrash = source === "TRASH";
  const remove: string[] = [];
  if (isLabelFolder(source)) remove.push(source);
  if (target !== "SPAM") remove.push("SPAM");
  if (target !== "INBOX" && !remove.includes("INBOX")) remove.push("INBOX");
  const add = target === ARCHIVE ? [] : [target];
  return { add, remove: remove.filter((r) => r !== target), untrash };
}

export function useMailActions() {
  const qc = useQueryClient();

  const run = useCallback(
    async (accountId: string, task: () => Promise<void>, failure: string) => {
      try {
        await task();
      } catch (e) {
        toast.error(failure, { description: errorMessage(e) });
      } finally {
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.threads(accountId) }),
          qc.invalidateQueries({ queryKey: keys.labels(accountId) }),
        ]);
      }
    },
    [qc],
  );

  const modify = useCallback(
    (accountId: string, ids: string[], add: string[], remove: string[]) => {
      if (!ids.length) return Promise.resolve();
      patchLists(qc, accountId, (t) => (ids.includes(t.id) ? applyLabels(t, add, remove) : t));
      patchThread(qc, accountId, ids, add, remove);
      return run(accountId, () => getApi().modifyThreads(accountId, ids, add, remove), "Couldn't update messages");
    },
    [qc, run],
  );

  const removeFromView = useCallback(
    (accountId: string, ids: string[]) => {
      const { selectedIds, select } = useUi.getState();
      if (selectedIds.some((id) => ids.includes(id))) {
        const next = nextSelection(ids);
        select(next, next[0] ?? null);
      }
      patchLists(qc, accountId, (t) => (ids.includes(t.id) ? null : t));
    },
    [qc],
  );

  const setRead = useCallback(
    (accountId: string, ids: string[], read: boolean) =>
      modify(accountId, ids, read ? [] : ["UNREAD"], read ? ["UNREAD"] : []),
    [modify],
  );

  const setFlag = useCallback(
    (accountId: string, ids: string[], flagged: boolean) =>
      modify(accountId, ids, flagged ? ["STARRED"] : [], flagged ? [] : ["STARRED"]),
    [modify],
  );

  const toggleLabel = useCallback(
    (accountId: string, ids: string[], labelId: string, on: boolean) =>
      modify(accountId, ids, on ? [labelId] : [], on ? [] : [labelId]),
    [modify],
  );

  const move = useCallback(
    async (accountId: string, ids: string[], source: string, target: string, labels?: Label[]) => {
      if (!ids.length || source === target) return;
      const ops = moveOps(source, target);
      removeFromView(accountId, ids);
      const api = getApi();
      await run(
        accountId,
        async () => {
          if (ops.trash) await api.trashThreads(accountId, ids);
          else {
            if (ops.untrash) await api.untrashThreads(accountId, ids);
            await api.modifyThreads(accountId, ids, ops.add, ops.remove);
          }
        },
        "Couldn't move messages",
      );
      const noun = ids.length === 1 ? "Conversation" : `${ids.length} conversations`;
      const verb =
        target === "TRASH" ? "deleted" : target === ARCHIVE ? "archived" : `moved to ${folderName(target, labels)}`;
      toast(`${noun} ${verb}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void run(
              accountId,
              async () => {
                if (ops.trash) {
                  await api.untrashThreads(accountId, ids);
                  if (isLabelFolder(source)) await api.modifyThreads(accountId, ids, [source], []);
                  return;
                }
                await api.modifyThreads(accountId, ids, ops.remove, ops.add);
                if (ops.untrash) await api.trashThreads(accountId, ids);
              },
              "Couldn't undo",
            ),
        },
      });
    },
    [removeFromView, run],
  );

  const deleteForever = useCallback(
    async (accountId: string, ids: string[]) => {
      removeFromView(accountId, ids);
      await run(accountId, () => getApi().deleteThreads(accountId, ids), "Couldn't delete messages");
      toast(ids.length === 1 ? "Conversation permanently deleted" : `${ids.length} conversations permanently deleted`);
    },
    [removeFromView, run],
  );

  const remove = useCallback(
    (accountId: string, ids: string[], source: string, labels?: Label[]) =>
      source === "TRASH" || source === "SPAM"
        ? deleteForever(accountId, ids)
        : move(accountId, ids, source, "TRASH", labels),
    [deleteForever, move],
  );

  const markFolderRead = useCallback(
    (accountId: string, folder: string) => {
      patchLists(qc, accountId, (t) => applyLabels(t, [], ["UNREAD"]));
      return run(accountId, () => getApi().markFolderRead(accountId, folder), "Couldn't mark folder as read");
    },
    [qc, run],
  );

  const emptyFolder = useCallback(
    (accountId: string, folder: string) =>
      run(accountId, () => getApi().emptyFolder(accountId, folder), "Couldn't empty folder"),
    [run],
  );

  const refresh = useCallback(
    (accountId: string) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.threads(accountId) }),
        qc.invalidateQueries({ queryKey: keys.labels(accountId) }),
        qc.invalidateQueries({ queryKey: ["thread", accountId] }),
      ]),
    [qc],
  );

  return { setRead, setFlag, toggleLabel, move, remove, deleteForever, markFolderRead, emptyFolder, refresh };
}
