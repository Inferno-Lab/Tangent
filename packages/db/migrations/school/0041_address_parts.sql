-- kind: expand
-- Addresses in the country's parts (docs/one-shot-plan.md §3.3.5); `address` stays the one-line form everything reads.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "address_parts" jsonb NOT NULL DEFAULT '{}'::jsonb;
