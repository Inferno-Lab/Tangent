-- kind: backfill
-- Until now only the guardian contacted first got the school's messages and bills; each link starts that way.
UPDATE "student_guardians" SET "gets_messages" = "is_primary", "gets_bills" = "is_primary";

-- Leavers before 0042 get the kind their reason tells (year-end writes "Completed the school").
UPDATE "students" SET "leaving_kind" = CASE WHEN "leaving_reason" = 'Completed the school' THEN 'graduated' ELSE 'withdrawn' END
  WHERE "status" = 'left' AND "leaving_kind" IS NULL;
