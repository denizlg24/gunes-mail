import type { AiCapabilities, UserSettings } from "@gunes/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { assistEnabled, composePrompt, insightKey, streamCompose, summarizeThread } from "../ai/assist";
import { classifierEnabled } from "../ai/classifier";
import type { AppEnv } from "../auth";
import { db, schema } from "../db";
import { recordError } from "../lib/observe";
import { allow } from "../lib/rate-limit";
import { loadThread } from "../sync/thread";
import { ownedAccount } from "./mail";

const { threads, users } = schema;

const AI_REQUESTS_PER_MINUTE = 20;

async function requireAssist(userId: string) {
  if (!assistEnabled()) throw new HTTPException(503, { message: "AI features aren't set up on this server" });
  const [user] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const settings = (user?.settings ?? {}) as Partial<UserSettings>;
  if (settings.aiAssist !== true) throw new HTTPException(403, { message: "Turn on AI features in Settings to use this" });
  if (!allow(`ai:${userId}`, AI_REQUESTS_PER_MINUTE, 60_000)) {
    throw new HTTPException(429, { message: "Too many AI requests. Try again in a minute." });
  }
}

const composeRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("draft"),
    instruction: z.string().max(2_000),
    threadId: z.string().optional(),
    messageId: z.string().optional(),
    mode: z.enum(["new", "reply", "replyAll", "forward"]),
    subject: z.string().max(1_000).optional(),
  }),
  z.object({
    action: z.literal("rewrite"),
    instruction: z.string().min(1).max(2_000),
    draft: z.string().min(1).max(20_000),
    threadId: z.string().optional(),
  }),
]);

export const ai = new Hono<AppEnv>()
  .get("/ai", (c) => c.json<AiCapabilities>({ classifier: classifierEnabled(), assist: assistEnabled() }))
  .post("/accounts/:id/threads/:threadId/insight", async (c) => {
    const userId = c.get("userId");
    const account = await ownedAccount(userId, c.req.param("id"));
    const threadId = c.req.param("threadId");
    const { refresh } = z.object({ refresh: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
    const rows = await loadThread(account, threadId);
    if (!rows.length) throw new HTTPException(404, { message: "Conversation not found" });

    const key = insightKey(rows);
    const [cached] = await db
      .select({ insight: threads.insight, key: threads.insightKey })
      .from(threads)
      .where(and(eq(threads.accountId, account.id), eq(threads.id, threadId)));
    if (!refresh && cached?.insight && cached.key === key) return c.json(cached.insight);

    await requireAssist(userId);
    const insight = await summarizeThread({ name: account.name, email: account.email }, rows);
    await db
      .update(threads)
      .set({ insight, insightKey: key })
      .where(and(eq(threads.accountId, account.id), eq(threads.id, threadId)));
    return c.json(insight);
  })
  .post("/accounts/:id/ai/compose", async (c) => {
    const userId = c.get("userId");
    const account = await ownedAccount(userId, c.req.param("id"));
    const request = composeRequest.parse(await c.req.json());
    await requireAssist(userId);
    const rows = request.threadId ? await loadThread(account, request.threadId) : [];
    const prompt = composePrompt({ name: account.name, email: account.email }, request, rows);
    try {
      const body = await streamCompose(prompt, c.req.raw.signal);
      return new Response(body, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    } catch (e) {
      const ref = recordError({
        kind: "request",
        userId,
        accountId: account.id,
        method: c.req.method,
        path: c.req.path,
        status: 502,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : null,
      });
      return c.json({ error: "The writing assistant is unavailable right now", ref }, 502);
    }
  });
