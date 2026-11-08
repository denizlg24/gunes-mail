import type { DeviceSession, UserProfile } from "@gunes/shared";

import { site } from "./site";

const TOKEN_KEY = "gunes-mail-session";

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const headers = new Headers(init.headers);
  headers.set("x-device-name", "Gunes Mail website");
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const res = await fetch(`${site.apiUrl}/v1${path}`, { ...init, headers });
  if (res.status === 401 && token) setToken(null);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function login(email: string, password: string) {
  const { session } = await call<{ session: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(session);
}

export async function logout() {
  await call("/connect/sign-out", { method: "POST" }).catch(() => undefined);
  setToken(null);
}

export const getProfile = () => call<UserProfile>("/me");
export const getSessions = () => call<DeviceSession[]>("/me/sessions");
export const revokeSession = (id: string) => call<void>(`/me/sessions/${id}`, { method: "DELETE" });

export async function deleteAccount() {
  await call<void>("/me", { method: "DELETE" });
  setToken(null);
}
