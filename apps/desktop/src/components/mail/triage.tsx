import { TRIAGE_CATEGORIES } from "@gunes/shared";

import type { TriageCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

export const TRIAGE_META: Record<TriageCategory, { label: string; className: string; color: string }> = {
  "action-needed": {
    label: "Action needed",
    className: "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300",
    color: "#d13438",
  },
  scheduled: {
    label: "Scheduled",
    className: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    color: "#8764b8",
  },
  fyi: {
    label: "FYI",
    className: "bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
    color: "#0f6cbd",
  },
  purchases: {
    label: "Purchases",
    className: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    color: "#107c10",
  },
  newsletter: {
    label: "Newsletter",
    className: "bg-teal-500/10 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
    color: "#038387",
  },
  promo: {
    label: "Promotions",
    className: "bg-amber-500/12 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    color: "#ca5010",
  },
  spam: {
    label: "Likely junk",
    className: "bg-zinc-500/12 text-zinc-700 dark:bg-zinc-400/15 dark:text-zinc-300",
    color: "#7a7574",
  },
};

export const TRIAGE_OPTIONS = TRIAGE_CATEGORIES.map((id) => ({ id, ...TRIAGE_META[id] }));

/** FYI is most mail; tagging every such row in the list would drown out the useful tags. */
export function showInList(category: TriageCategory | null | undefined): category is TriageCategory {
  return !!category && category !== "fyi";
}

export function TriageChip({ category, className }: { category: TriageCategory; className?: string }) {
  const meta = TRIAGE_META[category];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-sm px-1.5 text-[11px] leading-none font-semibold",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function TriageDot({ category }: { category: TriageCategory }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: TRIAGE_META[category].color }} />;
}
