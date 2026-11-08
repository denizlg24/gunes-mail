import {
  AlertCircleIcon,
  ArchiveIcon,
  ClockIcon,
  Loader2Icon,
  BanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilePenLineIcon,
  FlagIcon,
  FolderIcon,
  FolderPlusIcon,
  InboxIcon,
  MailCheckIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  UserMinusIcon,
} from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAccountActions } from "@/hooks/use-account-actions";
import { useContextTarget } from "@/hooks/use-context-target";
import { keys, useAccounts, useLabels, useMailActions } from "@/hooks/use-mail";
import { errorMessage, getApi } from "@/lib/api";
import { type LabelNode, type SystemFolder, SYSTEM_FOLDERS, buildLabelTree, isMovableTarget, leafName } from "@/lib/folders";
import type { Account, Label, SyncProgress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { confirmDialog, prompt } from "./dialog-host";
import { useOutbox } from "./sending-section";
import { useSettings } from "./settings-dialog";

export const DRAG_MIME = "application/x-mail-threads";

export interface DragPayload {
  accountId: string;
  ids: string[];
  source: string;
}

const ICONS: Record<SystemFolder["icon"], React.ComponentType<{ className?: string }>> = {
  inbox: InboxIcon,
  drafts: FilePenLineIcon,
  sent: SendIcon,
  flagged: FlagIcon,
  trash: Trash2Icon,
  junk: BanIcon,
  archive: ArchiveIcon,
};

type MenuTarget =
  | { kind: "account"; account: Account }
  | { kind: "folder"; account: Account; folder: string; label?: Label };

interface FolderRowProps {
  account: Account;
  folder: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  countIsTotal?: boolean;
  depth?: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onMenu: (target: MenuTarget) => void;
  label?: Label;
}

function FolderRow({
  account,
  folder,
  name,
  icon: Icon,
  count,
  countIsTotal,
  depth = 0,
  expandable,
  expanded,
  onToggle,
  onMenu,
  label,
}: FolderRowProps) {
  const active = useUi((s) => s.accountId === account.id && s.folder === folder && !s.search);
  const openFolder = useUi((s) => s.openFolder);
  const { move } = useMailActions();
  const qc = useQueryClient();
  const [dropping, setDropping] = useState(false);
  const droppable = isMovableTarget(folder);

  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={expandable ? expanded : undefined}
      tabIndex={-1}
      onClick={() => openFolder(account.id, folder)}
      onContextMenu={() => onMenu({ kind: "folder", account, folder, label })}
      onDragOver={(e) => {
        if (!droppable || !e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        e.preventDefault();
        const payload = JSON.parse(raw) as DragPayload;
        if (payload.accountId !== account.id) {
          toast.error("Messages can only be moved within the same account");
          return;
        }
        void move(
          account.id,
          payload.ids,
          payload.source,
          folder,
          qc.getQueryData<Label[]>(keys.labels(account.id)),
        );
      }}
      className={cn(
        "group relative flex h-8 items-center gap-2 rounded-md pr-2 text-[13px] transition-colors",
        active ? "bg-selected font-semibold hover:bg-selected-hover" : "hover:bg-hover",
        dropping && "bg-brand-soft ring-2 ring-brand ring-inset",
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      {expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="-ml-1 inline-flex size-5 items-center justify-center rounded-sm text-subtle hover:bg-foreground/10"
        >
          {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        </button>
      ) : (
        depth > 0 && <span className="w-4" />
      )}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-brand" : "text-subtle")} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {count > 0 && (
        <span className={cn("text-xs tabular-nums", countIsTotal ? "text-subtle" : "font-semibold text-brand")}>
          {countIsTotal ? `[${count}]` : count}
        </span>
      )}
    </div>
  );
}

function LabelBranch({
  account,
  node,
  depth,
  onMenu,
}: {
  account: Account;
  node: LabelNode;
  depth: number;
  onMenu: (t: MenuTarget) => void;
}) {
  const key = `${account.id}:${node.label.id}`;
  const collapsed = useUi((s) => s.collapsedLabels.includes(key));
  const toggle = useUi((s) => s.toggleLabelCollapsed);
  const hasChildren = node.children.length > 0;
  return (
    <>
      <FolderRow
        account={account}
        folder={node.label.id}
        name={leafName(node.label.name)}
        icon={FolderIcon}
        count={node.label.unread}
        depth={depth}
        expandable={hasChildren}
        expanded={!collapsed}
        onToggle={() => toggle(key)}
        onMenu={onMenu}
        label={node.label}
      />
      {hasChildren &&
        !collapsed &&
        node.children.map((child) => (
          <LabelBranch key={child.label.id} account={account} node={child} depth={depth + 1} onMenu={onMenu} />
        ))}
    </>
  );
}

function AccountTree({ account, onMenu }: { account: Account; onMenu: (t: MenuTarget) => void }) {
  const { data: labels = [], isLoading } = useLabels(account.id);
  const collapsed = useUi((s) => s.collapsedAccounts.includes(account.id));
  const toggle = useUi((s) => s.toggleAccountCollapsed);
  const isActive = useUi((s) => s.accountId === account.id);
  const tree = buildLabelTree(labels);
  const count = (id: string) => labels.find((l) => l.id === id)?.unread ?? 0;

  return (
    <div role="group" className="mb-2">
      <div
        role="treeitem"
        aria-selected={false}
        aria-expanded={!collapsed}
        tabIndex={-1}
        onClick={() => toggle(account.id)}
        onContextMenu={() => onMenu({ kind: "account", account })}
        className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-semibold hover:bg-hover"
      >
        {collapsed ? <ChevronRightIcon className="size-4 text-subtle" /> : <ChevronDownIcon className="size-4 text-subtle" />}
        <span className={cn("min-w-0 flex-1 truncate", isActive && "text-foreground")}>{account.email}</span>
        {account.status === "syncing" && (account.progress || !account.lastSyncedAt) && (
          <Loader2Icon aria-label="Syncing" className="size-3.5 shrink-0 animate-spin text-subtle" />
        )}
        {account.status === "error" && (
          <span title={account.lastError ?? "Sync failed"} className="shrink-0">
            <AlertCircleIcon aria-label="Sync problem" className="size-3.5 text-destructive" />
          </span>
        )}
      </div>
      {account.progress && <SyncProgressBar progress={account.progress} />}
      {!collapsed && (
        <div role="group">
          {SYSTEM_FOLDERS.map((f) => (
            <FolderRow
              key={f.id}
              account={account}
              folder={f.id}
              name={f.name}
              icon={ICONS[f.icon]}
              count={f.id === "SENT" || f.id === "TRASH" || f.id === "STARRED" ? 0 : count(f.id)}
              countIsTotal={f.id === "DRAFT"}
              depth={0}
              onMenu={onMenu}
            />
          ))}
          {isLoading && <div className="mx-2 my-1 h-3 w-24 animate-pulse rounded bg-foreground/10" />}
          {tree.map((node) => (
            <LabelBranch key={node.label.id} account={account} node={node} depth={0} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduledRow() {
  const { data: outbox = [] } = useOutbox();
  if (!outbox.length) return null;
  const failed = outbox.some((o) => o.status === "failed");
  return (
    <button
      type="button"
      onClick={() => useSettings.getState().show("sending")}
      className="mb-2 flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"
    >
      {failed ? <AlertCircleIcon className="size-[18px] text-destructive" /> : <ClockIcon className="size-[18px] text-brand" />}
      <span className="flex-1 text-left">{failed ? "Outbox needs attention" : "Scheduled"}</span>
      <span className="text-xs font-semibold text-brand tabular-nums">{outbox.length}</span>
    </button>
  );
}

export function FolderPane() {
  const { data: accounts = [] } = useAccounts();
  const menu = useContextTarget<MenuTarget>();
  const target = menu.target;
  const actions = useMailActions();
  const { removeAccount } = useAccountActions();
  const qc = useQueryClient();

  const createFolder = async (account: Account, parent?: Label) => {
    const name = await prompt({
      title: parent ? `New subfolder in "${leafName(parent.name)}"` : "Create new folder",
      placeholder: "Folder name",
      confirmLabel: "Create",
    });
    if (!name) return;
    try {
      await getApi().createLabel(account.id, parent ? `${parent.name}/${name}` : name);
      await qc.invalidateQueries({ queryKey: keys.labels(account.id) });
    } catch (e) {
      toast.error("Couldn't create folder", { description: errorMessage(e) });
    }
  };

  const renameFolder = async (account: Account, label: Label) => {
    const leaf = leafName(label.name);
    const name = await prompt({ title: "Rename folder", initial: leaf, confirmLabel: "Rename" });
    if (!name || name === leaf) return;
    const prefix = label.name.slice(0, label.name.length - leaf.length);
    try {
      await getApi().renameLabel(account.id, label.id, prefix + name);
      await qc.invalidateQueries({ queryKey: keys.labels(account.id) });
    } catch (e) {
      toast.error("Couldn't rename folder", { description: errorMessage(e) });
    }
  };

  const deleteFolder = async (account: Account, label: Label) => {
    const ok = await confirmDialog({
      title: `Delete "${leafName(label.name)}"?`,
      description: "The folder is removed. Messages in it stay in your mailbox.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await getApi().deleteLabel(account.id, label.id);
      const ui = useUi.getState();
      if (ui.accountId === account.id && ui.folder === label.id) ui.openFolder(account.id, "INBOX");
      await qc.invalidateQueries({ queryKey: keys.labels(account.id) });
    } catch (e) {
      toast.error("Couldn't delete folder", { description: errorMessage(e) });
    }
  };

  const emptyFolder = async (account: Account, folder: string) => {
    const ok = await confirmDialog({
      title: folder === "TRASH" ? "Empty Deleted Items?" : "Empty Junk Email?",
      description: "All items in this folder will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete all",
      destructive: true,
    });
    if (ok) await actions.emptyFolder(account.id, folder);
  };

  const removeAccountConfirm = async (account: Account) => {
    const ok = await confirmDialog({
      title: `Remove ${account.email}?`,
      description: "Mail stays in Gmail. This app's access to the account is revoked.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) await removeAccount(account);
  };

  return (
    <ContextMenu open={menu.open} onOpenChange={menu.onOpenChange}>
      <ContextMenuTrigger
        onContextMenuCapture={menu.resetCapture}
        render={<div role="tree" aria-label="Folders" className="thin-scroll h-full overflow-y-auto px-2 py-1" />}
      >
        <ScheduledRow />
        {accounts.map((a) => (
          <AccountTree key={a.id} account={a} onMenu={menu.setTarget} />
        ))}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {target?.kind === "account" && (
          <>
            <ContextMenuItem onClick={() => void createFolder(target.account)}>
              <FolderPlusIcon />
              Create new folder
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void actions.refresh(target.account.id)}>
              <RefreshCwIcon />
              Sync account
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => void removeAccountConfirm(target.account)}>
              <UserMinusIcon />
              Remove account
            </ContextMenuItem>
          </>
        )}
        {target?.kind === "folder" && (
          <>
            <ContextMenuItem onClick={() => void actions.markFolderRead(target.account.id, target.folder)}>
              <MailCheckIcon />
              Mark all as read
            </ContextMenuItem>
            {(target.folder === "TRASH" || target.folder === "SPAM") && (
              <ContextMenuItem onClick={() => void emptyFolder(target.account, target.folder)}>
                <Trash2Icon />
                Empty folder
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void createFolder(target.account, target.label)}>
              <FolderPlusIcon />
              {target.label ? "Create new subfolder" : "Create new folder"}
            </ContextMenuItem>
            {target.label && (
              <>
                <ContextMenuItem onClick={() => void renameFolder(target.account, target.label!)}>
                  <PencilIcon />
                  Rename folder
                </ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={() => void deleteFolder(target.account, target.label!)}>
                  <Trash2Icon />
                  Delete folder
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void actions.refresh(target.account.id)}>
              <RefreshCwIcon />
              Sync
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const formatCount = new Intl.NumberFormat();

function SyncProgressBar({ progress }: { progress: SyncProgress }) {
  const total = progress.total && progress.total >= progress.synced ? progress.total : null;
  const pct = total ? Math.max(2, Math.round((progress.synced / total) * 100)) : null;
  const label = progress.phase === "recent" ? "Syncing recent mail" : "Syncing older mail";
  const detail = `${formatCount.format(progress.synced)}${total ? ` of ${formatCount.format(total)}` : ""} messages downloaded`;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext={detail}
      title={detail}
      aria-valuemin={0}
      aria-valuemax={total ?? undefined}
      aria-valuenow={total ? progress.synced : undefined}
      className="mb-1 flex flex-col gap-1 pr-1.5 pl-7"
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-subtle">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{pct === null ? formatCount.format(progress.synced) : `${pct}%`}</span>
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-muted">
        {pct === null ? (
          <div className="animate-progress-slide absolute inset-y-0 w-1/3 rounded-full bg-brand" />
        ) : (
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}
