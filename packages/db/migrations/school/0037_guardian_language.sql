-- kind: expand
-- The language a family reads (docs/one-shot-plan.md §3.5.6), set by the office on the guardian's record; the family's own
-- choice in the app comes first. Empty means the school's default language.

ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "language" text;
