import { useEffect } from "react";

import { flushCompose, useCommands } from "@/hooks/use-commands";
import { useAccounts } from "@/hooks/use-mail";
import { isMac } from "@/lib/format";
import { useUi } from "@/store/ui";

import { MESSAGE_LIST_ID } from "./message-list";
import { SEARCH_INPUT_ID } from "./title-bar";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useShortcuts(openSettings: () => void) {
  const commands = useCommands();
  const { data: accounts = [] } = useAccounts();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const editing = isEditable(e.target) || !!document.querySelector("[role=dialog], [role=menu]");
      const ui = useUi.getState();
      const hasSelection = ui.selectedIds.length > 0;

      const handle = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };

      if (mod && key === "e") return handle(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
      if (e.key === "F3") return handle(() => document.getElementById(SEARCH_INPUT_ID)?.focus());
      if (e.key === "F9") return handle(commands.refresh);
      if (mod && e.key === ",") return handle(openSettings);
      if (mod && key === "n" && !e.shiftKey) return handle(() => commands.newMail());
      if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code)) {
        const account = accounts[Number(e.code.slice(5)) - 1];
        if (account) return handle(() => ui.switchAccount(account.id));
      }
      if (mod && e.shiftKey && key === "i" && ui.accountId) {
        const accountId = ui.accountId;
        return handle(() => ui.openFolder(accountId, "INBOX"));
      }

      if (editing) return;

      if (mod && e.shiftKey && key === "r" && hasSelection) return handle(() => void commands.reply("replyAll"));
      if (mod && !e.shiftKey && key === "r" && hasSelection) return handle(() => void commands.reply("reply"));
      if (mod && key === "f" && hasSelection) return handle(() => void commands.reply("forward"));
      if (mod && key === "q" && hasSelection) return handle(() => commands.setRead(true));
      if (mod && key === "u" && hasSelection) return handle(() => commands.setRead(false));
      if (mod && key === "a") {
        return handle(() => {
          commands.selectAll();
          document.getElementById(MESSAGE_LIST_ID)?.focus({ preventScroll: true });
        });
      }
      if (e.key === "Insert" && hasSelection) return handle(() => commands.toggleFlag());
      if (e.key === "Delete" && hasSelection) return handle(() => commands.remove());
      if (isMac && mod && e.altKey && e.code === "KeyA" && hasSelection) return handle(() => commands.archive());
      if (e.key === "Backspace" && hasSelection) {
        return handle(() => (isMac ? commands.remove() : commands.archive()));
      }
      if (e.key === "Escape") {
        if (ui.compose) return handle(() => void flushCompose());
        if (ui.search) return handle(() => ui.setSearch(""));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accounts, commands, openSettings]);
}
