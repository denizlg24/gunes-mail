import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon, Loader2Icon, MailIcon, ServerIcon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAccountActions } from "@/hooks/use-account-actions";
import { getApi } from "@/lib/api";
import type { ImapPreset, ImapServer } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AddAccountDialogState {
  open: boolean;
  imap: { preset: ImapPreset | null } | null;
  setOpen: (open: boolean) => void;
  openImap: (preset: ImapPreset | null) => void;
}

export const useAddAccountDialog = create<AddAccountDialogState>()((set) => ({
  open: false,
  imap: null,
  setOpen: (open) => set(open ? { open } : { open, imap: null }),
  openImap: (preset) => set({ open: true, imap: { preset } }),
}));

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-5", className)} aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={cn("size-5", className)} aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function ProviderButton({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-3 rounded-md border border-border bg-pane px-3 py-2.5 text-left transition-colors hover:border-input hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="truncate text-[12px] text-subtle">{subtitle}</span>
      </span>
    </button>
  );
}

function ServerFields({ label, value, onChange }: { label: string; value: ImapServer; onChange: (v: ImapServer) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold">{label}</legend>
      <div className="flex gap-2">
        <Input
          aria-label={`${label} host`}
          placeholder="mail.example.com"
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          className="flex-1"
        />
        <Input
          aria-label={`${label} port`}
          inputMode="numeric"
          value={String(value.port)}
          onChange={(e) => onChange({ ...value, port: Number(e.target.value.replace(/\D/g, "")) || 0 })}
          className="w-20"
        />
      </div>
      <label className="flex items-center gap-2 text-[12px] text-subtle">
        <Switch checked={value.secure} onCheckedChange={(secure) => onChange({ ...value, secure })} />
        SSL/TLS (off uses STARTTLS)
      </label>
    </fieldset>
  );
}

function ImapForm({ preset, onBack, onDone }: { preset: ImapPreset | null; onBack: () => void; onDone: () => void }) {
  const { addImapAccount, adding } = useAccountActions();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [imap, setImap] = useState<ImapServer>({ host: "", port: 993, secure: true });
  const [smtp, setSmtp] = useState<ImapServer>({ host: "", port: 465, secure: true });

  const valid = /\S+@\S+\.\S+/.test(email) && password && (preset || (imap.host && smtp.host));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        const ok = await addImapAccount({
          preset: preset?.id,
          email: email.trim(),
          name: name.trim(),
          password,
          username: username.trim() || undefined,
          imap: preset ? undefined : imap,
          smtp: preset ? undefined : smtp,
        });
        if (ok) onDone();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imap-email">Email address</Label>
        <Input id="imap-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imap-name">Your name</Label>
        <Input id="imap-name" placeholder="Shown to people you email" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imap-password">{preset ? "App password" : "Password"}</Label>
        <Input id="imap-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {preset && (
          <button
            type="button"
            onClick={() => void getApi().openExternal(preset.appPasswordUrl)}
            className="inline-flex w-fit items-center gap-1 text-[12px] text-brand hover:underline"
          >
            Create an app password for {preset.label}
            <ExternalLinkIcon className="size-3" />
          </button>
        )}
      </div>
      {!preset && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="imap-username">Username</Label>
            <Input id="imap-username" placeholder="Defaults to the email address" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <ServerFields label="Incoming (IMAP)" value={imap} onChange={setImap} />
          <ServerFields label="Outgoing (SMTP)" value={smtp} onChange={setSmtp} />
        </>
      )}
      <p className="text-[12px] leading-relaxed text-subtle">
        The password is encrypted and stored on your Güneş Mail server so it can sync while this app is closed.
      </p>
      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <Button type="submit" disabled={!valid || adding}>
          {adding && <Loader2Icon className="animate-spin" />}
          {adding ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </form>
  );
}

export function AddAccountChoices({ onImap }: { onImap: (preset: ImapPreset | null) => void }) {
  const { addAccount, adding } = useAccountActions();
  const { data: session } = useQuery({ queryKey: ["session"], queryFn: () => getApi().session() });
  const { data: presets = [] } = useQuery({ queryKey: ["imap-presets"], queryFn: () => getApi().imapPresets() });
  const close = useAddAccountDialog((s) => s.setOpen);

  return (
    <div className="flex flex-col gap-2">
      <ProviderButton
        icon={<GoogleMark className="size-6" />}
        title="Google"
        subtitle="Gmail and Google Workspace"
        disabled={adding || session?.providers.google === false}
        onClick={() => {
          close(false);
          void addAccount("google");
        }}
      />
      <ProviderButton
        icon={<MicrosoftMark className="size-5" />}
        title="Microsoft"
        subtitle={session?.providers.microsoft === false ? "Not enabled in this build" : "Outlook.com, Hotmail, Microsoft 365"}
        disabled={adding || session?.providers.microsoft === false}
        onClick={() => {
          close(false);
          void addAccount("microsoft");
        }}
      />
      <div className="mt-2 mb-1 text-[12px] font-semibold text-subtle">With an app password</div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <ProviderButton key={p.id} icon={<MailIcon className="size-5 text-brand" />} title={p.label} subtitle="IMAP" onClick={() => onImap(p)} />
        ))}
      </div>
      <ProviderButton
        icon={<ServerIcon className="size-5 text-subtle" />}
        title="Other mail account"
        subtitle="Any IMAP/SMTP server"
        onClick={() => onImap(null)}
      />
    </div>
  );
}

export function AddAccountDialog() {
  const open = useAddAccountDialog((s) => s.open);
  const imap = useAddAccountDialog((s) => s.imap);
  const setOpen = useAddAccountDialog((s) => s.setOpen);
  const openImap = useAddAccountDialog((s) => s.openImap);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{imap ? (imap.preset ? `Add ${imap.preset.label}` : "Add a mail account") : "Add an account"}</DialogTitle>
          <DialogDescription>
            {imap ? "We'll check the connection before adding it." : "Choose where your mail lives."}
          </DialogDescription>
        </DialogHeader>
        {imap ? (
          <ImapForm
            preset={imap.preset}
            onBack={() => useAddAccountDialog.setState({ imap: null })}
            onDone={() => setOpen(false)}
          />
        ) : (
          <AddAccountChoices onImap={openImap} />
        )}
      </DialogContent>
    </Dialog>
  );
}
