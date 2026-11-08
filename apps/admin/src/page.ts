const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const head = (title: string, extra = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
${extra}
</head>`;

export function loginPage(error?: string) {
  return `${head("Sign in · Güneş Mail admin")}
<body class="login">
  <form method="post" action="/login" class="login-card">
    <div class="brand"><span class="dot"></span>Güneş Mail admin</div>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    ${error ? `<p class="form-error">${escape(error)}</p>` : ""}
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`;
}

export function dashboardPage() {
  return `${head("Güneş Mail admin", '<link rel="stylesheet" href="/assets/uplot.css">')}
<body>
  <header class="top">
    <div class="brand"><span class="dot"></span>Güneş Mail <span class="muted">admin</span></div>
    <nav class="tabs" role="tablist">
      <button role="tab" data-tab="overview" aria-selected="true">Overview</button>
      <button role="tab" data-tab="errors">Errors</button>
      <button role="tab" data-tab="accounts">Mailboxes</button>
      <button role="tab" data-tab="logs">Logs</button>
    </nav>
    <div class="top-right">
      <select id="range" aria-label="Time range">
        <option value="1">Last hour</option>
        <option value="6" selected>Last 6 hours</option>
        <option value="24">Last 24 hours</option>
        <option value="168">Last 7 days</option>
      </select>
      <span id="updated" class="muted"></span>
      <form method="post" action="/logout"><button class="ghost" type="submit">Sign out</button></form>
    </div>
  </header>

  <main>
    <section data-panel="overview">
      <div class="health" id="health"></div>
      <div class="stats" id="stats"></div>
      <div class="grid2">
        <div class="panel"><h2>Requests</h2><div class="chart" id="chart-requests"></div></div>
        <div class="panel"><h2>Latency <span class="muted">avg / max ms</span></h2><div class="chart" id="chart-latency"></div></div>
      </div>
      <div class="grid2">
        <div class="panel"><h2>Errors by kind</h2><div class="chart" id="chart-errors"></div></div>
        <div class="panel"><h2>Top routes</h2><div class="table-wrap"><table id="routes"></table></div></div>
      </div>
    </section>

    <section data-panel="errors" hidden>
      <div class="toolbar">
        <input id="error-search" type="search" placeholder="Reference (GM-…), message, path or email" autocomplete="off">
      </div>
      <div class="split">
        <div class="panel"><div class="table-wrap tall"><table id="errors"></table></div></div>
        <div class="panel detail" id="error-detail"><p class="muted">Select an error to see its details.</p></div>
      </div>
    </section>

    <section data-panel="accounts" hidden>
      <div class="panel"><div class="table-wrap tall"><table id="accounts"></table></div></div>
    </section>

    <section data-panel="logs" hidden>
      <div class="toolbar">
        <select id="log-level" aria-label="Level">
          <option value="info">All levels</option>
          <option value="warn">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>
        <input id="log-search" type="search" placeholder="Search logs" autocomplete="off">
        <label class="check"><input id="log-follow" type="checkbox" checked> Live</label>
      </div>
      <div class="panel"><pre class="logs" id="logs"></pre></div>
    </section>
  </main>
  <script src="/assets/uplot.js"></script>
  <script src="/assets/app.js"></script>
</body>
</html>`;
}
