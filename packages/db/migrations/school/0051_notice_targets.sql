-- kind: expand
-- Notices reach more than one class (one-shot plan 4.8): any of some classes, year groups or houses, and staff of some roles.
ALTER TABLE "notices" ADD COLUMN IF NOT EXISTS "targets" jsonb NOT NULL DEFAULT '{}'::jsonb;
