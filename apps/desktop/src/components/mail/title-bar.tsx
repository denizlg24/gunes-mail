import { RefreshCwIcon, SearchIcon, SettingsIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommands } from "@/hooks/use-commands";
import { useAccounts } from "@/hooks/use-mail";
import { getApi } from "@/lib/api";
import { isMac, shortcut } from "@/lib/format";
import { isTauri } from "@/lib/server-api";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { AccountMenu } from "./account-menu";

export const SEARCH_INPUT_ID = "mail-search";

function TitleButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="inline-flex size-9 items-center justify-center rounded-md text-titlebar-foreground/95 transition-colors hover:bg-white/15 active:bg-white/25 [&_svg]:size-[18px]"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function TitleBar({ onOpenSettings, syncing }: { onOpenSettings: () => void; syncing: boolean }) {
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const [value, setValue] = useState(search);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useCommands();
  const { data: accounts } = useAccounts();
  const accountId = useUi((s) => s.accountId);
  const account = accounts?.find((a) => a.id === accountId);
  const trafficLightPad = isMac && isTauri();

  const [syncedSearch, setSyncedSearch] = useState(search);
  if (syncedSearch !== search) {
    setSyncedSearch(search);
    setValue(search);
  }

  const clear = () => {
    setValue("");
    setSearch("");
    inputRef.current?.blur();
  };

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-12 shrink-0 items-center gap-2 bg-titlebar pr-2 text-titlebar-foreground",
        trafficLightPad ? "pl-[84px]" : "pl-3",
      )}
    >
      <div data-tauri-drag-region className="flex w-[220px] shrink-0 items-center gap-2">
        <span className="pointer-events-none text-[15px] font-semibold tracking-tight">Güneş Mail</span>
        {getApi().demo && (
          <span className="pointer-events-none rounded-sm bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
            Demo
          </span>
        )}
      </div>

      <div data-tauri-drag-region className="flex flex-1 justify-center">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(value.trim());
          }}
          className={cn(
            "flex h-8 w-full max-w-[560px] items-center gap-2 rounded-md px-2.5 transition-colors",
            focused || value
              ? "bg-background text-foreground shadow-sm"
              : "bg-white/20 text-titlebar-foreground hover:bg-white/30",
          )}
        >
          <SearchIcon className={cn("size-4 shrink-0", focused || value ? "text-brand" : "opacity-90")} />
          <input
            id={SEARCH_INPUT_ID}
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") clear();
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder={account ? `Search ${account.email}` : "Search"}
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none",
              focused || value ? "placeholder:text-muted-foreground" : "placeholder:text-titlebar-foreground/90",
            )}
          />
          {value ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : (
            !focused && <kbd className="pointer-events-none text-[11px] opacity-80">{shortcut("Ctrl+E")}</kbd>
          )}
        </form>
      </div>

      <div data-tauri-drag-region className="flex w-[220px] shrink-0 items-center justify-end gap-0.5">
        <TitleButton label="Sync (F9)" onClick={commands.refresh}>
          <RefreshCwIcon className={cn(syncing && "animate-spin")} />
        </TitleButton>
        <TitleButton label="Settings" onClick={onOpenSettings}>
          <SettingsIcon />
        </TitleButton>
        <AccountMenu onOpenSettings={onOpenSettings} />
      </div>
    </header>
  );
}
