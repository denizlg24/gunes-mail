"use client";

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";

import { isTauri } from "@/lib/server-api";

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Downloads signed updates from GitHub Releases in the background and offers a restart. */
export function useUpdater() {
  useEffect(() => {
    if (!isTauri() || process.env.NODE_ENV !== "production") return;
    let offered = false;
    const run = async () => {
      if (offered) return;
      try {
        const update = await check();
        if (!update) return;
        await update.downloadAndInstall();
        offered = true;
        toast(`Güneş Mail ${update.version} is ready`, {
          description: "Restart to finish updating.",
          duration: Infinity,
          action: { label: "Restart", onClick: () => void relaunch() },
        });
      } catch {
        // Offline or no release yet; try again later.
      }
    };
    void run();
    const timer = setInterval(() => void run(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
}
