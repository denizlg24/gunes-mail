import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { type AppEnv, requireUser } from "./auth";
import { env } from "./env";
import { ProviderError } from "./lib/http";
import { recordError, recordRequest } from "./lib/observe";
import { account, publicAccount } from "./routes/account";
import { ai } from "./routes/ai";
import { connect } from "./routes/connect";
import { extras } from "./routes/extras";
import { mail } from "./routes/mail";
import { releases } from "./routes/releases";

export const app = new Hono<AppEnv>();

app.use("*", secureHeaders());
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  if (c.req.path !== "/v1/events" && c.req.path !== "/health") {
    recordRequest(c.req.path, c.res.status, performance.now() - start);
  }
});
app.use(
  "*",
  cors({ origin: env.CORS_ORIGINS, allowHeaders: ["authorization", "content-type", "x-device-name"], maxAge: 600 }),
);
// Attachments arrive base64-encoded inside JSON (25 MB of files ≈ 34 MB of body).
app.use("/v1/accounts/*", bodyLimit({ maxSize: 40 * 1024 * 1024 }));
app.use("*", async (c, next) => (c.req.path.startsWith("/v1/accounts/") ? next() : bodyLimit({ maxSize: 1024 * 1024 })(c, next)));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/v1/connect", connect);
app.route("/v1/auth", publicAccount);
app.route("/v1/me", account);
app.route("/v1/releases", releases);
const PUBLIC_PREFIXES = ["/v1/connect", "/v1/auth", "/v1/me", "/v1/releases"];
app.use("/v1/*", async (c, next) =>
  PUBLIC_PREFIXES.some((p) => c.req.path.startsWith(p)) ? next() : requireUser(c, next),
);
app.route("/v1", mail);
app.route("/v1", extras);
app.route("/v1", ai);

app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join("; ") }, 400);
  const userId: string | undefined = c.get("userId");
  const where = { userId, method: c.req.method, path: c.req.path };
  if (err instanceof ProviderError) {
    const status = err.status === 401 ? 409 : err.status >= 400 && err.status < 500 ? 400 : 502;
    const ref = recordError({ kind: "provider", ...where, status: err.status, message: err.message, stack: err.stack });
    return c.json({ error: err.message, ref }, status);
  }
  const ref = recordError({
    kind: "request",
    ...where,
    status: 500,
    message: err.message || String(err),
    stack: err.stack,
  });
  return c.json({ error: "Something went wrong on our side", ref }, 500);
});
