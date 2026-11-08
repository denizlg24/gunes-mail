"use client";

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useDefaultLayout } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { keys, useAccounts, useSession } from "@/hooks/use-mail";
import { useSettingsSync } from "@/hooks/use-settings-sync";
import { useUpdater } from "@/hooks/use-updater";
import { errorMessage, getApi } from "@/lib/api";
import type { Account, ServerEvent } from "@/lib/types";
import { useUi } from "@/store/ui";

import { AddAccountDialog } from "./add-account-dialog";
import { AppRail } from "./app-rail";
import { DialogHost } from "./dialog-host";
import { FolderPane } from "./folder-pane";
import { MessageList } from "./message-list";
import { ReadingPane } from "./reading-pane";
import { Ribbon } from "./ribbon";
import { SettingsDialog, useSettings } from "./settings-dialog";
import { TitleBar } from "./title-bar";
import { useShortcuts } from "./use-shortcuts";
import { Welcome } from "./welcome";

function suppressNativeContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  const editable = target?.closest("input, textarea, [contenteditable=true]");
  const hasSelection = !!window.getSelection()?.toString();
  if (!editable && !hasSelection) e.preventDefault();
}

function Workspace() {
  const folderPaneOpen = useUi((s) => s.folderPaneOpen);
  const readingPane = useUi((s) => s.readingPane);
  const outer = useDefaultLayout({ id: "mail-outer", panelIds: folderPaneOpen ? ["folders", "main"] : ["main"] });
  const inner = useDefaultLayout({
    id: `mail-inner-${readingPane}`,
    panelIds: readingPane === "off" ? ["list"] : ["list", "reading"],
  });

  const mainContent =
    readingPane === "off" ? (
      <div className="h-full overflow-hidden rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <MessageList />
      </div>
    ) : (
      <ResizablePanelGroup
        key={readingPane}
        orientation={readingPane === "bottom" ? "vertical" : "horizontal"}
        defaultLayout={inner.defaultLayout}
        onLayoutChanged={inner.onLayoutChanged}
      >
        <ResizablePanel
          id="list"
          defaultSize={readingPane === "bottom" ? "40%" : 400}
          minSize={readingPane === "bottom" ? 160 : 300}
          maxSize={readingPane === "bottom" ? "75%" : 640}
          groupResizeBehavior={readingPane === "bottom" ? "preserve-relative-size" : "preserve-pixel-size"}
        >
          <div className="h-full overflow-hidden rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <MessageList />
          </div>
        </ResizablePanel>
        <ResizableHandle className="bg-transparent aria-[orientation=horizontal]:h-2 aria-[orientation=vertical]:w-2" />
        <ResizablePanel id="reading" minSize={readingPane === "bottom" ? 160 : 360}>
          <div className="h-full overflow-hidden rounded-lg bg-pane shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <ReadingPane />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );

  return (
    <ResizablePanelGroup
      key={folderPaneOpen ? "with-folders" : "no-folders"}
      orientation="horizontal"
      defaultLayout={outer.defaultLayout}
      onLayoutChanged={outer.onLayoutChanged}
    >
      {folderPaneOpen && (
        <>
          <ResizablePanel id="folders" defaultSize={248} minSize={180} maxSize={420} groupResizeBehavior="preserve-pixel-size">
            <FolderPane />
          </ResizablePanel>
          <ResizableHandle className="bg-transparent" />
        </>
      )}
      <ResizablePanel id="main" minSize={600}>
        <div className="h-full pl-1">{mainContent}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function MailApp() {
  const openSettings = useCallback(() => useSettings.getState().show(), []);
  const qc = useQueryClient();
  const session = useSession();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data;
  const accountId = useUi((s) => s.accountId);
  const switchAccount = useUi((s) => s.switchAccount);
  const fetching = useIsFetching({ queryKey: ["threads"] }) + useIsFetching({ queryKey: ["labels"] }) > 0;
  const signedIn = !!session.data?.signedIn;
  const migrating = useRef(false);

  useShortcuts(openSettings);
  useSettingsSync(signedIn);
  useUpdater();

  useEffect(() => {
    if (!session.data?.legacyAccounts || migrating.current) return;
    migrating.current = true;
    const id = toast.loading("Moving your accounts to the Güneş Mail server…");
    getApi()
      .migrateLegacyAccounts()
      .then(async (emails) => {
        await qc.invalidateQueries({ queryKey: ["session"] });
        toast.success(`Moved ${emails.length} account${emails.length === 1 ? "" : "s"}`, {
          id,
          description: "Mail now syncs on the server, even while this app is closed.",
        });
      })
      .catch((e: unknown) => toast.error("Couldn't move your accounts", { id, description: errorMessage(e) }));
  }, [session.data?.legacyAccounts, qc]);

  useEffect(() => {
    if (!signedIn) return;
    return getApi().subscribe((event: ServerEvent) => {
      if (event.type === "changed") {
        void qc.invalidateQueries({ queryKey: keys.threads(event.accountId) });
        void qc.invalidateQueries({ queryKey: keys.labels(event.accountId) });
        void qc.invalidateQueries({ queryKey: ["thread", event.accountId] });
      } else if (event.type === "sync") {
        const current = qc.getQueryData<Account[]>(keys.accounts)?.find((a) => a.id === event.accountId);
        // Progress ticks arrive every second while downloading; patch them in place
        // and only refetch when the account's state actually changes.
        if (current && current.status === event.status && event.status === "syncing") {
          qc.setQueryData<Account[]>(keys.accounts, (list) =>
            list?.map((a) => (a.id === event.accountId ? { ...a, progress: event.progress ?? null } : a)),
          );
        } else {
          void qc.invalidateQueries({ queryKey: keys.accounts });
        }
      } else if (event.type === "settings") {
        void qc.invalidateQueries({ queryKey: ["settings"] });
      } else {
        void qc.invalidateQueries({ queryKey: ["outbox"] });
        if (event.status === "failed") toast.error("A message couldn't be sent", { description: event.error });
      }
    });
  }, [signedIn, qc]);

  useEffect(() => {
    if (!accounts?.length) return;
    if (!accountId || !accounts.some((a) => a.id === accountId)) switchAccount(accounts[0].id);
  }, [accounts, accountId, switchAccount]);

  const accent = useUi((s) => s.accent);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  useEffect(() => {
    document.addEventListener("contextmenu", suppressNativeContextMenu);
    return () => document.removeEventListener("contextmenu", suppressNativeContextMenu);
  }, []);

  const ready = !session.isLoading && !(signedIn && accountsQuery.isLoading) && !(session.data?.legacyAccounts ?? 0);
  const hasAccounts = signedIn && (accounts?.length ?? 0) > 0;

  return (
    <div className="flex h-screen flex-col bg-app">
      <TitleBar onOpenSettings={openSettings} syncing={fetching} />
      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2Icon className="size-6 animate-spin text-brand" />
        </div>
      ) : !hasAccounts ? (
        <Welcome />
      ) : (
        <div className="flex min-h-0 flex-1">
          <AppRail />
          <main className="flex min-w-0 flex-1 flex-col gap-2 pt-2 pr-2 pb-2">
            <Ribbon />
            <div className="min-h-0 flex-1">
              <Workspace />
            </div>
          </main>
        </div>
      )}
      <SettingsDialog />
      <AddAccountDialog />
      <DialogHost />
    </div>
  );
}
