-- kind: backfill
-- Payment methods became the school's own list (name and kind); new schools start with cash, card, bank transfer and
-- cheque. Schools that existed before keep the Indian set they have always offered, written down as their own.

INSERT INTO "settings" ("key", "value", "updated_by")
SELECT 'fees.paymentMethods', '[{"key":"cash","name":"Cash","kind":"cash"},{"key":"upi","name":"UPI","kind":"wallet"},{"key":"card","name":"Card","kind":"card"},{"key":"netbanking","name":"Net banking","kind":"bank"},{"key":"cheque","name":"Cheque","kind":"cheque"}]'::jsonb, 'Tangent'
WHERE EXISTS (SELECT 1 FROM "meta" WHERE "key" = 'seeded.mode')
ON CONFLICT ("key") DO NOTHING;
