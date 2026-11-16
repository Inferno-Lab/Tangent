-- kind: expand
-- Translations kept by Tangent (docs/one-shot-plan.md §3.5.9): every text of every surface in any language, drafted by a
-- machine or a person and marked reviewed once a person approves it. The repository's own catalogues come first; a row here
-- adds a language or corrects a text without a release. `surface` is admin, console, ui, text (shared) or app.

CREATE TABLE IF NOT EXISTS "translations" (
	"lang" text NOT NULL,
	"surface" text NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'person' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("lang", "surface", "key")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "translations_lang_surface" ON "translations" ("lang", "surface", "updated_at");
