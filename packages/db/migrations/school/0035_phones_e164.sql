-- kind: backfill
-- Phone numbers are kept in one international form (E.164, "+919822041200") so the same person is found however they
-- type their number (docs/one-shot-plan.md §3.3). Every school so far is in India: local numbers take +91. A number that
-- already starts with + only loses its spaces. A number that would clash with another login's is left as it was.

UPDATE "users" u SET "phone" = n.e FROM (
  SELECT id, CASE
    WHEN phone LIKE '+%' THEN '+' || regexp_replace(phone, '\D', '', 'g')
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10 THEN '+91' || regexp_replace(phone, '\D', '', 'g')
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11 AND regexp_replace(phone, '\D', '', 'g') LIKE '0%' THEN '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 12 AND regexp_replace(phone, '\D', '', 'g') LIKE '91%' THEN '+' || regexp_replace(phone, '\D', '', 'g')
  END e FROM "users" WHERE phone IS NOT NULL
) n
WHERE u.id = n.id AND n.e IS NOT NULL AND n.e <> u.phone
  AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'school.country' AND "value" = '"IN"')
  AND NOT EXISTS (SELECT 1 FROM "users" x WHERE x.phone = n.e AND x.id <> u.id);
--> statement-breakpoint
UPDATE "guardians" SET "phone" = CASE
    WHEN phone LIKE '+%' THEN '+' || regexp_replace(phone, '\D', '', 'g')
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10 THEN '+91' || regexp_replace(phone, '\D', '', 'g')
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11 AND regexp_replace(phone, '\D', '', 'g') LIKE '0%' THEN '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 12 AND regexp_replace(phone, '\D', '', 'g') LIKE '91%' THEN '+' || regexp_replace(phone, '\D', '', 'g')
    ELSE phone END
WHERE phone IS NOT NULL AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'school.country' AND "value" = '"IN"');
--> statement-breakpoint
UPDATE "enquiries" SET "phone" = CASE
    WHEN phone LIKE '+%' THEN '+' || regexp_replace(phone, '\D', '', 'g')
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10 THEN '+91' || regexp_replace(phone, '\D', '', 'g')
    ELSE phone END
WHERE phone IS NOT NULL AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'school.country' AND "value" = '"IN"');
--> statement-breakpoint
UPDATE "transport_routes" SET "attendant_phone" = '+91' || regexp_replace(attendant_phone, '\D', '', 'g')
WHERE length(regexp_replace(coalesce(attendant_phone, ''), '\D', '', 'g')) = 10 AND attendant_phone NOT LIKE '+%'
  AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'school.country' AND "value" = '"IN"');
