-- kind: backfill
-- Receipt and admission numbers follow the school's own series (packages/db numbers.ts). Schools that existed before keep
-- the numbering they had: receipts RCPT-<year>- from 9001, admission numbers <year>/ from 0501.

INSERT INTO "settings" ("key", "value", "updated_by")
SELECT v.k, v.val::jsonb, 'Tangent' FROM (VALUES
  ('fees.receiptPrefix', '"RCPT-{yyyy}-{seq:5}"'), ('fees.receiptStart', '9001'),
  ('people.admissionNumber', '"{yyyy}/{seq:4}"'), ('people.admissionStart', '501')
) AS v(k, val)
WHERE EXISTS (SELECT 1 FROM "meta" WHERE "key" = 'seeded.mode')
ON CONFLICT ("key") DO NOTHING;
