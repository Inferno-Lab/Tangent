-- kind: expand
-- Trips per session (one-shot plan 4.13): a route runs some of the school's trips (none listed: all of them); a bus
-- attendant (a member of staff) runs the trip from the app like the driver; "the bus is near" is told once per stop per trip.
ALTER TABLE "transport_routes" ADD COLUMN IF NOT EXISTS "sessions" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "transport_routes" ADD COLUMN IF NOT EXISTS "attendant_user_id" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "bus_near_sent" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'morning';
CREATE UNIQUE INDEX IF NOT EXISTS "bus_near_sent_trip" ON "bus_near_sent" ("stop_id", "day", "kind");
