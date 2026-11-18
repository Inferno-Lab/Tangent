-- kind: expand
-- Small copies of photos (one-shot plan 5.2.2), made where the photo is chosen and kept beside it: lists and the gallery load
-- these, the full photo only when it is opened.
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "thumb_id" text;
