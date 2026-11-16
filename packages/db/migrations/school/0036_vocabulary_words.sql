-- kind: backfill
-- The school's words become one setting per language (docs/one-shot-plan.md §3.6.7): the four old keys move into
-- vocab.words under the school's default language, then go. Schools that existed before keep the app languages they had
-- by default (English, Hindi, Marathi); a new school's come from its country pack.

INSERT INTO "settings" ("key", "value", "updated_by", "updated_at")
SELECT 'vocab.words', jsonb_build_object(coalesce((SELECT "value" #>> '{}' FROM "settings" WHERE "key" = 'school.language'), 'en'), w.words), 'system', now()
FROM (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'student', CASE WHEN coalesce(s.v #>> '{}', '') NOT IN ('', 'Student') THEN jsonb_strip_nulls(jsonb_build_object('one', s.v #>> '{}', 'many', nullif(sp.v #>> '{}', ''))) END,
    'class', CASE WHEN coalesce(c.v #>> '{}', '') NOT IN ('', 'Class') THEN jsonb_strip_nulls(jsonb_build_object('one', c.v #>> '{}', 'many', nullif(cp.v #>> '{}', ''))) END
  )) words
  FROM (SELECT 1) one
  LEFT JOIN (SELECT "value" v FROM "settings" WHERE "key" = 'vocab.student') s ON true
  LEFT JOIN (SELECT "value" v FROM "settings" WHERE "key" = 'vocab.students') sp ON true
  LEFT JOIN (SELECT "value" v FROM "settings" WHERE "key" = 'vocab.class') c ON true
  LEFT JOIN (SELECT "value" v FROM "settings" WHERE "key" = 'vocab.classes') cp ON true
) w
WHERE w.words <> '{}'::jsonb
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
DELETE FROM "settings" WHERE "key" IN ('vocab.student', 'vocab.students', 'vocab.class', 'vocab.classes');
--> statement-breakpoint
INSERT INTO "settings" ("key", "value", "updated_by", "updated_at")
SELECT 'app.languages', '["en","hi","mr"]', 'system', now()
WHERE EXISTS (SELECT 1 FROM "meta" WHERE "key" = 'seeded.mode')
ON CONFLICT ("key") DO NOTHING;
