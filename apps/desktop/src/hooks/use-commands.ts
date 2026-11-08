"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { errorMessage, getApi } from "@/lib/api";
import {
  base64UrlToBase64,
  draftCompose,
  newCompose,
  replyCompose,
} from "@/lib/compose";
import { ARCHIVE } from "@/lib/folders";
import type { Account, Label, OutgoingAttachment, Thread } from "@/lib/types";
import { type ComposeDraft, useUi } from "@/store/ui";

import { keys, useMailActions, useVisibleThreads } from "./use-mail";

export type ReplyMode = "reply" | "replyAll" | "forward";

let pendingComposeFlush: (() => Promise<void>) | null = null;

export function registerComposeFlush(fn: (() => Promise<void>) | null) {
  pendingComposeFlush = fn;
}

export async function flushCompose() {
  const fn = pendingComposeFlush;
  pendingComposeFlush = null;
  if (fn) await fn();
}

export function useCommands() {
  const qc = useQueryClient();
  const actions = useMailActions();

  const ctx = useCallback((ids?: string[]) => {
    const s = useUi.getState();
    return { accountId: s.accountId, folder: s.folder, ids: ids ?? s.selectedIds };
  }, []);

  const labelsFor = useCallback(
    (accountId: string) => qc.getQueryData<Label[]>(keys.labels(accountId)),
    [qc],
  );

  const accountFor = useCallback(
    (accountId: string) => qc.getQueryData<Account[]>(keys.accounts)?.find((a) => a.id === accountId),
    [qc],
  );

  const fetchThread = useCallback(
    (accountId: string, threadId: string) =>
      qc.query({
        queryKey: keys.thread(accountId, threadId),
        queryFn: () => getApi().getThread(accountId, threadId),
        staleTime: 30_000,
      }),
    [qc],
  );

  const openCompose = useCallback(async (draft: ComposeDraft) => {
    await flushCompose();
    useUi.getState().setCompose(draft);
  }, []);

  const newMail = useCallback(
    (to?: { name: string; email: string }[]) => {
      const { accountId } = ctx();
      if (!accountId) return;
      void openCompose(newCompose(accountId, to));
    },
    [ctx, openCompose],
  );

  const reply = useCallback(
    async (mode: ReplyMode, threadId?: string, messageId?: string) => {
      const c = ctx(threadId ? [threadId] : undefined);
      const id = c.ids[0];
      if (!c.accountId || !id) return;
      const account = accountFor(c.accountId);
      if (!account) return;
      try {
        const thread: Thread = await fetchThread(c.accountId, id);
        const candidates = thread.messages.filter((m) => !m.draft);
        const message =
          candidates.find((m) => m.id === messageId) ?? candidates[candidates.length - 1] ?? thread.messages[0];
        if (!message) return;
        let attachments: OutgoingAttachment[] = [];
        if (mode === "forward" && message.attachments.length) {
          const api = getApi();
          attachments = await Promise.all(
            message.attachments
              .filter((a) => !a.inline)
              .map(async (a) => ({
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                data: base64UrlToBase64(
                  a.data ?? (a.attachmentId ? await api.getAttachmentData(c.accountId!, message.id, a.attachmentId) : ""),
                ),
              })),
          );
        }
        if (useUi.getState().selectedIds[0] !== id) useUi.getState().select([id], id);
        await openCompose(replyCompose(account, thread, message, mode, attachments));
      } catch (e) {
        toast.error("Couldn't open the message", { description: errorMessage(e) });
      }
    },
    [accountFor, ctx, fetchThread, openCompose],
  );

  const editDraft = useCallback(
    async (threadId: string) => {
      const { accountId } = ctx();
      if (!accountId) return;
      try {
        const thread = await fetchThread(accountId, threadId);
        const message = [...thread.messages].reverse().find((m) => m.draft);
        if (!message) return;
        const draftId = await getApi().findDraftId(accountId, message.id);
        await openCompose(draftCompose(accountId, message, draftId));
      } catch (e) {
        toast.error("Couldn't open the draft", { description: errorMessage(e) });
      }
    },
    [ctx, fetchThread, openCompose],
  );

  const summaries = useCallback(
    (ids: string[]) => useVisibleThreads.getState().threads.filter((t) => ids.includes(t.id)),
    [],
  );

  const remove = useCallback(
    (ids?: string[]) => {
      const c = ctx(ids);
      if (!c.accountId || !c.ids.length) return;
      void actions.remove(c.accountId, c.ids, c.folder, labelsFor(c.accountId));
    },
    [actions, ctx, labelsFor],
  );

  const move = useCallback(
    (target: string, ids?: string[]) => {
      const c = ctx(ids);
      if (!c.accountId || !c.ids.length) return;
      void actions.move(c.accountId, c.ids, c.folder, target, labelsFor(c.accountId));
    },
    [actions, ctx, labelsFor],
  );

  const archive = useCallback((ids?: string[]) => move(ARCHIVE, ids), [move]);
  const junk = useCallback((ids?: string[]) => move("SPAM", ids), [move]);
  const notJunk = useCallback((ids?: string[]) => move("INBOX", ids), [move]);
  const restore = useCallback((ids?: string[]) => move("INBOX", ids), [move]);

  const setRead = useCallback(
    (read: boolean, ids?: string[]) => {
      const c = ctx(ids);
      if (!c.accountId || !c.ids.length) return;
      void actions.setRead(c.accountId, c.ids, read);
    },
    [actions, ctx],
  );

  const toggleRead = useCallback(
    (ids?: string[]) => {
      const c = ctx(ids);
      const anyUnread = summaries(c.ids).some((t) => t.unread);
      setRead(anyUnread, c.ids);
    },
    [ctx, setRead, summaries],
  );

  const setFlag = useCallback(
    (flagged: boolean, ids?: string[]) => {
      const c = ctx(ids);
      if (!c.accountId || !c.ids.length) return;
      void actions.setFlag(c.accountId, c.ids, flagged);
    },
    [actions, ctx],
  );

  const toggleFlag = useCallback(
    (ids?: string[]) => {
      const c = ctx(ids);
      const allFlagged = summaries(c.ids).every((t) => t.flagged);
      setFlag(!allFlagged, c.ids);
    },
    [ctx, setFlag, summaries],
  );

  const toggleLabel = useCallback(
    (labelId: string, on: boolean, ids?: string[]) => {
      const c = ctx(ids);
      if (!c.accountId || !c.ids.length) return;
      void actions.toggleLabel(c.accountId, c.ids, labelId, on);
    },
    [actions, ctx],
  );

  const selectAll = useCallback(() => {
    const ids = useVisibleThreads.getState().threads.map((t) => t.id);
    useUi.getState().select(ids, ids[0] ?? null);
  }, []);

  const refresh = useCallback(() => {
    const { accountId } = ctx();
    if (accountId) void actions.refresh(accountId);
  }, [actions, ctx]);

  return useMemo(
    () => ({
      newMail,
      reply,
      editDraft,
      remove,
      move,
      archive,
      junk,
      notJunk,
      restore,
      setRead,
      toggleRead,
      setFlag,
      toggleFlag,
      toggleLabel,
      selectAll,
      refresh,
      summaries,
    }),
    [newMail, reply, editDraft, remove, move, archive, junk, notJunk, restore, setRead, toggleRead, setFlag, toggleFlag, toggleLabel, selectAll, refresh, summaries],
  );
}

export type Commands = ReturnType<typeof useCommands>;
