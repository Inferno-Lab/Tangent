-- kind: expand
-- Tax on fees for any country (docs/one-shot-plan.md §3.4.2): the GST settings become the tax model. A school that had a
-- GSTIN keeps it, with GST's names and its two halves; its rate, service code and taxed heads carry over.
INSERT INTO settings (key, value) SELECT 'tax.number', value FROM settings WHERE key = 'fees.gstin' AND value <> '""'::jsonb ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) SELECT 'tax.code', value FROM settings WHERE key = 'fees.gstSac' ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) SELECT 'tax.ratePct', value FROM settings WHERE key = 'fees.gstRatePct' ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) SELECT 'tax.heads', value FROM settings WHERE key = 'fees.gstHeads' ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value)
  SELECT k, v FROM (VALUES ('tax.name', '"GST"'::jsonb), ('tax.numberLabel', '"GSTIN"'::jsonb), ('tax.codeLabel', '"SAC"'::jsonb),
    ('tax.split', '[{"name":"CGST","sharePct":50},{"name":"SGST","sharePct":50}]'::jsonb)) x(k, v)
  WHERE EXISTS (SELECT 1 FROM settings WHERE key IN ('fees.gstin', 'fees.gstSac', 'fees.gstRatePct'))
ON CONFLICT (key) DO NOTHING;
DELETE FROM settings WHERE key IN ('fees.gstin', 'fees.gstSac', 'fees.gstRatePct', 'fees.gstHeads');
