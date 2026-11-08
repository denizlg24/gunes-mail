import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { rememberPhotos, useContactSearch } from "@/hooks/use-contacts";
import { useVisibleThreads } from "@/hooks/use-mail";
import { displayName } from "@/lib/format";
import { parseMailboxes } from "@/lib/mime";
import type { Contact, Mailbox } from "@/lib/types";
import { cn } from "@/lib/utils";

import { PersonAvatar } from "./person-avatar";

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function useLocalContacts(): Mailbox[] {
  const threads = useVisibleThreads((s) => s.threads);
  return useMemo(() => {
    const map = new Map<string, Mailbox>();
    for (const t of threads) {
      for (const m of [...t.senders, ...t.recipients]) {
        const key = m.email.toLowerCase();
        if (!map.has(key) || map.get(key)!.name === m.email) map.set(key, m);
      }
    }
    return Array.from(map.values());
  }, [threads]);
}

interface RecipientInputProps {
  label: string;
  value: Mailbox[];
  onChange: (value: Mailbox[]) => void;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}

export function RecipientInput({ label, value, onChange, autoFocus, trailing }: RecipientInputProps) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const local = useLocalContacts();
  const { data: remote } = useContactSearch(text);

  useEffect(() => {
    if (remote) rememberPhotos(remote);
  }, [remote]);

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(value.map((v) => v.email.toLowerCase()));
    const merged = new Map<string, Contact>();
    for (const c of remote ?? []) merged.set(c.email.toLowerCase(), c);
    for (const c of local) {
      const key = c.email.toLowerCase();
      if (!merged.has(key) && (key.includes(q) || c.name.toLowerCase().includes(q))) merged.set(key, c);
    }
    return [...merged.values()].filter((c) => !taken.has(c.email.toLowerCase())).slice(0, 8);
  }, [remote, local, text, value]);

  const add = (boxes: Mailbox[]) => {
    const existing = new Set(value.map((v) => v.email.toLowerCase()));
    const fresh = boxes.filter((b) => EMAIL_RE.test(b.email) && !existing.has(b.email.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
  };

  const commit = () => {
    const raw = text.trim().replace(/[,;]$/, "");
    if (!raw) return false;
    const parsed = parseMailboxes(raw);
    if (!parsed.length || !parsed.every((p) => EMAIL_RE.test(p.email))) return false;
    add(parsed);
    setText("");
    return true;
  };

  const choose = (m: Mailbox) => {
    add([m]);
    setText("");
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="relative flex min-h-10 items-start gap-2 border-b border-border py-1.5">
      <span className="mt-1 w-12 shrink-0 text-[13px] text-subtle">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1" onClick={() => inputRef.current?.focus()}>
        {value.map((m) => (
          <span
            key={m.email}
            title={m.email}
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-brand-soft pr-1 pl-0.5 text-[13px]"
          >
            <PersonAvatar name={m.name} email={m.email} size={20} />
            <span className="truncate">{displayName(m)}</span>
            <button
              type="button"
              aria-label={`Remove ${m.email}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v.email !== m.email));
              }}
              className="inline-flex size-4 items-center justify-center rounded-full text-subtle hover:bg-foreground/10 hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]\s*$/.test(v) && EMAIL_RE.test(v.replace(/[,;]\s*$/, "").trim())) {
              add(parseMailboxes(v));
              setText("");
              return;
            }
            setText(v);
            setActive(0);
          }}
          onPaste={(e) => {
            const pasted = parseMailboxes(e.clipboardData.getData("text"));
            if (pasted.length > 1) {
              e.preventDefault();
              add(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && suggestions.length && text.trim()) {
              e.preventDefault();
              choose(suggestions[active]);
            } else if (e.key === "Enter" || e.key === ";" || e.key === ",") {
              if (text.trim()) {
                e.preventDefault();
                commit();
              }
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="h-7 min-w-[120px] flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
      {trailing}
      {focused && suggestions.length > 0 && (
        <div className="absolute top-full left-14 z-20 mt-1 w-80 overflow-hidden rounded-md bg-popover py-1 shadow-lg ring-1 ring-foreground/10">
          {suggestions.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left", i === active && "bg-hover")}
            >
              <PersonAvatar name={s.name} email={s.email} size={28} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px]">{displayName(s)}</span>
                <span className="truncate text-[12px] text-subtle">{s.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
