import type { Label, ListParams } from "./types";

export const ARCHIVE = "ARCHIVE";

export interface SystemFolder {
  id: string;
  name: string;
  icon: "inbox" | "drafts" | "sent" | "trash" | "junk" | "archive" | "flagged";
}

export const SYSTEM_FOLDERS: SystemFolder[] = [
  { id: "INBOX", name: "Inbox", icon: "inbox" },
  { id: "DRAFT", name: "Drafts", icon: "drafts" },
  { id: "SENT", name: "Sent Items", icon: "sent" },
  { id: "STARRED", name: "Flagged", icon: "flagged" },
  { id: "TRASH", name: "Deleted Items", icon: "trash" },
  { id: "SPAM", name: "Junk Email", icon: "junk" },
  { id: ARCHIVE, name: "Archive", icon: "archive" },
];

const ARCHIVE_QUERY = "-in:inbox -in:sent -in:drafts -in:spam -in:trash -in:chats";

export function folderQuery(params: Omit<ListParams, "pageToken">): { labelIds: string[]; q: string } {
  const parts: string[] = [];
  const search = params.search?.trim();
  let labelIds: string[] = [];

  if (search) {
    parts.push(search);
  } else if (params.folder === ARCHIVE) {
    parts.push(ARCHIVE_QUERY);
  } else {
    labelIds = [params.folder];
    if (params.folder === "INBOX" && params.tab) {
      parts.push(params.tab === "focused" ? "category:primary" : "-category:primary");
    }
  }

  switch (params.filter) {
    case "unread":
      parts.push("is:unread");
      break;
    case "flagged":
      parts.push("is:starred");
      break;
    case "attachments":
      parts.push("has:attachment");
      break;
    case "tome":
      parts.push("to:me");
      break;
  }
  return { labelIds, q: parts.join(" ") };
}

export function folderName(folder: string, labels: Label[] | undefined): string {
  const system = SYSTEM_FOLDERS.find((f) => f.id === folder);
  if (system) return system.name;
  const label = labels?.find((l) => l.id === folder);
  return label ? leafName(label.name) : folder;
}

export function leafName(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

export interface LabelNode {
  label: Label;
  children: LabelNode[];
}

export function buildLabelTree(labels: Label[]): LabelNode[] {
  const user = labels
    .filter((l) => l.type === "user")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const byName = new Map<string, LabelNode>();
  const roots: LabelNode[] = [];
  for (const label of user) {
    const node: LabelNode = { label, children: [] };
    byName.set(label.name, node);
    const parentName = label.name.includes("/") ? label.name.slice(0, label.name.lastIndexOf("/")) : null;
    const parent = parentName ? byName.get(parentName) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function isMovableTarget(folder: string): boolean {
  return !["DRAFT", "SENT", "STARRED"].includes(folder);
}
