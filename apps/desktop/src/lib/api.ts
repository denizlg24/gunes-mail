import { DemoMailApi } from "./demo-api";
import { ServerMailApi, isTauri } from "./server-api";
import type { MailApi } from "./types";

let instance: MailApi | null = null;

export function getApi(): MailApi {
  instance ??= isTauri() ? new ServerMailApi() : new DemoMailApi();
  return instance;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
