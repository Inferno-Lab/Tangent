-- kind: expand
-- A school created without a country starts neutral (docs/one-shot-plan.md §3.9.1): UTC, English, US dollars, no board;
-- the wizard sets each from the country and curriculum chosen. Schools already created keep what they have.
ALTER TABLE "schools" ALTER COLUMN "timezone" SET DEFAULT 'UTC';
ALTER TABLE "schools" ALTER COLUMN "locale" SET DEFAULT 'en';
ALTER TABLE "schools" ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "schools" ALTER COLUMN "board" SET DEFAULT 'Other';
ALTER TABLE "schools" ALTER COLUMN "country" SET DEFAULT '';
