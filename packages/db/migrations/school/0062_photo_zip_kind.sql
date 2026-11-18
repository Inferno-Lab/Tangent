-- kind: contract
-- A zip of students' photos is a kind of file (Moving in): the list of kinds a file may be grows by one.
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_kind_check";
ALTER TABLE "files" ADD CONSTRAINT "files_kind_check" CHECK ("kind" IN ('photo_zip', 'homework_submission', 'homework_attachment', 'notice_attachment', 'chat', 'student_photo', 'student_document', 'logo', 'gallery', 'receipt', 'report_card'));
