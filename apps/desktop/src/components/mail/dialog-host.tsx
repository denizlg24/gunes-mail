import { useRef } from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface PromptRequest {
  kind: "prompt";
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  inputType?: "text" | "datetime-local";
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

interface ConfirmRequest {
  kind: "confirm";
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (value: boolean) => void;
}

type Request = PromptRequest | ConfirmRequest;

const useDialogs = create<{ request: Request | null; value: string }>()(() => ({ request: null, value: "" }));

export function prompt(options: Omit<PromptRequest, "kind" | "resolve">): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.setState({ request: { kind: "prompt", ...options, resolve }, value: options.initial ?? "" }),
  );
}

export function confirmDialog(options: Omit<ConfirmRequest, "kind" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => useDialogs.setState({ request: { kind: "confirm", ...options, resolve } }));
}

export function DialogHost() {
  const request = useDialogs((s) => s.request);
  const value = useDialogs((s) => s.value);
  const setValue = (v: string) => useDialogs.setState({ value: v });
  const inputRef = useRef<HTMLInputElement>(null);

  const close = (result: boolean) => {
    if (!request) return;
    if (request.kind === "prompt") request.resolve(result && value.trim() ? value.trim() : null);
    else request.resolve(result);
    useDialogs.setState({ request: null });
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} initialFocus={inputRef}>
        {request && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              {request.description && <DialogDescription>{request.description}</DialogDescription>}
            </DialogHeader>
            {request.kind === "prompt" && (
              <Input
                ref={inputRef}
                value={value}
                type={request.inputType ?? "text"}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={request.kind === "confirm" && request.destructive ? "destructive" : "default"}
                disabled={request.kind === "prompt" && !value.trim()}
              >
                {request.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
