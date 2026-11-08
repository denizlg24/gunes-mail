import { Hono } from "hono";

import type { AppEnv } from "../auth";

const REPO = "denizlg24/gunes-mail";
const TTL_MS = 10 * 60 * 1000;

interface LatestRelease {
  version: string;
  publishedAt: string;
  assets: { name: string; url: string; size: number }[];
}

let cached: { at: number; value: LatestRelease } | null = null;

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

async function fetchLatest(): Promise<LatestRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "gunes-mail-server" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const release: GitHubRelease = await res.json();
  return {
    version: release.tag_name.replace(/^v/, ""),
    publishedAt: release.published_at,
    assets: release.assets
      .filter((a) => !a.name.endsWith(".sig") && a.name !== "latest.json")
      .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

/** The latest published desktop release, so the website never links to a draft that isn't downloadable yet. */
export const releases = new Hono<AppEnv>().get("/latest", async (c) => {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    try {
      cached = { at: Date.now(), value: await fetchLatest() };
    } catch (e) {
      if (!cached) return c.json({ error: e instanceof Error ? e.message : "Unavailable" }, 502);
    }
  }
  c.header("cache-control", "public, max-age=300");
  return c.json(cached.value);
});
