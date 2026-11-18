import { pg } from '@tangent/db';
import { notFound } from '@tangent/nest-kit';
import { unseal } from '@tangent/security';
import { withSchool } from '@tangent/tenancy';
import type { Db } from './core.js';

/** Opens one school's own database for the length of `fn`, in the school's own country, zone, locale and currency. */
export async function withSchoolDb<T>(db: Db, secretsKey: string, schoolId: string, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const s = (await db.pool.query<{ db_url_sealed: string | null; timezone: string; locale: string; currency: string; country: string }>(
    'select db_url_sealed, timezone, locale, currency, country from schools where id = $1 and deleted_at is null', [schoolId])).rows[0];
  if (!s?.db_url_sealed) throw notFound('That school’s database');
  const pool = new pg.Pool({ connectionString: unseal(s.db_url_sealed, secretsKey), max: 2 });
  try { return await withSchool(s, () => fn(pool)); } finally { await pool.end(); }
}
