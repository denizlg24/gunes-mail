import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircleIcon, ClockIcon, PencilIcon, SendIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { errorMessage, getApi } from "@/lib/api";
import { displayName } from "@/lib/format";
import type { OutboxItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { SendingRules } from "./rules-section";

const UNDO_OPTIONS = [0, 5, 10, 20, 30];

export function useOutbox() {
  return useQuery({ queryKey: ["outbox"], queryFn: () => getApi().listOutbox(), refetchInterval: 60_000 });
}

export function OutboxList({ onEdit }: { onEdit?: () => void }) {
  const qc = useQueryClient();
  const { data: items = [] } = useOutbox();

  const act = async (item: OutboxItem, action: "cancel" | "now" | "edit") => {
    try {
      if (action === "now") {
        await getApi().sendOutboxNow(item.id);
        toast("Sending now…");
      } else {
        const { payload, accountId } = await getApi().cancelOutbox(item.id);
        if (action === "edit") {
          useUi.getState().setCompose({
            key: crypto.randomUUID(),
            accountId,
            mode: "draft",
            threadId: payload.threadId,
            draftId: payload.draftId,
            to: payload.to,
            cc: payload.cc,
            bcc: payload.bcc,
            subject: payload.subject,
            body: payload.html,
            inReplyTo: payload.inReplyTo,
            references: payload.references,
            attachments: payload.attachments,
          });
          onEdit?.();
        } else {
          toast("Scheduled message cancelled");
        }
      }
      await qc.invalidateQueries({ queryKey: ["outbox"] });
    } catch (e) {
      toast.error("Couldn't update the message", { description: errorMessage(e) });
    }
  };

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-6 text-center">
        <ClockIcon className="size-6 text-brand/70" />
        <div className="text-[13px] font-semibold">Nothing scheduled</div>
        <div className="text-[12px] text-subtle">Use the arrow next to Send to schedule a message.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-4 py-3">
          {item.status === "failed" ? (
            <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
          ) : (
            <ClockIcon className="size-5 shrink-0 text-brand" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{item.subject || "(no subject)"}</div>
            <div className="truncate text-[12px] text-subtle">
              To {item.to.map(displayName).join(", ") || "(no recipients)"} ·{" "}
              <span className={cn(item.status === "failed" && "text-destructive")}>
                {item.status === "failed" ? `Failed: ${item.error ?? "unknown error"}` : format(item.sendAt, "EEE d MMM, HH:mm")}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void act(item, "now")}>
            <SendIcon />
            {item.status === "failed" ? "Retry" : "Send now"}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit" onClick={() => void act(item, "edit")}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Cancel" title="Cancel" onClick={() => void act(item, "cancel")}>
            <XIcon />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function SendingSection({ onEdit }: { onEdit: () => void }) {
  const undoSendSeconds = useUi((s) => s.undoSendSeconds);
  const setUndoSendSeconds = useUi((s) => s.setUndoSendSeconds);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[16px] font-semibold">Sending</h3>
        <p className="text-[13px] text-subtle">Scheduled and delayed mail is sent by the server, even while this app is closed.</p>
      </div>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Undo send</h4>
        <p className="text-[12px] text-subtle">How long you have to cancel a message after pressing Send.</p>
        <div role="radiogroup" className="inline-flex w-fit rounded-md border border-border bg-app/50 p-0.5">
          {UNDO_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={undoSendSeconds === s}
              onClick={() => setUndoSendSeconds(s)}
              className={cn(
                "h-7 rounded-sm px-3 text-[13px] transition-colors",
                undoSendSeconds === s ? "bg-pane font-semibold shadow-sm" : "text-subtle hover:text-foreground",
              )}
            >
              {s === 0 ? "Off" : `${s} s`}
            </button>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Scheduled</h4>
        <OutboxList onEdit={onEdit} />
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Sending rules</h4>
        <SendingRules />
      </section>
    </div>
  );
}
