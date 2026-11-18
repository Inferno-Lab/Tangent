-- kind: backfill
-- Every school so far is in India: its country, time zone, locale and currency are written down as its own settings, so
-- the international defaults (docs/one-shot-plan.md §3.3) change nothing for it. Only schools that already exist (their
-- database was set up before this ran): a new school gets the values chosen in the onboarding wizard instead.

INSERT INTO "settings" ("key", "value", "updated_by")
SELECT v.k, v.val::jsonb, 'Tangent' FROM (VALUES
  ('school.country', '"IN"'), ('school.timezone', '"Asia/Kolkata"'), ('school.locale', '"en-IN"'), ('school.currency', '"INR"')
) AS v(k, val)
WHERE EXISTS (SELECT 1 FROM "meta" WHERE "key" = 'seeded.mode')
ON CONFLICT ("key") DO NOTHING;
