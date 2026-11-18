-- kind: expand
-- People to the standard (one-shot plan 4.2): households, contact preferences, names, lifecycle, line managers.

-- Separated parents: each link says whether that guardian gets the school's messages and the bills (0043 sets them from
-- who was contacted first, the only one who got either until now).
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "gets_messages" boolean NOT NULL DEFAULT true;
ALTER TABLE "student_guardians" ADD COLUMN IF NOT EXISTS "gets_bills" boolean NOT NULL DEFAULT true;

-- Channels a guardian asked not to be reached on ('sms', 'whatsapp', 'email', 'push').
ALTER TABLE "guardians" ADD COLUMN IF NOT EXISTS "channels_off" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Given and family names (the display name is composed from them in the school's order) and the name in a second script.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "given_name" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "family_name" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "name_local" text;

-- Why a student left: withdrawn, transferred (to which school), graduated, other.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "leaving_kind" text;
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "transfer_to" text;

-- A staff member's line manager (workflow steps can go to them).
ALTER TABLE "staff" ADD COLUMN IF NOT EXISTS "manager_id" text REFERENCES "users"("id") ON DELETE SET NULL;
