-- kind: expand
-- Per school (one-shot plan D13 and 3.7): the contract it is billed under (a currency, a fixed rate from Tangent's price
-- list, an agreed price per student) and the region its data must stay in. Invoices keep the currency they were made in.
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "contract" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "residency" text NOT NULL DEFAULT '';
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'INR'; -- india-pack: invoices made so far were in Tangent's rupee price list
-- Amounts in currencies with decimals (cents, fils): the invoice total is exact, not whole units.
ALTER TABLE "invoices" ALTER COLUMN "amount" TYPE numeric(16,3);
