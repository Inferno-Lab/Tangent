-- kind: expand
-- The feature "GST receipts" is "Tax receipts" for every country (docs/one-shot-plan.md §3.4.2): plans and schools keep
-- whether they had it.
UPDATE plans SET features = (features - 'fees.gstReceipts') || jsonb_build_object('fees.taxReceipts', features -> 'fees.gstReceipts')
  WHERE features ? 'fees.gstReceipts';
UPDATE schools SET entitlement = jsonb_set(entitlement, '{features}', ((entitlement -> 'features') - 'fees.gstReceipts') || jsonb_build_object('fees.taxReceipts', entitlement -> 'features' -> 'fees.gstReceipts'))
  WHERE entitlement -> 'features' ? 'fees.gstReceipts';
