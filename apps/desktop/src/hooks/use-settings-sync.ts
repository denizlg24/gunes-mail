"use client";

import type { UserSettings } from "@gunes/shared";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

import { getApi } from "@/lib/api";
import { useUi } from "@/store/ui";

type SyncedUi = Omit<UserSettings, "theme">;

function fromUi(): SyncedUi {
  const s = useUi.getState();
  return {
    accent: s.accent,
    density: s.density,
    readingPane: s.readingPane,
    focusedInbox: s.focusedInbox,
    markReadOnOpen: s.markReadOnOpen,
    undoSendSeconds: s.undoSendSeconds,
    signature: s.signature,
  };
}

/** Keeps appearance and behaviour preferences identical on every signed-in device. */
export function useSettingsSync(enabled: boolean) {
  const { theme, setTheme } = useTheme();
  const applied = useRef<string | null>(null);
  const { data: remote } = useQuery({
    queryKey: ["settings"],
    queryFn: () => getApi().getSettings(),
    enabled,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!remote) return;
    const { theme: remoteTheme, ...rest } = remote;
    applied.current = JSON.stringify({ ...rest, theme: remoteTheme });
    useUi.setState(rest);
    setTheme(remoteTheme);
  }, [remote, setTheme]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const push = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next: UserSettings = { ...fromUi(), theme: (theme as UserSettings["theme"] | undefined) ?? "system" };
        const serialized = JSON.stringify(next);
        if (!applied.current || serialized === applied.current) return;
        applied.current = serialized;
        void getApi().saveSettings(next).catch(() => undefined);
      }, 800);
    };
    push();
    const unsubscribe = useUi.subscribe(push);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, theme]);
}
