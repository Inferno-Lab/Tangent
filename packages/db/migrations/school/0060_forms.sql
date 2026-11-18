-- kind: expand
-- The school's own forms (one-shot plan 3.6.3): consent forms, surveys, data-update requests, filled in the app or by link.
CREATE TABLE IF NOT EXISTS "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"fields" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience" text DEFAULT 'families' NOT NULL,
	"per_child" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"closes_on" date,
	"token" text UNIQUE,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "form_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
	"user_id" text,
	"student_id" text,
	"by_name" text DEFAULT '' NOT NULL,
	"answers" jsonb NOT NULL,
	"from_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
-- One answer per person (per child for a per-child form): a second one replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS "form_responses_one" ON "form_responses" ("form_id", "user_id", coalesce("student_id", '')) WHERE "user_id" IS NOT NULL;
