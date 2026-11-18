-- kind: expand
-- Changing one's phone or email (one-shot plan 5.1.3): the code goes to the new address, kept with the challenge.
ALTER TABLE "otp_challenges" ADD COLUMN IF NOT EXISTS "target" text;
