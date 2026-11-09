"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { keys, moveOps } from "@/hooks/use-mail";
import { errorMessage, getApi } from "@/lib/api";
import { ARCHIVE, folderName } from "@/lib/folders";
import { displayName } from "@/lib/format";
import type { Account, Label, Mailbox, Rule, ThreadSummary } from "@/lib/types";

const NOT_RULE_TARGETS = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"]);

interface Suggestion {
  accountId: string;
  sender: Mailbox;
  source: string;
  target: string;
  targetName: string;
  /** Conversations from the sender still sitting in `source`. */
  remaining: number;
}

const useSuggestion = create<{ open: Suggestion | null }>()(() => ({ open: null }));

/** Asked once per sender and folder for the life of the app, like Outlook. */
const offered = new Set<string>();

/** The one outside sender the moved conversations have in common, if there is exactly one. */
export function commonSender(threads: ThreadSummary[], ownEmail: string): Mailbox | null {
  const own = ownEmail.toLowerCase();
  let sender: Mailbox | null = null;
  for (const t of threads) {
    const theirs = [...t.senders].reverse().find((s) => s.email.toLowerCase() !== own);
    if (!theirs) return null;
    if (sender && sender.email.toLowerCase() !== theirs.email.toLowerCase()) return null;
    sender = theirs;
  }
  return sender;
}

function hasRule(rules: Rule[], sender: string, target: string): boolean {
  return rules.some(
    (r) =>
      r.kind === "incoming" &&
      r.conditions.some((c) => c.field === "from" && c.value.toLowerCase() === sender) &&
      r.actions.some((a) => (a.type === "move" && a.folder === target) || (a.type === "archive" && target === ARCHIVE)),
  );
}

/**
 * After a move out of the Inbox, offers to keep doing it automatically for that sender
 * and to sweep up the rest of their mail that is still there.
 */
export async function suggestRuleAfterMove(
  qc: QueryClient,
  input: { accountId: string; threads: ThreadSummary[]; source: string; target: string; labels?: Label[] },
) {
  const { accountId, threads, source, target, labels } = input;
  if (source !== "INBOX" || NOT_RULE_TARGETS.has(target) || !threads.length) return;
  const account = qc.getQueryData<Account[]>(keys.accounts)?.find((a) => a.id === accountId);
  const sender = account ? commonSender(threads, account.email) : null;
  if (!sender) return;
  const key = `${accountId}|${sender.email.toLowerCase()}|${target}`;
  if (offered.has(key)) return;
  offered.add(key);

  try {
    const rules = await qc.query({ queryKey: ["rules"], queryFn: () => getApi().listRules(), staleTime: 60_000 });
    if (hasRule(rules, sender.email.toLowerCase(), target)) return;
    const ops = moveOps(source, target);
    const remaining = await getApi().moveMatching(accountId, {
      sender: sender.email,
      source,
      add: ops.add,
      remove: ops.remove,
      dryRun: true,
    });
    const targetName = target === ARCHIVE ? "Archive" : folderName(target, labels);
    toast(`Always move messages from ${displayName(sender)} to ${targetName}?`, {
      description: remaining
        ? `${remaining} more conversation${remaining === 1 ? "" : "s"} from this sender ${remaining === 1 ? "is" : "are"} still in your Inbox.`
        : undefined,
      duration: 12_000,
      action: {
        label: "Create rule",
        onClick: () => useSuggestion.setState({ open: { accountId, sender, source, target, targetName, remaining } }),
      },
    });
  } catch {
    // A suggestion is a nicety; the move itself already succeeded.
  }
}

export function RuleSuggestionDialog() {
  const qc = useQueryClient();
  const suggestion = useSuggestion((s) => s.open);
  const [moveExisting, setMoveExisting] = useState(true);
  const [saving, setSaving] = useState(false);
  const close = () => {
    useSuggestion.setState({ open: null });
    setMoveExisting(true);
  };

  const create = async () => {
    if (!suggestion) return;
    const { accountId, sender, source, target, targetName, remaining } = suggestion;
    setSaving(true);
    try {
      const api = getApi();
      await api.createRule({
        name: `Move mail from ${displayName(sender)} to ${targetName}`,
        kind: "incoming",
        accountId,
        enabled: true,
        match: "all",
        conditions: [{ field: "from", operator: "equals", value: sender.email.toLowerCase() }],
        actions: target === ARCHIVE ? [{ type: "archive" }] : [{ type: "move", folder: target }],
        stopProcessing: false,
      });
      let moved = 0;
      if (moveExisting && remaining > 0) {
        const ops = moveOps(source, target);
        moved = await api.moveMatching(accountId, { sender: sender.email, source, add: ops.add, remove: ops.remove });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rules"] }),
        qc.invalidateQueries({ queryKey: keys.threads(accountId) }),
        qc.invalidateQueries({ queryKey: keys.labels(accountId) }),
      ]);
      toast.success("Rule created", {
        description: moved ? `Moved ${moved} conversation${moved === 1 ? "" : "s"} to ${targetName}.` : undefined,
      });
      close();
    } catch (e) {
      toast.error("Couldn't create the rule", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {suggestion && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Create a rule</DialogTitle>
              <DialogDescription>
                New messages from <span className="font-semibold text-foreground">{displayName(suggestion.sender)}</span>{" "}
                <span className="text-subtle">&lt;{suggestion.sender.email}&gt;</span> will be moved to{" "}
                <span className="font-semibold text-foreground">{suggestion.targetName}</span>. You can change this
                later in Settings → Rules.
              </DialogDescription>
            </DialogHeader>
            {suggestion.remaining > 0 && (
              <label className="flex items-start gap-2.5 text-[13px]">
                <Checkbox checked={moveExisting} onCheckedChange={(v) => setMoveExisting(v === true)} className="mt-0.5" />
                <span>
                  Also move the {suggestion.remaining} conversation{suggestion.remaining === 1 ? "" : "s"} from this
                  sender already in your Inbox
                </span>
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void create()} disabled={saving}>
                {saving && <Loader2Icon className="animate-spin" />}
                Create rule
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
