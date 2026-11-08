CREATE TABLE "error_events" (
	"ref" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"method" text,
	"path" text,
	"status" integer,
	"message" text NOT NULL,
	"stack" text
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "log_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_stats" (
	"minute" timestamp with time zone NOT NULL,
	"route" text NOT NULL,
	"status_class" text NOT NULL,
	"count" integer NOT NULL,
	"total_ms" integer NOT NULL,
	"max_ms" integer NOT NULL,
	CONSTRAINT "request_stats_minute_route_status_class_pk" PRIMARY KEY("minute","route","status_class")
);
--> statement-breakpoint
CREATE INDEX "error_events_created_idx" ON "error_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "log_entries_created_idx" ON "log_entries" USING btree ("created_at");