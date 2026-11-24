-- kind: backfill
-- Marking attendance, entering marks and setting homework are for the classes a person teaches, unless their role says every class
-- (classes.all). Roles that already run the school's people or settings keep acting on every class, as they did before.
UPDATE "roles" SET "permissions" = "permissions" || '["classes.all"]'::jsonb
WHERE NOT ("permissions" ? 'classes.all') AND ("permissions" ? 'students.write' OR "permissions" ? 'settings.manage');
