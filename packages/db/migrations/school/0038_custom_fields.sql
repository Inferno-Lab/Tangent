-- kind: expand
-- The school's own fields on its records (docs/one-shot-plan.md §3.6.3): values by field key, checked against fields.custom.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "custom" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "custom" jsonb NOT NULL DEFAULT '{}'::jsonb;
