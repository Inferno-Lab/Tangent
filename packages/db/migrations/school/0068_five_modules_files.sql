-- kind: contract
-- Staff photos (ID cards), visitors' photos, photos of the people who collect a child, and diary attachments are kinds of file.
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_kind_check";
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_kind_check" CHECK ("kind" IN ('photo_zip', 'homework_submission', 'homework_attachment', 'notice_attachment', 'chat', 'student_photo', 'student_document', 'logo', 'gallery', 'receipt', 'report_card', 'staff_photo', 'visitor_photo', 'pickup_photo', 'diary_attachment'));
