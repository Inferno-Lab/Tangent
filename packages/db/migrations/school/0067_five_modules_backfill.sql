-- kind: backfill
-- Staff leave asked for before the staff attendance module is its own kind of request (staff_leave), counted in whole days of
-- the school's first leave type; the new permissions reach the roles made from the templates before them.
UPDATE "approvals" SET "kind" = 'staff_leave', "payload" = "payload" || jsonb_build_object(
  'type', coalesce("payload"->>'type', 'casual'),
  'days', coalesce(("payload"->>'days')::numeric, greatest(1, (("payload"->>'to')::date - ("payload"->>'from')::date) + 1)),
  'halfDay', "payload"->'halfDay')
WHERE "kind" = 'leave' AND coalesce("payload"->>'studentLeave', 'false') <> 'true' AND "payload" ? 'from' AND "payload" ? 'to';
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || (
  SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements_text('["forms.manage","staffAttendance.read","staffAttendance.manage","diary.read","diary.write","meetings.read","meetings.manage","visitors.read","visitors.manage","certificates.read","certificates.issue"]'::jsonb) p
  WHERE NOT "roles"."permissions" ? p)
WHERE "key" = 'principal';
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || (
  SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements_text('["forms.manage","staffAttendance.read","diary.read","meetings.read","meetings.manage","visitors.read","visitors.manage","certificates.read"]'::jsonb) p
  WHERE NOT "roles"."permissions" ? p)
WHERE "key" = 'office';
--> statement-breakpoint
UPDATE "roles" SET "permissions" = "permissions" || (
  SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements_text('["diary.write","meetings.read"]'::jsonb) p
  WHERE NOT "roles"."permissions" ? p)
WHERE "key" = 'teacher';
