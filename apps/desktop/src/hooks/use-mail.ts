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

import { suggestRuleAfterMove } from "@/components/mail/rule-suggestion";
import { errorMessage, getApi } from "@/lib/api";
import { ARCHIVE, folderName } from "@/lib/folders";
import type { Label, ListParams, Thread, ThreadPage, ThreadSummary, TriageCategory } from "@/lib/types";
import { useUi } from "@/store/ui";

/** Live updates arrive over server events; this is only a safety net. */
const SYNC_INTERVAL = 5 * 60_000;

export const keys = {
  accounts: ["accounts"] as const,
  labels: (accountId: string) => ["labels", accountId] as const,
  threads: (accountId: string) => ["threads", accountId] as const,
  list: (accountId: string, p: Omit<ListParams, "pageToken">) =>
    ["threads", accountId, p.folder, p.tab ?? "", p.filter, p.triage ?? "", p.search ?? ""] as const,
  thread: (accountId: string, id: string) => ["thread", accountId, id] as const,
};

const inFlight = new Map<string, number>();

/**
 * True while an optimistic change for this account is waiting on the server. Refetches
 * that land in that window would return pre-change data and undo what the user sees.
 */
export function isMutating(accountId: string): boolean {
  return (inFlight.get(accountId) ?? 0) > 0;
}

const pollUnlessMutating = (accountId: string | null) => () =>
  accountId && isMutating(accountId) ? false : SYNC_INTERVAL;

export function useAiCapabilities() {
  const { data: session } = useSession();
  return useQuery({
    queryKey: ["ai"],
    queryFn: () => getApi().aiCapabilities(),
    enabled: !!session?.signedIn,
    staleTime: 10 * 60_000,
  });
}

export function useThreadInsight(accountId: string, threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["insight", accountId, threadId],
    queryFn: () => getApi().threadInsight(accountId, threadId),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

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
    refetchInterval: pollUnlessMutating(accountId),
  });
}

export function useListParams(): Omit<ListParams, "pageToken"> {
  const folder = useUi((s) => s.folder);
  const inboxTab = useUi((s) => s.inboxTab);
  const focusedInbox = useUi((s) => s.focusedInbox);
  const filter = useUi((s) => s.filter);
  const triage = useUi((s) => s.triage);
  const smartCategories = useUi((s) => s.smartCategories);
  const search = useUi((s) => s.search);
  return {
    folder,
    tab: folder === "INBOX" && focusedInbox && !search ? inboxTab : undefined,
    filter,
    triage: smartCategories && triage ? triage : undefined,
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
    refetchInterval: pollUnlessMutating(accountId),
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

/** Mirrors the server's counting: Deleted Items and Junk only count toward themselves. */
function countedLabels(labelIds: string[]): string[] {
  const binned = labelIds.filter((l) => l === "TRASH" || l === "SPAM");
  return binned.length ? binned : labelIds;
}

/** Each conversation once, from whichever cached list has it. */
function cachedSummaries(qc: QueryClient, accountId: string, match: string[] | ((t: ThreadSummary) => boolean)): ThreadSummary[] {
  const test = Array.isArray(match) ? (t: ThreadSummary) => match.includes(t.id) : match;
  const found = new Map<string, ThreadSummary>();
  for (const [, data] of qc.getQueriesData<ListData>({ queryKey: keys.threads(accountId) })) {
    for (const page of data?.pages ?? []) for (const t of page.threads) if (test(t)) found.set(t.id, t);
  }
  return [...found.values()];
}

/** Shifts folder badges the way the change will once the server has applied it. */
function patchCounts(qc: QueryClient, accountId: string, changes: { before: ThreadSummary; after: ThreadSummary | null }[]) {
  const delta = new Map<string, { unread: number; total: number }>();
  const bump = (t: ThreadSummary, sign: 1 | -1) => {
    for (const id of countedLabels(t.labelIds)) {
      const d = delta.get(id) ?? { unread: 0, total: 0 };
      d.total += sign;
      if (t.unread || id === "DRAFT") d.unread += sign;
      delta.set(id, d);
    }
  };
  for (const { before, after } of changes) {
    bump(before, -1);
    if (after) bump(after, 1);
  }
  if (!delta.size) return;
  qc.setQueryData<Label[]>(keys.labels(accountId), (labels) =>
    labels?.map((l) => {
      const d = delta.get(l.id);
      return d ? { ...l, unread: Math.max(0, l.unread + d.unread), total: Math.max(0, l.total + d.total) } : l;
    }),
  );
}

function moveSummary(t: ThreadSummary, ops: MoveOps): ThreadSummary {
  return ops.trash
    ? applyLabels(t, ["TRASH"], ["INBOX", "SPAM"])
    : applyLabels(t, ops.add, [...ops.remove, ...(ops.untrash ? ["TRASH"] : [])]);
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

  const settle = useCallback(
    async (accountId: string) => {
      const left = (inFlight.get(accountId) ?? 1) - 1;
      if (left > 0) {
        inFlight.set(accountId, left);
        return;
      }
      inFlight.delete(accountId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.threads(accountId) }),
        qc.invalidateQueries({ queryKey: keys.labels(accountId) }),
      ]);
    },
    [qc],
  );

  /**
   * Applies `patch` to the cache right away, then runs `task` against the server. Any
   * refetch already in flight is cancelled first so it can't land on top of the patch.
   */
  const run = useCallback(
    async (accountId: string, patch: () => void, task: () => Promise<void>, failure: string): Promise<boolean> => {
      inFlight.set(accountId, (inFlight.get(accountId) ?? 0) + 1);
      await Promise.all([
        qc.cancelQueries({ queryKey: keys.threads(accountId) }),
        qc.cancelQueries({ queryKey: keys.labels(accountId) }),
        qc.cancelQueries({ queryKey: ["thread", accountId] }),
      ]);
      patch();
      try {
        await task();
        return true;
      } catch (e) {
        toast.error(failure, { description: errorMessage(e) });
        void qc.invalidateQueries({ queryKey: ["thread", accountId] });
        return false;
      } finally {
        await settle(accountId);
      }
    },
    [qc, settle],
  );

  const modify = useCallback(
    (accountId: string, ids: string[], add: string[], remove: string[]) => {
      if (!ids.length) return Promise.resolve();
      return run(
        accountId,
        () => {
          patchCounts(
            qc,
            accountId,
            cachedSummaries(qc, accountId, ids).map((before) => ({ before, after: applyLabels(before, add, remove) })),
          );
          patchLists(qc, accountId, (t) => (ids.includes(t.id) ? applyLabels(t, add, remove) : t));
          patchThread(qc, accountId, ids, add, remove);
        },
        () => getApi().modifyThreads(accountId, ids, add, remove),
        "Couldn't update messages",
      );
    },
    [qc, run],
  );

  /** Takes conversations out of the list on screen, keeping the selection on a neighbour. */
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
      const api = getApi();
      const originals = cachedSummaries(qc, accountId, ids);
      const done = run(
        accountId,
        () => {
          patchCounts(qc, accountId, originals.map((before) => ({ before, after: moveSummary(before, ops) })));
          removeFromView(accountId, ids);
        },
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
              () => patchCounts(qc, accountId, originals.map((o) => ({ before: moveSummary(o, ops), after: o }))),
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
      if (await done) void suggestRuleAfterMove(qc, { accountId, threads: originals, source, target, labels });
    },
    [qc, removeFromView, run],
  );

  const deleteForever = useCallback(
    async (accountId: string, ids: string[]) => {
      const done = run(
        accountId,
        () => {
          patchCounts(qc, accountId, cachedSummaries(qc, accountId, ids).map((before) => ({ before, after: null })));
          removeFromView(accountId, ids);
        },
        () => getApi().deleteThreads(accountId, ids),
        "Couldn't delete messages",
      );
      toast(ids.length === 1 ? "Conversation permanently deleted" : `${ids.length} conversations permanently deleted`);
      await done;
    },
    [qc, removeFromView, run],
  );

  const remove = useCallback(
    (accountId: string, ids: string[], source: string, labels?: Label[]) =>
      source === "TRASH" || source === "SPAM"
        ? deleteForever(accountId, ids)
        : move(accountId, ids, source, "TRASH", labels),
    [deleteForever, move],
  );

  const markFolderRead = useCallback(
    (accountId: string, folder: string) =>
      run(
        accountId,
        () => {
          const inFolder = (t: ThreadSummary) => t.labelIds.includes(folder);
          const unread = cachedSummaries(qc, accountId, (t) => t.unread && inFolder(t));
          patchCounts(qc, accountId, unread.map((before) => ({ before, after: applyLabels(before, [], ["UNREAD"]) })));
          qc.setQueryData<Label[]>(keys.labels(accountId), (labels) =>
            labels?.map((l) => (l.id === folder ? { ...l, unread: 0 } : l)),
          );
          patchLists(qc, accountId, (t) => (inFolder(t) ? applyLabels(t, [], ["UNREAD"]) : t));
        },
        () => getApi().markFolderRead(accountId, folder),
        "Couldn't mark folder as read",
      ),
    [qc, run],
  );

  const emptyFolder = useCallback(
    (accountId: string, folder: string) =>
      run(
        accountId,
        () => {
          qc.setQueryData<Label[]>(keys.labels(accountId), (labels) =>
            labels?.map((l) => (l.id === folder ? { ...l, unread: 0, total: 0 } : l)),
          );
          patchLists(qc, accountId, (t) => (t.labelIds.includes(folder) ? null : t));
          useUi.getState().select([], null);
        },
        () => getApi().emptyFolder(accountId, folder),
        "Couldn't empty folder",
      ),
    [qc, run],
  );

  const setTriage = useCallback(
    (accountId: string, ids: string[], category: TriageCategory | null) => {
      if (!ids.length) return Promise.resolve();
      return run(
        accountId,
        () => {
          const filtered = useUi.getState().triage;
          if (filtered && filtered !== category) removeFromView(accountId, ids);
          patchLists(qc, accountId, (t) => (ids.includes(t.id) ? { ...t, triage: category } : t));
        },
        () => getApi().setTriage(accountId, ids, category),
        "Couldn't change the category",
      );
    },
    [qc, removeFromView, run],
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

  return { setRead, setFlag, toggleLabel, move, remove, deleteForever, markFolderRead, emptyFolder, setTriage, refresh };
}
