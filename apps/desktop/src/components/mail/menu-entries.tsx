import {
  ArchiveIcon,
  BanIcon,
  FlagIcon,
  FlagOffIcon,
  FolderIcon,
  FolderInputIcon,
  ForwardIcon,
  InboxIcon,
  MailIcon,
  MailOpenIcon,
  ReplyAllIcon,
  ReplyIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { Commands } from "@/hooks/use-commands";
import { keys, useAiCapabilities, useLabels, useMailActions } from "@/hooks/use-mail";
import { errorMessage, getApi } from "@/lib/api";
import { ARCHIVE, SYSTEM_FOLDERS, buildLabelTree, type LabelNode } from "@/lib/folders";
import { ARCHIVE_KEY, shortcut } from "@/lib/format";
import type { ThreadSummary } from "@/lib/types";
import { useUi } from "@/store/ui";
import { toast } from "sonner";

import { prompt } from "./dialog-host";
import { TRIAGE_OPTIONS } from "./triage";

type Icon = React.ComponentType<{ className?: string }>;

export type MenuEntry =
  | {
      type: "item";
      label: string;
      icon?: Icon;
      shortcut?: string;
      destructive?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { type: "check"; label: string; checked: boolean; color?: string; onSelect: () => void }
  | { type: "sub"; label: string; icon?: Icon; entries: MenuEntry[] }
  | { type: "separator" };

const sep: MenuEntry = { type: "separator" };

function labelEntries(nodes: LabelNode[], depth: number, toEntry: (node: LabelNode, depth: number) => MenuEntry): MenuEntry[] {
  return nodes.flatMap((n) => [toEntry(n, depth), ...labelEntries(n.children, depth + 1, toEntry)]);
}

export function useMessageMenu(commands: Commands, ids: string[], threads: ThreadSummary[]): MenuEntry[] {
  const accountId = useUi((s) => s.accountId);
  const folder = useUi((s) => s.folder);
  const { data: labels = [] } = useLabels(accountId);
  const smartCategories = useUi((s) => s.smartCategories);
  const { data: ai } = useAiCapabilities();
  const { setTriage } = useMailActions();
  const qc = useQueryClient();
  if (!ids.length || !accountId) return [];

  const single = ids.length === 1;
  const anyUnread = threads.some((t) => t.unread);
  const allFlagged = threads.length > 0 && threads.every((t) => t.flagged);
  const inTrash = folder === "TRASH";
  const inJunk = folder === "SPAM";
  const tree = buildLabelTree(labels);

  const moveTargets: MenuEntry[] = [
    ...SYSTEM_FOLDERS.filter((f) => !["DRAFT", "SENT", "STARRED", folder].includes(f.id)).map(
      (f): MenuEntry => ({
        type: "item",
        label: f.name,
        icon: f.id === "INBOX" ? InboxIcon : f.id === "TRASH" ? Trash2Icon : f.id === "SPAM" ? BanIcon : f.id === ARCHIVE ? ArchiveIcon : FolderIcon,
        onSelect: () => commands.move(f.id, ids),
      }),
    ),
    ...(tree.length ? [sep] : []),
    ...labelEntries(tree, 0, (n, depth) => ({
      type: "item",
      label: `${" ".repeat(depth)}${n.label.name.split("/").pop()}`,
      icon: FolderIcon,
      disabled: n.label.id === folder,
      onSelect: () => commands.move(n.label.id, ids),
    })),
  ];

  const createCategory = async () => {
    const name = await prompt({ title: "New category", placeholder: "Category name", confirmLabel: "Create" });
    if (!name) return;
    try {
      const label = await getApi().createLabel(accountId, name);
      await qc.invalidateQueries({ queryKey: keys.labels(accountId) });
      commands.toggleLabel(label.id, true, ids);
    } catch (e) {
      toast.error("Couldn't create category", { description: errorMessage(e) });
    }
  };

  const categories: MenuEntry[] = [
    ...labelEntries(tree, 0, (n, depth) => ({
      type: "check",
      label: `${" ".repeat(depth)}${n.label.name.split("/").pop()}`,
      checked: threads.length > 0 && threads.every((t) => t.labelIds.includes(n.label.id)),
      color: n.label.color?.backgroundColor,
      onSelect: () =>
        commands.toggleLabel(
          n.label.id,
          !(threads.length > 0 && threads.every((t) => t.labelIds.includes(n.label.id))),
          ids,
        ),
    })),
    ...(tree.length ? [sep] : []),
    { type: "item", label: "New category…", icon: TagIcon, onSelect: () => void createCategory() },
  ];

  const current = threads.length > 0 && threads.every((t) => t.triage === threads[0].triage) ? (threads[0].triage ?? null) : undefined;
  const smart: MenuEntry[] =
    smartCategories && ai?.classifier
      ? [
          {
            type: "sub",
            label: "Smart category",
            icon: SparklesIcon,
            entries: [
              ...TRIAGE_OPTIONS.map(
                (o): MenuEntry => ({
                  type: "check",
                  label: o.label,
                  checked: current === o.id,
                  color: o.color,
                  onSelect: () => void setTriage(accountId, ids, o.id),
                }),
              ),
              sep,
              { type: "check", label: "None", checked: current === null, onSelect: () => void setTriage(accountId, ids, null) },
            ],
          },
        ]
      : [];

  return [
    ...(single
      ? ([
          { type: "item", label: "Reply", icon: ReplyIcon, shortcut: "Ctrl+R", onSelect: () => void commands.reply("reply", ids[0]) },
          { type: "item", label: "Reply all", icon: ReplyAllIcon, shortcut: "Ctrl+Shift+R", onSelect: () => void commands.reply("replyAll", ids[0]) },
          { type: "item", label: "Forward", icon: ForwardIcon, shortcut: "Ctrl+F", onSelect: () => void commands.reply("forward", ids[0]) },
          sep,
        ] satisfies MenuEntry[])
      : []),
    {
      type: "item",
      label: inTrash || inJunk ? "Delete permanently" : "Delete",
      icon: Trash2Icon,
      shortcut: "Del",
      destructive: inTrash || inJunk,
      onSelect: () => commands.remove(ids),
    },
    ...(inTrash
      ? ([{ type: "item", label: "Restore", icon: Undo2Icon, onSelect: () => commands.restore(ids) }] satisfies MenuEntry[])
      : []),
    ...(folder !== ARCHIVE
      ? ([{ type: "item", label: "Archive", icon: ArchiveIcon, shortcut: ARCHIVE_KEY, onSelect: () => commands.archive(ids) }] satisfies MenuEntry[])
      : []),
    { type: "sub", label: "Move", icon: FolderInputIcon, entries: moveTargets },
    { type: "sub", label: "Categorize", icon: TagIcon, entries: categories },
    ...smart,
    sep,
    anyUnread
      ? { type: "item", label: "Mark as read", icon: MailOpenIcon, shortcut: "Ctrl+Q", onSelect: () => commands.setRead(true, ids) }
      : { type: "item", label: "Mark as unread", icon: MailIcon, shortcut: "Ctrl+U", onSelect: () => commands.setRead(false, ids) },
    allFlagged
      ? { type: "item", label: "Clear flag", icon: FlagOffIcon, shortcut: "Insert", onSelect: () => commands.setFlag(false, ids) }
      : { type: "item", label: "Flag", icon: FlagIcon, shortcut: "Insert", onSelect: () => commands.setFlag(true, ids) },
    sep,
    inJunk
      ? { type: "item", label: "Not junk", icon: ShieldCheckIcon, onSelect: () => commands.notJunk(ids) }
      : { type: "item", label: "Report junk", icon: BanIcon, onSelect: () => commands.junk(ids) },
  ];
}

function Swatch({ color }: { color?: string }) {
  return <span className="size-3 shrink-0 rounded-sm border border-foreground/10" style={{ background: color ?? "var(--muted-foreground)" }} />;
}

export function ContextMenuEntries({ entries }: { entries: MenuEntry[] }) {
  return entries.map((e, i) => {
    switch (e.type) {
      case "separator":
        return <ContextMenuSeparator key={i} />;
      case "item":
        return (
          <ContextMenuItem key={i} variant={e.destructive ? "destructive" : "default"} disabled={e.disabled} onClick={e.onSelect}>
            {e.icon ? <e.icon /> : <span className="size-4" />}
            {e.label}
            {e.shortcut && <ContextMenuShortcut>{shortcut(e.shortcut)}</ContextMenuShortcut>}
          </ContextMenuItem>
        );
      case "check":
        return (
          <ContextMenuCheckboxItem key={i} checked={e.checked} onClick={e.onSelect}>
            <Swatch color={e.color} />
            {e.label}
          </ContextMenuCheckboxItem>
        );
      case "sub":
        return (
          <ContextMenuSub key={i}>
            <ContextMenuSubTrigger>
              {e.icon ? <e.icon /> : <span className="size-4" />}
              {e.label}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-80">
              <ContextMenuEntries entries={e.entries} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        );
    }
  });
}

export function DropdownMenuEntries({ entries }: { entries: MenuEntry[] }) {
  return entries.map((e, i) => {
    switch (e.type) {
      case "separator":
        return <DropdownMenuSeparator key={i} />;
      case "item":
        return (
          <DropdownMenuItem key={i} variant={e.destructive ? "destructive" : "default"} disabled={e.disabled} onClick={e.onSelect}>
            {e.icon ? <e.icon /> : <span className="size-4" />}
            {e.label}
            {e.shortcut && <DropdownMenuShortcut>{shortcut(e.shortcut)}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        );
      case "check":
        return (
          <DropdownMenuCheckboxItem key={i} checked={e.checked} onClick={e.onSelect}>
            <Swatch color={e.color} />
            {e.label}
          </DropdownMenuCheckboxItem>
        );
      case "sub":
        return (
          <DropdownMenuSub key={i}>
            <DropdownMenuSubTrigger>
              {e.icon ? <e.icon /> : <span className="size-4" />}
              {e.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80">
              <DropdownMenuEntries entries={e.entries} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        );
    }
  });
}
