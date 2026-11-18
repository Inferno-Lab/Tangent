-- kind: expand
-- Photos from a zip (one-shot plan 5.2.1): each photo named by a student's admission number becomes their photo, in the
-- background; the school sees how far it got and which names matched nobody.
CREATE TABLE IF NOT EXISTS "photo_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"unmatched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"by_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
