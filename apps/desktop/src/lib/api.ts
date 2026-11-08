import { DemoMailApi } from "./demo-api";
import { ApiError, ServerMailApi, isTauri } from "./server-api";
import type { MailApi } from "./types";

let instance: MailApi | null = null;

export function getApi(): MailApi {
  instance ??= isTauri() ? new ServerMailApi() : new DemoMailApi();
  return instance;
}

export function errorRef(error: unknown): string | undefined {
  return error instanceof ApiError ? error.ref : undefined;
}

/** Includes the support reference so it lands in toasts users screenshot or copy. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const ref = errorRef(error);
  if (error instanceof Error) return ref ? `${error.message} (Ref ${ref})` : error.message;
  return "Something went wrong";
}
