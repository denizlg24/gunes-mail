import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  /** 32 random bytes, base64. Encrypts provider credentials at rest. */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_CLIENT_ID: z.string().default(""),
  CORS_ORIGINS: z
    .string()
    .default("tauri://localhost,http://tauri.localhost,http://localhost:3000,http://localhost:3001,https://gunes-mail.denizlg24.com")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  SYNC_INTERVAL_SECONDS: z.coerce.number().default(45),
  INITIAL_SYNC_DAYS: z.coerce.number().default(90),
  /** Full classify endpoint, e.g. https://classifier.example.com/api/classify. Empty disables categories. */
  EMAIL_CLASSIFIER_URL: z.string().default(""),
  EMAIL_CLASSIFIER_API_TOKEN: z.string().default(""),
  /** Only recent inbox mail is classified; older mail keeps no category. */
  CLASSIFY_DAYS: z.coerce.number().default(30),
  /** Read by the AI SDK directly. Empty disables summaries and drafting. */
  AI_GATEWAY_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
});

export const env = schema.parse(process.env);
