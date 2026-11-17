-- kind: expand
-- Timetable to the standard (one-shot plan 4.4): the school's rooms and their bookings, and bell times that differ by day
-- (a short Friday) or by class (younger classes leaving earlier). `timetable_slots.day` is the timetable day of the school's
-- cycle (timetable.cycle): the weekday, the weekday + 7 in week B, or the day of a cycle of school days.

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "capacity" integer,
  "note" text NOT NULL DEFAULT '',
  "bookable" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "rooms_name_uq" ON "rooms" (lower("name"));

CREATE TABLE IF NOT EXISTS "room_bookings" (
  "id" text PRIMARY KEY NOT NULL,
  "room_id" text NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "purpose" text NOT NULL,
  "booked_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "room_bookings_room_date" ON "room_bookings" ("room_id", "date");

-- A period's own times on one timetable day, for every class (class_id null) or for one class.
CREATE TABLE IF NOT EXISTS "period_times" (
  "day" integer NOT NULL,
  "class_id" text REFERENCES "classes"("id") ON DELETE CASCADE,
  "period" integer NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "period_times_uq" ON "period_times" ("day", coalesce("class_id", ''), "period");

-- Every lesson's times: the class's own for that day, else the school's for that day, else the period's usual times.
CREATE OR REPLACE VIEW "slot_times" AS
  SELECT ts.id AS slot_id, coalesce(oc.starts_at, od.starts_at, p.starts_at) AS starts_at, coalesce(oc.ends_at, od.ends_at, p.ends_at) AS ends_at
  FROM timetable_slots ts JOIN periods p ON p.idx = ts.period
  LEFT JOIN period_times oc ON oc.class_id = ts.class_id AND oc.day = ts.day AND oc.period = ts.period
  LEFT JOIN period_times od ON od.class_id IS NULL AND od.day = ts.day AND od.period = ts.period;
