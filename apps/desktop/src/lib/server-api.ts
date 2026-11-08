import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { folderQuery } from "./folders";
import { bytesToBase64 } from "./mime";
import type {
  Account,
  DeviceSession,
  UserProfile,
  UserSettings,
  Attachment,
  Contact,
  ImapAccountInput,
  ImapPreset,
  Label,
  ListParams,
  MailApi,
  OutboxItem,
  OutgoingMessage,
  Rule,
  RuleInput,
  SendResult,
  ServerEvent,
  SessionState,
  Thread,
  ThreadPage,
} from "./types";

interface NativeSession {
  apiUrl: string;
  token: string | null;
  google: boolean;
  microsoft: boolean;
  legacyAccounts: number;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DEVICE_NAME = `Gunes Mail on ${
  typeof navigator === "undefined"
    ? "desktop"
    : /Mac/.test(navigator.userAgent)
      ? "macOS"
      : /Windows/.test(navigator.userAgent)
        ? "Windows"
        : "Linux"
}`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Support reference for server-side failures, e.g. GM-7K3QX9P2. */
    readonly ref?: string,
  ) {
    super(message);
  }
}

export class ServerMailApi implements MailApi {
  readonly demo = false;
  private native: NativeSession | null = null;

  private async ensureSession(): Promise<NativeSession> {
    this.native ??= await invoke<NativeSession>("session");
    return this.native;
  }

  private async refreshSession() {
    this.native = await invoke<NativeSession>("session");
    return this.native;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { apiUrl, token } = await this.ensureSession();
    if (!token) throw new ApiError(401, "Not signed in");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-device-name", DEVICE_NAME);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1${path}`, { ...init, headers });
    } catch {
      throw new ApiError(0, "Can't reach the Güneş Mail server. Check your connection.");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; ref?: string } | null;
      throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.ref);
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }

  private json(method: string, body: unknown): RequestInit {
    return { method, body: JSON.stringify(body) };
  }

  private async publicAuth(path: "login" | "register", body: Record<string, string>) {
    const { apiUrl } = await this.ensureSession();
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/v1/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-name": DEVICE_NAME },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "Can't reach the Güneş Mail server. Check your connection.");
    }
    const json = (await res.json().catch(() => ({}))) as { session?: string; error?: string };
    if (!res.ok || !json.session) throw new ApiError(res.status, json.error ?? "Couldn't sign in");
    await invoke("store_session", { token: json.session });
    await this.refreshSession();
  }

  login(email: string, password: string) {
    return this.publicAuth("login", { email, password });
  }

  register(email: string, password: string, name: string) {
    return this.publicAuth("register", { email, password, name });
  }

  profile() {
    return this.request<UserProfile>("/me");
  }

  updateProfile(patch: { name?: string; email?: string }) {
    return this.request<UserProfile>("/me", this.json("PATCH", patch));
  }

  async setPassword(password: string, current?: string) {
    await this.request("/me/password", this.json("PUT", { password, current }));
  }

  getSettings() {
    return this.request<UserSettings>("/me/settings");
  }

  saveSettings(patch: Partial<UserSettings>) {
    return this.request<UserSettings>("/me/settings", this.json("PUT", patch));
  }

  listSessions() {
    return this.request<DeviceSession[]>("/me/sessions");
  }

  async revokeSession(id: string) {
    await this.request(`/me/sessions/${id}`, { method: "DELETE" });
  }

  async deleteAccount() {
    await this.request("/me", { method: "DELETE" });
    await invoke("sign_out");
    await this.refreshSession();
  }

  async session(): Promise<SessionState> {
    const s = await this.refreshSession();
    return {
      signedIn: !!s.token,
      providers: { google: s.google, microsoft: s.microsoft },
      legacyAccounts: s.legacyAccounts,
    };
  }

  async migrateLegacyAccounts() {
    const migrated = await invoke<string[]>("migrate_legacy_accounts");
    await this.refreshSession();
    return migrated;
  }

  async signOut() {
    await invoke("sign_out");
    await this.refreshSession();
  }

  cancelSignIn() {
    return invoke<void>("cancel_sign_in");
  }

  listAccounts() {
    return this.request<Account[]>("/accounts");
  }

  async addOAuthAccount(provider: "google" | "microsoft") {
    const id = await invoke<string>("connect_oauth", { provider });
    await this.refreshSession();
    return id;
  }

  async imapPresets() {
    const { apiUrl } = await this.ensureSession();
    const res = await fetch(`${apiUrl}/v1/connect/imap/presets`);
    return (await res.json()) as ImapPreset[];
  }

  async addImapAccount(input: ImapAccountInput) {
    const { apiUrl, token } = await this.ensureSession();
    const res = await fetch(`${apiUrl}/v1/connect/imap`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
    });
    const body = (await res.json()) as { error?: string; session?: string | null; accountId?: string };
    if (!res.ok) throw new ApiError(res.status, body.error ?? "Couldn't connect the account");
    if (body.session) {
      await invoke("store_session", { token: body.session });
      await this.refreshSession();
    }
    return body.accountId ?? "";
  }

  async removeAccount(accountId: string) {
    await this.request(`/accounts/${accountId}`, { method: "DELETE" });
  }

  async syncAccount(accountId: string) {
    await this.request(`/accounts/${accountId}/sync`, { method: "POST" });
  }

  listLabels(accountId: string) {
    return this.request<Label[]>(`/accounts/${accountId}/labels`);
  }

  listThreads(accountId: string, params: ListParams) {
    const query = new URLSearchParams({ folder: params.folder, filter: params.filter });
    if (params.tab) query.set("tab", params.tab);
    if (params.search) query.set("q", params.search);
    if (params.pageToken) query.set("cursor", params.pageToken);
    return this.request<ThreadPage>(`/accounts/${accountId}/threads?${query}`);
  }

  getThread(accountId: string, threadId: string) {
    return this.request<Thread>(`/accounts/${accountId}/threads/${encodeURIComponent(threadId)}`);
  }

  async modifyThreads(accountId: string, ids: string[], add: string[], remove: string[]) {
    await this.request(`/accounts/${accountId}/threads/modify`, this.json("POST", { ids, add, remove }));
  }

  async trashThreads(accountId: string, ids: string[]) {
    await this.request(`/accounts/${accountId}/threads/trash`, this.json("POST", { ids }));
  }

  async untrashThreads(accountId: string, ids: string[]) {
    await this.request(`/accounts/${accountId}/threads/untrash`, this.json("POST", { ids }));
  }

  async deleteThreads(accountId: string, ids: string[]) {
    await this.request(`/accounts/${accountId}/threads/delete`, this.json("POST", { ids }));
  }

  async emptyFolder(accountId: string, folder: string) {
    await this.request(`/accounts/${accountId}/folders/${folder}/empty`, { method: "POST" });
  }

  async markFolderRead(accountId: string, folder: string) {
    await this.request(`/accounts/${accountId}/folders/${folder}/mark-read`, { method: "POST" });
  }

  send(accountId: string, message: OutgoingMessage, options: { sendAt?: number; undoSeconds: number }) {
    return this.request<SendResult>(`/accounts/${accountId}/send`, this.json("POST", { payload: message, ...options }));
  }

  listOutbox() {
    return this.request<OutboxItem[]>("/outbox");
  }

  cancelOutbox(id: string) {
    return this.request<{ payload: OutgoingMessage; accountId: string }>(`/outbox/${id}`, { method: "DELETE" });
  }

  async sendOutboxNow(id: string) {
    await this.request(`/outbox/${id}/send-now`, { method: "POST" });
  }

  async saveDraft(accountId: string, message: OutgoingMessage) {
    const { draftId } = await this.request<{ draftId: string }>(`/accounts/${accountId}/drafts`, this.json("POST", message));
    return draftId;
  }

  async deleteDraft(accountId: string, draftId: string) {
    await this.request(`/accounts/${accountId}/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
  }

  async findDraftId(accountId: string, messageId: string) {
    const { draftId } = await this.request<{ draftId: string | null }>(
      `/accounts/${accountId}/messages/${encodeURIComponent(messageId)}/draft-id`,
    );
    return draftId ?? undefined;
  }

  createLabel(accountId: string, name: string) {
    return this.request<Label>(`/accounts/${accountId}/labels`, this.json("POST", { name }));
  }

  async renameLabel(accountId: string, labelId: string, name: string) {
    await this.request(`/accounts/${accountId}/labels/${encodeURIComponent(labelId)}`, this.json("PATCH", { name }));
  }

  async deleteLabel(accountId: string, labelId: string) {
    await this.request(`/accounts/${accountId}/labels/${encodeURIComponent(labelId)}`, { method: "DELETE" });
  }

  private attachmentPath(accountId: string, messageId: string, attachmentId: string) {
    return `/v1/accounts/${accountId}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  }

  async getAttachmentBlob(accountId: string, messageId: string, attachmentId: string) {
    const { apiUrl, token } = await this.ensureSession();
    const res = await fetch(`${apiUrl}${this.attachmentPath(accountId, messageId, attachmentId)}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; ref?: string } | null;
      throw new ApiError(res.status, body?.error ?? "Couldn't load the attachment", body?.ref);
    }
    return res.blob();
  }

  async getAttachmentData(accountId: string, messageId: string, attachmentId: string) {
    const blob = await this.getAttachmentBlob(accountId, messageId, attachmentId);
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  saveAttachment(accountId: string, messageId: string, attachment: Attachment, open: boolean) {
    if (!attachment.attachmentId) return Promise.reject(new Error("This attachment can't be downloaded"));
    return invoke<string>("save_attachment", {
      request: {
        path: this.attachmentPath(accountId, messageId, attachment.attachmentId),
        filename: attachment.filename,
        open,
      },
    });
  }

  searchContacts(query: string) {
    return this.request<Contact[]>(`/contacts?${new URLSearchParams({ q: query, limit: "8" })}`);
  }

  contactPhotos(emails: string[]) {
    return this.request<Record<string, string>>("/contacts/photos", this.json("POST", { emails }));
  }

  listRules() {
    return this.request<Rule[]>("/rules");
  }

  createRule(rule: RuleInput) {
    return this.request<Rule>("/rules", this.json("POST", rule));
  }

  updateRule(id: string, rule: RuleInput) {
    return this.request<Rule>(`/rules/${id}`, this.json("PUT", rule));
  }

  async deleteRule(id: string) {
    await this.request(`/rules/${id}`, { method: "DELETE" });
  }

  async reorderRules(ids: string[]) {
    await this.request("/rules/order", this.json("PATCH", { ids }));
  }

  async runRule(id: string) {
    const { processed } = await this.request<{ processed: number }>(`/rules/${id}/run`, { method: "POST" });
    return processed;
  }

  subscribe(onEvent: (event: ServerEvent) => void) {
    let stopped = false;
    let controller: AbortController | null = null;
    let delay = 1000;

    const connect = async () => {
      while (!stopped) {
        try {
          const { apiUrl, token } = await this.ensureSession();
          if (!token) return;
          controller = new AbortController();
          const res = await fetch(`${apiUrl}/v1/events`, {
            headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
          delay = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let split = buffer.indexOf("\n\n");
            while (split >= 0) {
              const frame = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              const event = /^event: (.*)$/m.exec(frame)?.[1];
              const data = /^data: (.*)$/m.exec(frame)?.[1];
              if (event === "message" && data) onEvent(JSON.parse(data) as ServerEvent);
              split = buffer.indexOf("\n\n");
            }
          }
        } catch {
          if (stopped) return;
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }

  openExternal(url: string) {
    return openUrl(url);
  }
}

export { folderQuery };
