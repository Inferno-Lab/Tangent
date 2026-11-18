-- kind: expand
-- Reports sent by themselves (one-shot plan 5.2.3): a report and its class, every week or month on a day, to chosen staff.
CREATE TABLE IF NOT EXISTS "report_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"class_id" text,
	"every" text NOT NULL CHECK ("every" IN ('week', 'month')),
	"day" integer NOT NULL,
	"to_ids" text[] NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent" date
);
