import type pg from 'pg';
import { newId } from './ids.js';

type Q = pg.Pool | pg.PoolClient;

/** A school's saved settings and their version, from its own database. */
export async function readSettings(q: Q): Promise<{ version: number; values: Record<string, unknown> }> {
  const [rows, meta] = await Promise.all([
    q.query<{ key: string; value: unknown }>('select key, value from settings'),
    q.query<{ value: number }>("select value from meta where key = 'settings.version'"),
  ]);
  return { version: Number(meta.rows[0]?.value ?? 1), values: Object.fromEntries(rows.rows.map((r) => [r.key, r.value])) };
}

export interface SettingsWrite {
  /** Checked values to save; a null value puts the setting back to its default. */
  changes: Record<string, unknown>;
  /** Refuse the write if someone changed the settings since this version was read. */
  expectedVersion?: number;
  note?: string;
  /** Who, as the audit log and the history show it ("Tangent · ana@…" or the school's own staff member). */
  actorId: string | null;
  actorName: string;
}

export class StaleSettings extends Error {
  constructor() {
    super('Someone else changed these settings a moment ago. Reload to see their change.');
  }
}

/**
 * The one way a school's settings change, for the console and the school alike: one transaction, a stale version refused, the
 * version moved on, the change in the school's audit log, and every signed-in app told to reload its configuration.
 */
export async function writeSettings(pool: pg.Pool, w: SettingsWrite): Promise<{ version: number; values: Record<string, unknown>; changes: { key: string; from: unknown; to: unknown }[] }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('settings'))");
    const before = await readSettings(client);
    if (w.expectedVersion !== undefined && w.expectedVersion !== before.version) throw new StaleSettings();
    const resets = Object.keys(w.changes).filter((k) => w.changes[k] === null);
    for (const [k, v] of Object.entries(w.changes)) {
      if (v === null) continue;
      await client.query(
        'insert into settings (key, value, updated_by, updated_at) values ($1,$2,$3,now()) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()',
        [k, JSON.stringify(v), w.actorName]);
    }
    if (resets.length) await client.query('delete from settings where key = any($1)', [resets]);
    const after = await readSettings(client);
    const changes = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])]
      .filter((k) => JSON.stringify(before.values[k]) !== JSON.stringify(after.values[k]))
      .map((k) => ({ key: k, from: before.values[k], to: after.values[k] }));
    if (!changes.length) {
      await client.query('rollback');
      return { ...before, changes };
    }
    await client.query("insert into meta (key, value) values ('settings.version', '2') on conflict (key) do update set value = to_jsonb((meta.value)::int + 1)");
    await client.query('insert into audit_log (id, actor_id, actor_name, action, entity, detail) values ($1,$2,$3,$4,$5,$6)',
      [newId('aud'), w.actorId, w.actorName, 'settings.changed', 'settings', JSON.stringify({ keys: changes.map((c) => c.key).join(', '), note: w.note ?? '' })]);
    // The live stream's channel (apps/api StreamService): every signed-in app reloads its configuration.
    await client.query('select pg_notify($1, $2)', ['tangent_live', JSON.stringify({ users: [], type: 'config', data: {} })]);
    await client.query('commit');
    return { version: before.version + 1, values: after.values, changes };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Keeps the registry in step with a change to a school's settings (from the console or from the school): a version in the
 * history the console shows and can roll back, and the copy of who the school is that the fleet and sign-in pages read.
 */
export async function recordSettingsVersion(registry: pg.Pool, schoolId: string, after: { version: number; values: Record<string, unknown>; changes: { key: string }[] }, note: string, by: string): Promise<void> {
  if (!after.changes.length) return;
  await registry.query('insert into config_versions (id, school_id, version, values, changes, note, by) values ($1,$2,$3,$4,$5,$6,$7)',
    [newId('cfv'), schoolId, after.version, JSON.stringify(after.values), JSON.stringify(after.changes), note, by]);
  const v = after.values;
  const id = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  await registry.query(
    `update schools set config_version = config_version + 1, name = coalesce($2, name), short_name = coalesce($3, short_name), color = coalesce($4, color), logo_text = coalesce($5, logo_text),
       country = coalesce($6, country), timezone = coalesce($7, timezone), locale = coalesce($8, locale), currency = coalesce($9, currency) where id = $1`,
    [schoolId, id('school.name'), id('school.shortName'), id('brand.color'), id('brand.logoText'), id('school.country'), id('school.timezone'), id('school.locale'), id('school.currency')]);
}
