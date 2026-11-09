import { type TriageCategory, isTriageCategory } from "@gunes/shared";

import { env } from "../env";

export interface ClassifierInput {
  subject: string;
  body: string;
  senderName: string;
  senderAddress: string;
  attachmentCount: number;
  hasHtml: boolean;
}

export interface Classification {
  category: TriageCategory;
  confidence: number;
}

/** The service is down or misconfigured; retrying the same message later can succeed. */
export class ClassifierUnavailable extends Error {}

/** The service rejected this particular message; retrying won't help. */
export class ClassifierRejected extends Error {}

const TIMEOUT_MS = 20_000;
/** The service caps request bodies at 4 MB; nothing past this changes the prediction. */
const MAX_BODY_CHARS = 100_000;

export function classifierEnabled(): boolean {
  return !!env.EMAIL_CLASSIFIER_URL && !!env.EMAIL_CLASSIFIER_API_TOKEN;
}

function parse(payload: unknown): Classification {
  if (typeof payload !== "object" || payload === null) throw new ClassifierRejected("Classifier returned no prediction");
  const { category, confidence } = payload as { category?: unknown; confidence?: unknown };
  if (!isTriageCategory(category)) throw new ClassifierRejected("Classifier returned an unknown category");
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new ClassifierRejected("Classifier returned an invalid confidence");
  }
  return { category, confidence: Math.min(1, Math.max(0, confidence)) };
}

export async function classify(input: ClassifierInput): Promise<Classification> {
  let res: Response;
  try {
    res = await fetch(env.EMAIL_CLASSIFIER_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.EMAIL_CLASSIFIER_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        subject: input.subject.slice(0, 10_000),
        body: input.body.slice(0, MAX_BODY_CHARS),
        sender_name: input.senderName.slice(0, 10_000),
        sender_address: input.senderAddress.slice(0, 10_000),
        attachment_count: input.attachmentCount,
        has_html: input.hasHtml,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ClassifierUnavailable(e instanceof Error ? e.message : String(e));
  }
  if (res.status === 400 || res.status === 413) throw new ClassifierRejected(`Classifier returned HTTP ${res.status}`);
  if (!res.ok) throw new ClassifierUnavailable(`Classifier returned HTTP ${res.status}`);
  return parse(await res.json().catch(() => null));
}
