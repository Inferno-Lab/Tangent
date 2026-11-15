-- kind: backfill
-- The school changes its own settings from the admin now (docs/one-shot-plan.md §3.1): the principal's role, which holds
-- every permission, gets the new "settings.manage"; other roles get it when the school gives it to them.

UPDATE "roles" SET "permissions" = "permissions" || '["settings.manage"]'::jsonb
WHERE "locked" AND NOT "permissions" ? 'settings.manage';
