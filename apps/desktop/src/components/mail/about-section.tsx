import { formatDistanceToNow } from "date-fns";
import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUpdates } from "@/hooks/use-updater";
import { getApi } from "@/lib/api";

const REPO = "https://github.com/denizlg24/gunes-mail";

function formatBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function StatusLine() {
  const status = useUpdates((s) => s.status);
  switch (status.kind) {
    case "idle":
      return <>Updates install automatically in the background.</>;
    case "checking":
      return <>Checking for updates…</>;
    case "current":
      return <>You’re up to date. Checked {formatDistanceToNow(status.checkedAt, { addSuffix: true })}.</>;
    case "downloading": {
      const pct = status.total ? Math.min(100, Math.round((status.received / status.total) * 100)) : null;
      return (
        <span className="flex flex-col gap-2">
          <span>
            Downloading version {status.version}
            {pct !== null ? ` · ${pct}%` : ` · ${formatBytes(status.received)}`}
          </span>
          <span className="h-1.5 w-64 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-brand transition-[width]" style={{ width: `${pct ?? 30}%` }} />
          </span>
        </span>
      );
    }
    case "ready":
      return <>Version {status.version} is installed. Restart Güneş Mail to start using it.</>;
    case "error":
      return <span className="text-destructive">Couldn’t check for updates: {status.message}</span>;
  }
}

export function AboutSection() {
  const currentVersion = useUpdates((s) => s.currentVersion);
  const status = useUpdates((s) => s.status);
  const check = useUpdates((s) => s.check);
  const restart = useUpdates((s) => s.restart);
  const busy = status.kind === "checking" || status.kind === "downloading";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon.png" alt="" className="size-16" />
        <div>
          <h3 className="text-[16px] font-semibold">Güneş Mail</h3>
          <p className="text-[13px] text-subtle">Version {currentVersion ?? "—"}</p>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h4 className="text-[13px] font-semibold">Updates</h4>
        <p className="text-[13px] text-subtle">
          <StatusLine />
        </p>
        <div className="flex gap-2">
          {status.kind === "ready" ? (
            <Button size="sm" onClick={() => void restart()}>
              <RotateCwIcon />
              Restart to update
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void check({ manual: true })}>
              {status.kind === "downloading" ? <DownloadIcon /> : <RefreshCwIcon className={busy ? "animate-spin" : undefined} />}
              Check for updates
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void getApi().openExternal(`${REPO}/releases`)}>
            Release notes
            <ExternalLinkIcon />
          </Button>
        </div>
      </section>
    </div>
  );
}
