-- kind: backfill
-- classes.all now also says what a person sees: without it, staff see only the students, attendance, homework, marks, diary and
-- family conversations of the classes they teach. Roles whose work spans the whole school keep seeing every class, as before.
UPDATE "roles" SET "permissions" = "permissions" || '["classes.all"]'::jsonb
WHERE NOT ("permissions" ? 'classes.all') AND (
  "permissions" ?| ARRAY['fees.read', 'fees.collect', 'fees.refund', 'admissions.read', 'admissions.write', 'staff.write', 'reports.read',
    'transport.read', 'transport.write', 'library.read', 'library.write', 'visitors.read', 'visitors.manage', 'certificates.read', 'certificates.issue',
    'staffAttendance.manage', 'privacy.manage']
);
