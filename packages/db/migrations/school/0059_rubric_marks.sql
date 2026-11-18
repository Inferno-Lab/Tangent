-- kind: expand
-- Rubric marks (one-shot plan 3.6.6): a subject graded on criteria (IB MYP A to D, 0 to 8 each) keeps each criterion's
-- level; its score is their total on the paper's maximum.
ALTER TABLE "exam_marks" ADD COLUMN IF NOT EXISTS "criteria" jsonb;
