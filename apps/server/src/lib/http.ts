export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with exponential backoff for rate limits and transient upstream errors. */
export async function fetchWithRetry(url: string, init: RequestInit, attempts = 8): Promise<Response> {
  let delay = 2000;
  for (let i = 0; ; i++) {
    const res = await fetch(url, init);
    const retryable = res.status === 429 || res.status === 503 || res.status === 500 || res.status === 502;
    let rateLimited = retryable;
    if (res.status === 403) {
      const body = await res.clone().text();
      rateLimited = /rateLimitExceeded|userRateLimitExceeded|quota/i.test(body);
    }
    if (!rateLimited || i >= attempts - 1) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const body = res.status === 429 || res.status === 403 ? await res.clone().text() : "";
    // Per-minute quotas only recover when the window rolls over.
    const perMinute = /per minute/i.test(body);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : perMinute ? 61_000 : delay;
    await sleep(wait + Math.random() * 1000);
    delay = Math.min(delay * 2, 60_000);
  }
}

export async function errorFrom(res: Response): Promise<ProviderError> {
  const text = await res.text();
  let message = text;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
    message =
      (typeof json.error === "object" ? json.error?.message : json.error_description ?? json.error) ?? text;
  } catch {}
  return new ProviderError(res.status, message || res.statusText);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
