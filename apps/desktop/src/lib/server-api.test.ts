import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

import type { ServerMailApi as ServerMailApiType } from "./server-api";
import type { ServerEvent } from "./types";

let ServerMailApi: typeof ServerMailApiType;
const requests: { url: string; init?: RequestInit }[] = [];

beforeAll(async () => {
  Object.assign(globalThis, { window: globalThis });
  const { mockIPC } = await import("@tauri-apps/api/mocks");
  mockIPC((cmd) =>
    cmd === "session"
      ? { apiUrl: "https://mail.test", token: "tok", google: true, microsoft: false, legacyAccounts: 0 }
      : null,
  );
  ({ ServerMailApi } = await import("./server-api"));
});

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | null = null;

function fakeFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(impl, { preconnect: globalThis.fetch.preconnect });
}

afterEach(() => {
  fetchSpy?.mockRestore();
  requests.length = 0;
});

function respond(body: unknown, status = 200) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    fakeFetch(async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(body === null ? null : JSON.stringify(body), { status });
    }),
  );
}

describe("ServerMailApi", () => {
  test("lists threads with folder, tab, filter, search and cursor", async () => {
    respond({ threads: [], nextPageToken: "c2" });
    const page = await new ServerMailApi().listThreads("acc", {
      folder: "INBOX",
      tab: "focused",
      filter: "unread",
      search: "from:bob",
      pageToken: "c1",
    });
    const url = new URL(requests[0].url);
    expect(url.origin + url.pathname).toBe("https://mail.test/v1/accounts/acc/threads");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      folder: "INBOX",
      filter: "unread",
      tab: "focused",
      q: "from:bob",
      cursor: "c1",
    });
    expect(new Headers(requests[0].init?.headers).get("authorization")).toBe("Bearer tok");
    expect(page.nextPageToken).toBe("c2");
  });

  test("send posts the payload with undo window and schedule", async () => {
    respond({ id: "o1", sendAt: 123, delayedByRule: 0 });
    const result = await new ServerMailApi().send(
      "acc",
      { from: { name: "A", email: "a@x.com" }, to: [], cc: [], bcc: [], subject: "s", html: "h", text: "h", attachments: [] },
      { undoSeconds: 10, sendAt: 999 },
    );
    expect(requests[0].init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ undoSeconds: 10, sendAt: 999, payload: { subject: "s" } });
    expect(result.id).toBe("o1");
  });

  test("surfaces server error messages", async () => {
    respond({ error: "Account not found" }, 404);
    await expect(new ServerMailApi().listLabels("nope")).rejects.toThrow("Account not found");
  });

  test("parses server-sent events split across chunks", async () => {
    const frames = [
      'event: ready\ndata: {}\n\nevent: message\ndata: {"type":"changed","accountId":"a1"}',
      '\n\nevent: ping\ndata: {}\n\nevent: message\ndata: {"type":"outbox","id":"o1","status":"sent"}\n\n',
    ];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
          },
        });
        return new Response(stream, { status: 200 });
      }),
    );

    const events: ServerEvent[] = [];
    const stop = new ServerMailApi().subscribe((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(events).toEqual([
      { type: "changed", accountId: "a1" },
      { type: "outbox", id: "o1", status: "sent" },
    ]);
  });
});
