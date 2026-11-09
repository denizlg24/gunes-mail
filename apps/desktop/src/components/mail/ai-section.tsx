import { Switch } from "@/components/ui/switch";
import { useAiCapabilities } from "@/hooks/use-mail";
import { useUi } from "@/store/ui";

import { TRIAGE_OPTIONS, TriageChip } from "./triage";

function Toggle({
  title,
  description,
  checked,
  onChange,
  unavailable,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  unavailable: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h4 className="text-[13px] font-semibold">{title}</h4>
          <p className="text-[12px] text-subtle">{description}</p>
          {unavailable && <p className="mt-1 text-[12px] text-flag">Not set up on this server yet.</p>}
        </div>
        <Switch checked={checked && !unavailable} disabled={unavailable} onCheckedChange={onChange} aria-label={title} />
      </div>
      {children}
    </section>
  );
}

export function AiSection() {
  const smartCategories = useUi((s) => s.smartCategories);
  const setSmartCategories = useUi((s) => s.setSmartCategories);
  const aiAssist = useUi((s) => s.aiAssist);
  const setAiAssist = useUi((s) => s.setAiAssist);
  const { data: ai } = useAiCapabilities();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[16px] font-semibold">AI features</h3>
        <p className="text-[13px] text-subtle">These settings follow you to every device.</p>
      </div>
      <Toggle
        title="Smart categories"
        description="Sorts recent Inbox mail into categories you can filter by. A small model on Güneş Mail's own servers does this; no third-party AI service sees it. Right-click a conversation to correct its category."
        checked={smartCategories}
        onChange={setSmartCategories}
        unavailable={ai ? !ai.classifier : false}
      >
        <div className="flex flex-wrap gap-1.5">
          {TRIAGE_OPTIONS.map((o) => (
            <TriageChip key={o.id} category={o.id} />
          ))}
        </div>
      </Toggle>
      <Toggle
        title="Summaries and drafting"
        description="Summarize long conversations and draft or rewrite messages. Only the conversation you ask about is sent to an AI model, and only when you ask."
        checked={aiAssist}
        onChange={setAiAssist}
        unavailable={ai ? !ai.assist : false}
      />
    </div>
  );
}
