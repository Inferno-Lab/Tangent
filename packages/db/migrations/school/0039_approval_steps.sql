-- kind: expand
-- Steps and approvals (docs/one-shot-plan.md §3.6.1): where a request is in the school's steps, since when, and who took the
-- steps before; `escalated` lets anyone allowed to decide the kind take a step that waited past its days.
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "step" integer NOT NULL DEFAULT 0;
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "step_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "steps_done" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "approvals" ADD COLUMN IF NOT EXISTS "escalated" boolean NOT NULL DEFAULT false;
