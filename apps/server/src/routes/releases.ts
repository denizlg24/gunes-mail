import { Hono } from "hono";

import type { AppEnv } from "../auth";

const REPO = "denizlg24/gunes-mail";
const TTL_MS = 15 * 60 * 1000;
/** After a failure, serve what we have and wait this long before asking GitHub again. */
const RETRY_MS = 5 * 60 * 1000;

interface LatestRelease {
  version: string;
  publishedAt: string;
  assets: { name: string; url: string; size: number }[];
}

let cached: { at: number; value: LatestRelease } | null = null;
let failedAt = 0;

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

/**
 * The release CDN serves the updater manifest without API rate limits. Bundle names follow
 * Tauri's conventions for the product name "Gunes Mail" (GitHub turns the space into a dot).
 */
async function fromUpdaterManifest(): Promise<LatestRelease> {
  const res = await fetch(`https://github.com/${REPO}/releases/latest/download/latest.json`);
  if (!res.ok) throw new Error(`Release manifest answered ${res.status}`);
  const manifest: { version: string; pub_date?: string } = await res.json();
  const v = manifest.version.replace(/^v/, "");
  const names = [
    `Gunes.Mail_${v}_aarch64.dmg`,
    `Gunes.Mail_${v}_x64.dmg`,
    `Gunes.Mail_${v}_x64-setup.exe`,
    `Gunes.Mail_${v}_x64_en-US.msi`,
    `Gunes.Mail_${v}_amd64.AppImage`,
    `Gunes.Mail_${v}_amd64.deb`,
    `Gunes.Mail-${v}-1.x86_64.rpm`,
  ];
  return {
    version: v,
    publishedAt: manifest.pub_date ?? "",
    assets: names.map((name) => ({ name, url: `https://github.com/${REPO}/releases/download/v${v}/${name}`, size: 0 })),
  };
}

async function fromApi(): Promise<LatestRelease> {
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
  const stale = !cached || Date.now() - cached.at > TTL_MS;
  if (stale && Date.now() - failedAt > RETRY_MS) {
    try {
      cached = { at: Date.now(), value: await fromApi().catch(() => fromUpdaterManifest()) };
    } catch (e) {
      failedAt = Date.now();
      console.warn("latest release lookup failed", e instanceof Error ? e.message : e);
    }
  }
  // 503 rather than 502: Cloudflare swaps origin 502s for its own error page.
  if (!cached) return c.json({ error: "Release information is temporarily unavailable" }, 503);
  c.header("cache-control", "public, max-age=300");
  return c.json(cached.value);
});
