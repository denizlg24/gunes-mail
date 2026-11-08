import {
  differenceInCalendarDays,
  format,
  isSameYear,
  isThisWeek,
  isToday,
  isYesterday,
  startOfMonth,
  subMonths,
} from "date-fns";

import type { Mailbox } from "./types";

export function listDate(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, "HH:mm");
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEE HH:mm");
  if (isSameYear(d, new Date())) return format(d, "dd/MM");
  return format(d, "dd/MM/yyyy");
}

export function fullDate(ts: number): string {
  return format(new Date(ts), "EEE dd/MM/yyyy HH:mm");
}

export function dateGroup(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (isThisWeek(d, { weekStartsOn: 1 })) return "This week";
  if (differenceInCalendarDays(now, d) < 14) return "Last week";
  if (d >= startOfMonth(now)) return "Earlier this month";
  if (d >= startOfMonth(subMonths(now, 1))) return "Last month";
  return "Older";
}

export function initials(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = [
  "#0F6CBD",
  "#8764B8",
  "#C239B3",
  "#CA5010",
  "#498205",
  "#038387",
  "#D13438",
  "#4F6BED",
  "#986F0B",
  "#00727C",
];

export function avatarColor(key: string): string {
  let hash = 0;
  for (const ch of key.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function displayName(m: Mailbox): string {
  return m.name && m.name !== m.email ? m.name : m.email.split("@")[0];
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function shortcut(keys: string): string {
  return isMac
    ? keys.replace(/Ctrl\+/g, "⌘").replace(/Shift\+/g, "⇧").replace(/Alt\+/g, "⌥")
    : keys;
}

export const ARCHIVE_KEY = isMac ? "Ctrl+Alt+A" : "Backspace";
