import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { endSession, loginAllowed, passwordMatches, requireAdmin, startSession } from "./auth";
import { env } from "./env";
import { dashboardPage, loginPage } from "./page";
import * as q from "./queries";

const PUBLIC_DIR = new URL("../public/", import.meta.url);
const asset = (specifier: string) => Bun.resolveSync(specifier, import.meta.dir);

const serve = (path: string, type: string) => () => new Response(Bun.file(path), { headers: { "content-type": type } });

const app = new Hono();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "no-referrer",
  }),
);
app.use("*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
  c.header("x-robots-tag", "noindex, nofollow");
});

app.get("/health", (c) => c.json({ ok: true }));
app.get("/favicon.ico", (c) => c.body(null, 204));

app.get("/login", (c) => c.html(loginPage()));
app.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!loginAllowed(ip)) return c.html(loginPage("Too many attempts. Try again in 15 minutes."), 429);
  const form = await c.req.parseBody();
  const password = typeof form.password === "string" ? form.password : "";
  if (!(await passwordMatches(password))) return c.html(loginPage("Wrong password."), 401);
  await startSession(c);
  return c.redirect("/");
});
app.post("/logout", (c) => {
  endSession(c);
  return c.redirect("/login");
});

// The sign-in page needs its stylesheet before there is a session.
app.get("/assets/app.css", serve(new URL("app.css", PUBLIC_DIR).pathname, "text/css"));

app.use("*", requireAdmin);

app.get("/assets/uplot.js", serve(asset("uplot/dist/uPlot.iife.min.js"), "text/javascript"));
app.get("/assets/uplot.css", serve(asset("uplot/dist/uPlot.min.css"), "text/css"));
app.get("/assets/app.js", serve(new URL("app.js", PUBLIC_DIR).pathname, "text/javascript"));

app.get("/", (c) => c.html(dashboardPage()));

const hours = (value: string | undefined) => Number(value ?? 6);

app.get("/api/overview", async (c) => c.json(await q.overview()));
app.get("/api/health", async (c) => c.json(await q.health()));
app.get("/api/requests", async (c) => c.json(await q.requestSeries(hours(c.req.query("hours")))));
app.get("/api/routes", async (c) => c.json(await q.topRoutes(hours(c.req.query("hours")))));
app.get("/api/error-series", async (c) => c.json(await q.errorSeries(hours(c.req.query("hours")))));
app.get("/api/errors", async (c) => c.json(await q.errors(c.req.query("q") ?? "", Number(c.req.query("limit") ?? 100))));
app.get("/api/errors/:ref", async (c) => {
  const row = await q.errorDetail(c.req.param("ref"));
  return row ? c.json(row) : c.json({ error: "No error with that reference" }, 404);
});
app.get("/api/accounts", async (c) => c.json(await q.accounts()));
app.get("/api/logs", async (c) =>
  c.json(
    await q.logs({
      level: c.req.query("level"),
      search: c.req.query("q"),
      afterId: Number(c.req.query("after") ?? 0) || undefined,
    }),
  ),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default { port: env.PORT, fetch: app.fetch };

console.info(`gunes-mail-admin listening on :${env.PORT}`);
