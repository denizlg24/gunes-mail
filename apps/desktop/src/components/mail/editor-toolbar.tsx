import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  BaselineIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  RemoveFormattingIcon,
  UnderlineIcon,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FONT_FAMILIES, FONT_SIZES, TEXT_COLORS, imageToDataUrl } from "@/lib/editor";
import { shortcut } from "@/lib/format";
import { cn } from "@/lib/utils";

import { prompt } from "./dialog-host";

export function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-foreground [&_svg]:size-4",
              active && "bg-selected text-foreground hover:bg-selected-hover",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const menuTrigger =
  "inline-flex h-7 items-center gap-0.5 rounded-sm px-1 text-[12px] text-subtle hover:bg-hover hover:text-foreground data-popup-open:bg-hover";

export async function insertImages(editor: Editor, files: Iterable<File>) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const { src, width } = await imageToDataUrl(file);
      editor.chain().focus().setImage({ src, alt: file.name.replace(/\.[^.]+$/, ""), width }).run();
    } catch (e) {
      toast.error(`Couldn't add ${file.name}`, { description: e instanceof Error ? e.message : undefined });
    }
  }
}

/** Pasted screenshots become inline pictures instead of disappearing. */
export function handleImagePaste(editor: Editor | null, event: ClipboardEvent): boolean {
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (!editor || !files.length) return false;
  event.preventDefault();
  void insertImages(editor, files);
  return true;
}

export async function promptLink(editor: Editor) {
  const current = editor.getAttributes("link").href as string | undefined;
  const url = await prompt({ title: "Insert link", initial: current ?? "https://", confirmLabel: "Insert" });
  if (url === null) return;
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}

/**
 * Bold through pictures. `extended` adds font, size and color controls, which signatures
 * need and the compact compose toolbar keeps behind fewer buttons.
 */
export function FormattingButtons({ editor, extended = false }: { editor: Editor | null; extended?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      link: e?.isActive("link") ?? false,
      color: (e?.getAttributes("textStyle").color as string | undefined) ?? null,
      fontSize: (e?.getAttributes("textStyle").fontSize as string | undefined) ?? null,
      fontFamily: (e?.getAttributes("textStyle").fontFamily as string | undefined) ?? null,
    }),
  });
  const chain = () => editor?.chain().focus();

  return (
    <>
      {extended && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Font" className={cn(menuTrigger, "w-28 justify-between")}>
              <span className="truncate">
                {FONT_FAMILIES.find((f) => f.value === state?.fontFamily)?.label ?? "Default font"}
              </span>
              <ChevronDownIcon className="size-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => chain()?.unsetFontFamily().run()}>Default font</DropdownMenuItem>
              {FONT_FAMILIES.map((f) => (
                <DropdownMenuItem key={f.value} onClick={() => chain()?.setFontFamily(f.value).run()}>
                  <span style={{ fontFamily: f.value }}>{f.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Font size" className={cn(menuTrigger, "w-14 justify-between tabular-nums")}>
              {state?.fontSize?.replace("px", "") ?? "14"}
              <ChevronDownIcon className="size-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-20">
              {FONT_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => (size === "14px" ? chain()?.unsetFontSize().run() : chain()?.setFontSize(size).run())}
                >
                  {size.replace("px", "")}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <ToolButton label="Bold" active={state?.bold} onClick={() => chain()?.toggleBold().run()}>
        <BoldIcon />
      </ToolButton>
      <ToolButton label="Italic" active={state?.italic} onClick={() => chain()?.toggleItalic().run()}>
        <ItalicIcon />
      </ToolButton>
      <ToolButton label="Underline" active={state?.underline} onClick={() => chain()?.toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolButton>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                aria-label="Font color"
                onMouseDown={(e) => e.preventDefault()}
                className="inline-flex size-7 flex-col items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-foreground data-popup-open:bg-hover"
              />
            }
          >
            <BaselineIcon className="size-4" />
            <span className="-mt-0.5 h-[3px] w-3.5 rounded-full" style={{ background: state?.color ?? "currentColor" }} />
          </TooltipTrigger>
          <TooltipContent>Font color</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-auto p-2">
          <div className="grid grid-cols-5 gap-1.5">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onClick={() => chain()?.setColor(c.value).run()}
                className="flex size-6 items-center justify-center rounded-sm ring-offset-1 ring-offset-popover hover:ring-2 hover:ring-border"
                style={{ background: c.value }}
              >
                {state?.color === c.value && <CheckIcon className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => chain()?.unsetColor().run()}
            className="mt-2 w-full rounded-sm px-2 py-1 text-left text-[12px] hover:bg-hover"
          >
            Automatic
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton label="Bullets" active={state?.bullet} onClick={() => chain()?.toggleBulletList().run()}>
        <ListIcon />
      </ToolButton>
      <ToolButton label="Numbering" active={state?.ordered} onClick={() => chain()?.toggleOrderedList().run()}>
        <ListOrderedIcon />
      </ToolButton>
      <ToolButton label={`Link (${shortcut("Ctrl+K")})`} active={state?.link} onClick={() => editor && void promptLink(editor)}>
        <LinkIcon />
      </ToolButton>
      <ToolButton label="Insert picture" onClick={() => fileRef.current?.click()}>
        <ImageIcon />
      </ToolButton>
      <ToolButton label="Clear formatting" onClick={() => chain()?.unsetAllMarks().clearNodes().run()}>
        <RemoveFormattingIcon />
      </ToolButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          if (editor && e.target.files) void insertImages(editor, Array.from(e.target.files));
          e.target.value = "";
        }}
      />
    </>
  );
}
