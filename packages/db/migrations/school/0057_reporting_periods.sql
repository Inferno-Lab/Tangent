-- kind: expand
-- Reporting periods (one-shot plan 3.3.8): the stretches a school reports on (quarters, half terms, marking periods),
-- separate from its terms. Reports offer them, beside the terms, as the dates to cover.
CREATE TABLE IF NOT EXISTS "reporting_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"year_id" text NOT NULL REFERENCES "academic_years"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "reporting_periods_year_name_uq" ON "reporting_periods" ("year_id", lower("name"));
