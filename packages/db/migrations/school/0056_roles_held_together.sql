-- kind: backfill
-- One switch for roles (one-shot plan D4): staff.schoolAssignsRoles goes. A school Tangent kept from assigning roles now has
-- its roles held by Tangent (roles.schoolEdits off), which also keeps it from assigning them.
INSERT INTO "settings" ("key", "value") SELECT 'roles.schoolEdits', 'false'::jsonb FROM "settings" WHERE "key" = 'staff.schoolAssignsRoles' AND "value" = 'false'::jsonb
  ON CONFLICT ("key") DO UPDATE SET "value" = 'false'::jsonb, "updated_at" = now();
DELETE FROM "settings" WHERE "key" = 'staff.schoolAssignsRoles';
