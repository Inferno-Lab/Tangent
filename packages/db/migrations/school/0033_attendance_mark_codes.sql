-- kind: expand
-- The school's own attendance marks (docs/one-shot-plan.md §3.6.5): a mark is kept by what it means (present, late, half
-- day, absent, leave: every count works on that) and, beside it, the school's own mark when it has one of its own.

ALTER TABLE "attendance_marks" ADD COLUMN IF NOT EXISTS "code" text;
