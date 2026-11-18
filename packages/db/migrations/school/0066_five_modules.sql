-- kind: expand
-- Five modules (one-shot plan 6.3, 6.7, 6.21, 6.23, 6.24): staff attendance and leave, the class diary, parent-teacher
-- meetings, visitors with gate passes and pick-up, and certificates.

-- A member of staff's day: marked by the office, or their own check-in and check-out from the app. Leave is not written
-- here: approved leave is read from the approvals, so undoing it leaves nothing behind.
CREATE TABLE IF NOT EXISTS "staff_attendance" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "status" text,
  "check_in" timestamptz,
  "check_out" timestamptz,
  "late" boolean NOT NULL DEFAULT false,
  "early" boolean NOT NULL DEFAULT false,
  "source" text NOT NULL DEFAULT 'office' CHECK ("source" IN ('office', 'app', 'device')),
  "lat" double precision,
  "lng" double precision,
  "note" text NOT NULL DEFAULT '',
  "marked_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_attendance_date" ON "staff_attendance" ("date");
--> statement-breakpoint
-- Days added to or taken from a balance by the office (an opening balance brought from the old system, a correction).
CREATE TABLE IF NOT EXISTS "staff_leave_adjustments" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "year_label" text NOT NULL,
  "days" numeric(6,1) NOT NULL,
  "note" text NOT NULL DEFAULT '',
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_leave_adjustments_user" ON "staff_leave_adjustments" ("user_id", "year_label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_staff_leave" ON "approvals" ("subject_ref") WHERE "kind" = 'staff_leave';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "diary_entries" (
  "id" text PRIMARY KEY,
  "class_id" text NOT NULL REFERENCES "classes"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "kind" text NOT NULL,
  "subject_id" text REFERENCES "subjects"("id") ON DELETE SET NULL,
  "text" text NOT NULL,
  "file_ids" jsonb NOT NULL DEFAULT '[]',
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "by_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "diary_entries_class_date" ON "diary_entries" ("class_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "diary_remarks" (
  "entry_id" text NOT NULL REFERENCES "diary_entries"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  PRIMARY KEY ("entry_id", "student_id")
);
--> statement-breakpoint
-- One acknowledgement per child: either guardian (or the student) ticking it counts for the child.
CREATE TABLE IF NOT EXISTS "diary_acks" (
  "entry_id" text NOT NULL REFERENCES "diary_entries"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("entry_id", "student_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meetings" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL,
  "date" date NOT NULL,
  "from_time" text NOT NULL,
  "to_time" text NOT NULL,
  "slot_minutes" integer NOT NULL,
  "gap_minutes" integer NOT NULL DEFAULT 0,
  "mode" text NOT NULL DEFAULT 'inPerson' CHECK ("mode" IN ('inPerson', 'online', 'either')),
  "place" text NOT NULL DEFAULT '',
  "link" text NOT NULL DEFAULT '',
  "class_ids" jsonb NOT NULL DEFAULT '[]',
  "teacher_ids" jsonb NOT NULL DEFAULT '[]',
  "closes_at" timestamptz,
  "status" text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'open', 'closed')),
  "reminded" boolean NOT NULL DEFAULT false,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_slots" (
  "id" text PRIMARY KEY,
  "meeting_id" text NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "teacher_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz NOT NULL,
  "closed" boolean NOT NULL DEFAULT false,
  "link" text NOT NULL DEFAULT '',
  "student_id" text REFERENCES "students"("id") ON DELETE SET NULL,
  "booked_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "booked_mode" text CHECK ("booked_mode" IN ('inPerson', 'online')),
  "note" text NOT NULL DEFAULT '',
  "booked_at" timestamptz,
  UNIQUE ("meeting_id", "teacher_id", "starts_at")
);
--> statement-breakpoint
-- A child meets each teacher once per meeting day.
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_slots_one_booking" ON "meeting_slots" ("meeting_id", "teacher_id", "student_id") WHERE "student_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "visitors" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "phone" text NOT NULL DEFAULT '',
  "purpose" text NOT NULL,
  "host_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "id_type" text NOT NULL DEFAULT '',
  "id_number" text NOT NULL DEFAULT '',
  "photo_file_id" text,
  "vehicle" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "custom" jsonb NOT NULL DEFAULT '{}',
  "badge_no" text UNIQUE,
  "code" text UNIQUE,
  "state" text NOT NULL CHECK ("state" IN ('pending', 'invited', 'in', 'out', 'cancelled', 'declined')),
  "expected_on" date,
  "in_at" timestamptz,
  "out_at" timestamptz,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_by_name" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visitors_state" ON "visitors" ("state", "expected_on");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gate_passes" (
  "id" text PRIMARY KEY,
  "number" text UNIQUE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "leave_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "pickup_id" text,
  "collector" text NOT NULL DEFAULT '',
  "returns" boolean NOT NULL DEFAULT false,
  "state" text NOT NULL CHECK ("state" IN ('consent', 'pending', 'approved', 'rejected', 'left', 'cancelled')),
  "approval_id" text,
  "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "out_at" timestamptz,
  "out_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gate_passes_student" ON "gate_passes" ("student_id", "leave_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pickup_people" (
  "id" text PRIMARY KEY,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "relation" text NOT NULL,
  "phone" text NOT NULL DEFAULT '',
  "photo_file_id" text,
  "active" boolean NOT NULL DEFAULT true,
  "added_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pickup_people_student" ON "pickup_people" ("student_id");
--> statement-breakpoint
-- A family's pick-up code for one day (one code for all their children), shown in the app and asked for at the gate.
CREATE TABLE IF NOT EXISTS "pickup_codes" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "code" text NOT NULL,
  PRIMARY KEY ("user_id", "day")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_codes_day_code" ON "pickup_codes" ("day", "code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pickups" (
  "id" text PRIMARY KEY,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "pickup_id" text,
  "name" text NOT NULL,
  "by_code" boolean NOT NULL DEFAULT false,
  "at" timestamptz NOT NULL DEFAULT now(),
  "recorded_by" text REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pickups_at" ON "pickups" ("at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "late_arrivals" (
  "id" text PRIMARY KEY,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "at" timestamptz NOT NULL,
  "reason" text NOT NULL DEFAULT '',
  "recorded_by" text REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "late_arrivals_at" ON "late_arrivals" ("at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "certificates" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "type_name" text NOT NULL,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "purpose" text NOT NULL DEFAULT '',
  "number" text UNIQUE,
  "state" text NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'issued', 'rejected', 'cancelled', 'revoked')),
  "approval_id" text,
  "invoice_id" text,
  "token" text NOT NULL UNIQUE,
  -- The words as issued, so a later change to the type's wording never changes a certificate already given.
  "body" text NOT NULL DEFAULT '',
  "requested_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_by_name" text NOT NULL DEFAULT '',
  "issued_at" timestamptz,
  "issued_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certificates_student" ON "certificates" ("student_id");
