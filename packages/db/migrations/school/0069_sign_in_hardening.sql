-- kind: expand
-- Authenticator-app codes for staff who run the school (a second step that someone holding the phone cannot pass), and the index the
-- sign-in limits count recent codes with.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_last" text;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "method" text DEFAULT 'code' NOT NULL;
--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "pending_secret" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_challenges_created_idx" ON "otp_challenges" ("created_at");
