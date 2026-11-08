import { site } from "./site";

export type Os = "mac" | "windows" | "linux";

export interface Build {
  os: Os;
  label: string;
  format: string;
  href: string;
}

export const OS_NAMES: Record<Os, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

const SPECS: (Omit<Build, "href"> & { match: RegExp })[] = [
  { os: "mac", label: "Apple silicon", format: ".dmg", match: /aarch64\.dmg$/ },
  { os: "mac", label: "Intel", format: ".dmg", match: /x64\.dmg$/ },
  { os: "windows", label: "Installer", format: ".exe", match: /-setup\.exe$/ },
  { os: "windows", label: "Windows Installer", format: ".msi", match: /\.msi$/ },
  { os: "linux", label: "AppImage", format: ".AppImage", match: /\.AppImage$/ },
  { os: "linux", label: "Debian, Ubuntu", format: ".deb", match: /\.deb$/ },
  { os: "linux", label: "Fedora, openSUSE", format: ".rpm", match: /\.rpm$/ },
];

export interface Release {
  version: string;
  assets: { name: string; url: string }[];
}

/** Until the latest release has loaded, every build points at the releases page. */
export function buildsFor(release: Release | null): Build[] {
  return SPECS.map(({ match, ...spec }) => ({
    ...spec,
    href: release?.assets.find((a) => match.test(a.name))?.url ?? site.releases,
  }));
}

export async function fetchLatestRelease(): Promise<Release | null> {
  try {
    const res = await fetch(`${site.apiUrl}/v1/releases/latest`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

interface UaData {
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
}

declare global {
  interface Navigator {
    userAgentData?: UaData;
  }
}

export interface Detected {
  os: Os;
  /** Index into the OS's builds, in `buildsFor` order. */
  variant: number;
}

function detectOs(): Os | null {
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  const ua = navigator.userAgent;
  if (/android|iphone|ipad|ipod/i.test(ua)) return null;
  if (/mac/i.test(platform)) return navigator.maxTouchPoints > 1 ? null : "mac";
  if (/win/i.test(platform)) return "windows";
  if (/linux|x11|cros/i.test(platform) || /linux/i.test(ua)) return "linux";
  return null;
}

/**
 * Browsers other than Chromium don't expose the CPU architecture, and Safari reports
 * "Intel" on Apple silicon, so Macs default to the Apple silicon build.
 */
export async function detectBuild(): Promise<Detected | null> {
  const os = detectOs();
  if (!os) return null;
  if (os === "mac") {
    const arch = await navigator.userAgentData
      ?.getHighEntropyValues(["architecture"])
      .then((v) => v.architecture)
      .catch(() => undefined);
    return { os, variant: arch === "x86" ? 1 : 0 };
  }
  return { os, variant: 0 };
}
