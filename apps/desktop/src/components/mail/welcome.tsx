import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, MailIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, getApi } from "@/lib/api";

import { AddAccountChoices, useAddAccountDialog } from "./add-account-dialog";

function SignInForm({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await getApi().login(email.trim(), password);
          await qc.invalidateQueries({ queryKey: ["session"] });
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-password">Password</Label>
        <Input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" disabled={busy || !email || !password}>
          {busy && <Loader2Icon className="animate-spin" />}
          Sign in
        </Button>
      </div>
    </form>
  );
}

export function Welcome() {
  const openImap = useAddAccountDialog((s) => s.openImap);
  const [signingIn, setSigningIn] = useState(false);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-pane p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg bg-brand-strong text-white">
            <MailIcon className="size-6" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold">Welcome to Güneş Mail</h1>
            <p className="text-[13px] text-subtle">All your inboxes in one desktop app.</p>
          </div>
        </div>
        {signingIn ? (
          <SignInForm onBack={() => setSigningIn(false)} />
        ) : (
          <>
            <p className="mb-4 text-[14px]">Add your first mail account to get started.</p>
            <AddAccountChoices onImap={openImap} />
            <p className="mt-5 text-center text-[13px] text-subtle">
              Already use Güneş Mail on another computer?{" "}
              <button type="button" onClick={() => setSigningIn(true)} className="font-semibold text-brand hover:underline">
                Sign in
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
