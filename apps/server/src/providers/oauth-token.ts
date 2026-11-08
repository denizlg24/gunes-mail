import { ProviderError, errorFrom, fetchWithRetry } from "../lib/http";

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenEndpoint {
  url: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}

/** Holds OAuth credentials, refreshing them on demand and reporting rotations. */
export class OAuthToken {
  private refreshing: Promise<string> | null = null;

  constructor(
    private credentials: OAuthCredentials,
    private readonly endpoint: TokenEndpoint,
    private readonly onRotate: (credentials: OAuthCredentials) => Promise<void>,
  ) {}

  async get(force = false): Promise<string> {
    if (!force && this.credentials.expiresAt - 60 > Date.now() / 1000) return this.credentials.accessToken;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken,
      client_id: this.endpoint.clientId,
    });
    if (this.endpoint.clientSecret) form.set("client_secret", this.endpoint.clientSecret);
    if (this.endpoint.scope) form.set("scope", this.endpoint.scope);
    const res = await fetchWithRetry(this.endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) {
      const err = await errorFrom(res);
      throw new ProviderError(401, `Sign-in expired, reconnect this account (${err.message})`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    this.credentials = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.credentials.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
    };
    await this.onRotate(this.credentials);
    return this.credentials.accessToken;
  }

  /** Authenticated JSON request with one forced refresh on 401. */
  async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.get(attempt > 0);
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      const res = await fetchWithRetry(url, { ...init, headers });
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) throw await errorFrom(res);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw new ProviderError(401, "Unauthorized");
  }
}
