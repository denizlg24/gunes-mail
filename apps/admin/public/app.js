/* global uPlot */
"use strict";

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat();
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const time = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);

async function api(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("signed out");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const range = () => Number($("#range").value);
let tab = "overview";

/* Tabs */
for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b === button));
    for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== tab;
    location.hash = tab;
    refresh();
  });
}

/* Charts */
const charts = {};
const palette = { ok: "#3fb950", client: "#d29922", server: "#f85149", avg: "#5b8cff", max: "#a371f7", request: "#f85149", provider: "#d29922", sync: "#db61a2", send: "#a371f7" };

function chart(id, series, data, opts = {}) {
  const el = document.getElementById(id);
  const width = el.clientWidth || 500;
  const config = {
    width,
    height: 220,
    cursor: { drag: { x: false, y: false } },
    legend: { live: true },
    scales: { x: { time: true } },
    axes: [
      { stroke: "#7d8799", grid: { stroke: "#232a38" }, ticks: { stroke: "#232a38" } },
      { stroke: "#7d8799", grid: { stroke: "#232a38" }, ticks: { stroke: "#232a38" }, size: 50 },
    ],
    series: [{}, ...series],
    ...opts,
  };
  if (charts[id]) charts[id].destroy();
  el.innerHTML = data[0].length ? "" : '<div class="empty">No data in this range yet.</div>';
  if (data[0].length) charts[id] = new uPlot(config, data, el);
}

const bars = uPlot.paths.bars({ size: [0.8, 40] });
const stacked = (rows, keys) => {
  const out = keys.map(() => []);
  for (const row of rows) {
    let sum = 0;
    keys.forEach((k, i) => {
      sum += row[k];
      out[i].push(sum);
    });
  }
  return out.reverse();
};

async function loadOverview() {
  const h = range();
  const [overview, health, requests, routes, errorSeries] = await Promise.all([
    api("/api/overview"),
    api("/api/health"),
    api(`/api/requests?hours=${h}`),
    api(`/api/routes?hours=${h}`),
    api(`/api/error-series?hours=${h}`),
  ]);

  const pill = (label, ok, detail) => `<span class="pill ${ok ? "ok" : "bad"}"><i></i>${esc(label)} <span class="muted">${esc(detail)}</span></span>`;
  $("#health").innerHTML = [
    pill("API", health.api.ok, health.api.ok ? `${health.api.ms} ms` : `down (${health.api.status})`),
    pill("Website", health.web.ok, health.web.ok ? `${health.web.ms} ms` : `down (${health.web.status})`),
    pill("Database", health.db.ok, `${health.db.ms} ms · ${bytes(Number(overview.db_bytes))}`),
    health.release ? pill("Desktop", true, `v${health.release.version} · ${ago(health.release.publishedAt)}`) : pill("Desktop", false, "no release"),
  ].join("");

  const errorRate = overview.requests_1h ? (overview.requests_5xx_1h / overview.requests_1h) * 100 : 0;
  const stat = (label, value, sub = "", tone = "") =>
    `<div class="stat ${tone}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
  $("#stats").innerHTML = [
    stat("Users", fmt.format(overview.users), `+${overview.users_24h} in 24h · ${overview.active_sessions_24h} active`),
    stat("Mailboxes", fmt.format(overview.accounts), `${overview.accounts_downloading} downloading`),
    stat("Mailbox errors", fmt.format(overview.accounts_error), "accounts in error", overview.accounts_error ? "err" : ""),
    stat("Messages stored", fmt.format(Number(overview.messages_estimate)), "estimate"),
    stat("Requests / hour", fmt.format(overview.requests_1h), `${overview.avg_ms_1h} ms average`),
    stat("5xx rate", `${errorRate.toFixed(2)}%`, `${overview.requests_5xx_1h} in the last hour`, errorRate > 1 ? "err" : errorRate > 0 ? "warn" : ""),
    stat("Errors", fmt.format(overview.errors_1h), `${overview.errors_24h} in 24h`, overview.errors_1h ? "warn" : ""),
    stat("Outbox", fmt.format(overview.outbox_scheduled), `${overview.outbox_failed} failed`, overview.outbox_failed ? "err" : ""),
  ].join("");

  const t = requests.map((r) => Number(r.t));
  chart(
    "chart-requests",
    [
      { label: "5xx", stroke: palette.server, fill: palette.server + "cc", paths: bars },
      { label: "4xx", stroke: palette.client, fill: palette.client + "cc", paths: bars },
      { label: "2xx", stroke: palette.ok, fill: palette.ok + "99", paths: bars },
    ],
    [t, ...stacked(requests, ["ok", "client_errors", "server_errors"])],
  );
  chart(
    "chart-latency",
    [
      { label: "avg ms", stroke: palette.avg, width: 2 },
      { label: "max ms", stroke: palette.max, dash: [4, 4] },
    ],
    [t, requests.map((r) => r.avg_ms), requests.map((r) => r.max_ms)],
  );
  const kinds = ["request", "provider", "sync", "send"];
  chart(
    "chart-errors",
    kinds
      .slice()
      .reverse()
      .map((k) => ({ label: k, stroke: palette[k], fill: palette[k] + "cc", paths: bars })),
    [errorSeries.map((r) => Number(r.t)), ...stacked(errorSeries, kinds)],
  );

  $("#routes").innerHTML =
    `<thead><tr><th>Route</th><th class="num">Requests</th><th class="num">Avg</th><th class="num">Max</th><th class="num">4xx</th><th class="num">5xx</th></tr></thead><tbody>` +
    (routes.length
      ? routes
          .map(
            (r) =>
              `<tr><td class="mono truncate" title="${esc(r.route)}">${esc(r.route)}</td><td class="num">${fmt.format(r.requests)}</td><td class="num">${r.avg_ms} ms</td><td class="num">${r.max_ms} ms</td><td class="num">${r.client_errors}</td><td class="num">${r.server_errors ? `<span class="tag error">${r.server_errors}</span>` : 0}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty">No requests in this range.</td></tr>') +
    "</tbody>";
}

/* Errors */
let selectedRef = null;

async function loadErrors() {
  const q = $("#error-search").value.trim();
  const rows = await api(`/api/errors?q=${encodeURIComponent(q)}&limit=200`);
  $("#errors").innerHTML =
    "<thead><tr><th>Reference</th><th>When</th><th>Kind</th><th>Where</th><th>Message</th><th>User</th></tr></thead><tbody>" +
    (rows.length
      ? rows
          .map(
            (e) =>
              `<tr class="clickable ${e.ref === selectedRef ? "selected" : ""}" data-ref="${esc(e.ref)}"><td class="mono nowrap">${esc(e.ref)}</td><td class="nowrap" title="${esc(time(e.created_at))}">${ago(e.created_at)}</td><td><span class="tag ${esc(e.kind)}">${esc(e.kind)}</span></td><td class="mono truncate where">${esc([e.method, e.path].filter(Boolean).join(" ") || e.account_email || "")}</td><td class="truncate" title="${esc(e.message)}">${esc(e.message)}</td><td class="truncate">${esc(e.user_email || "")}</td></tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty">No errors match.</td></tr>') +
    "</tbody>";
  if (rows.length === 1 && /^GM-/i.test(q)) showError(rows[0].ref);
}

async function showError(ref) {
  selectedRef = ref;
  for (const row of document.querySelectorAll("#errors tr[data-ref]")) row.classList.toggle("selected", row.dataset.ref === ref);
  const e = await api(`/api/errors/${encodeURIComponent(ref)}`);
  const field = (label, value) => (value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : "");
  $("#error-detail").innerHTML = `
    <h2>${esc(e.ref)}</h2>
    <dl>
      ${field("When", esc(time(e.created_at)))}
      ${field("Kind", `<span class="tag ${esc(e.kind)}">${esc(e.kind)}</span>`)}
      ${field("Request", e.path ? `<span class="mono">${esc(e.method || "")} ${esc(e.path)}</span>` : "")}
      ${field("Status", e.status ? esc(e.status) : "")}
      ${field("User", esc(e.user_email || ""))}
      ${field("Mailbox", e.account_email ? `${esc(e.account_email)} <span class="muted">(${esc(e.account_provider)})</span>` : "")}
    </dl>
    <h2>Message</h2>
    <pre>${esc(e.message)}</pre>
    ${e.stack ? `<h2 style="margin-top:14px">Stack</h2><pre>${esc(e.stack)}</pre>` : ""}`;
}

$("#errors").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-ref]");
  if (row) showError(row.dataset.ref);
});
let searchTimer;
$("#error-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadErrors, 250);
});

/* Mailboxes */
async function loadAccounts() {
  const rows = await api("/api/accounts");
  $("#accounts").innerHTML =
    '<thead><tr><th>Mailbox</th><th>Owner</th><th>Provider</th><th>Status</th><th class="num">Messages</th><th>Download</th><th>Last sync</th><th>Last error</th></tr></thead><tbody>' +
    (rows.length
      ? rows
          .map((a) => {
            const pct = a.total ? Math.min(100, Math.round((a.messages / a.total) * 100)) : null;
            const download = a.downloading
              ? `${esc(a.phase || "recent")} ${pct === null ? "" : `${pct}%`}<div class="bar"><span style="width:${pct ?? 30}%"></span></div>`
              : '<span class="tag ok">complete</span>';
            return `<tr><td>${esc(a.email)}</td><td class="muted">${esc(a.user_email || "")}</td><td>${esc(a.provider)}</td><td><span class="tag ${a.status === "error" ? "error" : a.status === "ready" ? "ready" : ""}">${esc(a.status)}</span></td><td class="num">${fmt.format(a.messages)}${a.total ? ` <span class="muted">/ ${fmt.format(a.total)}</span>` : ""}</td><td style="min-width:140px">${download}</td><td title="${a.last_synced_at ? esc(time(a.last_synced_at)) : ""}">${ago(a.last_synced_at)}</td><td class="truncate" title="${esc(a.last_error || "")}">${esc(a.last_error || "")}</td></tr>`;
          })
          .join("")
      : '<tr><td colspan="8" class="empty">No mailboxes connected.</td></tr>') +
    "</tbody>";
}

/* Logs */
let lastLogId = 0;
let logFilterKey = "";

async function loadLogs() {
  const level = $("#log-level").value;
  const q = $("#log-search").value.trim();
  const key = `${level}|${q}`;
  const fresh = key !== logFilterKey;
  if (fresh) {
    logFilterKey = key;
    lastLogId = 0;
  }
  const rows = await api(`/api/logs?level=${level}&q=${encodeURIComponent(q)}${lastLogId ? `&after=${lastLogId}` : ""}`);
  const box = $("#logs");
  if (fresh) box.innerHTML = rows.length ? "" : '<span class="muted">No log lines match.</span>';
  if (!rows.length) return;
  lastLogId = Math.max(lastLogId, ...rows.map((r) => r.id));
  const html = rows
    .slice()
    .reverse()
    .map((r) => `<div class="${esc(r.level)}"><span class="time">${esc(time(r.created_at))}</span> ${esc(r.level.toUpperCase().padEnd(5))} ${esc(r.message)}</div>`)
    .join("");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.insertAdjacentHTML("beforeend", html);
  if (fresh || atBottom) box.scrollTop = box.scrollHeight;
}

let logTimer;
$("#log-search").addEventListener("input", () => {
  clearTimeout(logTimer);
  logTimer = setTimeout(loadLogs, 250);
});
$("#log-level").addEventListener("change", loadLogs);

/* Refresh loop */
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    if (tab === "overview") await loadOverview();
    if (tab === "errors") await loadErrors();
    if (tab === "accounts") await loadAccounts();
    if (tab === "logs") await loadLogs();
    $("#updated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    $("#updated").textContent = `Refresh failed: ${e.message}`;
  } finally {
    busy = false;
  }
}

$("#range").addEventListener("change", refresh);
setInterval(() => {
  if (document.hidden) return;
  if (tab === "logs" && !$("#log-follow").checked) return;
  refresh();
}, 10_000);
window.addEventListener("resize", () => {
  for (const id of Object.keys(charts)) charts[id].setSize({ width: document.getElementById(id).clientWidth, height: 220 });
});

const initial = location.hash.slice(1);
const start = document.querySelector(`[data-tab="${initial}"]`);
if (start) start.click();
else refresh();
