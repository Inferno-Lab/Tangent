-- kind: expand
-- Tangent is international (docs/one-shot-plan.md §3.3): every school has its own country, time zone, locale and currency.
-- They are the school's settings; the registry keeps a copy, like the name, so every server knows a school's "today"
-- without opening its database. Every school so far is in India, so existing rows start there; new schools are set by
-- the onboarding wizard from the country chosen.

ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "country" text NOT NULL DEFAULT 'IN';
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'Asia/Kolkata';
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'en-IN';
--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'INR';
