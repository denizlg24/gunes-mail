import { folderQuery } from "./folders";
import { htmlToText } from "./mime";
import { DEFAULT_SETTINGS } from "@gunes/shared";

import type {
  Account,
  DeviceSession,
  UserProfile,
  UserSettings,
  Attachment,
  Contact,
  ImapAccountInput,
  Label,
  ListParams,
  MailApi,
  Mailbox,
  Message,
  OutboxItem,
  OutgoingMessage,
  Rule,
  RuleInput,
  SendResult,
  ServerEvent,
  Thread,
  ThreadPage,
  ThreadSummary,
} from "./types";

const ACCOUNTS: Account[] = [
  { id: "demo-personal", provider: "gmail", status: "ready", email: "alex.morgan@gmail.com", name: "Alex Morgan" },
  { id: "demo-studio", provider: "gmail", status: "ready", email: "morgan.studio.hq@gmail.com", name: "Morgan Studio" },
];

const PEOPLE: Mailbox[] = [
  { name: "Priya Raman", email: "priya.raman@northwind.io" },
  { name: "Jonas Becker", email: "jonas@becker-design.de" },
  { name: "GitHub", email: "noreply@github.com" },
  { name: "Linear", email: "notifications@linear.app" },
  { name: "Maya Chen", email: "maya.chen@gmail.com" },
  { name: "Figma", email: "no-reply@figma.com" },
  { name: "Tomás Oliveira", email: "tomas.oliveira@outlook.pt" },
  { name: "Stripe", email: "receipts@stripe.com" },
  { name: "Sarah Kim", email: "sarah.kim@contoso.com" },
  { name: "TAP Air Portugal", email: "booking@flytap.com" },
  { name: "Daniel Okafor", email: "daniel.okafor@fabrikam.com" },
  { name: "Vercel", email: "notifications@vercel.com" },
  { name: "Emma Laurent", email: "emma.laurent@adatum.fr" },
  { name: "Notion Team", email: "team@makenotion.com" },
];

const SUBJECTS: { subject: string; body: string; category: "primary" | "other"; attach?: string }[] = [
  { subject: "Q4 roadmap review — notes and next steps", body: "Thanks everyone for joining today. I've summarised the decisions below:<ul><li>Ship the offline mode beta by Nov 28</li><li>Move the analytics revamp to Q1</li><li>Hire one more frontend engineer</li></ul>Let me know if I missed anything.", category: "primary", attach: "Q4-Roadmap.pdf" },
  { subject: "Lunch on Thursday?", body: "Hey! Are you free for lunch on Thursday? There's a new ramen place near the office I've been wanting to try.", category: "primary" },
  { subject: "[outlook-clone] Pull request #42: Add keyboard shortcuts", body: "<b>@maya-chen</b> requested your review on this pull request.<br><br>Adds Ctrl+R / Ctrl+Shift+R / Ctrl+F handlers and a shortcut cheat sheet.", category: "other" },
  { subject: "ENG-1182 moved to In Review", body: "Sarah Kim moved <b>ENG-1182 Sync drafts across devices</b> from In Progress to In Review.", category: "other" },
  { subject: "Contract draft for the website redesign", body: "Please find attached the draft contract. The main changes from last time are the payment schedule (now 40/30/30) and the extended support window.", category: "primary", attach: "Contract-v3.docx" },
  { subject: "Your receipt from Stripe #1834-2291", body: "Amount paid: <b>€49.00</b><br>Date paid: this week<br>Payment method: Visa ending in 4242", category: "other", attach: "Receipt-1834-2291.pdf" },
  { subject: "Design review: new onboarding flow", body: "I've updated the onboarding prototype with the feedback from Monday. The biggest change is the account connection step, which now happens after the tour.", category: "primary" },
  { subject: "Your flight to Lisbon is confirmed", body: "Booking reference <b>X7K2PL</b>.<br>Departure: Friday 08:35 — Arrival: 10:05.<br>Seat 14A. Have a great trip!", category: "other", attach: "Boarding-pass.pdf" },
  { subject: "Re: Invoice for October", body: "Thanks, payment has been scheduled for the 15th. Could you send the updated VAT number for next month's invoice?", category: "primary" },
  { subject: "Deployment succeeded: outlook-clone (production)", body: "Your deployment is live.<br><br>Commit: <code>feat: conversation view</code><br>Duration: 48s", category: "other" },
  { subject: "Weekend plans 🎉", body: "We're thinking of going hiking in Sintra on Saturday. Want to join? We'd leave around 9.", category: "primary" },
  { subject: "Feedback on the API proposal", body: "Overall I like the direction. Two concerns: pagination should be cursor-based, and we should version the endpoints from day one. Happy to pair on it tomorrow.", category: "primary" },
  { subject: "Your weekly Notion digest", body: "Here's what happened in your workspace this week: 14 pages edited, 3 new comments mentioning you.", category: "other" },
  { subject: "Quarterly planning offsite — agenda", body: "Agenda for the offsite is attached. Please add any topics you'd like to cover by Wednesday.", category: "primary", attach: "Offsite-agenda.xlsx" },
  { subject: "Can you review the hiring rubric?", body: "We're finalising the frontend rubric. I'd love your eyes on the system design section before we share it with the panel.", category: "primary" },
  { subject: "Figma: Maya commented on Mail App — Components", body: "<i>\"Should the hover actions be visible on the selected row as well?\"</i>", category: "other" },
];

const USER_LABELS: Record<string, Label[]> = {
  "demo-personal": [
    { id: "Label_1", name: "Travel", type: "user", unread: 0, total: 0 },
    { id: "Label_2", name: "Receipts", type: "user", unread: 0, total: 0 },
    { id: "Label_3", name: "Family", type: "user", unread: 0, total: 0 },
  ],
  "demo-studio": [
    { id: "Label_11", name: "Clients", type: "user", unread: 0, total: 0 },
    { id: "Label_12", name: "Clients/Northwind", type: "user", unread: 0, total: 0 },
    { id: "Label_13", name: "Clients/Fabrikam", type: "user", unread: 0, total: 0 },
    { id: "Label_14", name: "Invoices", type: "user", unread: 0, total: 0 },
  ],
};

interface DemoThread {
  id: string;
  category: "primary" | "other";
  messages: Message[];
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function bodyHtml(sender: Mailbox, body: string): string {
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5"><p>Hi,</p><p>${body}</p><p>Best,<br>${sender.name}</p></div>`;
}

function attachment(name: string): Attachment {
  const ext = name.split(".").pop() ?? "";
  const mime: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return {
    attachmentId: `att-${name}`,
    filename: name,
    mimeType: mime[ext] ?? "application/octet-stream",
    size: 48_000 + name.length * 9_731,
    inline: false,
  };
}

function generate(account: Account, seed: number): DemoThread[] {
  const rand = seeded(seed);
  const me: Mailbox = { name: account.name, email: account.email };
  const now = Date.now();
  const threads: DemoThread[] = [];
  const labels = USER_LABELS[account.id];

  for (let i = 0; i < 48; i++) {
    const tpl = SUBJECTS[Math.floor(rand() * SUBJECTS.length)];
    const sender = PEOPLE[Math.floor(rand() * PEOPLE.length)];
    const age = i < 4 ? i * 40 * 60_000 : Math.pow(i, 1.7) * 3_600_000 * (0.6 + rand());
    const date = now - age;
    const id = `${account.id}-t${i}`;
    const count = rand() > 0.72 ? 2 + Math.floor(rand() * 2) : 1;
    const baseLabels: string[] = [];
    const roll = rand();
    if (roll < 0.78) baseLabels.push("INBOX");
    else if (roll < 0.84) baseLabels.push("SENT");
    else if (roll < 0.88) baseLabels.push("SPAM");
    else if (roll < 0.92) baseLabels.push("TRASH");
    if (rand() < 0.18) baseLabels.push("STARRED");
    if (rand() < 0.25) baseLabels.push(labels[Math.floor(rand() * labels.length)].id);
    const unread = i < 6 ? rand() < 0.8 : rand() < 0.2;

    const messages: Message[] = [];
    for (let m = 0; m < count; m++) {
      const fromMe = baseLabels.includes("SENT") ? m % 2 === 0 : m % 2 === 1;
      const from = fromMe ? me : sender;
      const to = fromMe ? [sender] : [me];
      const isLast = m === count - 1;
      const msgLabels = [...baseLabels];
      if (unread && isLast && !fromMe) msgLabels.push("UNREAD");
      const html = bodyHtml(from, m === 0 ? tpl.body : "Sounds good — thanks for the quick turnaround. I'll follow up later today.");
      messages.push({
        id: `${id}-m${m}`,
        threadId: id,
        labelIds: msgLabels,
        from,
        to,
        cc: m === 0 && rand() < 0.3 ? [PEOPLE[(i + 3) % PEOPLE.length]] : [],
        bcc: [],
        replyTo: [],
        subject: m === 0 ? tpl.subject : `Re: ${tpl.subject}`,
        date: date - (count - 1 - m) * 2.5 * 3_600_000,
        snippet: htmlToText(html).replace(/\s+/g, " ").slice(0, 140),
        html,
        attachments: m === 0 && tpl.attach ? [attachment(tpl.attach)] : [],
        messageIdHeader: `<${id}-m${m}@demo.mail>`,
        unread: msgLabels.includes("UNREAD"),
        flagged: msgLabels.includes("STARRED"),
        draft: false,
      });
    }
    threads.push({ id, category: tpl.category, messages });
  }

  threads.push({
    id: `${account.id}-draft`,
    category: "primary",
    messages: [
      {
        id: `${account.id}-draft-m0`,
        threadId: `${account.id}-draft`,
        labelIds: ["DRAFT"],
        from: me,
        to: [PEOPLE[0]],
        cc: [],
        bcc: [],
        replyTo: [],
        subject: "Follow-up on the proposal",
        date: now - 5 * 3_600_000,
        snippet: "Hi Priya, following up on the proposal we discussed…",
        html: "<p>Hi Priya,</p><p>Following up on the proposal we discussed…</p>",
        attachments: [],
        unread: false,
        flagged: false,
        draft: true,
      },
    ],
  });
  return threads;
}

function syncFlags(m: Message) {
  m.unread = m.labelIds.includes("UNREAD");
  m.flagged = m.labelIds.includes("STARRED");
  m.draft = m.labelIds.includes("DRAFT");
}

export class DemoMailApi implements MailApi {
  readonly demo = true;
  private accounts = [...ACCOUNTS];
  private data = new Map<string, DemoThread[]>(
    ACCOUNTS.map((a, i) => [a.id, generate(a, 7 + i * 31)]),
  );
  private labels = new Map<string, Label[]>(
    Object.entries(USER_LABELS).map(([k, v]) => [k, v.map((l) => ({ ...l }))]),
  );
  private nextId = 1000;

  private threads(accountId: string) {
    return this.data.get(accountId) ?? [];
  }

  private thread(accountId: string, id: string) {
    const t = this.threads(accountId).find((x) => x.id === id);
    if (!t) throw new Error("Thread not found");
    return t;
  }

  private listeners = new Set<(event: ServerEvent) => void>();
  private outbox: (OutboxItem & { timer: ReturnType<typeof setTimeout> })[] = [];
  private rules: Rule[] = [
    {
      id: "rule-1",
      name: "Receipts to Receipts folder",
      kind: "incoming",
      accountId: null,
      enabled: true,
      position: 0,
      match: "any",
      conditions: [{ field: "from", operator: "contains", value: "stripe.com" }],
      actions: [{ type: "move", folder: "Label_2" }, { type: "mark_read" }],
      stopProcessing: false,
    },
  ];

  private emit(event: ServerEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private settings: UserSettings = { ...DEFAULT_SETTINGS };

  async login() {}

  async register() {}

  async profile(): Promise<UserProfile> {
    return { id: "demo", email: "alex.morgan@gmail.com", name: "Alex Morgan", hasPassword: true, createdAt: Date.now() - 86_400_000 * 30 };
  }

  async updateProfile(): Promise<UserProfile> {
    return this.profile();
  }

  async setPassword() {}

  async getSettings() {
    return this.settings;
  }

  async saveSettings(patch: Partial<UserSettings>) {
    this.settings = { ...this.settings, ...patch };
    return this.settings;
  }

  async listSessions(): Promise<DeviceSession[]> {
    return [
      { id: "s1", name: "Güneş Mail on macOS", createdAt: Date.now() - 86_400_000 * 3, lastUsedAt: Date.now(), current: true },
      { id: "s2", name: "Güneş Mail on Windows", createdAt: Date.now() - 86_400_000 * 20, lastUsedAt: Date.now() - 3_600_000 * 5, current: false },
    ];
  }

  async revokeSession() {}

  async deleteAccount() {}

  async session() {
    return { signedIn: true, providers: { google: true, microsoft: true }, legacyAccounts: 0 };
  }

  async migrateLegacyAccounts() {
    return [];
  }

  async signOut() {}

  async cancelSignIn() {}

  async listAccounts() {
    await delay(40);
    return this.accounts;
  }

  async addOAuthAccount(): Promise<string> {
    await delay(600);
    throw new Error("Adding accounts requires the desktop app (demo mode)");
  }

  async imapPresets() {
    return [
      { id: "icloud", label: "iCloud Mail", appPasswordUrl: "https://account.apple.com" },
      { id: "yahoo", label: "Yahoo Mail", appPasswordUrl: "https://login.yahoo.com/account/security" },
      { id: "fastmail", label: "Fastmail", appPasswordUrl: "https://app.fastmail.com/settings/security/apps" },
      { id: "zoho", label: "Zoho Mail", appPasswordUrl: "https://accounts.zoho.com/home#security/app_password" },
    ];
  }

  async addImapAccount(input: ImapAccountInput): Promise<string> {
    await delay(800);
    throw new Error(`Couldn't sign in to ${input.email} (demo mode)`);
  }

  async syncAccount() {
    await delay(300);
  }

  async listOutbox(): Promise<OutboxItem[]> {
    return this.outbox.map(({ id, accountId, status, sendAt, subject, to, payload }) => ({
      id,
      accountId,
      status,
      sendAt,
      subject,
      to,
      payload,
    }));
  }

  async cancelOutbox(id: string) {
    const item = this.outbox.find((o) => o.id === id);
    if (!item) throw new Error("Already sent");
    clearTimeout(item.timer);
    this.outbox = this.outbox.filter((o) => o.id !== id);
    this.emit({ type: "outbox", id, status: "cancelled" });
    return { payload: item.payload, accountId: item.accountId };
  }

  async sendOutboxNow(id: string) {
    const item = this.outbox.find((o) => o.id === id);
    if (!item) return;
    clearTimeout(item.timer);
    await this.deliver(item.accountId, item.payload, id);
  }

  private async deliver(accountId: string, msg: OutgoingMessage, outboxId: string) {
    this.outbox = this.outbox.filter((o) => o.id !== outboxId);
    if (msg.draftId) await this.deleteDraft(accountId, msg.draftId);
    const existing = msg.threadId ? this.threads(accountId).find((t) => t.id === msg.threadId) : undefined;
    if (existing) existing.messages.push(this.toMessage(msg, existing.id, ["SENT"]));
    else {
      const id = `demo-thread-${this.nextId++}`;
      this.threads(accountId).push({ id, category: "primary", messages: [this.toMessage(msg, id, ["SENT"])] });
    }
    this.emit({ type: "outbox", id: outboxId, status: "sent" });
    this.emit({ type: "changed", accountId });
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const q = query.toLowerCase();
    return PEOPLE.filter((p) => p.email.includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ ...p, photoUrl: null }));
  }

  async contactPhotos() {
    return {};
  }

  async listRules() {
    return this.rules;
  }

  async createRule(input: RuleInput) {
    const rule: Rule = { ...input, id: `rule-${this.nextId++}`, position: this.rules.length };
    this.rules = [...this.rules, rule];
    return rule;
  }

  async updateRule(id: string, input: RuleInput) {
    const existing = this.rules.find((r) => r.id === id);
    if (!existing) throw new Error("Rule not found");
    const rule: Rule = { ...existing, ...input };
    this.rules = this.rules.map((r) => (r.id === id ? rule : r));
    return rule;
  }

  async deleteRule(id: string) {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  async reorderRules(ids: string[]) {
    this.rules = ids.flatMap((id, position) => {
      const rule = this.rules.find((r) => r.id === id);
      return rule ? [{ ...rule, position }] : [];
    });
  }

  async runRule() {
    await delay(500);
    return 42;
  }

  subscribe(onEvent: (event: ServerEvent) => void) {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  async removeAccount(accountId: string) {
    this.accounts = this.accounts.filter((a) => a.id !== accountId);
  }

  async listLabels(accountId: string): Promise<Label[]> {
    await delay();
    const threads = this.threads(accountId);
    const count = (id: string) => {
      const matching = threads.filter((t) => {
        const all = new Set(t.messages.flatMap((m) => m.labelIds));
        if (!all.has(id)) return false;
        return id === "TRASH" || id === "SPAM" || (!all.has("TRASH") && !all.has("SPAM"));
      });
      return {
        total: matching.length,
        unread:
          id === "DRAFT"
            ? matching.length
            : matching.filter((t) => t.messages.some((m) => m.unread)).length,
      };
    };
    const system: Label[] = ["INBOX", "DRAFT", "SENT", "TRASH", "SPAM", "STARRED"].map((id) => ({
      id,
      name: id,
      type: "system",
      ...count(id),
    }));
    const user = (this.labels.get(accountId) ?? []).map((l) => ({ ...l, ...count(l.id) }));
    return [...system, ...user];
  }

  private matches(t: DemoThread, labelIds: string[], q: string, account: Account): boolean {
    const all = new Set(t.messages.flatMap((m) => m.labelIds));
    if (labelIds.some((id) => !all.has(id))) return false;
    const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    for (const token of tokens) {
      const neg = token.startsWith("-");
      const raw = neg ? token.slice(1) : token;
      let ok: boolean;
      if (raw === "is:unread") ok = t.messages.some((m) => m.unread);
      else if (raw === "is:starred") ok = all.has("STARRED");
      else if (raw === "has:attachment") ok = t.messages.some((m) => m.attachments.length > 0);
      else if (raw === "to:me") ok = t.messages.some((m) => m.to.some((x) => x.email === account.email));
      else if (raw === "category:primary") ok = t.category === "primary";
      else if (raw.startsWith("in:")) {
        const map: Record<string, string> = { inbox: "INBOX", sent: "SENT", drafts: "DRAFT", spam: "SPAM", trash: "TRASH" };
        ok = map[raw.slice(3)] ? all.has(map[raw.slice(3)]) : false;
      } else {
        const needle = raw.replace(/"/g, "").toLowerCase();
        ok = t.messages.some((m) =>
          [m.subject, m.snippet, m.from.name, m.from.email].some((s) => s.toLowerCase().includes(needle)),
        );
      }
      if (neg ? ok : !ok) return false;
    }
    if (!labelIds.includes("TRASH") && !labelIds.includes("SPAM") && (all.has("TRASH") || all.has("SPAM")))
      return false;
    return true;
  }

  async listThreads(accountId: string, params: ListParams): Promise<ThreadPage> {
    await delay(250);
    const account = this.accounts.find((a) => a.id === accountId) ?? ACCOUNTS[0];
    const { labelIds, q } = folderQuery(params);
    const matching = this.threads(accountId)
      .filter((t) => this.matches(t, labelIds, q, account))
      .sort((a, b) => b.messages[b.messages.length - 1].date - a.messages[a.messages.length - 1].date);
    const start = Number(params.pageToken ?? 0);
    const page = matching.slice(start, start + 25);
    return {
      threads: page.map((t) => this.summary(t)),
      nextPageToken: start + 25 < matching.length ? String(start + 25) : undefined,
    };
  }

  private summary(t: DemoThread): ThreadSummary {
    const last = t.messages[t.messages.length - 1];
    const senders = new Map(t.messages.map((m) => [m.from.email, m.from]));
    return {
      id: t.id,
      subject: t.messages[0].subject,
      snippet: last.snippet,
      senders: Array.from(senders.values()),
      recipients: last.to,
      date: last.date,
      unread: t.messages.some((m) => m.unread),
      flagged: t.messages.some((m) => m.flagged),
      hasAttachments: t.messages.some((m) => m.attachments.length > 0),
      messageCount: t.messages.length,
      labelIds: Array.from(new Set(t.messages.flatMap((m) => m.labelIds))),
      draft: t.messages.some((m) => m.draft),
    };
  }

  async getThread(accountId: string, threadId: string): Promise<Thread> {
    await delay(150);
    const t = this.thread(accountId, threadId);
    const messages = t.messages.map((m) => ({ ...m, labelIds: [...m.labelIds] }));
    return {
      id: t.id,
      subject: t.messages[0].subject,
      messages,
      labelIds: Array.from(new Set(messages.flatMap((m) => m.labelIds))),
    };
  }

  async modifyThreads(accountId: string, ids: string[], add: string[], remove: string[]) {
    await delay();
    for (const id of ids) {
      for (const m of this.thread(accountId, id).messages) {
        m.labelIds = Array.from(new Set([...m.labelIds.filter((l) => !remove.includes(l)), ...add]));
        syncFlags(m);
      }
    }
  }

  async trashThreads(accountId: string, ids: string[]) {
    await this.modifyThreads(accountId, ids, ["TRASH"], []);
  }

  async untrashThreads(accountId: string, ids: string[]) {
    await this.modifyThreads(accountId, ids, [], ["TRASH"]);
  }

  async deleteThreads(accountId: string, ids: string[]) {
    await delay();
    this.data.set(accountId, this.threads(accountId).filter((t) => !ids.includes(t.id)));
  }

  async emptyFolder(accountId: string, folder: string) {
    const ids = this.threads(accountId)
      .filter((t) => t.messages.some((m) => m.labelIds.includes(folder)))
      .map((t) => t.id);
    await this.deleteThreads(accountId, ids);
  }

  async markFolderRead(accountId: string, folder: string) {
    await delay();
    for (const t of this.threads(accountId)) {
      if (!t.messages.some((m) => m.labelIds.includes(folder))) continue;
      for (const m of t.messages) {
        m.labelIds = m.labelIds.filter((l) => l !== "UNREAD");
        syncFlags(m);
      }
    }
  }

  private toMessage(msg: OutgoingMessage, threadId: string, labels: string[]): Message {
    return {
      id: `demo-${this.nextId++}`,
      threadId,
      labelIds: labels,
      from: msg.from,
      to: msg.to,
      cc: msg.cc,
      bcc: msg.bcc,
      replyTo: [],
      subject: msg.subject,
      date: Date.now(),
      snippet: msg.text.slice(0, 140),
      html: msg.html,
      attachments: msg.attachments.map((a) => ({
        attachmentId: `local-${a.filename}`,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        inline: false,
      })),
      unread: false,
      flagged: false,
      draft: labels.includes("DRAFT"),
    };
  }

  async send(accountId: string, msg: OutgoingMessage, options: { sendAt?: number; undoSeconds: number }): Promise<SendResult> {
    await delay(150);
    const id = `outbox-${this.nextId++}`;
    const sendAt = options.sendAt ?? Date.now() + options.undoSeconds * 1000;
    const timer = setTimeout(() => void this.deliver(accountId, msg, id), Math.max(0, sendAt - Date.now()));
    this.outbox.push({ id, accountId, status: "scheduled", sendAt, subject: msg.subject, to: msg.to, payload: msg, timer });
    this.emit({ type: "outbox", id, status: "scheduled" });
    return { id, sendAt, delayedByRule: 0 };
  }

  async saveDraft(accountId: string, msg: OutgoingMessage) {
    await delay();
    if (msg.draftId) await this.deleteDraft(accountId, msg.draftId);
    const id = `demo-draft-${this.nextId++}`;
    const message = this.toMessage(msg, id, ["DRAFT"]);
    message.id = `${id}-m0`;
    this.threads(accountId).push({ id, category: "primary", messages: [message] });
    return id;
  }

  async deleteDraft(accountId: string, draftId: string) {
    this.data.set(accountId, this.threads(accountId).filter((t) => t.id !== draftId));
  }

  async findDraftId(accountId: string, messageId: string) {
    return this.threads(accountId).find((t) => t.messages.some((m) => m.id === messageId))?.id;
  }

  async createLabel(accountId: string, name: string): Promise<Label> {
    const label: Label = { id: `Label_${this.nextId++}`, name, type: "user", unread: 0, total: 0 };
    this.labels.set(accountId, [...(this.labels.get(accountId) ?? []), label]);
    return label;
  }

  async renameLabel(accountId: string, labelId: string, name: string) {
    const labels = this.labels.get(accountId) ?? [];
    const target = labels.find((l) => l.id === labelId);
    if (!target) return;
    const old = target.name;
    for (const l of labels) {
      if (l.name === old || l.name.startsWith(`${old}/`)) l.name = name + l.name.slice(old.length);
    }
  }

  async deleteLabel(accountId: string, labelId: string) {
    this.labels.set(accountId, (this.labels.get(accountId) ?? []).filter((l) => l.id !== labelId));
    await this.modifyThreads(
      accountId,
      this.threads(accountId).map((t) => t.id),
      [],
      [labelId],
    );
  }

  async getAttachmentData() {
    return "";
  }

  async getAttachmentBlob(_accountId: string, _messageId: string, attachmentId: string) {
    await delay(200);
    return new Blob([`Demo attachment ${attachmentId}\n\nAttachments preview here in the desktop app.`], { type: "text/plain" });
  }

  async saveAttachment(_accountId: string, _messageId: string, attachment: Attachment) {
    await delay(300);
    return `~/Downloads/${attachment.filename}`;
  }

  async openExternal(url: string) {
    window.open(url, "_blank", "noopener");
  }
}
