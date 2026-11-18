-- kind: expand
-- Value mapping on import (one-shot plan 3.6.8): "M" is Male, "VIII" is 8, remembered with the column matching so next
-- term's file from the same system imports in one step.
ALTER TABLE "import_mappings" ADD COLUMN IF NOT EXISTS "value_map" jsonb NOT NULL DEFAULT '{}'::jsonb;
