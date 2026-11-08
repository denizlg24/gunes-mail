import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/** Runs against a real Postgres (DATABASE_URL); CI provides one as a service. */
const enabled = !!process.env.DATABASE_URL;
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client";

describe.skipIf(!enabled)("accounts", async () => {
  const { app } = await import("../app");
  const { runMigrations } = await import("../db/migrate");
  const { client } = await import("../db");
  const email = `test-${crypto.randomUUID()}@example.com`;
  const call = (path: string, init: RequestInit = {}, token?: string) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-device-name": "Test runner",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  beforeAll(async () => {
    await runMigrations();
  });
  afterAll(async () => {
    await client`delete from users where email = ${email}`;
  });

  test("register, sync settings across devices, manage sessions, delete everything", async () => {
    const weak = await call("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password: "short" }) });
    expect(weak.status).toBe(400);

    const reg = await call("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: "correct horse battery", name: "Tester" }),
    });
    expect(reg.status).toBe(200);
    const { session: laptop, profile } = (await reg.json()) as { session: string; profile: { email: string; hasPassword: boolean } };
    expect(profile).toMatchObject({ email, hasPassword: true });

    const dup = await call("/v1/auth/register", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery" }) });
    expect(dup.status).toBe(409);

    const wrong = await call("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: "nope nope nope" }) });
    expect(wrong.status).toBe(401);

    const login = await call("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery" }) });
    const { session: desktop } = (await login.json()) as { session: string };

    await call("/v1/me/settings", { method: "PUT", body: JSON.stringify({ accent: "sunset", undoSendSeconds: 20 }) }, laptop);
    const synced = (await (await call("/v1/me/settings", {}, desktop)).json()) as { accent: string; undoSendSeconds: number; theme: string };
    expect(synced).toMatchObject({ accent: "sunset", undoSendSeconds: 20, theme: "system" });

    const sessions = (await (await call("/v1/me/sessions", {}, laptop)).json()) as { id: string; current: boolean; name: string }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions[0].name).toBe("Test runner");
    const other = sessions.find((s) => !s.current)!;
    await call(`/v1/me/sessions/${other.id}`, { method: "DELETE" }, laptop);
    expect((await call("/v1/me", {}, desktop)).status).toBe(401);

    expect((await call("/v1/me", { method: "DELETE" }, laptop)).status).toBe(204);
    expect((await call("/v1/me", {}, laptop)).status).toBe(401);
    const gone = await call("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery" }) });
    expect(gone.status).toBe(401);
  });

  test("unauthenticated requests are rejected", async () => {
    expect((await call("/v1/accounts")).status).toBe(401);
    expect((await call("/v1/me")).status).toBe(401);
  });
});
