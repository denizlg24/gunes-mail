/** Contract types shared by the Güneş Mail server, desktop app and website. */

export type ProviderKind = "gmail" | "microsoft" | "imap";

export interface Mailbox {
  name: string;
  email: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** Standard base64. */
  data: string;
}

export interface OutgoingPayload {
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  bcc: Mailbox[];
  subject: string;
  html: string;
  text: string;
  attachments: OutgoingAttachment[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  draftId?: string;
}

export type RuleField = "from" | "to" | "cc" | "subject" | "body" | "sender_domain" | "recipient_domain" | "has_attachment";
export type RuleOperator = "contains" | "not_contains" | "equals" | "starts_with" | "ends_with" | "matches";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

export type RuleAction =
  | { type: "move"; folder: string }
  | { type: "label"; labelId: string }
  | { type: "mark_read" }
  | { type: "flag" }
  | { type: "archive" }
  | { type: "delete" }
  | { type: "mark_spam" }
  | { type: "focus"; category: "focused" | "other" }
  | { type: "delay_send"; minutes: number }
  | { type: "add_bcc"; email: string };

/** Present while an account's first full download is still running. */
export interface SyncProgress {
  /** Messages stored so far. */
  synced: number;
  /** Messages in the mailbox, when the provider reports it. */
  total: number | null;
  /** Recent mail arrives first, then older mail is backfilled. */
  phase: "recent" | "older";
}

export type ServerEvent =
  | {
      type: "sync";
      accountId: string;
      status: "syncing" | "ready" | "error";
      error?: string;
      progress?: SyncProgress | null;
    }
  | { type: "changed"; accountId: string }
  | { type: "outbox"; id: string; status: string; error?: string }
  | { type: "settings" };

export type ThemeMode = "light" | "dark" | "system";
export type Accent = "blue" | "teal" | "purple" | "berry" | "sunset" | "green" | "red" | "graphite";

/** Preferences that follow the user across devices. */
export interface UserSettings {
  theme: ThemeMode;
  accent: Accent;
  density: "comfortable" | "compact";
  readingPane: "right" | "bottom" | "off";
  focusedInbox: boolean;
  markReadOnOpen: boolean;
  undoSendSeconds: number;
  /** HTML. Older clients stored plain text, which is still accepted. */
  signature: string;
  /** Sort incoming mail into categories with the email classifier. Opt-in, per the privacy policy. */
  smartCategories: boolean;
  /** Thread summaries and drafting help. Opt-in, per the privacy policy. */
  aiAssist: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  accent: "blue",
  density: "comfortable",
  readingPane: "right",
  focusedInbox: true,
  markReadOnOpen: true,
  undoSendSeconds: 10,
  signature: "",
  smartCategories: false,
  aiAssist: false,
};

export const TRIAGE_CATEGORIES = ["action-needed", "scheduled", "fyi", "purchases", "newsletter", "promo", "spam"] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export function isTriageCategory(value: unknown): value is TriageCategory {
  return typeof value === "string" && (TRIAGE_CATEGORIES as readonly string[]).includes(value);
}

/** What the server can do; AI features hide themselves when unconfigured. */
export interface AiCapabilities {
  classifier: boolean;
  assist: boolean;
}

export interface ThreadInsight {
  summary: string;
  keyPoints: string[];
  actionItems: { text: string; due: string | null }[];
  generatedAt: number;
}

export type AiComposeRequest =
  | {
      action: "draft";
      /** What the user wants the message to say. */
      instruction: string;
      threadId?: string;
      /** The message being replied to or forwarded. */
      messageId?: string;
      mode: "new" | "reply" | "replyAll" | "forward";
      subject?: string;
    }
  | {
      action: "rewrite";
      instruction: string;
      /** Plain text of the current draft, without signature or quote. */
      draft: string;
      threadId?: string;
    };

export interface UserProfile {
  id: string;
  email: string | null;
  name: string;
  hasPassword: boolean;
  createdAt: number;
}

export interface DeviceSession {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  current: boolean;
}
