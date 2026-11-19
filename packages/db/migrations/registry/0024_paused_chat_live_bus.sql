-- kind: backfill
-- The owner's review (19 November 2026): chat and live bus tracking are paused for every school. The code stays; the
-- console lifts a pause on Plans and modules (a module's features), for every school or one.
INSERT INTO "flags" ("key", "school_id", "label", "enabled", "updated_by")
VALUES ('kill.chat', '*', 'Chat paused', true, 'migration'),
       ('kill.transport.liveBus', '*', 'Live bus tracking paused', true, 'migration')
ON CONFLICT ("key", "school_id") DO NOTHING;
