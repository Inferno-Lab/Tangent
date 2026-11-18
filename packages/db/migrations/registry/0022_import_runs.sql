-- kind: expand
-- Big imports run in the background (one-shot plan 5.2.4): the console sees each run's state and its result when done.
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"batch_id" text,
	"created" integer,
	"updated" integer,
	"skipped" integer,
	"error" text,
	"by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
