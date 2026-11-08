import { eq } from "drizzle-orm";

import { db, schema } from "../db";
import { decryptJson, encryptJson } from "../lib/crypto";
import { GmailProvider } from "../providers/gmail";
import { ImapProvider, type ImapCredentials } from "../providers/imap";
import { MicrosoftProvider } from "../providers/microsoft";
import type { OAuthCredentials } from "../providers/oauth-token";
import type { MailProvider } from "../providers/types";

export type AccountRow = typeof schema.accounts.$inferSelect;

const cache = new Map<string, { credentials: string; provider: MailProvider }>();

function persist(accountId: string) {
  return async (credentials: OAuthCredentials) => {
    const encrypted = encryptJson(credentials);
    await db.update(schema.accounts).set({ credentials: encrypted }).where(eq(schema.accounts.id, accountId));
    const entry = cache.get(accountId);
    if (entry) entry.credentials = encrypted;
  };
}

export function providerFor(account: AccountRow): MailProvider {
  const cached = cache.get(account.id);
  if (cached && cached.credentials === account.credentials) return cached.provider;
  let provider: MailProvider;
  switch (account.provider) {
    case "gmail":
      provider = new GmailProvider(decryptJson<OAuthCredentials>(account.credentials), persist(account.id));
      break;
    case "microsoft":
      provider = new MicrosoftProvider(decryptJson<OAuthCredentials>(account.credentials), persist(account.id));
      break;
    case "imap":
      provider = new ImapProvider(decryptJson<ImapCredentials>(account.credentials));
      break;
  }
  cache.set(account.id, { credentials: account.credentials, provider });
  return provider;
}

export function forgetProvider(accountId: string) {
  cache.delete(accountId);
}
