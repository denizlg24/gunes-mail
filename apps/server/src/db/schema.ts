import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { UserSettings } from "@gunes/shared";

import type { AttachmentMeta, Mailbox, OutgoingPayload, RuleAction, RuleCondition } from "../providers/types";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash"),
  settings: jsonb("settings").$type<Partial<UserSettings>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  deviceName: text("device_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["gmail", "microsoft", "imap"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    picture: text("picture"),
    credentials: text("credentials").notNull(),
    syncState: jsonb("sync_state").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["syncing", "ready", "error"] }).notNull().default("syncing"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_provider_identity").on(t.provider, t.providerUserId)],
);

export const labels = pgTable(
  "labels",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["system", "user"] }).notNull(),
    color: jsonb("color").$type<{ backgroundColor: string; textColor: string }>(),
    providerRef: text("provider_ref"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.id] })],
);

export const messages = pgTable(
  "messages",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    threadId: text("thread_id").notNull(),
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    from: jsonb("from").$type<Mailbox>().notNull(),
    to: jsonb("to").$type<Mailbox[]>().notNull().default([]),
    cc: jsonb("cc").$type<Mailbox[]>().notNull().default([]),
    bcc: jsonb("bcc").$type<Mailbox[]>().notNull().default([]),
    replyTo: jsonb("reply_to").$type<Mailbox[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    date: timestamp("date", { withTimezone: true }).notNull(),
    snippet: text("snippet").notNull().default(""),
    html: text("html"),
    text: text("text"),
    bodyFetched: boolean("body_fetched").notNull().default(false),
    attachments: jsonb("attachments").$type<AttachmentMeta[]>().notNull().default([]),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    messageIdHeader: text("message_id_header"),
    inReplyTo: text("in_reply_to"),
    references: text("references"),
    providerRef: jsonb("provider_ref").$type<Record<string, unknown>>(),
    category: text("category", { enum: ["focused", "other"] }),
    rulesApplied: boolean("rules_applied").notNull().default(false),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce("subject", '')), 'A') || setweight(to_tsvector('simple', coalesce("from"->>'name', '') || ' ' || coalesce("from"->>'email', '')), 'B') || setweight(to_tsvector('simple', coalesce("snippet", '') || ' ' || coalesce(left("text", 20000), '')), 'C')`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index("messages_thread").on(t.accountId, t.threadId),
    index("messages_labels").using("gin", t.labelIds),
    index("messages_search").using("gin", t.search),
    index("messages_message_id").on(t.accountId, t.messageIdHeader),
  ],
);

export const threads = pgTable(
  "threads",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    lastDate: timestamp("last_date", { withTimezone: true }).notNull(),
    labelIds: text("label_ids").array().notNull().default(sql`'{}'::text[]`),
    senders: jsonb("senders").$type<Mailbox[]>().notNull().default([]),
    recipients: jsonb("recipients").$type<Mailbox[]>().notNull().default([]),
    messageCount: integer("message_count").notNull().default(0),
    unread: boolean("unread").notNull().default(false),
    flagged: boolean("flagged").notNull().default(false),
    draft: boolean("draft").notNull().default(false),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    category: text("category"),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index("threads_recent").on(t.accountId, t.lastDate),
    index("threads_labels").using("gin", t.labelIds),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    photoUrl: text("photo_url"),
    source: text("source", { enum: ["directory", "history"] }).notNull().default("history"),
    timesContacted: integer("times_contacted").notNull().default(0),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.email] })],
);

export const rules = pgTable("rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["incoming", "outgoing"] }).notNull().default("incoming"),
  enabled: boolean("enabled").notNull().default(true),
  position: integer("position").notNull().default(0),
  match: text("match", { enum: ["all", "any"] }).notNull().default("all"),
  conditions: jsonb("conditions").$type<RuleCondition[]>().notNull(),
  actions: jsonb("actions").$type<RuleAction[]>().notNull(),
  stopProcessing: boolean("stop_processing").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<OutgoingPayload>().notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["scheduled", "sending", "sent", "failed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_due").on(t.status, t.sendAt)],
);
