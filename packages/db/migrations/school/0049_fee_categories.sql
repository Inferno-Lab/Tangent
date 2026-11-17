-- kind: expand
-- Fees to the standard (one-shot plan 4.7): a student's fee category (the school's list: staff child, scholarship, boarder…)
-- and fee structures for one category, which take the place of the everyone version of that fee head for those students.
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "fee_category" text;
ALTER TABLE "fee_structures" ADD COLUMN IF NOT EXISTS "category" text;
CREATE UNIQUE INDEX IF NOT EXISTS "fee_structures_grade_cat_title_uq" ON "fee_structures" (coalesce("grade", 0), coalesce("category", ''), lower("title"));
-- A late fee is kept once per invoice per period: a month, a week (its Monday), "once", as `month` has always held.
