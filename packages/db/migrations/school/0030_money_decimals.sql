-- kind: expand
-- Money in any currency (docs/one-shot-plan.md §3.4): amounts keep the school's own decimals (cents, pence, fils), up to
-- three places for the dinars that have them. Whole amounts stay exactly as they were.

ALTER TABLE "fee_invoices" ALTER COLUMN "amount" TYPE numeric(16,3), ALTER COLUMN "waived_amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount" TYPE numeric(16,3), ALTER COLUMN "refunded" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "fee_structures" ALTER COLUMN "amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "payment_orders" ALTER COLUMN "amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "reconciliation" ALTER COLUMN "provider_amount" TYPE numeric(16,3), ALTER COLUMN "receipt_amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "fee_fines" ALTER COLUMN "amount" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "library_loans" ALTER COLUMN "fine" TYPE numeric(16,3);
--> statement-breakpoint
ALTER TABLE "transport_routes" ALTER COLUMN "fee" TYPE numeric(16,3);
