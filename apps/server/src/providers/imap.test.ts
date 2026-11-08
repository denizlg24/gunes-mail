import { describe, expect, test } from "bun:test";

import type { AddressObject, Attachment } from "mailparser";

process.env.DATABASE_URL ??= "postgres://test";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "google-test";

const {
  IMAP_PRESETS,
  ImapProvider,
  bodyFromParsed,
  compressUids,
  deriveThreadId,
  expandUids,
  flagChanges,
  formatMessageId,
  labelsFor,
  labelsFromFlags,
  messageIdList,
  moveTarget,
  normalizeParsed,
  normalizeSubject,
  parseMessageId,
  resolveMailboxes,
  structureHasAttachments,
  threadHeadersOf,
} = await import("./imap");
type MailboxEntry = import("./imap").MailboxEntry;
type ParsedHeaders = import("./imap").ParsedHeaders;

function entry(path: string, opts: Partial<MailboxEntry> = {}): MailboxEntry {
  const delimiter = opts.delimiter ?? "/";
  return {
    path,
    name: path.split(delimiter).pop() ?? path,
    delimiter,
    flags: new Set<string>(),
    ...opts,
  };
}

function address(...list: { name: string; address: string }[]): AddressObject {
  return { value: list, html: "", text: list.map((a) => a.address).join(", ") };
}

const labelOf = (list: MailboxEntry[], path: string) => resolveMailboxes(list).find((m) => m.path === path)?.labelId;

describe("resolveMailboxes", () => {
  test("maps special-use flags to system labels", () => {
    const list = [
      entry("INBOX", { specialUse: "\\Inbox" }),
      entry("Sent", { specialUse: "\\Sent", specialUseSource: "extension" }),
      entry("Drafts", { specialUse: "\\Drafts", specialUseSource: "extension" }),
      entry("Bin", { specialUse: "\\Trash", specialUseSource: "extension" }),
      entry("Bulk", { specialUse: "\\Junk", specialUseSource: "extension" }),
      entry("Old", { specialUse: "\\Archive", specialUseSource: "extension" }),
    ];
    expect(resolveMailboxes(list).map((m) => [m.path, m.labelId, m.name])).toEqual([
      ["INBOX", "INBOX", "Inbox"],
      ["Sent", "SENT", "Sent"],
      ["Drafts", "DRAFT", "Drafts"],
      ["Bin", "TRASH", "Trash"],
      ["Bulk", "SPAM", "Junk"],
      ["Old", "ARCHIVE", "Archive"],
    ]);
  });

  test("falls back to common folder names (iCloud style)", () => {
    const list = [
      entry("INBOX"),
      entry("Sent Messages"),
      entry("Deleted Messages"),
      entry("Junk"),
      entry("Archive"),
      entry("Drafts"),
    ];
    expect(resolveMailboxes(list).map((m) => m.labelId)).toEqual(["INBOX", "SENT", "TRASH", "SPAM", "ARCHIVE", "DRAFT"]);
  });

  test("handles INBOX-prefixed namespaces and normalizes the delimiter", () => {
    const list = [
      entry("INBOX", { delimiter: "." }),
      entry("INBOX.Sent", { delimiter: "." }),
      entry("INBOX.Projects.Alpha", { delimiter: "." }),
    ];
    const resolved = resolveMailboxes(list);
    expect(resolved.map((m) => m.labelId)).toEqual(["INBOX", "SENT", "mailbox:INBOX.Projects.Alpha"]);
    expect(resolved[2].name).toBe("INBOX/Projects/Alpha");
  });

  test("does not treat nested user folders as system folders by name", () => {
    expect(labelOf([entry("INBOX"), entry("Clients/Archive")], "Clients/Archive")).toBe("mailbox:Clients/Archive");
  });

  test("gives each system label to exactly one mailbox, preferring server-declared special use", () => {
    const list = [
      entry("INBOX"),
      entry("Sent"),
      entry("Sent Messages", { specialUse: "\\Sent", specialUseSource: "extension" }),
    ];
    expect(labelOf(list, "Sent Messages")).toBe("SENT");
    expect(labelOf(list, "Sent")).toBe("mailbox:Sent");
  });

  test("skips \\Noselect, \\NonExistent and virtual mailboxes", () => {
    const list = [
      entry("INBOX"),
      entry("[Gmail]", { flags: new Set(["\\Noselect", "\\HasChildren"]) }),
      entry("Gone", { flags: new Set(["\\NonExistent"]) }),
      entry("All Mail", { specialUse: "\\All" }),
      entry("Starred", { specialUse: "\\Flagged" }),
    ];
    expect(resolveMailboxes(list).map((m) => m.path)).toEqual(["INBOX"]);
  });

  test("labelsFor emits folder labels plus STARRED and UNREAD", () => {
    const labels = labelsFor(resolveMailboxes([entry("INBOX"), entry("Work/Clients")]));
    expect(labels).toEqual([
      { id: "INBOX", name: "Inbox", type: "system", providerRef: "INBOX" },
      { id: "mailbox:Work/Clients", name: "Work/Clients", type: "user", providerRef: "Work/Clients" },
      { id: "STARRED", name: "Starred", type: "system" },
      { id: "UNREAD", name: "Unread", type: "system" },
    ]);
  });
});

describe("flags and labels", () => {
  test("missing \\Seen means UNREAD and \\Flagged means STARRED", () => {
    expect(labelsFromFlags("INBOX", [])).toEqual(["INBOX", "UNREAD"]);
    expect(labelsFromFlags("INBOX", new Set(["\\Seen"]))).toEqual(["INBOX"]);
    expect(labelsFromFlags("mailbox:Work", ["\\seen", "\\Flagged", "$Forwarded"])).toEqual(["mailbox:Work", "STARRED"]);
  });

  test("translates label changes to IMAP flag changes", () => {
    expect(flagChanges(["STARRED"], [])).toEqual({ add: ["\\Flagged"], remove: [] });
    expect(flagChanges([], ["STARRED"])).toEqual({ add: [], remove: ["\\Flagged"] });
    expect(flagChanges(["UNREAD"], [])).toEqual({ add: [], remove: ["\\Seen"] });
    expect(flagChanges([], ["UNREAD"])).toEqual({ add: ["\\Seen"], remove: [] });
    expect(flagChanges(["INBOX"], ["TRASH"])).toEqual({ add: [], remove: [] });
  });

  test("picks the folder a modify call moves to", () => {
    expect(moveTarget(["STARRED", "ARCHIVE"])).toBe("ARCHIVE");
    expect(moveTarget(["mailbox:Work"])).toBe("mailbox:Work");
    expect(moveTarget(["STARRED", "UNREAD"])).toBeUndefined();
    expect(moveTarget(["SENT"])).toBeUndefined();
  });
});

describe("message ids", () => {
  test("round-trips paths containing colons", () => {
    const ref = { mailbox: "Work: 2024/Q1", uidValidity: "1700000000", uid: 42 };
    const id = formatMessageId(ref);
    expect(id).toBe("Work: 2024/Q1:1700000000:42");
    expect(parseMessageId(id)).toEqual(ref);
  });

  test("rejects malformed ids", () => {
    expect(parseMessageId("18c0f2a7b")).toBeUndefined();
    expect(parseMessageId("INBOX:abc:1")).toBeUndefined();
  });

  test("compresses and expands UID sets", () => {
    expect(compressUids([5, 1, 2, 3, 9, 10, 3])).toBe("1:3,5,9:10");
    expect(expandUids("1:3,5,9:10")).toEqual([1, 2, 3, 5, 9, 10]);
    expect(expandUids("")).toEqual([]);
    expect(compressUids([])).toBe("");
  });
});

describe("threading", () => {
  test("extracts message ids from header values", () => {
    expect(messageIdList("<a@x> <b@y>\r\n <c@z>")).toEqual(["<a@x>", "<b@y>", "<c@z>"]);
    expect(messageIdList(["<a@x>", "<b@y>"])).toEqual(["<a@x>", "<b@y>"]);
    expect(messageIdList("bare@id")).toEqual(["<bare@id>"]);
    expect(messageIdList(undefined)).toEqual([]);
  });

  test("replies hash to the same thread as their root", () => {
    const root = deriveThreadId({ messageId: "<root@x>", references: [], subject: "Plan", from: "a@x.com" });
    const reply = deriveThreadId({
      messageId: "<r2@y>",
      inReplyTo: "<r1@x>",
      references: ["<root@x>", "<r1@x>"],
      subject: "Re: Plan",
      from: "b@y.com",
    });
    const directReply = deriveThreadId({ messageId: "<r1@x>", inReplyTo: "<root@x>", references: [], subject: "Re: Plan", from: "b@y.com" });
    expect(root).toMatch(/^t:[0-9a-f]{32}$/);
    expect(reply).toBe(root);
    expect(directReply).toBe(root);
  });

  test("falls back to normalized subject and sender without a Message-ID", () => {
    const a = deriveThreadId({ references: [], subject: "RE: Fwd:  Quarterly   report", from: "Boss@Corp.com" });
    const b = deriveThreadId({ references: [], subject: "quarterly report", from: "boss@corp.com" });
    const c = deriveThreadId({ references: [], subject: "quarterly report", from: "other@corp.com" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(normalizeSubject("Re[2]: AW: Hello  World")).toBe("hello world");
  });

  test("threadHeadersOf reads parsed headers", () => {
    const parsed: ParsedHeaders = {
      messageId: "<m@x>",
      inReplyTo: "<p@x>",
      references: ["<root@x>", "<p@x>"],
      subject: "Re: hi",
      from: address({ name: "Ann", address: "Ann@X.com" }),
    };
    expect(threadHeadersOf(parsed)).toEqual({
      messageId: "<m@x>",
      inReplyTo: "<p@x>",
      references: ["<root@x>", "<p@x>"],
      subject: "Re: hi",
      from: "ann@x.com",
    });
  });
});

describe("structureHasAttachments", () => {
  test("detects real attachments but ignores cid-referenced inline images", () => {
    expect(
      structureHasAttachments({
        type: "multipart/alternative",
        childNodes: [{ type: "text/plain" }, { type: "text/html" }],
      }),
    ).toBe(false);
    expect(
      structureHasAttachments({
        type: "multipart/related",
        childNodes: [{ type: "text/html" }, { type: "image/png", id: "<logo@x>", parameters: { name: "logo.png" } }],
      }),
    ).toBe(false);
    expect(
      structureHasAttachments({
        type: "multipart/mixed",
        childNodes: [
          { type: "text/plain" },
          { type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "a.pdf" } },
        ],
      }),
    ).toBe(true);
    expect(
      structureHasAttachments({
        type: "multipart/mixed",
        childNodes: [{ type: "text/plain" }, { type: "image/jpeg", disposition: "inline", dispositionParameters: { filename: "p.jpg" } }],
      }),
    ).toBe(true);
    expect(structureHasAttachments({ type: "multipart/mixed", childNodes: [{ type: "message/rfc822" }] })).toBe(true);
    expect(structureHasAttachments(undefined)).toBe(false);
  });
});

function attachment(
  fields: Pick<Attachment, "contentType" | "size"> & Partial<Pick<Attachment, "filename" | "contentDisposition" | "cid">>,
): Attachment {
  return {
    type: "attachment",
    content: Buffer.from("data"),
    headers: new Map(),
    checksum: "abc",
    related: false,
    release: null,
    partId: null,
    ...fields,
  };
}

describe("normalizeParsed", () => {
  const parsed: ParsedHeaders = {
    from: address({ name: "", address: "Alice@Example.com" }),
    to: [address({ name: "Bob", address: "bob@example.com" }), address({ name: "Carol", address: "carol@example.com" })],
    cc: address({ name: "Dan", address: "dan@example.com" }),
    replyTo: address({ name: "List", address: "list@example.com" }),
    subject: "Hello",
    date: new Date("2024-01-01T10:00:00Z"),
    messageId: "<m1@example.com>",
    inReplyTo: "<m0@example.com>",
    references: ["<root@example.com>", "<m0@example.com>"],
  };
  const ref = { mailbox: "INBOX", uidValidity: "7", uid: 12 };

  test("builds metadata-only messages from headers", () => {
    const received = new Date("2024-01-01T10:00:05Z");
    const message = normalizeParsed(parsed, {
      ref,
      threadId: "t:1",
      labelIds: ["INBOX", "UNREAD"],
      receivedAt: received,
      hasAttachments: true,
    });
    expect(message).toMatchObject({
      id: "INBOX:7:12",
      threadId: "t:1",
      labelIds: ["INBOX", "UNREAD"],
      from: { name: "Alice@Example.com", email: "alice@example.com" },
      to: [
        { name: "Bob", email: "bob@example.com" },
        { name: "Carol", email: "carol@example.com" },
      ],
      cc: [{ name: "Dan", email: "dan@example.com" }],
      bcc: [],
      replyTo: [{ name: "List", email: "list@example.com" }],
      subject: "Hello",
      date: received,
      bodyFetched: false,
      attachments: [],
      hasAttachments: true,
      messageIdHeader: "<m1@example.com>",
      inReplyTo: "<m0@example.com>",
      references: "<root@example.com> <m0@example.com>",
      providerRef: ref,
      category: "focused",
    });
  });

  test("uses the parsed body when present and flattens address groups", () => {
    const body = bodyFromParsed({
      html: "<p>Hi</p>",
      text: "Hi",
      attachments: [
        attachment({ filename: "report.pdf", contentType: "application/pdf", contentDisposition: "attachment", size: 10 }),
        attachment({ filename: "logo.png", contentType: "image/png", contentDisposition: "inline", cid: "logo@x", size: 5 }),
      ],
    });
    expect(body.attachments).toEqual([
      { id: "0", filename: "report.pdf", mimeType: "application/pdf", size: 10, contentId: undefined, inline: false },
      { id: "1", filename: "logo.png", mimeType: "image/png", size: 5, contentId: "logo@x", inline: true },
    ]);

    const message = normalizeParsed(
      {
        ...parsed,
        to: { value: [{ name: "Team", group: [{ name: "Eve", address: "eve@example.com" }] }], html: "", text: "" },
        date: undefined,
      },
      { ref: { ...ref, mailbox: "Sent" }, threadId: "t:2", labelIds: ["SENT"], hasAttachments: false, body },
    );
    expect(message.to).toEqual([{ name: "Eve", email: "eve@example.com" }]);
    expect(message.html).toBe("<p>Hi</p>");
    expect(message.bodyFetched).toBe(true);
    expect(message.hasAttachments).toBe(true);
    expect(message.category).toBeUndefined();
  });

  test("tolerates a message without sender or ids", () => {
    const message = normalizeParsed({}, { ref, threadId: "t:3", labelIds: ["INBOX"], hasAttachments: false });
    expect(message.from).toEqual({ name: "(unknown)", email: "" });
    expect(message.messageIdHeader).toBeUndefined();
    expect(message.references).toBeUndefined();
    expect(message.subject).toBe("");
  });
});

describe("presets and provider", () => {
  test("only includes providers that accept app passwords", () => {
    expect(Object.keys(IMAP_PRESETS).sort()).toEqual(["fastmail", "icloud", "yahoo", "zoho"]);
    expect(IMAP_PRESETS.icloud.smtp).toEqual({ host: "smtp.mail.me.com", port: 587, secure: false });
    expect(IMAP_PRESETS.yahoo.smtp).toEqual({ host: "smtp.mail.yahoo.com", port: 465, secure: true });
  });

  test("rejects label operations on system folders without connecting", async () => {
    const provider = new ImapProvider({
      email: "a@example.com",
      name: "A",
      username: "a@example.com",
      password: "x",
      imap: { host: "127.0.0.1", port: 1, secure: true },
      smtp: { host: "127.0.0.1", port: 1, secure: true },
    });
    expect(provider.kind).toBe("imap");
    await expect(provider.renameLabel("INBOX", "Other")).rejects.toThrow("Only custom folders");
    await expect(provider.deleteLabel("SENT")).rejects.toThrow("Only custom folders");
  });
});
