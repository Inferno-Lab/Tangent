-- kind: contract
-- "Near" is told once per stop per trip (0054), so the old one-per-day key goes.
ALTER TABLE "bus_near_sent" DROP CONSTRAINT IF EXISTS "bus_near_sent_pkey";
