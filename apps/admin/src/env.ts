function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const password = required("ADMIN_PASSWORD");
if (password.length < 16) throw new Error("ADMIN_PASSWORD must be at least 16 characters");

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: required("DATABASE_URL"),
  ADMIN_PASSWORD: password,
  /** Signs session cookies; rotating it signs everyone out. Defaults to a value derived from the password. */
  SESSION_SECRET: process.env.ADMIN_SESSION_SECRET ?? `gunes-admin:${password}`,
  API_URL: process.env.API_URL ?? "https://gunes-mail-api.denizlg24.com",
  WEB_URL: process.env.WEB_URL ?? "https://gunes-mail.denizlg24.com",
  SECURE_COOKIES: process.env.NODE_ENV === "production",
};
