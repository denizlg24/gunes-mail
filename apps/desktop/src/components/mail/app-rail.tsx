import { MailIcon, PlusIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccountActions } from "@/hooks/use-account-actions";
import { useAddAccountDialog } from "./add-account-dialog";
import { useAccounts, useLabels } from "@/hooks/use-mail";
import { cn } from "@/lib/utils";
import type { Account } from "@/lib/types";
import { useUi } from "@/store/ui";

import { PersonAvatar } from "./person-avatar";

function RailAccount({ account, index, active }: { account: Account; index: number; active: boolean }) {
  const switchAccount = useUi((s) => s.switchAccount);
  const { data: labels } = useLabels(account.id);
  const unread = labels?.find((l) => l.id === "INBOX")?.unread ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Switch to ${account.email}`}
            aria-pressed={active}
            onClick={() => switchAccount(account.id)}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-md transition-colors hover:bg-hover",
              active && "bg-pane shadow-sm",
            )}
          />
        }
      >
        {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-brand" />}
        <PersonAvatar name={account.name} email={account.email} picture={account.picture} size={28} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-brand-strong px-1 text-center text-[10px] leading-4 font-semibold text-white ring-2 ring-app">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">
        <div className="flex flex-col">
          <span className="font-medium">{account.name}</span>
          <span className="text-muted-foreground">{account.email}</span>
          {index < 9 && <span className="mt-1 text-muted-foreground">Alt+{index + 1}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppRail() {
  const { data: accounts = [] } = useAccounts();
  const accountId = useUi((s) => s.accountId);
  const { adding } = useAccountActions();

  return (
    <nav aria-label="Apps and accounts" className="flex w-14 shrink-0 flex-col items-center gap-1 py-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Mail"
              aria-current="page"
              className="relative flex size-10 items-center justify-center rounded-md bg-brand-soft text-brand"
            />
          }
        >
          <MailIcon className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">Mail</TooltipContent>
      </Tooltip>
      <div className="my-1.5 h-px w-7 bg-border" />
      {accounts.map((a, i) => (
        <RailAccount key={a.id} account={a} index={i} active={a.id === accountId} />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Add account"
              disabled={adding}
              onClick={() => useAddAccountDialog.getState().setOpen(true)}
              className="flex size-10 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
            />
          }
        >
          <PlusIcon className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">Add Google account</TooltipContent>
      </Tooltip>
    </nav>
  );
}
