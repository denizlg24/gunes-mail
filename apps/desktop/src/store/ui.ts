import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { InboxTab, ListFilter, Mailbox, OutgoingAttachment } from "@/lib/types";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeDraft {
  key: string;
  accountId: string;
  mode: ComposeMode;
  threadId?: string;
  draftId?: string;
  to: Mailbox[];
  cc: Mailbox[];
  bcc: Mailbox[];
  subject: string;
  body: string;
  quoted?: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
}

export type ReadingPane = "right" | "bottom" | "off";
export type Density = "comfortable" | "compact";
export type Theme = "light" | "dark" | "system";

export const ACCENTS = [
  { id: "blue", label: "Blue", swatch: "#0f6cbd" },
  { id: "teal", label: "Teal", swatch: "#038387" },
  { id: "purple", label: "Purple", swatch: "#5c2e91" },
  { id: "berry", label: "Berry", swatch: "#c239b3" },
  { id: "sunset", label: "Güneş", swatch: "#ca5010" },
  { id: "green", label: "Green", swatch: "#107c10" },
  { id: "red", label: "Red", swatch: "#c50f1f" },
  { id: "graphite", label: "Graphite", swatch: "#424242" },
] as const;

export type Accent = (typeof ACCENTS)[number]["id"];

interface UiState {
  accountId: string | null;
  folder: string;
  inboxTab: InboxTab;
  filter: ListFilter;
  search: string;
  selectedIds: string[];
  anchorId: string | null;
  compose: ComposeDraft | null;
  readingPane: ReadingPane;
  folderPaneOpen: boolean;
  density: Density;
  focusedInbox: boolean;
  collapsedAccounts: string[];
  collapsedLabels: string[];
  markReadOnOpen: boolean;
  accent: Accent;
  undoSendSeconds: number;
  signature: string;

  openFolder: (accountId: string, folder: string) => void;
  switchAccount: (accountId: string) => void;
  setInboxTab: (tab: InboxTab) => void;
  setFilter: (filter: ListFilter) => void;
  setSearch: (search: string) => void;
  select: (ids: string[], anchorId?: string | null) => void;
  setCompose: (compose: ComposeDraft | null) => void;
  updateCompose: (patch: Partial<ComposeDraft>) => void;
  setReadingPane: (pane: ReadingPane) => void;
  toggleFolderPane: () => void;
  setDensity: (density: Density) => void;
  setFocusedInbox: (on: boolean) => void;
  toggleAccountCollapsed: (accountId: string) => void;
  toggleLabelCollapsed: (key: string) => void;
  setMarkReadOnOpen: (on: boolean) => void;
  setAccent: (accent: Accent) => void;
  setUndoSendSeconds: (seconds: number) => void;
  setSignature: (signature: string) => void;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      accountId: null,
      folder: "INBOX",
      inboxTab: "focused",
      filter: "all",
      search: "",
      selectedIds: [],
      anchorId: null,
      compose: null,
      readingPane: "right",
      folderPaneOpen: true,
      density: "comfortable",
      focusedInbox: true,
      collapsedAccounts: [],
      collapsedLabels: [],
      markReadOnOpen: true,
      accent: "blue",
      undoSendSeconds: 10,
      signature: "",

      openFolder: (accountId, folder) =>
        set({ accountId, folder, selectedIds: [], anchorId: null, search: "", filter: "all" }),
      switchAccount: (accountId) =>
        set((s) =>
          s.accountId === accountId
            ? s
            : { accountId, folder: "INBOX", selectedIds: [], anchorId: null, search: "", filter: "all" },
        ),
      setInboxTab: (inboxTab) => set({ inboxTab, selectedIds: [], anchorId: null }),
      setFilter: (filter) => set({ filter, selectedIds: [], anchorId: null }),
      setSearch: (search) => set({ search, selectedIds: [], anchorId: null }),
      select: (selectedIds, anchorId) =>
        set((s) => ({ selectedIds, anchorId: anchorId === undefined ? s.anchorId : anchorId })),
      setCompose: (compose) => set({ compose }),
      updateCompose: (patch) => set((s) => (s.compose ? { compose: { ...s.compose, ...patch } } : s)),
      setReadingPane: (readingPane) => set({ readingPane }),
      toggleFolderPane: () => set((s) => ({ folderPaneOpen: !s.folderPaneOpen })),
      setDensity: (density) => set({ density }),
      setFocusedInbox: (focusedInbox) => set({ focusedInbox }),
      toggleAccountCollapsed: (id) => set((s) => ({ collapsedAccounts: toggle(s.collapsedAccounts, id) })),
      toggleLabelCollapsed: (key) => set((s) => ({ collapsedLabels: toggle(s.collapsedLabels, key) })),
      setMarkReadOnOpen: (markReadOnOpen) => set({ markReadOnOpen }),
      setAccent: (accent) => set({ accent }),
      setUndoSendSeconds: (undoSendSeconds) => set({ undoSendSeconds }),
      setSignature: (signature) => set({ signature }),
    }),
    {
      name: "mail-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accountId: s.accountId,
        folder: s.folder,
        inboxTab: s.inboxTab,
        readingPane: s.readingPane,
        folderPaneOpen: s.folderPaneOpen,
        density: s.density,
        focusedInbox: s.focusedInbox,
        collapsedAccounts: s.collapsedAccounts,
        collapsedLabels: s.collapsedLabels,
        markReadOnOpen: s.markReadOnOpen,
        accent: s.accent,
        undoSendSeconds: s.undoSendSeconds,
        signature: s.signature,
      }),
    },
  ),
);
