import postgres from "postgres";

import { env } from "./env";

export const sql = postgres(env.DATABASE_URL, { max: 4, idle_timeout: 30, connection: { application_name: "gunes-admin" } });

const clampHours = (hours: number) => Math.min(Math.max(Math.round(hours) || 6, 1), 24 * 14);

export async function overview() {
  const [row] = await sql`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from users where created_at > now() - interval '24 hours') as users_24h,
      (select count(*)::int from sessions where last_used_at > now() - interval '24 hours') as active_sessions_24h,
      (select count(*)::int from accounts) as accounts,
      (select count(*)::int from accounts where status = 'error') as accounts_error,
      (select count(*)::int from accounts where (sync_state->>'pending')::boolean) as accounts_downloading,
      (select greatest(reltuples, 0)::bigint from pg_class where relname = 'messages') as messages_estimate,
      (select count(*)::int from error_events where created_at > now() - interval '1 hour') as errors_1h,
      (select count(*)::int from error_events where created_at > now() - interval '24 hours') as errors_24h,
      (select coalesce(sum(count), 0)::int from request_stats where minute > now() - interval '1 hour') as requests_1h,
      (select coalesce(sum(count) filter (where status_class = '5xx'), 0)::int from request_stats where minute > now() - interval '1 hour') as requests_5xx_1h,
      (select coalesce(round(sum(total_ms)::numeric / nullif(sum(count), 0)), 0)::int from request_stats where minute > now() - interval '1 hour') as avg_ms_1h,
      (select count(*)::int from outbox where status = 'scheduled') as outbox_scheduled,
      (select count(*)::int from outbox where status = 'failed') as outbox_failed,
      pg_database_size(current_database())::bigint as db_bytes`;
  return row;
}

export async function requestSeries(hours: number) {
  const h = clampHours(hours);
  const bucket = h <= 6 ? 60 : h <= 48 ? 300 : 3600;
  return sql`
    select
      extract(epoch from to_timestamp(floor(extract(epoch from minute) / ${bucket}) * ${bucket}))::bigint as t,
      coalesce(sum(count) filter (where status_class = '2xx' or status_class = '3xx'), 0)::int as ok,
      coalesce(sum(count) filter (where status_class = '4xx'), 0)::int as client_errors,
      coalesce(sum(count) filter (where status_class = '5xx'), 0)::int as server_errors,
      coalesce(round(sum(total_ms)::numeric / nullif(sum(count), 0)), 0)::int as avg_ms,
      coalesce(max(max_ms), 0)::int as max_ms
    from request_stats
    where minute > now() - make_interval(hours => ${h})
    group by 1
    order by 1`;
}

export async function errorSeries(hours: number) {
  const h = clampHours(hours);
  const bucket = h <= 6 ? 300 : 3600;
  return sql`
    select
      extract(epoch from to_timestamp(floor(extract(epoch from created_at) / ${bucket}) * ${bucket}))::bigint as t,
      count(*) filter (where kind = 'request')::int as request,
      count(*) filter (where kind = 'provider')::int as provider,
      count(*) filter (where kind = 'sync')::int as sync,
      count(*) filter (where kind = 'send')::int as send
    from error_events
    where created_at > now() - make_interval(hours => ${h})
    group by 1
    order by 1`;
}

export async function topRoutes(hours: number) {
  const h = clampHours(hours);
  return sql`
    select route,
           sum(count)::int as requests,
           round(sum(total_ms)::numeric / nullif(sum(count), 0))::int as avg_ms,
           max(max_ms)::int as max_ms,
           coalesce(sum(count) filter (where status_class = '5xx'), 0)::int as server_errors,
           coalesce(sum(count) filter (where status_class = '4xx'), 0)::int as client_errors
    from request_stats
    where minute > now() - make_interval(hours => ${h})
    group by route
    order by requests desc
    limit 15`;
}

export async function errors(search: string, limit: number) {
  const q = search.trim();
  const ref = q.toUpperCase().replace(/^REF\s*/, "");
  return sql`
    select e.ref, e.created_at, e.kind, e.method, e.path, e.status, left(e.message, 300) as message,
           u.email as user_email, a.email as account_email
    from error_events e
    left join users u on u.id = e.user_id
    left join accounts a on a.id = e.account_id
    where ${q === "" ? sql`true` : sql`(e.ref = ${ref} or e.message ilike ${`%${q}%`} or e.path ilike ${`%${q}%`} or u.email ilike ${`%${q}%`} or a.email ilike ${`%${q}%`})`}
    order by e.created_at desc
    limit ${Math.min(Math.max(limit, 1), 500)}`;
}

export async function errorDetail(ref: string) {
  const [row] = await sql`
    select e.*, u.email as user_email, a.email as account_email, a.provider as account_provider
    from error_events e
    left join users u on u.id = e.user_id
    left join accounts a on a.id = e.account_id
    where e.ref = ${ref.toUpperCase()}`;
  return row ?? null;
}

export async function accounts() {
  return sql`
    select a.id, a.provider, a.email, a.status, a.last_synced_at, a.created_at, left(a.last_error, 400) as last_error,
           coalesce((a.sync_state->>'pending')::boolean, false) as downloading,
           (a.sync_state->>'total')::int as total,
           a.sync_state->>'phase' as phase,
           coalesce(m.messages, 0)::int as messages,
           coalesce(u.email, nullif(u.name, ''), 'user ' || left(u.id::text, 8)) as user_email
    from accounts a
    join users u on u.id = a.user_id
    left join (select account_id, count(*) as messages from messages group by account_id) m on m.account_id = a.id
    order by a.status = 'error' desc, a.last_synced_at desc nulls last`;
}

export async function logs(options: { level?: string; search?: string; afterId?: number; limit?: number }) {
  const levels = options.level === "error" ? ["error"] : options.level === "warn" ? ["warn", "error"] : ["info", "warn", "error"];
  const q = options.search?.trim() ?? "";
  return sql`
    select id, created_at, level, message
    from log_entries
    where level = any(${levels})
      ${options.afterId ? sql`and id > ${options.afterId}` : sql``}
      ${q ? sql`and message ilike ${`%${q}%`}` : sql``}
    order by id desc
    limit ${Math.min(Math.max(options.limit ?? 300, 1), 1000)}`;
}

export async function health() {
  const probe = async (url: string) => {
    const start = performance.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, status: 0, ms: Math.round(performance.now() - start) };
    }
  };
  const dbStart = performance.now();
  const db = await sql`select 1`.then(
    () => ({ ok: true, ms: Math.round(performance.now() - dbStart) }),
    () => ({ ok: false, ms: Math.round(performance.now() - dbStart) }),
  );
  const [api, web, release] = await Promise.all([
    probe(`${env.API_URL}/health`),
    probe(`${env.WEB_URL}/`),
    fetch(`${env.API_URL}/v1/releases/latest`, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ version: string; publishedAt: string }>) : null))
      .catch(() => null),
  ]);
  return { api, web, db, release };
}
