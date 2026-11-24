-- kind: backfill
-- Results published before they kept their exam are matched to it: the published exam of that name the student has marks in,
-- the latest one when the name came back in another year.
UPDATE "exam_results" r SET "exam_id" = x.id, "exam_name" = x.name, "taken_on" = x.starts_on
FROM (
  SELECT DISTINCT ON (m.student_id, e.name) m.student_id, e.name, e.id, e.starts_on
  FROM "exams" e JOIN "exam_marks" m ON m.exam_id = e.id
  WHERE e.status = 'published'
  ORDER BY m.student_id, e.name, e.starts_on DESC
) x
WHERE r.exam_id IS NULL AND x.student_id = r.student_id AND x.name = r.exam;

-- Until now every change reached families at once, so what is in the timetable today is what they already see: it becomes the
-- published timetable, and only changes made from here on wait for Publish.
UPDATE "timetable_slots" SET "published_teacher_id" = "teacher_id", "published_subject_id" = "subject_id", "published_cover_id" = "cover_teacher_id", "published_room" = "room";
