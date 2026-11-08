import { afterEach, describe, expect, mock, test } from "bun:test";

import type { MessageRef, NormalizedLabel, NormalizedMessage, SyncSink } from "./types";

process.env.DATABASE_URL ??= "postgres://test";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "google-test";
process.env.MICROSOFT_CLIENT_ID ??= "ms-test";

const { MicrosoftProvider, mapFolders, normalizeMessage, planModify, folderLabelId, toAttachmentMeta } = await import(
  "./microsoft"
);
const { ProviderError } = await import("../lib/http");
type GraphMessage = import("./microsoft").GraphMessage;
type GraphFolder = import("./microsoft").GraphFolder;

const INBOX_ID = "AAMkAGI2TAAA=inbox";
const ARCHIVE_ID = "AAMkAGI2TAAA=archive";
const wellKnown = new Map([
  [INBOX_ID, "INBOX"],
  [ARCHIVE_ID, "ARCHIVE"],
]);

const folders: GraphFolder[] = [
  { id: INBOX_ID, displayName: "Inbox", parentFolderId: "root", childFolderCount: 1 },
  { id: ARCHIVE_ID, displayName: "Archive", parentFolderId: "root", childFolderCount: 0 },
  { id: "proj", displayName: "Projects", parentFolderId: "root", childFolderCount: 1 },
  { id: "proj-a", displayName: "Alpha", parentFolderId: "proj", childFolderCount: 1 },
  { id: "proj-a-1", displayName: "Specs", parentFolderId: "proj-a", childFolderCount: 0 },
  { id: "inbox-sub", displayName: "Receipts", parentFolderId: INBOX_ID, childFolderCount: 0 },
];

const graphMessage: GraphMessage = {
  id: "AAMkAGI2THVSAAA=",
  conversationId: "AAQkAGI2conv=",
  parentFolderId: INBOX_ID,
  subject: "Quarterly report",
  bodyPreview: "Hi team,\r\n\r\nAttached is   the report.",
  from: { emailAddress: { name: "Megan Bowen", address: "MeganB@Contoso.com" } },
  toRecipients: [
    { emailAddress: { name: "Alex Wilber", address: "AlexW@contoso.com" } },
    { emailAddress: { name: "", address: "noname@contoso.com" } },
  ],
  ccRecipients: [],
  bccRecipients: [],
  replyTo: [],
  receivedDateTime: "2026-10-01T09:30:00Z",
  sentDateTime: "2026-10-01T09:29:58Z",
  isRead: false,
  isDraft: false,
  flag: { flagStatus: "flagged" },
  categories: ["Red category", "Work"],
  hasAttachments: true,
  internetMessageId: "<abc123@contoso.com>",
  inferenceClassification: "other",
};

describe("folder mapping", () => {
  test("well-known folders become system labels and others folder:<id> with nested names", () => {
    const labels = mapFolders(folders, wellKnown);
    const byProvider = new Map(labels.map((l: NormalizedLabel) => [l.providerRef, l]));
    expect(byProvider.get(INBOX_ID)).toEqual({ id: "INBOX", name: "Inbox", type: "system", providerRef: INBOX_ID });
    expect(byProvider.get(ARCHIVE_ID)?.id).toBe("ARCHIVE");
    expect(byProvider.get("proj")).toEqual({ id: "folder:proj", name: "Projects", type: "user", providerRef: "proj" });
    expect(byProvider.get("proj-a-1")?.name).toBe("Projects/Alpha/Specs");
    expect(byProvider.get("inbox-sub")).toMatchObject({ id: "folder:inbox-sub", name: "Inbox/Receipts", type: "user" });
  });

  test("folderLabelId falls back to folder:<id>", () => {
    expect(folderLabelId(INBOX_ID, wellKnown)).toBe("INBOX");
    expect(folderLabelId("xyz", wellKnown)).toBe("folder:xyz");
  });
});

describe("normalizeMessage", () => {
  test("maps Graph metadata to a normalized message", () => {
    const m = normalizeMessage(graphMessage, "INBOX");
    expect(m.id).toBe(graphMessage.id);
    expect(m.threadId).toBe("AAQkAGI2conv=");
    expect(m.labelIds).toEqual(["INBOX", "UNREAD", "STARRED", "category:Red category", "category:Work"]);
    expect(m.from).toEqual({ name: "Megan Bowen", email: "meganb@contoso.com" });
    expect(m.to).toEqual([
      { name: "Alex Wilber", email: "alexw@contoso.com" },
      { name: "noname@contoso.com", email: "noname@contoso.com" },
    ]);
    expect(m.subject).toBe("Quarterly report");
    expect(m.date.toISOString()).toBe("2026-10-01T09:30:00.000Z");
    expect(m.snippet).toBe("Hi team, Attached is the report.");
    expect(m.bodyFetched).toBe(false);
    expect(m.hasAttachments).toBe(true);
    expect(m.messageIdHeader).toBe("<abc123@contoso.com>");
    expect(m.category).toBe("other");
  });

  test("read, unflagged draft without sender", () => {
    const m = normalizeMessage(
      { id: "d1", conversationId: "c1", isRead: true, isDraft: true, flag: { flagStatus: "notFlagged" }, from: null, subject: null },
      "DRAFT",
    );
    expect(m.labelIds).toEqual(["DRAFT"]);
    expect(m.from).toEqual({ name: "(unknown)", email: "" });
    expect(m.subject).toBe("");
  });

  test("hasAttachments follows fetched body when present", () => {
    const m = normalizeMessage(graphMessage, "INBOX", {
      html: "<p>x</p>",
      attachments: [toAttachmentMeta({ id: "att1", name: "logo.png", contentType: "image/png", size: 10, isInline: true, contentId: "<logo>" })],
    });
    expect(m.bodyFetched).toBe(true);
    expect(m.hasAttachments).toBe(false);
    expect(m.attachments[0]).toEqual({ id: "att1", filename: "logo.png", mimeType: "image/png", size: 10, contentId: "logo", inline: true });
  });
});

describe("planModify", () => {
  const ref = (labelIds: string[]): MessageRef => ({ id: "m1", threadId: "t1", labelIds });

  test("read/flag toggles become a PATCH", () => {
    expect(planModify(ref(["INBOX", "UNREAD"]), [], ["UNREAD"])).toEqual({ patch: { isRead: true }, destinationId: undefined });
    expect(planModify(ref(["INBOX"]), ["UNREAD", "STARRED"], [])).toEqual({
      patch: { isRead: false, flag: { flagStatus: "flagged" } },
      destinationId: undefined,
    });
    expect(planModify(ref(["INBOX", "STARRED"]), [], ["STARRED"]).patch).toEqual({ flag: { flagStatus: "notFlagged" } });
  });

  test("categories are recomputed from current labels", () => {
    const plan = planModify(ref(["INBOX", "category:Work", "category:Old"]), ["category:New"], ["category:Old"]);
    expect(plan.patch).toEqual({ categories: ["Work", "New"] });
    expect(planModify(ref(["INBOX", "category:Work"]), ["category:Work"], []).patch).toBeUndefined();
  });

  test("folder labels in add become a move", () => {
    expect(planModify(ref(["INBOX"]), ["ARCHIVE"], []).destinationId).toBe("archive");
    expect(planModify(ref(["INBOX"]), ["SPAM"], ["INBOX"]).destinationId).toBe("junkemail");
    expect(planModify(ref(["INBOX"]), ["TRASH"], []).destinationId).toBe("deleteditems");
    expect(planModify(ref(["ARCHIVE"]), ["folder:AAMk=abc"], []).destinationId).toBe("AAMk=abc");
    expect(planModify(ref(["INBOX"]), ["INBOX"], []).destinationId).toBeUndefined();
  });

  test("removing the current folder follows Gmail semantics", () => {
    expect(planModify(ref(["INBOX"]), [], ["INBOX"]).destinationId).toBe("archive");
    expect(planModify(ref(["TRASH"]), [], ["TRASH"]).destinationId).toBe("inbox");
    expect(planModify(ref(["ARCHIVE"]), [], ["INBOX"]).destinationId).toBeUndefined();
  });
});

describe("requests", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  interface Call {
    url: string;
    method: string;
    headers: Headers;
    body: string;
  }

  function mockFetch(handler: (call: Call) => Response): Call[] {
    const calls: Call[] = [];
    const fn = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: input.toString(),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      };
      calls.push(call);
      return handler(call);
    });
    globalThis.fetch = Object.assign(fn, { preconnect: realFetch.preconnect });
    return calls;
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const provider = () =>
    new MicrosoftProvider({ accessToken: "tok", refreshToken: "ref", expiresAt: Date.now() / 1000 + 3600 }, async () => {});

  function recordingSink() {
    const upserts: NormalizedMessage[] = [];
    const deletes: string[] = [];
    const labelSets: NormalizedLabel[][] = [];
    const sink: SyncSink = {
      upsertMessages: async (m) => void upserts.push(...m),
      updateLabels: async () => {},
      deleteMessages: async (ids) => void deletes.push(...ids),
      replaceLabels: async (l) => void labelSets.push(l),
      threadForMessageIds: async () => undefined,
    };
    return { sink, upserts, deletes, labelSets };
  }

  type BatchBody = { requests: { id: string; method: string; url: string; body?: Record<string, unknown> }[] };

  test("modify batches PATCH then move", async () => {
    const batches: BatchBody[] = [];
    mockFetch((call) => {
      const body: BatchBody = JSON.parse(call.body);
      batches.push(body);
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 200, body: {} })) });
    });
    const refs: MessageRef[] = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, threadId: "t", labelIds: ["INBOX", "UNREAD"] }));
    await provider().modify(refs, ["ARCHIVE"], ["UNREAD"]);
    expect(batches.map((b) => b.requests.length)).toEqual([20, 5, 20, 5]);
    expect(batches[0].requests[0]).toMatchObject({ id: "0", method: "PATCH", url: "/me/messages/m0", body: { isRead: true } });
    expect(batches[2].requests[0]).toMatchObject({ method: "POST", url: "/me/messages/m0/move", body: { destinationId: "archive" } });
  });

  test("send posts base64 MIME as text/plain and deletes the draft", async () => {
    const calls = mockFetch((call) => (call.method === "DELETE" ? new Response(null, { status: 204 }) : new Response(null, { status: 202 })));
    const raw = Buffer.from("Subject: hi\r\n\r\nbody");
    await provider().send(raw, { draftId: "d1", from: { name: "", email: "a@b.c" }, to: [], cc: [], bcc: [], subject: "hi", html: "", text: "", attachments: [] });
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(calls[0].headers.get("content-type")).toBe("text/plain");
    expect(calls[0].body).toBe(raw.toString("base64"));
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "https://graph.microsoft.com/v1.0/me/messages/d1" });
  });

  test("renameLabel rejects non-folder ids", async () => {
    mockFetch(() => json({}));
    await expect(provider().renameLabel("INBOX", "x")).rejects.toBeInstanceOf(ProviderError);
    await expect(provider().deleteLabel("category:Work")).rejects.toMatchObject({ status: 400 });
  });

  test("sync: initial delta, then incremental with removals and 410 reset", async () => {
    const deltaLink = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$deltatoken=t1";
    let phase: "initial" | "incremental" | "expired" = "initial";
    const calls = mockFetch((call) => {
      const url = new URL(call.url);
      if (url.pathname.endsWith("/$batch")) {
        const body: BatchBody = JSON.parse(call.body);
        return json({
          responses: body.requests.map((r) => {
            if (r.url.startsWith("/me/mailFolders/inbox?")) return { id: r.id, status: 200, body: { id: "inbox-id" } };
            if (r.url.startsWith("/me/mailFolders/")) return { id: r.id, status: 404, body: { error: { code: "ErrorFolderNotFound" } } };
            if (r.url.startsWith("/me/messages/gone")) return { id: r.id, status: 404, body: { error: { code: "ErrorItemNotFound" } } };
            return { id: r.id, status: 200, body: { id: "moved" } };
          }),
        });
      }
      if (url.pathname === "/v1.0/me/mailFolders") {
        return json({ value: [{ id: "inbox-id", displayName: "Inbox", childFolderCount: 0 }] });
      }
      if (url.pathname === "/v1.0/me/mailFolders/inbox-id/messages/delta") {
        if (url.searchParams.has("$deltatoken")) {
          if (phase === "expired") return json({ error: { code: "SyncStateNotFound", message: "SyncStateNotFound" } }, 410);
          return json({
            value: [
              { ...graphMessage, id: "m2", parentFolderId: "inbox-id", categories: ["Travel"] },
              { id: "gone", "@removed": { reason: "deleted" } },
              { id: "moved", "@removed": { reason: "changed" } },
            ],
            "@odata.deltaLink": deltaLink.replace("t1", "t2"),
          });
        }
        if (!url.searchParams.has("$skiptoken")) {
          expect(url.searchParams.get("$filter")).toMatch(/^receivedDateTime ge \d{4}-/);
          expect(url.searchParams.get("$select")).toContain("conversationId");
          expect(call.headers.get("prefer")).toContain("odata.maxpagesize=100");
          return json({
            value: [{ ...graphMessage, id: "m1", parentFolderId: "inbox-id" }],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox-id/messages/delta?$skiptoken=s1",
          });
        }
        return json({ value: [], "@odata.deltaLink": deltaLink });
      }
      throw new Error(`unexpected ${call.method} ${call.url}`);
    });

    const p = provider();
    const first = recordingSink();
    const state = await p.sync({}, first.sink);
    expect(first.labelSets[0].map((l) => l.id)).toEqual(["INBOX", "STARRED", "UNREAD"]);
    expect(first.upserts.map((m) => m.id)).toEqual(["m1"]);
    expect(first.upserts[0].labelIds[0]).toBe("INBOX");
    expect(state).toMatchObject({ folders: { "inbox-id": { deltaLink } }, categories: ["Red category", "Work"] });
    expect(first.labelSets.at(-1)?.map((l) => l.id)).toContain("category:Work");

    phase = "incremental";
    const second = recordingSink();
    const next = await p.sync(state, second.sink);
    expect(second.upserts.map((m) => m.id)).toEqual(["m2"]);
    expect(second.deletes).toEqual(["gone"]);
    expect(next).toMatchObject({ folders: { "inbox-id": { deltaLink: deltaLink.replace("t1", "t2") } } });
    expect(second.labelSets.at(-1)?.map((l) => l.id)).toContain("category:Travel");

    phase = "expired";
    const before = calls.length;
    const third = recordingSink();
    const reset = await p.sync(next, third.sink);
    expect(third.upserts.map((m) => m.id)).toEqual(["m1"]);
    expect(reset).toMatchObject({ folders: { "inbox-id": { deltaLink } } });
    expect(calls.length).toBeGreaterThan(before);
  });
});
