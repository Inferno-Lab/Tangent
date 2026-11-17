-- kind: expand
-- RSVP rules per event (one-shot plan 4.10): replies close at the end of a day, at most so many grown-ups per family, and
-- at most so many children going.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "rsvp_by" date;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "max_adults" integer;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "capacity" integer;
