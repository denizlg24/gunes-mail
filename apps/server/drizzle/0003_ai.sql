ALTER TABLE "messages" ADD COLUMN "triage" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "triage_confidence" real;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "triage_source" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "triaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "triage" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "insight" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "insight_key" text;--> statement-breakpoint
CREATE INDEX "messages_untriaged" ON "messages" USING btree ("date") WHERE triaged_at is null;