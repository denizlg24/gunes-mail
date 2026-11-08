import { site } from "./site";

export type Os = "mac" | "windows" | "linux";

export interface Build {
  os: Os;
  label: string;
  format: string;
  href: string;
}

const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";
const base = `${site.repo}/releases/download/v${version}/Gunes.Mail_${version}`;

export const OS_NAMES: Record<Os, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };

export const BUILDS: Build[] = [
  { os: "mac", label: "Apple silicon", format: ".dmg", href: `${base}_aarch64.dmg` },
  { os: "mac", label: "Intel", format: ".dmg", href: `${base}_x64.dmg` },
  { os: "windows", label: "Installer", format: ".exe", href: `${base}_x64-setup.exe` },
  { os: "windows", label: "Windows Installer", format: ".msi", href: `${base}_x64_en-US.msi` },
  { os: "linux", label: "AppImage", format: ".AppImage", href: `${base}_amd64.AppImage` },
  { os: "linux", label: "Debian, Ubuntu", format: ".deb", href: `${base}_amd64.deb` },
  { os: "linux", label: "Fedora, openSUSE", format: ".rpm", href: `${site.repo}/releases/download/v${version}/Gunes.Mail-${version}-1.x86_64.rpm` },
];

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
  build: Build;
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
  const builds = BUILDS.filter((b) => b.os === os);
  if (os === "mac") {
    const arch = await navigator.userAgentData
      ?.getHighEntropyValues(["architecture"])
      .then((v) => v.architecture)
      .catch(() => undefined);
    return { os, build: arch === "x86" ? builds[1] : builds[0] };
  }
  return { os, build: builds[0] };
}
