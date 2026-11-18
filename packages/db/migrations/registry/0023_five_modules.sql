-- kind: backfill
-- The five modules built in the one shot (staff attendance and leave, the class diary, parent-teacher meetings, visitors and
-- certificates) join the Premium plan, and the demo schools get them, so the demo shows them.
UPDATE "plans" SET "modules" = "modules" || (
  SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM jsonb_array_elements_text('["staffAttendance","diary","ptm","visitors","certificates"]'::jsonb) m WHERE NOT "plans"."modules" ? m)
WHERE "key" = 'premium';
--> statement-breakpoint
UPDATE "schools" SET "entitlement" = jsonb_set(jsonb_set("entitlement", '{modules}', ("entitlement"->'modules') || (
  SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM jsonb_array_elements_text('["staffAttendance","diary","ptm","visitors","certificates"]'::jsonb) m WHERE NOT ("schools"."entitlement"->'modules') ? m)),
  '{version}', to_jsonb(coalesce(("entitlement"->>'version')::int, 0) + 1))
WHERE "demo" = true AND "deleted_at" IS NULL;
