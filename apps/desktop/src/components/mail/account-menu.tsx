import { CheckIcon, PlusIcon, SettingsIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountActions } from "@/hooks/use-account-actions";
import { useAddAccountDialog } from "./add-account-dialog";
import { useAccounts } from "@/hooks/use-mail";
import { useUi } from "@/store/ui";

import { PersonAvatar } from "./person-avatar";

export function AccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const accountId = useUi((s) => s.accountId);
  const switchAccount = useUi((s) => s.switchAccount);
  const { adding } = useAccountActions();
  const active = accounts.find((a) => a.id === accountId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Accounts"
        className="ml-1 inline-flex size-9 items-center justify-center rounded-md hover:bg-white/15 data-popup-open:bg-white/25"
      >
        {active ? (
          <PersonAvatar name={active.name} email={active.email} picture={active.picture} size={28} className="ring-2 ring-white/40" />
        ) : (
          <span className="size-7 rounded-full bg-white/30" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Accounts</DropdownMenuLabel>
          {accounts.map((a, i) => (
            <DropdownMenuItem key={a.id} onClick={() => switchAccount(a.id)} className="gap-3 py-2">
              <PersonAvatar name={a.name} email={a.email} picture={a.picture} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{a.name}</span>
                <span className="truncate text-xs text-muted-foreground">{a.email}</span>
              </span>
              {a.id === accountId ? (
                <CheckIcon className="text-brand" />
              ) : (
                i < 9 && <span className="text-xs text-muted-foreground">Alt+{i + 1}</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={adding} onClick={() => useAddAccountDialog.getState().setOpen(true)}>
          <PlusIcon />
          Add Google account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenSettings}>
          <SettingsIcon />
          Manage accounts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
