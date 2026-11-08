import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { LaptopIcon, LogOutIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, getApi } from "@/lib/api";
import { useUi } from "@/store/ui";

import { confirmDialog, prompt } from "./dialog-host";
import { useSettings } from "./settings-dialog";

function ProfileForm() {
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => getApi().profile() });
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  const saveProfile = async () => {
    setBusy(true);
    try {
      await getApi().updateProfile({ name: name ?? undefined, email: email ?? undefined });
      await qc.invalidateQueries({ queryKey: ["profile"] });
      setName(null);
      setEmail(null);
      toast.success("Profile saved");
    } catch (e) {
      toast.error("Couldn't save your profile", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setBusy(true);
    try {
      await getApi().setPassword(password, profile.hasPassword ? current : undefined);
      await qc.invalidateQueries({ queryKey: ["profile"] });
      setPassword("");
      setCurrent("");
      toast.success(profile.hasPassword ? "Password changed" : "Password set", {
        description: profile.hasPassword ? "Other devices were signed out." : "You can now sign in on other devices.",
      });
    } catch (e) {
      toast.error("Couldn't update your password", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const dirty = (name !== null && name !== profile.name) || (email !== null && email !== (profile.email ?? ""));

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" value={name ?? profile.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">Sign-in email</Label>
          <Input
            id="profile-email"
            type="email"
            placeholder="you@example.com"
            value={email ?? profile.email ?? ""}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Button size="sm" disabled={!dirty || busy} onClick={() => void saveProfile()}>
            Save profile
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">{profile.hasPassword ? "Change password" : "Set a password"}</h4>
        {!profile.hasPassword && (
          <p className="text-[12px] text-subtle">
            Add a sign-in email and password to open your mail on another computer or on the web account page.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {profile.hasPassword && (
            <Input type="password" aria-label="Current password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          <Input
            type="password"
            aria-label="New password"
            placeholder="New password (10+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || password.length < 10 || !profile.email || (profile.hasPassword && !current)}
            onClick={() => void savePassword()}
          >
            <ShieldCheckIcon />
            {profile.hasPassword ? "Change password" : "Set password"}
          </Button>
          {!profile.email && <span className="ml-2 text-[12px] text-subtle">Save a sign-in email first.</span>}
        </div>
      </section>
    </div>
  );
}

function Devices() {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery({ queryKey: ["sessions"], queryFn: () => getApi().listSessions() });

  return (
    <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
          <LaptopIcon className="size-5 shrink-0 text-subtle" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">
              {s.name}
              {s.current && <span className="ml-2 rounded-sm bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand">This device</span>}
            </div>
            <div className="text-[12px] text-subtle">Active {formatDistanceToNow(s.lastUsedAt, { addSuffix: true })}</div>
          </div>
          {!s.current && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await getApi().revokeSession(s.id);
                await qc.invalidateQueries({ queryKey: ["sessions"] });
              }}
            >
              Sign out
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function AccountSection() {
  const qc = useQueryClient();
  const signature = useUi((s) => s.signature);
  const setSignature = useUi((s) => s.setSignature);

  const signOut = async () => {
    const ok = await confirmDialog({
      title: "Sign out of Güneş Mail on this device?",
      description: "Your mail keeps syncing on the server. Sign back in with your email or any connected mailbox.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    await getApi().signOut();
    useSettings.getState().close();
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["session"] });
  };

  const deleteAccount = async () => {
    const typed = await prompt({
      title: "Delete your Güneş Mail account?",
      description:
        "This removes your connected mailboxes, synced mail, rules, scheduled messages and settings from our server, and revokes Google access. Mail in your providers is not touched. Type DELETE to confirm.",
      placeholder: "DELETE",
      confirmLabel: "Delete account",
    });
    if (typed !== "DELETE") return;
    try {
      await getApi().deleteAccount();
      useSettings.getState().close();
      qc.clear();
      await qc.invalidateQueries({ queryKey: ["session"] });
      toast("Your account and its data were deleted");
    } catch (e) {
      toast.error("Couldn't delete your account", { description: errorMessage(e) });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-[16px] font-semibold">Güneş account</h3>
        <p className="text-[13px] text-subtle">Your mailboxes, rules and preferences follow this account to every device.</p>
      </div>
      <ProfileForm />
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Signature</h4>
        <Textarea
          rows={3}
          value={signature}
          placeholder={"Best,\nYour name"}
          onChange={(e) => setSignature(e.target.value)}
          className="text-[13px]"
        />
        <p className="text-[12px] text-subtle">Added to new messages and replies on all your devices.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h4 className="text-[13px] font-semibold">Signed-in devices</h4>
        <Devices />
      </section>
      <section className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={() => void signOut()}>
          <LogOutIcon />
          Sign out on this device
        </Button>
        <Button variant="destructive" onClick={() => void deleteAccount()}>
          <Trash2Icon />
          Delete account and data
        </Button>
      </section>
    </div>
  );
}
