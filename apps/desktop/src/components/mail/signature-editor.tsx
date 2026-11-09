import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import { signatureBody } from "@/lib/compose";
import { richTextExtensions } from "@/lib/editor";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { FormattingButtons, handleImagePaste } from "./editor-toolbar";

/** Leaves headroom under the server's 400 000 character limit for settings. */
const MAX_SIGNATURE_CHARS = 380_000;

export function SignatureEditor() {
  const setSignature = useUi((s) => s.setSignature);
  const editorRef = useRef<Editor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tooLarge, setTooLarge] = useState(false);

  const save = (editor: Editor) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const html = editor.isEmpty ? "" : editor.getHTML();
      const over = html.length > MAX_SIGNATURE_CHARS;
      setTooLarge(over);
      if (!over) setSignature(html);
    }, 400);
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: richTextExtensions("Best regards,\nYour name"),
    content: signatureBody(useUi.getState().signature),
    editorProps: {
      attributes: { class: "selectable text-[14px]", spellcheck: "true", "aria-label": "Signature" },
      handlePaste: (_view, event) => handleImagePaste(editorRef.current, event),
    },
    onCreate: ({ editor: e }) => {
      editorRef.current = e;
    },
    onUpdate: ({ editor: e }) => save(e),
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "overflow-hidden rounded-md border bg-pane focus-within:border-brand",
          tooLarge ? "border-destructive" : "border-input",
        )}
      >
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-app/40 px-1.5 py-1">
          <FormattingButtons editor={editor} extended />
        </div>
        <div
          className="compose-editor cursor-text px-3 py-2 [&_.ProseMirror]:min-h-24"
          onClick={() => editor?.commands.focus()}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {tooLarge && (
        <p className="text-[12px] text-destructive">
          This signature is too large to save. Use smaller or fewer pictures.
        </p>
      )}
    </div>
  );
}
