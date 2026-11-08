function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Production stores only an Argon2id hash (`bun -e 'console.log(await Bun.password.hash("…"))'`);
 * a plain ADMIN_PASSWORD is accepted for local development.
 */
async function passwordHash(): Promise<string> {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash) return hash;
  const plain = process.env.ADMIN_PASSWORD;
  if (!plain) throw new Error("Set ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD for local development)");
  if (plain.length < 16) throw new Error("ADMIN_PASSWORD must be at least 16 characters");
  return Bun.password.hash(plain);
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required("DATABASE_URL"),
  ADMIN_PASSWORD_HASH: await passwordHash(),
  /** Random per process unless set, so a restart signs everyone out. */
  SESSION_SECRET: process.env.ADMIN_SESSION_SECRET ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"),
  API_URL: process.env.API_URL ?? "https://gunes-mail-api.denizlg24.com",
  WEB_URL: process.env.WEB_URL ?? "https://gunes-mail.denizlg24.com",
  SECURE_COOKIES: process.env.NODE_ENV === "production",
};
