-- kind: expand
-- Results stay with the exam that gave them, not its name: names like "Term 1" come back every year, so each result also keeps
-- its exam, the exam's name and the day it began (older code still writes the name alone, and those rows read as before).
ALTER TABLE "exam_results" ADD COLUMN IF NOT EXISTS "exam_id" text;
ALTER TABLE "exam_results" ADD COLUMN IF NOT EXISTS "exam_name" text;
ALTER TABLE "exam_results" ADD COLUMN IF NOT EXISTS "taken_on" date;
CREATE INDEX IF NOT EXISTS "exam_results_exam_idx" ON "exam_results" ("exam_id");

-- The timetable families, teachers and the bus read is the published one: a change in the admin is a draft until it is
-- published. A lesson taken out of a published timetable stays published (marked removed) until then, and so does its room.
ALTER TABLE "timetable_slots" ADD COLUMN IF NOT EXISTS "published_room" text;
ALTER TABLE "timetable_slots" ADD COLUMN IF NOT EXISTS "removed" boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW "live_slots" AS
  SELECT id, class_id, day, period, published_subject_id AS subject_id, published_teacher_id AS teacher_id, published_cover_id AS cover_teacher_id, published_room AS room
  FROM timetable_slots WHERE published_subject_id IS NOT NULL AND published_teacher_id IS NOT NULL;

CREATE OR REPLACE VIEW "draft_slots" AS
  SELECT id, class_id, day, period, subject_id, teacher_id, cover_teacher_id, room, published_teacher_id, published_subject_id, published_cover_id, published_room
  FROM timetable_slots WHERE NOT removed;

-- Cover for one day (a teacher away): one person a lesson a date, apart from the timetable's own teacher for that lesson.
CREATE UNIQUE INDEX IF NOT EXISTS "substitutions_slot_date_uq" ON "substitutions" ("slot_id", "date");
CREATE INDEX IF NOT EXISTS "substitutions_teacher_idx" ON "substitutions" ("teacher_id", "date");
