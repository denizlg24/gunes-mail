import type { Mailbox, OutgoingPayload } from "@gunes/shared";

export type {
  Mailbox,
  OutgoingAttachment,
  OutgoingPayload,
  ProviderKind,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleOperator,
} from "@gunes/shared";

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

/**
 * Folder membership and state are expressed as label ids on every provider:
 * INBOX, SENT, DRAFT, TRASH, SPAM, ARCHIVE, STARRED and UNREAD are shared
 * system ids; anything else is a provider-specific folder/label/category id.
 */
export const SYSTEM_LABELS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "ARCHIVE", "STARRED"] as const;

export interface NormalizedLabel {
  id: string;
  name: string;
  type: "system" | "user";
  color?: { backgroundColor: string; textColor: string };
  providerRef?: string;
}

export interface NormalizedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  bcc: Mailbox[];
  replyTo: Mailbox[];
  subject: string;
  date: Date;
  snippet: string;
  html?: string;
  text?: string;
  bodyFetched: boolean;
  attachments: AttachmentMeta[];
  hasAttachments: boolean;
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string;
  providerRef?: Record<string, unknown>;
  category?: "focused" | "other";
}

export interface MessageRef {
  id: string;
  threadId: string;
  labelIds: string[];
  providerRef?: Record<string, unknown> | null;
}

export interface SyncSink {
  upsertMessages(messages: NormalizedMessage[]): Promise<void>;
  /** Patch only label state (cheap incremental updates). */
  updateLabels(updates: { id: string; labelIds: string[] }[]): Promise<void>;
  deleteMessages(ids: string[]): Promise<void>;
  replaceLabels(labels: NormalizedLabel[]): Promise<void>;
  /** Look up a thread id by RFC 5322 Message-ID, for providers without native threading. */
  threadForMessageIds(messageIds: string[]): Promise<string | undefined>;
}

export interface Body {
  html?: string;
  text?: string;
  attachments: AttachmentMeta[];
}

export interface Contact {
  email: string;
  name: string;
  photoUrl?: string;
}

export interface MailProvider {
  readonly kind: "gmail" | "microsoft" | "imap";
  /** Returns the next sync cursor state; must be resumable after a crash. */
  sync(state: Record<string, unknown>, sink: SyncSink): Promise<Record<string, unknown>>;
  fetchBody(message: MessageRef): Promise<Body>;
  getAttachment(message: MessageRef, attachmentId: string): Promise<Uint8Array>;
  modify(messages: MessageRef[], add: string[], remove: string[]): Promise<void>;
  trash(messages: MessageRef[]): Promise<void>;
  untrash(messages: MessageRef[]): Promise<void>;
  deleteForever(messages: MessageRef[]): Promise<void>;
  /** `raw` is the RFC 822 message. Returns the provider id of the sent message when known. */
  send(raw: Buffer, payload: OutgoingPayload): Promise<void>;
  saveDraft(raw: Buffer, payload: OutgoingPayload): Promise<string>;
  deleteDraft(draftId: string): Promise<void>;
  /** Maps a synced draft message to the id saveDraft/deleteDraft expect, when they differ. */
  resolveDraftId?(message: MessageRef): Promise<string | undefined>;
  createLabel(name: string): Promise<NormalizedLabel>;
  renameLabel(id: string, name: string): Promise<void>;
  deleteLabel(id: string): Promise<void>;
  listContacts?(): Promise<Contact[]>;
  /** Called after credentials change (token refresh) so they can be persisted. */
  close?(): Promise<void>;
}
