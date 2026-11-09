import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test";

const { stripQuoted } = await import("./assist");

test("quoted history is dropped from replies", () => {
  expect(stripQuoted("Sounds good.\n\nOn Mon, 3 Nov 2026 at 10:02, Sarah <s@x.com> wrote:\n> earlier text")).toBe("Sounds good.");
  expect(stripQuoted("Thanks!\n-----Original Message-----\nFrom: a")).toBe("Thanks!");
  expect(stripQuoted("Done\n\nFrom: Sarah Kim\nSent: Monday\nSubject: x")).toBe("Done");
  expect(stripQuoted("> quoted\nmine")).toBe("mine");
});

test("a message that starts with a quote header keeps its text", () => {
  expect(stripQuoted("On Monday we shipped it, wrote:\nno")).toBe("On Monday we shipped it, wrote:\nno");
});

const { MockLanguageModelV4 } = await import("ai/test");
const { simulateReadableStream } = await import("ai");
const { streamCompose, summarizeThread, composePrompt } = await import("./assist");

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const finish = { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, logprobs: undefined, usage };

test("compose streams plain text as it arrives", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Hi Sam," },
          { type: "text-delta", id: "t", delta: "\n\nFriday works." },
          { type: "text-end", id: "t" },
          finish,
        ],
      }),
    }),
  });
  const body = await streamCompose({ instructions: "x", prompt: "y" }, new AbortController().signal, model);
  expect(await new Response(body).text()).toBe("Hi Sam,\n\nFriday works.");
});

test("a model failure before any text rejects, so the route can answer with an error status", async () => {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: [{ type: "error", error: new Error("gateway down") }] }),
    }),
  });
  await expect(streamCompose({ instructions: "x", prompt: "y" }, new AbortController().signal, model)).rejects.toThrow(
    "gateway down",
  );
});

test("summaries come back structured and trimmed to five items", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "  Sam wants to meet Friday.  ",
            keyPoints: ["a", "b", "c", "d", "e", "f"],
            actionItems: [{ text: "Confirm Friday", due: "Thursday" }],
          }),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
  const insight = await summarizeThread({ name: "Me", email: "me@x.com" }, [], model);
  expect(insight.summary).toBe("Sam wants to meet Friday.");
  expect(insight.keyPoints).toHaveLength(5);
  expect(insight.actionItems).toEqual([{ text: "Confirm Friday", due: "Thursday" }]);
});

test("rewrites carry the draft and keep facts; drafts name the person being answered", () => {
  const rewrite = composePrompt({ name: "Me", email: "me@x.com" }, { action: "rewrite", instruction: "Shorter.", draft: "Long text" }, []);
  expect(rewrite.prompt).toContain("<draft>\nLong text\n</draft>");
  expect(rewrite.prompt).toContain("Keep every fact");
  const draft = composePrompt({ name: "Me", email: "me@x.com" }, { action: "draft", instruction: "", mode: "new", subject: "Lunch" }, []);
  expect(draft.prompt).toContain('subject "Lunch"');
  expect(draft.prompt).toContain("Write an appropriate response.");
});
