-- kind: expand
-- Exams to the standard (one-shot plan 4.6): the kind of exam (the school's list), who invigilates each paper, a grade given
-- straight away where a subject is graded without marks, and each student's remark on the exam.
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT '';
ALTER TABLE "exam_subjects" ADD COLUMN IF NOT EXISTS "invigilator_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "exam_marks" ADD COLUMN IF NOT EXISTS "grade" text;
CREATE TABLE IF NOT EXISTS "exam_remarks" (
  "exam_id" text NOT NULL REFERENCES "exams"("id") ON DELETE CASCADE,
  "student_id" text NOT NULL REFERENCES "students"("id") ON DELETE CASCADE,
  "remark" text NOT NULL,
  "by_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("exam_id", "student_id")
);
