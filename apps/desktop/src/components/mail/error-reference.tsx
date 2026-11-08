import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { errorRef } from "@/lib/api";

/** Shows the support reference for a server failure with a one-click copy. */
export function ErrorReference({ error }: { error: unknown }) {
  const ref = errorRef(error);
  if (!ref) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(ref);
        toast("Reference copied", { description: "Include it when you contact support." });
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[12px] text-subtle hover:bg-hover hover:text-foreground"
      title="Copy reference"
    >
      Ref {ref}
      <CopyIcon className="size-3" />
    </button>
  );
}
