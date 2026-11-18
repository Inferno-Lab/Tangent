-- kind: expand
-- Admission stages are the school's own (one-shot plan 4.2). `test_on` keeps the day of whatever stage the enquiry is in.
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "scores" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "docs" jsonb NOT NULL DEFAULT '{}'::jsonb;
-- From the online application: the child's date of birth (enrolment starts with it), and a hash of the address it came from
-- (how many applications one address may send in an hour; never the address itself).
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "dob" date;
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "from_hash" text;
CREATE INDEX IF NOT EXISTS "enquiries_from_hash" ON "enquiries" ("from_hash", "created_at");
