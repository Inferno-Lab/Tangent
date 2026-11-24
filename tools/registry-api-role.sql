-- A registry login for the school API alone, which cannot read or change the console's own tables (console accounts, their
-- sessions and codes, the console's audit, backups, billing, compliance, releases, provisioning). Run it as the registry's owner:
--   psql "$REGISTRY_DATABASE_URL" -v password="'<a long random password>'" -f tools/registry-api-role.sql
-- then give the school API that login as API_REGISTRY_DATABASE_URL (in a split install, as its REGISTRY_DATABASE_URL).
-- Safe to run again: after a migration adds a table, run it once more.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tangent_api') THEN CREATE ROLE tangent_api LOGIN; END IF;
END $$;
ALTER ROLE tangent_api PASSWORD :password;
GRANT USAGE ON SCHEMA public TO tangent_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tangent_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tangent_api;
-- Tables a migration adds later are the API's too (the API breaks on a table it cannot reach), until this is run again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tangent_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tangent_api;
-- The console's own: nothing the school API ever reads or writes.
REVOKE ALL ON console_users, console_sessions, console_otp, console_audit, school_backups, restore_drills, compliance_items, invoices,
  config_templates, wizard_drafts, provision_runs, releases, migration_runs, import_runs, incidents, blueprints, cells, plans FROM tangent_api;
-- What it reads but never changes.
REVOKE INSERT, UPDATE, DELETE ON flags, translations, support_sessions, console_settings FROM tangent_api;
