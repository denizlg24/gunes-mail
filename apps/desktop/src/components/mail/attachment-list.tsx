import {
  DownloadIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderOpenIcon,
  EyeIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { errorMessage, getApi } from "@/lib/api";
import { fileSize } from "@/lib/format";
import type { Attachment } from "@/lib/types";

import { AttachmentPreview } from "./attachment-preview";

function iconFor(mime: string, name: string) {
  if (mime.startsWith("image/")) return { Icon: FileImageIcon, color: "#8764B8" };
  if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|csv)$/i.test(name)) return { Icon: FileSpreadsheetIcon, color: "#107C41" };
  if (/zip|compressed|tar/.test(mime)) return { Icon: FileArchiveIcon, color: "#986F0B" };
  if (/pdf/.test(mime)) return { Icon: FileTextIcon, color: "#D13438" };
  if (/word|document|text/.test(mime)) return { Icon: FileTextIcon, color: "#185ABD" };
  return { Icon: FileIcon, color: "#616161" };
}

export function AttachmentList({
  accountId,
  messageId,
  attachments,
}: {
  accountId: string;
  messageId: string;
  attachments: Attachment[];
}) {
  const visible = attachments.filter((a) => !a.inline);
  const [previewing, setPreviewing] = useState<number | null>(null);
  if (!visible.length) return null;

  const save = async (a: Attachment, open: boolean) => {
    const id = toast.loading(open ? `Opening ${a.filename}…` : `Downloading ${a.filename}…`);
    try {
      const path = await getApi().saveAttachment(accountId, messageId, a, open);
      toast.success(open ? `Opened ${a.filename}` : "Saved to Downloads", { id, description: open ? undefined : path });
    } catch (e) {
      toast.error(`Couldn't save ${a.filename}`, { id, description: errorMessage(e) });
    }
  };

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {visible.map((a, i) => {
        const { Icon, color } = iconFor(a.mimeType, a.filename);
        return (
          <ContextMenu key={`${a.filename}-${i}`}>
            <ContextMenuTrigger
              render={
                <button
                  type="button"
                  title={a.filename}
                  onClick={() => setPreviewing(i)}
                  className="group/att flex h-12 w-56 items-center gap-2.5 rounded-md border border-border bg-pane px-2.5 text-left transition-colors hover:border-input hover:bg-hover"
                />
              }
            >
              <Icon className="size-6 shrink-0" style={{ color }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{a.filename}</span>
                <span className="text-[11px] text-subtle">{fileSize(a.size)}</span>
              </span>
              <span
                role="button"
                aria-label="Download"
                onClick={(e) => {
                  e.stopPropagation();
                  void save(a, false);
                }}
                className="invisible inline-flex size-7 items-center justify-center rounded-sm text-subtle group-hover/att:visible hover:bg-foreground/10 hover:text-foreground"
              >
                <DownloadIcon className="size-4" />
              </span>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => setPreviewing(i)}>
                <EyeIcon />
                Preview
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void save(a, true)}>
                <ExternalLinkIcon />
                Open with default app
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void save(a, false)}>
                <FolderOpenIcon />
                Download and show in folder
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      {previewing !== null && visible[previewing] && (
        <AttachmentPreview
          accountId={accountId}
          messageId={messageId}
          attachments={visible}
          index={previewing}
          onIndexChange={setPreviewing}
          onClose={() => setPreviewing(null)}
          onSave={(a, open) => void save(a, open)}
        />
      )}
    </div>
  );
}
