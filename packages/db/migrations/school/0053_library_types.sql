-- kind: expand
-- Library item types (one-shot plan 4.12): a title is a book, a laptop, a camera or a kit, with that type's own loan rules;
-- and the barcode on its label, beside the ISBN, so a scanner finds it.
ALTER TABLE "library_books" ADD COLUMN IF NOT EXISTS "item_type" text NOT NULL DEFAULT 'book';
ALTER TABLE "library_books" ADD COLUMN IF NOT EXISTS "barcode" text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "library_books_barcode" ON "library_books" ("barcode") WHERE "barcode" <> '';
