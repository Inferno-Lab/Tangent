-- kind: expand
-- Homework can be handed in as photos of the work, as an answer written in the app, or both (homework.handInWith).
ALTER TABLE "homework_submissions" ADD COLUMN IF NOT EXISTS "answer" text NOT NULL DEFAULT '';
