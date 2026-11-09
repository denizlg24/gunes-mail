import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "../db";
import { mapLimit } from "../lib/http";
import { snippetFrom } from "../lib/mime";
import { type AccountRow, providerFor } from "./providers";
import { recomputeThreads } from "./store";

const { messages } = schema;

function select(accountId: string, threadId: string) {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.accountId, accountId), eq(messages.threadId, threadId)))
    .orderBy(asc(messages.date));
}

/** A conversation's messages, oldest first, downloading any bodies sync skipped. */
export async function loadThread(account: AccountRow, threadId: string) {
  const rows = await select(account.id, threadId);
  const missing = rows.filter((m) => !m.bodyFetched);
  if (!missing.length) return rows;
  const provider = providerFor(account);
  await mapLimit(missing, 3, async (m) => {
    const body = await provider.fetchBody({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, providerRef: m.providerRef });
    await db
      .update(messages)
      .set({
        html: body.html ?? null,
        text: body.text ?? null,
        attachments: body.attachments,
        hasAttachments: body.attachments.some((a) => !a.inline),
        bodyFetched: true,
        snippet: m.snippet || snippetFrom(body.text, body.html),
      })
      .where(and(eq(messages.accountId, account.id), eq(messages.id, m.id)));
  });
  await recomputeThreads(account.id, [threadId]);
  return select(account.id, threadId);
}
