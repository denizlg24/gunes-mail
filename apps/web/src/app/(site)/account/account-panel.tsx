"use client";

import type { DeviceSession, UserProfile } from "@gunes/shared";
import { LaptopIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { deleteAccount, getProfile, getSessions, login, logout, revokeSession, storedToken } from "@/lib/api";

const input =
  "h-11 w-full rounded-xl border border-line bg-card px-4 text-[15px] outline-none transition focus:border-sun focus:ring-4 focus:ring-sun/15";

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await login(email.trim(), password);
          onSignedIn();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't sign in");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Your Güneş account</h1>
        <p className="mt-2 text-muted">Sign in to see your devices or delete your account and data.</p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink font-medium text-paper disabled:opacity-60"
      >
        {busy && <Loader2Icon className="size-4 animate-spin" />}
        Sign in
      </button>
      <p className="text-sm text-muted">
        Signed up with a mailbox only? Set an email and password in the desktop app under Settings → Güneş account, or delete
        your account there directly.
      </p>
    </form>
  );
}

function Signed({ profile, onChange }: { profile: UserProfile; onChange: () => void }) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const load = useCallback(() => getSessions().then(setSessions).catch(() => setSessions([])), []);
  useEffect(() => {
    void load();
  }, [load]);

  if (deleted) {
    return (
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Account deleted</h1>
        <p className="mt-3 text-muted">
          Your account, connected mailboxes, synced mail, rules and settings were removed from our servers, and Google access
          was revoked. Mail at your providers is untouched.
        </p>
        <Link href="/" className="mt-6 inline-block text-sun underline">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{profile.name || "Your account"}</h1>
          <p className="mt-1 text-muted">{profile.email}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            onChange();
          }}
          className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/30"
        >
          Sign out
        </button>
      </div>

      <section>
        <h2 className="font-semibold">Signed-in devices</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-card">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <LaptopIcon className="size-5 text-muted" />
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {s.name}
                  {s.current && <span className="ml-2 rounded-full bg-sun-soft px-2 py-0.5 text-xs text-sun">This browser</span>}
                </div>
                <div className="text-xs text-muted">Last active {new Date(s.lastUsedAt).toLocaleString()}</div>
              </div>
              {!s.current && (
                <button
                  type="button"
                  onClick={async () => {
                    await revokeSession(s.id);
                    await load();
                  }}
                  className="text-sm text-muted hover:text-ink"
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-red-500/30 p-5">
        <h2 className="font-semibold">Delete account and data</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Permanently deletes your Güneş account, connected mailboxes, synced mail, rules, scheduled messages and settings,
          and revokes our access to your Google account. Mail stored at your providers is not affected. This can&apos;t be
          undone.
        </p>
        <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
          Type DELETE to confirm
          <input className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={confirm !== "DELETE" || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await deleteAccount();
              setDeleted(true);
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy && <Loader2Icon className="size-4 animate-spin" />}
          Delete my account
        </button>
      </section>
    </div>
  );
}

export function AccountPanel() {
  const [state, setState] = useState<{ checked: boolean; profile: UserProfile | null }>({ checked: false, profile: null });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (storedToken() ? getProfile() : Promise.resolve(null))
      .catch(() => null)
      .then((profile) => {
        if (!cancelled) setState({ checked: true, profile });
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!state.checked) return <Loader2Icon className="mx-auto size-6 animate-spin text-muted" />;
  return state.profile ? <Signed profile={state.profile} onChange={refresh} /> : <SignIn onSignedIn={refresh} />;
}
