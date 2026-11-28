-- kind: backfill
-- 0073 left out two permissions that a new school's starting roles count as whole-school (WHOLE_SCHOOL_PERMISSIONS):
-- adding and changing students, and changing the school's settings, are work on every class.
UPDATE "roles" SET "permissions" = "permissions" || '["classes.all"]'::jsonb
WHERE NOT ("permissions" ? 'classes.all') AND ("permissions" ?| ARRAY['students.write', 'settings.manage']);
