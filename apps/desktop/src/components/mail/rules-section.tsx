import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FilterIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAccounts, useLabels } from "@/hooks/use-mail";
import { errorMessage, getApi } from "@/lib/api";
import { SYSTEM_FOLDERS, leafName } from "@/lib/folders";
import type { Rule, RuleAction, RuleCondition, RuleInput } from "@/lib/types";
import { cn } from "@/lib/utils";

import { confirmDialog } from "./dialog-host";

const FIELDS: { value: RuleCondition["field"]; label: string }[] = [
  { value: "from", label: "From" },
  { value: "to", label: "To" },
  { value: "cc", label: "Cc" },
  { value: "subject", label: "Subject" },
  { value: "body", label: "Message body" },
  { value: "sender_domain", label: "Sender domain" },
  { value: "recipient_domain", label: "Recipient domain" },
  { value: "has_attachment", label: "Has attachment" },
];

const OPERATORS: { value: RuleCondition["operator"]; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "equals", label: "is" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches", label: "matches pattern" },
];

const INCOMING_ACTIONS: { value: RuleAction["type"]; label: string }[] = [
  { value: "move", label: "Move to folder" },
  { value: "label", label: "Categorize" },
  { value: "mark_read", label: "Mark as read" },
  { value: "flag", label: "Flag" },
  { value: "archive", label: "Archive" },
  { value: "focus", label: "Put in Focused / Other" },
  { value: "mark_spam", label: "Move to Junk" },
  { value: "delete", label: "Delete" },
];

const OUTGOING_ACTIONS: { value: RuleAction["type"]; label: string }[] = [
  { value: "delay_send", label: "Delay delivery by" },
  { value: "add_bcc", label: "Bcc a copy to" },
];

function Choice<T extends string>({
  value,
  onChange,
  options,
  className,
  placeholder,
}: {
  value: T | undefined;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select
      value={value ?? null}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      onValueChange={(v) => v !== null && onChange(v)}
    >
      <SelectTrigger size="sm" className={cn("min-w-32 text-[13px]", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[13px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function defaultAction(type: RuleAction["type"]): RuleAction {
  switch (type) {
    case "move":
      return { type, folder: "ARCHIVE" };
    case "label":
      return { type, labelId: "" };
    case "focus":
      return { type, category: "other" };
    case "delay_send":
      return { type, minutes: 2 };
    case "add_bcc":
      return { type, email: "" };
    default:
      return { type };
  }
}

function describeAction(a: RuleAction, folderName: (id: string) => string): string {
  switch (a.type) {
    case "move":
      return `move to ${folderName(a.folder)}`;
    case "label":
      return `categorize as ${folderName(a.labelId)}`;
    case "mark_read":
      return "mark as read";
    case "flag":
      return "flag";
    case "archive":
      return "archive";
    case "delete":
      return "delete";
    case "mark_spam":
      return "move to Junk";
    case "focus":
      return `put in ${a.category === "focused" ? "Focused" : "Other"}`;
    case "delay_send":
      return `delay delivery ${a.minutes} min`;
    case "add_bcc":
      return `Bcc ${a.email}`;
  }
}

function describeRule(rule: Rule, folderName: (id: string) => string): string {
  const conditions = rule.conditions.length
    ? rule.conditions
        .map((c) =>
          c.field === "has_attachment"
            ? "it has an attachment"
            : `${FIELDS.find((f) => f.value === c.field)?.label.toLowerCase()} ${OPERATORS.find((o) => o.value === c.operator)?.label} "${c.value}"`,
        )
        .join(rule.match === "all" ? " and " : " or ")
    : rule.kind === "incoming"
      ? "any message arrives"
      : "I send any message";
  return `When ${conditions}: ${rule.actions.map((a) => describeAction(a, folderName)).join(", ")}`;
}

function RuleEditor({ rule, onClose }: { rule: Rule | Partial<RuleInput> & { kind: Rule["kind"] }; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [draft, setDraft] = useState<RuleInput>({
    name: rule.name ?? "",
    kind: rule.kind,
    accountId: rule.accountId ?? null,
    enabled: rule.enabled ?? true,
    match: rule.match ?? "all",
    conditions: rule.conditions ?? [{ field: "from", operator: "contains", value: "" }],
    actions: rule.actions ?? [defaultAction(rule.kind === "incoming" ? "move" : "delay_send")],
    stopProcessing: rule.stopProcessing ?? false,
  });
  const [saving, setSaving] = useState(false);
  const { data: labels = [] } = useLabels(draft.accountId);
  const userLabels = labels.filter((l) => l.type === "user");
  const folderOptions = [
    ...SYSTEM_FOLDERS.filter((f) => !["DRAFT", "SENT", "STARRED"].includes(f.id)).map((f) => ({ value: f.id, label: f.name })),
    ...userLabels.map((l) => ({ value: l.id, label: l.name })),
  ];
  const actionTypes = draft.kind === "incoming" ? INCOMING_ACTIONS : OUTGOING_ACTIONS;

  const patchCondition = (i: number, patch: Partial<RuleCondition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const patchAction = (i: number, next: RuleAction) =>
    setDraft((d) => ({ ...d, actions: d.actions.map((a, j) => (j === i ? next : a)) }));

  const incomplete =
    !draft.name.trim() ||
    draft.conditions.some((c) => c.field !== "has_attachment" && !c.value.trim()) ||
    draft.actions.some(
      (a) => (a.type === "label" && !a.labelId) || (a.type === "add_bcc" && !/\S+@\S+\.\S+/.test(a.email)),
    );

  const save = async () => {
    setSaving(true);
    try {
      const api = getApi();
      if ("id" in rule && rule.id) await api.updateRule(rule.id, draft);
      else await api.createRule(draft);
      await qc.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    } catch (e) {
      toast.error("Couldn't save the rule", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{"id" in rule ? "Edit rule" : draft.kind === "incoming" ? "New rule" : "New sending rule"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                autoFocus
                value={draft.name}
                placeholder={draft.kind === "incoming" ? "Newsletters to Other" : "Delay everything 2 minutes"}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Applies to</Label>
              <Choice
                value={draft.accountId ?? "all"}
                onChange={(v) => setDraft((d) => ({ ...d, accountId: v === "all" ? null : v }))}
                options={[{ value: "all", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.email }))]}
                className="w-56"
              />
            </div>
          </div>

          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              When
              <Choice
                value={draft.match}
                onChange={(match) => setDraft((d) => ({ ...d, match }))}
                options={[
                  { value: "all", label: "all conditions match" },
                  { value: "any", label: "any condition matches" },
                ]}
                className="min-w-0"
              />
            </div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Choice value={c.field} onChange={(field) => patchCondition(i, { field })} options={FIELDS} className="w-40" />
                {c.field === "has_attachment" ? (
                  <span className="flex-1 text-[13px] text-subtle">The message has one or more files attached</span>
                ) : (
                  <>
                    <Choice value={c.operator} onChange={(operator) => patchCondition(i, { operator })} options={OPERATORS} className="w-40" />
                    <Input
                      aria-label="Value"
                      value={c.value}
                      placeholder={c.operator === "matches" ? "regular expression" : "text"}
                      onChange={(e) => patchCondition(i, { value: e.target.value })}
                      className="h-7 flex-1 text-[13px]"
                    />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove condition"
                  onClick={() => setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, j) => j !== i) }))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({ ...d, conditions: [...d.conditions, { field: "subject", operator: "contains", value: "" }] }))
              }
              className="inline-flex w-fit items-center gap-1 text-[13px] text-brand hover:underline"
            >
              <PlusIcon className="size-3.5" />
              Add a condition
            </button>
            {!draft.conditions.length && (
              <p className="text-[12px] text-subtle">
                No conditions: this rule applies to every {draft.kind === "incoming" ? "incoming" : "outgoing"} message.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[13px] font-semibold">Then</div>
            {draft.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <Choice value={a.type} onChange={(type) => patchAction(i, defaultAction(type))} options={actionTypes} className="w-52" />
                {a.type === "move" && (
                  <Choice value={a.folder} onChange={(folder) => patchAction(i, { type: "move", folder })} options={folderOptions} className="flex-1" />
                )}
                {a.type === "label" &&
                  (draft.accountId ? (
                    <Choice
                      value={a.labelId || undefined}
                      placeholder="Choose a category"
                      onChange={(labelId) => patchAction(i, { type: "label", labelId })}
                      options={userLabels.map((l) => ({ value: l.id, label: leafName(l.name) }))}
                      className="flex-1"
                    />
                  ) : (
                    <span className="flex-1 text-[12px] text-subtle">Pick an account above to choose a category</span>
                  ))}
                {a.type === "focus" && (
                  <Choice
                    value={a.category}
                    onChange={(category) => patchAction(i, { type: "focus", category })}
                    options={[
                      { value: "focused", label: "Focused" },
                      { value: "other", label: "Other" },
                    ]}
                    className="flex-1"
                  />
                )}
                {a.type === "delay_send" && (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      aria-label="Minutes"
                      inputMode="numeric"
                      value={String(a.minutes)}
                      onChange={(e) => patchAction(i, { type: "delay_send", minutes: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })}
                      className="h-7 w-20 text-[13px]"
                    />
                    <span className="text-[13px] text-subtle">minutes</span>
                  </div>
                )}
                {a.type === "add_bcc" && (
                  <Input
                    aria-label="Email"
                    type="email"
                    value={a.email}
                    placeholder="archive@example.com"
                    onChange={(e) => patchAction(i, { type: "add_bcc", email: e.target.value })}
                    className="h-7 flex-1 text-[13px]"
                  />
                )}
                {!["move", "label", "focus", "delay_send", "add_bcc"].includes(a.type) && <span className="flex-1" />}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove action"
                  disabled={draft.actions.length === 1}
                  onClick={() => setDraft((d) => ({ ...d, actions: d.actions.filter((_, j) => j !== i) }))}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({ ...d, actions: [...d.actions, defaultAction(d.kind === "incoming" ? "mark_read" : "add_bcc")] }))
              }
              className="inline-flex w-fit items-center gap-1 text-[13px] text-brand hover:underline"
            >
              <PlusIcon className="size-3.5" />
              Add an action
            </button>
          </section>

          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox
              checked={draft.stopProcessing}
              onCheckedChange={(stopProcessing) => setDraft((d) => ({ ...d, stopProcessing }))}
            />
            Stop processing more rules
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={incomplete || saving} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleList({ kind }: { kind: Rule["kind"] }) {
  const qc = useQueryClient();
  const { data: rules = [] } = useQuery({ queryKey: ["rules"], queryFn: () => getApi().listRules() });
  const { data: accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<Rule | { kind: Rule["kind"] } | null>(null);
  const list = rules.filter((r) => r.kind === kind).sort((a, b) => a.position - b.position);
  const folderName = (id: string) => SYSTEM_FOLDERS.find((f) => f.id === id)?.name ?? leafName(id.replace(/^(folder|mailbox|category):/, ""));

  const refresh = () => qc.invalidateQueries({ queryKey: ["rules"] });

  const toggle = async (rule: Rule, enabled: boolean) => {
    await getApi().updateRule(rule.id, {
      name: rule.name,
      kind: rule.kind,
      accountId: rule.accountId,
      enabled,
      match: rule.match,
      conditions: rule.conditions,
      actions: rule.actions,
      stopProcessing: rule.stopProcessing,
    });
    await refresh();
  };

  const move = async (index: number, delta: number) => {
    const ids = list.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    await getApi().reorderRules(ids);
    await refresh();
  };

  const run = async (rule: Rule) => {
    const id = toast.loading(`Running "${rule.name}" on your inbox…`);
    try {
      const processed = await getApi().runRule(rule.id);
      toast.success(`"${rule.name}" checked ${processed} messages`, { id });
    } catch (e) {
      toast.error("Couldn't run the rule", { id, description: errorMessage(e) });
    }
  };

  const remove = async (rule: Rule) => {
    const ok = await confirmDialog({ title: `Delete "${rule.name}"?`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    await getApi().deleteRule(rule.id);
    await refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {list.map((rule, i) => (
          <div key={rule.id} className="group flex items-center gap-3 px-4 py-3">
            <Switch checked={rule.enabled} onCheckedChange={(on) => void toggle(rule, on)} aria-label={`Enable ${rule.name}`} />
            <div className={cn("min-w-0 flex-1", !rule.enabled && "opacity-60")}>
              <div className="truncate text-[14px] font-semibold">{rule.name}</div>
              <div className="line-clamp-2 text-[12px] text-subtle">{describeRule(rule, folderName)}</div>
              {rule.accountId && (
                <div className="mt-0.5 text-[11px] text-subtle">{accounts.find((a) => a.id === rule.accountId)?.email}</div>
              )}
            </div>
            <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => void move(i, -1)}>
                <ArrowUpIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === list.length - 1} onClick={() => void move(i, 1)}>
                <ArrowDownIcon />
              </Button>
              {kind === "incoming" && (
                <Button variant="ghost" size="icon-sm" aria-label="Run now on inbox" title="Run now on inbox" onClick={() => void run(rule)}>
                  <PlayIcon />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(rule)}>
                <PencilIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => void remove(rule)}>
                <Trash2Icon />
              </Button>
            </div>
          </div>
        ))}
        {!list.length && (
          <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
            {kind === "incoming" ? <FilterIcon className="size-6 text-brand/70" /> : <SendIcon className="size-6 text-brand/70" />}
            <div className="text-[13px] font-semibold">No {kind === "incoming" ? "rules" : "sending rules"} yet</div>
            <div className="text-[12px] text-subtle">
              {kind === "incoming"
                ? "Rules sort, flag or file new mail as it arrives, even while this app is closed."
                : "Sending rules can hold outgoing mail for a few minutes or Bcc a copy."}
            </div>
          </div>
        )}
      </div>
      <div>
        <Button onClick={() => setEditing({ kind })}>
          <PlusIcon />
          {kind === "incoming" ? "Add rule" : "Add sending rule"}
        </Button>
      </div>
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function RulesSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[16px] font-semibold">Rules</h3>
        <p className="text-[13px] text-subtle">Rules run on the server, top to bottom, as new mail arrives.</p>
      </div>
      <RuleList kind="incoming" />
    </div>
  );
}

export function SendingRules() {
  return <RuleList kind="outgoing" />;
}
