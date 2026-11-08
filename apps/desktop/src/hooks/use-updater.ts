"use client";

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { isTauri } from "@/lib/server-api";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const RECHECK_ON_FOCUS_AFTER_MS = 60 * 60 * 1000;

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  | { kind: "ready"; version: string; notes: string | null }
  | { kind: "error"; message: string };

interface UpdaterState {
  currentVersion: string | null;
  status: UpdateStatus;
  lastCheckedAt: number;
  check: (opts?: { manual?: boolean }) => Promise<void>;
  restart: () => Promise<void>;
}

const supported = () => isTauri() && process.env.NODE_ENV === "production";

let inFlight: Promise<void> | null = null;

async function download(update: Update, set: (s: Partial<UpdaterState>) => void) {
  let received = 0;
  let total: number | null = null;
  set({ status: { kind: "downloading", version: update.version, received, total } });
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? null;
    if (event.event === "Progress") received += event.data.chunkLength;
    set({ status: { kind: "downloading", version: update.version, received, total } });
  });
  set({ status: { kind: "ready", version: update.version, notes: update.body ?? null } });
  toast(`Güneş Mail ${update.version} is ready`, {
    id: "update-ready",
    description: "Restart to finish updating.",
    duration: Infinity,
    action: { label: "Restart", onClick: () => void relaunch() },
  });
}

export const useUpdates = create<UpdaterState>()((set, get) => ({
  currentVersion: null,
  status: { kind: "idle" },
  lastCheckedAt: 0,
  check: async ({ manual = false } = {}) => {
    if (!supported()) {
      if (manual) toast("Updates are only available in the installed app");
      return;
    }
    const { status } = get();
    if (status.kind === "ready" || status.kind === "downloading") return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      set({ status: { kind: "checking" }, lastCheckedAt: Date.now() });
      try {
        const update = await check();
        if (!update) {
          set({ status: { kind: "current", checkedAt: Date.now() } });
          if (manual) toast.success("You're on the latest version");
          return;
        }
        await download(update, set);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        set({ status: { kind: "error", message } });
        if (manual) toast.error("Couldn't check for updates", { description: message });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },
  restart: () => relaunch(),
}));

/** Checks GitHub Releases on launch, every few hours and when the window regains focus, and installs signed updates in the background. */
export function useUpdater() {
  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then((currentVersion) => useUpdates.setState({ currentVersion }));
    if (!supported()) return;
    const { check: run } = useUpdates.getState();
    void run();
    const timer = setInterval(() => void run(), CHECK_EVERY_MS);
    const onFocus = () => {
      if (Date.now() - useUpdates.getState().lastCheckedAt > RECHECK_ON_FOCUS_AFTER_MS) void run();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
