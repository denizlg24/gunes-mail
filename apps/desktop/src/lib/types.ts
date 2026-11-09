import type {
  AiCapabilities,
  AiComposeRequest,
  DeviceSession,
  Mailbox,
  OutgoingPayload,
  ProviderKind,
  RuleAction,
  RuleCondition,
  ServerEvent,
  SyncProgress,
  ThreadInsight,
  TriageCategory,
  UserProfile,
  UserSettings,
} from "@gunes/shared";

export type {
  Mailbox,
  OutgoingAttachment,
  ProviderKind,
  RuleAction,
  RuleCondition,
  RuleField,
  RuleOperator,
  ServerEvent,
  SyncProgress,
  AiCapabilities,
  AiComposeRequest,
  ThreadInsight,
  TriageCategory,
} from "@gunes/shared";
export type OutgoingMessage = OutgoingPayload;

export interface Account {
  id: string;
  provider: ProviderKind;
  email: string;
  name: string;
  picture?: string | null;
  status: "syncing" | "ready" | "error";
  lastError?: string | null;
  lastSyncedAt?: number | null;
  progress?: SyncProgress | null;
}

export interface LabelColor {
  backgroundColor: string;
  textColor: string;
}

export interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  unread: number;
  total: number;
  color?: LabelColor;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  senders: Mailbox[];
  recipients: Mailbox[];
  date: number;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  messageCount: number;
  labelIds: string[];
  draft: boolean;
  triage?: TriageCategory | null;
}

export interface Attachment {
  attachmentId?: string;
  data?: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  labelIds: string[];
  from: Mailbox;
  to: Mailbox[];
  cc: Mailbox[];
  bcc: Mailbox[];
  replyTo: Mailbox[];
  subject: string;
  date: number;
  snippet: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
  messageIdHeader?: string;
  references?: string;
  unread: boolean;
  flagged: boolean;
  draft: boolean;
}

export interface Thread {
  id: string;
  subject: string;
  messages: Message[];
  labelIds: string[];
}

export type InboxTab = "focused" | "other";
export type ListFilter = "all" | "unread" | "flagged" | "attachments" | "tome";

export interface ListParams {
  folder: string;
  tab?: InboxTab;
  filter: ListFilter;
  triage?: TriageCategory;
  search?: string;
  pageToken?: string;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextPageToken?: string;
  /** True while the account's first sync hasn't finished yet. */
  syncing?: boolean;
}

export interface Contact {
  email: string;
  name: string;
  photoUrl?: string | null;
}

export interface ImapPreset {
  id: string;
  label: string;
  appPasswordUrl: string;
}

export interface ImapServer {
  host: string;
  port: number;
  secure: boolean;
}

export interface ImapAccountInput {
  preset?: string;
  email: string;
  name: string;
  password: string;
  username?: string;
  imap?: ImapServer;
  smtp?: ImapServer;
}

export interface SendResult {
  id: string;
  sendAt: number;
  delayedByRule: number;
}

export interface OutboxItem {
  id: string;
  accountId: string;
  status: "scheduled" | "sending" | "failed";
  error?: string | null;
  sendAt: number;
  subject: string;
  to: Mailbox[];
  payload: OutgoingMessage;
}

export interface Rule {
  id: string;
  name: string;
  kind: "incoming" | "outgoing";
  accountId: string | null;
  enabled: boolean;
  position: number;
  match: "all" | "any";
  conditions: RuleCondition[];
  actions: RuleAction[];
  stopProcessing: boolean;
}

export type RuleInput = Omit<Rule, "id" | "position">;

export interface SessionState {
  signedIn: boolean;
  providers: { google: boolean; microsoft: boolean };
  legacyAccounts: number;
}

export type { DeviceSession, UserProfile, UserSettings } from "@gunes/shared";

export interface MailApi {
  readonly demo: boolean;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, name: string): Promise<void>;
  profile(): Promise<UserProfile>;
  updateProfile(patch: { name?: string; email?: string }): Promise<UserProfile>;
  setPassword(password: string, current?: string): Promise<void>;
  getSettings(): Promise<UserSettings>;
  saveSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
  listSessions(): Promise<DeviceSession[]>;
  revokeSession(id: string): Promise<void>;
  deleteAccount(): Promise<void>;
  session(): Promise<SessionState>;
  migrateLegacyAccounts(): Promise<string[]>;
  signOut(): Promise<void>;
  cancelSignIn(): Promise<void>;
  listAccounts(): Promise<Account[]>;
  addOAuthAccount(provider: "google" | "microsoft"): Promise<string>;
  imapPresets(): Promise<ImapPreset[]>;
  addImapAccount(input: ImapAccountInput): Promise<string>;
  removeAccount(accountId: string): Promise<void>;
  syncAccount(accountId: string): Promise<void>;
  listLabels(accountId: string): Promise<Label[]>;
  listThreads(accountId: string, params: ListParams): Promise<ThreadPage>;
  getThread(accountId: string, threadId: string): Promise<Thread>;
  modifyThreads(accountId: string, ids: string[], add: string[], remove: string[]): Promise<void>;
  trashThreads(accountId: string, ids: string[]): Promise<void>;
  untrashThreads(accountId: string, ids: string[]): Promise<void>;
  deleteThreads(accountId: string, ids: string[]): Promise<void>;
  emptyFolder(accountId: string, folder: string): Promise<void>;
  markFolderRead(accountId: string, folder: string): Promise<void>;
  send(accountId: string, message: OutgoingMessage, options: { sendAt?: number; undoSeconds: number }): Promise<SendResult>;
  listOutbox(): Promise<OutboxItem[]>;
  cancelOutbox(id: string): Promise<{ payload: OutgoingMessage; accountId: string }>;
  sendOutboxNow(id: string): Promise<void>;
  saveDraft(accountId: string, message: OutgoingMessage): Promise<string>;
  deleteDraft(accountId: string, draftId: string): Promise<void>;
  findDraftId(accountId: string, messageId: string): Promise<string | undefined>;
  createLabel(accountId: string, name: string): Promise<Label>;
  renameLabel(accountId: string, labelId: string, name: string): Promise<void>;
  deleteLabel(accountId: string, labelId: string): Promise<void>;
  getAttachmentData(accountId: string, messageId: string, attachmentId: string): Promise<string>;
  getAttachmentBlob(accountId: string, messageId: string, attachmentId: string): Promise<Blob>;
  saveAttachment(accountId: string, messageId: string, attachment: Attachment, open: boolean): Promise<string>;
  searchContacts(query: string): Promise<Contact[]>;
  contactPhotos(emails: string[]): Promise<Record<string, string>>;
  listRules(): Promise<Rule[]>;
  createRule(rule: RuleInput): Promise<Rule>;
  updateRule(id: string, rule: RuleInput): Promise<Rule>;
  deleteRule(id: string): Promise<void>;
  reorderRules(ids: string[]): Promise<void>;
  runRule(id: string): Promise<number>;
  setTriage(accountId: string, ids: string[], category: TriageCategory | null): Promise<void>;
  /** Moves every conversation from a sender in `source`, or counts them when dryRun is set. */
  moveMatching(
    accountId: string,
    input: { sender: string; source: string; add: string[]; remove: string[]; dryRun?: boolean },
  ): Promise<number>;
  aiCapabilities(): Promise<AiCapabilities>;
  threadInsight(accountId: string, threadId: string, refresh?: boolean): Promise<ThreadInsight>;
  /** Streams plain text; onText receives the accumulated text so far. */
  aiCompose(
    accountId: string,
    request: AiComposeRequest,
    onText: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  subscribe(onEvent: (event: ServerEvent) => void): () => void;
  openExternal(url: string): Promise<void>;
}
