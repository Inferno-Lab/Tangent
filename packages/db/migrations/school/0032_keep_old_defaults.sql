-- kind: backfill
-- The platform's defaults became neutral (docs/one-shot-plan.md §3.2): a new school gets its country's and curriculum's
-- starter pack instead. Schools that existed before keep exactly what they had, written down as their own settings.

INSERT INTO "settings" ("key", "value", "updated_by")
SELECT v.k, v.val::jsonb, 'Tangent' FROM (VALUES
  ('grading.scale', '[{"grade":"A1","minPct":91},{"grade":"A2","minPct":81},{"grade":"B1","minPct":71},{"grade":"B2","minPct":61},{"grade":"C1","minPct":51},{"grade":"C2","minPct":41},{"grade":"D","minPct":33},{"grade":"E","minPct":0}]'),
  ('grading.passPct', '33'),
  ('calendar.weeklyOff', '["sun"]'),
  ('leave.reasons', '["Unwell","Family function","Travel","Appointment","Other"]'),
  ('fees.gstSac', '"999293"'),
  ('fees.gstRatePct', '18'),
  ('fees.refundApprovalAbove', '5000'),
  ('fees.dailyTarget', '150000')
) AS v(k, val)
WHERE EXISTS (SELECT 1 FROM "meta" WHERE "key" = 'seeded.mode')
ON CONFLICT ("key") DO NOTHING;
