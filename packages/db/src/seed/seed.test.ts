import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDatabase, startDevPostgres, type DevPostgres } from '../dev.js';
import { migrate } from '../migrate.js';
import { seedSchool } from './school.js';

let server: DevPostgres;
const pools: pg.Pool[] = [];
const school = { name: 'Lakeside School', shortName: 'Lakeside', tagline: '', phone: '', email: '', address: '', color: '#2F5BD3', logoText: 'L', language: 'en', country: 'IN' };
const admin = { name: 'Asha Rao', email: 'Principal@Lakeside.example', phone: '98450 11111', passwordHash: 'x' };

async function fresh(name: string, data?: 'empty' | 'import'): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: await ensureDatabase(server.url, name), max: 2 });
  pools.push(pool);
  await migrate(pool, 'school');
  await seedSchool(pool, { school, admin, modules: ['people', 'attendance'], data, today: '2026-11-20' });
  return pool;
}
const n = async (pool: pg.Pool, sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);

beforeAll(async () => {
  server = await startDevPostgres({ dataDir: path.join(mkdtempSync(path.join(tmpdir(), 'tangent-seed-')), 'data'), fresh: true, throwaway: true });
}, 180_000);
afterAll(async () => { for (const p of pools) await p.end(); await server?.stop(); });

describe('a new school', () => {
  it('starts with its year, roles, principal and starter settings, and no people or history', async () => {
    const pool = await fresh('school_empty');
    expect((await pool.query('select label, starts_on::text from academic_years where current')).rows).toEqual([{ label: '2026–27', starts_on: '2026-04-01' }]);
    expect(await n(pool, 'select count(*) n from roles')).toBeGreaterThanOrEqual(4);
    const principal = (await pool.query("select u.email, u.phone from users u join user_roles r on r.user_id = u.id where r.role_id = 'role_principal'")).rows;
    expect(principal).toEqual([{ email: 'principal@lakeside.example', phone: '+919845011111' }]);
    expect(await n(pool, "select count(*) n from settings where key = 'grading.scale'")).toBe(1);
    for (const table of ['students', 'classes', 'attendance_marks', 'fee_invoices', 'homework', 'notices', 'events', 'timetable_slots']) expect(await n(pool, `select count(*) n from ${table}`)).toBe(0);
    expect(await n(pool, 'select count(*) n from users')).toBe(1);
    expect(await n(pool, 'select count(*) n from periods')).toBeGreaterThan(0);
  });

  it('started for an import brings no starter bell or subjects: the school’s files bring its own', async () => {
    const pool = await fresh('school_import', 'import');
    expect(await n(pool, 'select count(*) n from periods')).toBe(0);
    expect(await n(pool, 'select count(*) n from subjects')).toBe(0);
    expect(await n(pool, 'select count(*) n from roles')).toBeGreaterThanOrEqual(4);
  });
});
