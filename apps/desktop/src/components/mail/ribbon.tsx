import {
  ArchiveIcon,
  BanIcon,
  ChevronDownIcon,
  FlagIcon,
  FolderInputIcon,
  ForwardIcon,
  MailOpenIcon,
  MenuIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  ReplyAllIcon,
  ReplyIcon,
  RefreshCwIcon,
  Rows3Icon,
  ShieldCheckIcon,
  SquarePenIcon,
  SunMoonIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/hooks/use-commands";
import { useVisibleThreads } from "@/hooks/use-mail";
import { ARCHIVE } from "@/lib/folders";
import { ARCHIVE_KEY, shortcut } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type Density, type ReadingPane, useUi } from "@/store/ui";

import { DropdownMenuEntries, useMessageMenu } from "./menu-entries";

const buttonClass =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-foreground transition-colors hover:bg-hover active:bg-accent disabled:pointer-events-none disabled:opacity-40 data-popup-open:bg-hover [&_svg]:size-[18px] [&_svg]:shrink-0";

function RibbonButton({
  label,
  tip,
  icon: Icon,
  onClick,
  disabled,
  iconClass,
  hideLabel,
}: {
  label: string;
  tip?: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  iconClass?: string;
  hideLabel?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={buttonClass} />}
      >
        <Icon className={cn("text-brand", iconClass)} />
        {!hideLabel && <span className="max-xl:hidden">{label}</span>}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip ?? label}</TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function HomeTab() {
  const commands = useCommands();
  const selectedIds = useUi((s) => s.selectedIds);
  const folder = useUi((s) => s.folder);
  const threads = useVisibleThreads((s) => s.threads);
  const selected = threads.filter((t) => selectedIds.includes(t.id));
  const entries = useMessageMenu(commands, selectedIds, selected);
  const none = selectedIds.length === 0;
  const single = selectedIds.length === 1;
  const anyUnread = selected.some((t) => t.unread);
  const allFlagged = selected.length > 0 && selected.every((t) => t.flagged);
  const moveEntries = entries.find((e) => e.type === "sub" && e.label === "Move");
  const categoryEntries = entries.find((e) => e.type === "sub" && e.label === "Categorize");

  return (
    <>
      <button
        type="button"
        onClick={() => commands.newMail()}
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-brand-strong px-3 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong-hover [&_svg]:size-[18px]"
      >
        <SquarePenIcon />
        New mail
      </button>
      <Divider />
      <RibbonButton
        label={folder === "TRASH" || folder === "SPAM" ? "Delete forever" : "Delete"}
        tip="Delete (Del)"
        icon={Trash2Icon}
        disabled={none}
        onClick={() => commands.remove()}
      />
      {folder === "TRASH" ? (
        <RibbonButton label="Restore" icon={Undo2Icon} disabled={none} onClick={() => commands.restore()} />
      ) : (
        <RibbonButton
          label="Archive"
          tip={`Archive (${shortcut(ARCHIVE_KEY)})`}
          icon={ArchiveIcon}
          disabled={none || folder === ARCHIVE}
          onClick={() => commands.archive()}
        />
      )}
      {folder === "SPAM" ? (
        <RibbonButton label="Not junk" icon={ShieldCheckIcon} disabled={none} onClick={() => commands.notJunk()} />
      ) : (
        <RibbonButton label="Report" tip="Report junk" icon={BanIcon} disabled={none} onClick={() => commands.junk()} />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger disabled={none} className={buttonClass}>
          <FolderInputIcon className="text-brand" />
          <span className="max-xl:hidden">Move to</span>
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-96">
          {moveEntries?.type === "sub" && <DropdownMenuEntries entries={moveEntries.entries} />}
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />
      <RibbonButton label="Reply" tip={`Reply (${shortcut("Ctrl+R")})`} icon={ReplyIcon} disabled={!single} onClick={() => void commands.reply("reply")} />
      <RibbonButton label="Reply all" tip={`Reply all (${shortcut("Ctrl+Shift+R")})`} icon={ReplyAllIcon} disabled={!single} onClick={() => void commands.reply("replyAll")} />
      <RibbonButton label="Forward" tip={`Forward (${shortcut("Ctrl+F")})`} icon={ForwardIcon} disabled={!single} onClick={() => void commands.reply("forward")} />
      <Divider />
      <RibbonButton
        label={anyUnread ? "Read" : "Unread"}
        tip={anyUnread ? `Mark as read (${shortcut("Ctrl+Q")})` : `Mark as unread (${shortcut("Ctrl+U")})`}
        icon={MailOpenIcon}
        disabled={none}
        onClick={() => commands.setRead(anyUnread)}
      />
      <RibbonButton
        label={allFlagged ? "Unflag" : "Flag"}
        tip={allFlagged ? "Clear flag (Insert)" : "Flag (Insert)"}
        icon={FlagIcon}
        iconClass={allFlagged ? "fill-flag text-flag" : undefined}
        disabled={none}
        onClick={() => commands.setFlag(!allFlagged)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger disabled={none} className={buttonClass}>
          <TagIcon className="text-brand" />
          <span className="max-xl:hidden">Categorize</span>
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-96">
          {categoryEntries?.type === "sub" && <DropdownMenuEntries entries={categoryEntries.entries} />}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <RibbonButton label="Sync" tip="Sync (F9)" icon={RefreshCwIcon} onClick={commands.refresh} />
    </>
  );
}

function ViewTab() {
  const readingPane = useUi((s) => s.readingPane);
  const setReadingPane = useUi((s) => s.setReadingPane);
  const folderPaneOpen = useUi((s) => s.folderPaneOpen);
  const toggleFolderPane = useUi((s) => s.toggleFolderPane);
  const density = useUi((s) => s.density);
  const setDensity = useUi((s) => s.setDensity);
  const focusedInbox = useUi((s) => s.focusedInbox);
  const setFocusedInbox = useUi((s) => s.setFocusedInbox);
  const markReadOnOpen = useUi((s) => s.markReadOnOpen);
  const setMarkReadOnOpen = useUi((s) => s.setMarkReadOnOpen);
  const { theme = "system", setTheme } = useTheme();
  const PaneIcon = readingPane === "bottom" ? PanelBottomIcon : PanelRightIcon;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonClass}>
          <PaneIcon className="text-brand" />
          Reading pane
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={readingPane} onValueChange={(v) => setReadingPane(v as ReadingPane)}>
            <DropdownMenuRadioItem value="right">Show on the right</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="bottom">Show on the bottom</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="off">Hide</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <RibbonButton label={folderPaneOpen ? "Hide folder pane" : "Show folder pane"} icon={PanelLeftIcon} onClick={toggleFolderPane} />
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonClass}>
          <Rows3Icon className="text-brand" />
          Density
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
            <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonClass}>
          <SunMoonIcon className="text-brand" />
          Theme
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as string)}>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">Use system setting</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonClass}>
          Inbox options
          <ChevronDownIcon className="size-3.5! text-subtle" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Inbox</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={focusedInbox} onCheckedChange={setFocusedInbox}>
              Focused Inbox
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={markReadOnOpen} onCheckedChange={setMarkReadOnOpen}>
              Mark as read when opened
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function Ribbon() {
  const [tab, setTab] = useState<"home" | "view">("home");
  const toggleFolderPane = useUi((s) => s.toggleFolderPane);

  return (
    <div className="shrink-0 rounded-lg bg-pane shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="flex h-9 items-center gap-1 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Toggle folder pane"
                onClick={toggleFolderPane}
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-hover"
              />
            }
          >
            <MenuIcon className="size-[18px]" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Show/hide folder pane</TooltipContent>
        </Tooltip>
        {(["home", "view"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "relative h-8 rounded-md px-2.5 text-[13px] capitalize hover:bg-hover",
              tab === t ? "font-semibold" : "text-subtle",
            )}
          >
            {t}
            {tab === t && <span className="absolute inset-x-2.5 bottom-0.5 h-[3px] rounded-full bg-brand" />}
          </button>
        ))}
      </div>
      <div className="flex h-11 items-center gap-0.5 overflow-hidden border-t border-border/70 px-2">
        {tab === "home" ? <HomeTab /> : <ViewTab />}
      </div>
    </div>
  );
}
