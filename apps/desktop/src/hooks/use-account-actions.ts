"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { errorMessage, getApi } from "@/lib/api";
import type { Account, ImapAccountInput } from "@/lib/types";
import { useUi } from "@/store/ui";

import { keys } from "./use-mail";

const SIGN_IN_ABANDON_MS = 20_000;
const PROVIDER_NAMES = { google: "Google", microsoft: "Microsoft" } as const;

export function useAccountActions() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const opened = useCallback(
    async (accountId: string) => {
      await qc.invalidateQueries({ queryKey: ["session"] });
      const accounts = await qc.query({ queryKey: keys.accounts, queryFn: () => getApi().listAccounts(), staleTime: 0 });
      const account = accounts.find((a) => a.id === accountId);
      if (account) useUi.getState().openFolder(account.id, "INBOX");
      return account;
    },
    [qc],
  );

  const addAccount = useCallback(
    async (provider: "google" | "microsoft") => {
      const api = getApi();
      setAdding(true);
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        void api.cancelSignIn();
      };
      const id = toast.loading(`Continue signing in with ${PROVIDER_NAMES[provider]} in your browser…`, {
        description: "Closed the tab? Cancel and try again.",
        action: { label: "Cancel", onClick: cancel },
        duration: Infinity,
      });

      // Returning to the app without finishing usually means the browser tab was
      // closed; give a slow redirect a short grace period, then give up.
      let abandonTimer: ReturnType<typeof setTimeout> | undefined;
      const onFocus = () => {
        clearTimeout(abandonTimer);
        abandonTimer = setTimeout(cancel, SIGN_IN_ABANDON_MS);
      };
      const onBlur = () => clearTimeout(abandonTimer);
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);

      try {
        const account = await opened(await api.addOAuthAccount(provider));
        toast.success(account ? `Added ${account.email}` : "Account added", {
          id,
          description: "Your mail is syncing in the background.",
          action: undefined,
          duration: 4000,
        });
      } catch (e) {
        const message = errorMessage(e);
        const abandoned = cancelled || /cancelled|timed out/i.test(message);
        const notify = abandoned ? toast.info : toast.error;
        notify(abandoned ? "Sign-in wasn't completed" : "Couldn't add the account", {
          id,
          description: abandoned ? "No account was added." : message,
          action: undefined,
          duration: 5000,
        });
      } finally {
        clearTimeout(abandonTimer);
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
        setAdding(false);
      }
    },
    [opened],
  );

  const addImapAccount = useCallback(
    async (input: ImapAccountInput) => {
      setAdding(true);
      try {
        const account = await opened(await getApi().addImapAccount(input));
        toast.success(`Added ${account?.email ?? input.email}`, { description: "Your mail is syncing in the background." });
        return true;
      } catch (e) {
        toast.error("Couldn't add the account", { description: errorMessage(e) });
        return false;
      } finally {
        setAdding(false);
      }
    },
    [opened],
  );

  const removeAccount = useCallback(
    async (account: Account) => {
      try {
        await getApi().removeAccount(account.id);
        const accounts = await qc.query({ queryKey: keys.accounts, queryFn: () => getApi().listAccounts(), staleTime: 0 });
        qc.removeQueries({ queryKey: keys.threads(account.id) });
        qc.removeQueries({ queryKey: keys.labels(account.id) });
        const ui = useUi.getState();
        if (ui.accountId === account.id) {
          if (accounts[0]) ui.openFolder(accounts[0].id, "INBOX");
          else useUi.setState({ accountId: null, selectedIds: [], compose: null });
        }
        toast(`Removed ${account.email}`);
      } catch (e) {
        toast.error("Couldn't remove the account", { description: errorMessage(e) });
      }
    },
    [qc],
  );

  return { addAccount, addImapAccount, removeAccount, adding };
}
