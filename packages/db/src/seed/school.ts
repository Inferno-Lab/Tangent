import { toE164, packSettings, PERMISSIONS, ROLE_TEMPLATES, type RoleTemplate, schoolToday } from '@tangent/contracts';
import type { Pool, PoolClient } from 'pg';
import { newId } from '../ids.js';
import { bulkInsert } from './bulk.js';

/**
 * What a new school starts with, and nothing more: its year, the roles from the console's starting roles, its first admin
 * (the principal), its details and its country's and curriculum's starter pack of settings. A school started `empty` also
 * gets a starter bell and subjects; one started for an `import` brings its own in its files. Its people and its history
 * come in through the import engine (Moving in), never from here.
 */
export interface SeedInput {
  school: {
    name: string;
    shortName: string;
    tagline: string;
    place?: string;
    phone: string;
    email: string;
    address: string;
    color: string;
    logoText: string;
    language: string;
    /** Where the school is (ISO country, IANA zone, BCP 47 locale, ISO currency); India when not given. */
    country?: string;
    timezone?: string;
    locale?: string;
    currency?: string;
  };
  admin: { name: string; email: string; phone: string; passwordHash: string };
  modules: string[];
  /** `empty`: a starter bell and subjects to begin with. `import`: none, since the school's files bring its own. */
  data?: 'empty' | 'import';
  /** The curriculum the school starts from (packs.ts); its country comes from `school.country`. India and CBSE when not given. */
  curriculum?: string;
  /** The starting roles the console keeps (Blueprints → Starting roles); the built-in ones when not given. */
  roleTemplates?: RoleTemplate[];
  today?: string;
}

export interface SeedReport {
  staff: number;
  ms: number;
}

/** A starter bell: eight lessons with a break and lunch. */
const PERIOD_ROWS: [number, string, string, string, 'period' | 'break' | 'lunch'][] = [
  [0, 'P1', '08:10', '08:50', 'period'], [1, 'P2', '08:50', '09:30', 'period'], [2, 'P3', '09:30', '10:10', 'period'], [3, 'P4', '10:30', '11:10', 'period'],
  [4, 'P5', '11:10', '11:50', 'period'], [5, 'P6', '12:30', '13:10', 'period'], [6, 'P7', '13:10', '13:50', 'period'], [7, 'P8', '13:50', '14:30', 'period'],
  [12, 'Break', '10:10', '10:30', 'break'], [14, 'Lunch', '11:50', '12:30', 'lunch'],
];

/** Starter subjects, with their colours and periods a week. */
const SUBJECTS: { id: string; name: string; color: string; perWeek: number }[] = [
  { id: 'sub_maths', name: 'Maths', color: 'v', perWeek: 7 }, { id: 'sub_english', name: 'English', color: 'c', perWeek: 7 }, { id: 'sub_science', name: 'Science', color: 'g', perWeek: 6 },
  { id: 'sub_hindi', name: 'Hindi', color: 'a', perWeek: 5 }, { id: 'sub_social', name: 'Social', color: 'b', perWeek: 5 }, { id: 'sub_computer', name: 'Computer', color: 'n', perWeek: 5 },
  { id: 'sub_pe', name: 'PE', color: 'n', perWeek: 5 },
];

export async function seedSchool(pool: Pool, input: SeedInput): Promise<SeedReport> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await run(client, input);
    // Phones in international form, as the school keeps them (a local number takes the school's country).
    const country = input.school.country ?? 'IN';
    const rows = (await client.query<{ id: string; v: string }>("select id, phone v from users where phone is not null and phone <> ''")).rows;
    for (const r of rows) {
      const e = toE164(r.v, country);
      if (e && e !== r.v) await client.query('update users set phone = $2 where id = $1', [r.id, e]);
    }
    await client.query('commit');
    return { staff: 1, ms: Date.now() - started };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function run(db: PoolClient, input: SeedInput): Promise<void> {
  // Today on the school's own clock: the school year it is in begins in April in a school year that runs April to March.
  // ponytail: the year starts in April (India's and the starter packs' default); a country pack with another start would set it.
  const today = input.today ?? schoolToday(new Date(), input.school.timezone ?? 'Asia/Kolkata');
  const year = Number(today.slice(0, 4));
  const startY = today >= `${year}-04-01` ? year : year - 1;
  await db.query('insert into academic_years (id,label,starts_on,ends_on,current) values ($1,$2,$3,$4,true)', [
    'yr_current', `${startY}–${String(startY + 1).slice(2)}`, `${startY}-04-01`, `${startY + 1}-03-31`,
  ]);
  await bulkInsert(db, 'roles', ['id', 'key', 'name', 'description', 'permissions', 'locked'],
    (input.roleTemplates?.length ? input.roleTemplates : ROLE_TEMPLATES).map((t) => [`role_${t.key}`, t.key, t.name, t.description, JSON.stringify(t.key === 'principal' ? [...PERMISSIONS] : t.permissions), t.key === 'principal']));
  if (input.data !== 'import') {
    await bulkInsert(db, 'periods', ['idx', 'label', 'starts_at', 'ends_at', 'kind'], PERIOD_ROWS);
    await bulkInsert(db, 'subjects', ['id', 'name', 'color', 'per_week'], SUBJECTS.map((s) => [s.id, s.name, s.color, s.perWeek]));
  }
  const adminId = newId('usr');
  await bulkInsert(db, 'users', ['id', 'kind', 'name', 'email', 'phone', 'password_hash'], [
    [adminId, 'staff', input.admin.name, input.admin.email.toLowerCase(), input.admin.phone, input.admin.passwordHash],
  ]);
  await db.query("insert into staff (user_id, designation, department, joined_on) values ($1,'Principal','Administration',$2)", [adminId, today]);
  await db.query('insert into user_roles (user_id, role_id) values ($1,$2)', [adminId, 'role_principal']);
  const s = input.school;
  const settings: [string, unknown][] = [
    ['school.name', s.name], ['school.shortName', s.shortName], ['school.tagline', s.tagline], ['school.place', s.place ?? ''], ['school.phone', s.phone],
    ['school.email', s.email], ['school.address', s.address], ['school.language', s.language], ['brand.color', s.color], ['brand.logoText', s.logoText],
    ['school.country', s.country ?? 'IN'], ['school.timezone', s.timezone ?? 'Asia/Kolkata'], ['school.locale', s.locale ?? 'en-IN'], ['school.currency', s.currency ?? 'INR'],
    ['approvals.notice', 'required'], ['attendance.notifyParents', true], ['attendance.lockAfterDays', 2], ['fees.lateFeePct', 0], ['fees.remindDaysBefore', 3],
    ['attendance.goalPct', 95], ['homework.goalPct', 85], ['security.twoFactor', true],
  ];
  // Its country's and curriculum's starter pack, so a new school has nothing to set up (docs/one-shot-plan.md §3.2).
  const seen = new Set(settings.map(([k]) => k));
  for (const [k, v] of Object.entries(packSettings(s.country ?? 'IN', input.curriculum ?? 'CBSE'))) if (!seen.has(k)) settings.push([k, v]);
  await bulkInsert(db, 'settings', ['key', 'value', 'updated_by'], settings.map(([k, v]) => [k, JSON.stringify(v), 'system']));
  await bulkInsert(db, 'meta', ['key', 'value'], [
    ['settings.version', JSON.stringify(1)], ['timetable.version', JSON.stringify(1)], ['timetable.publishedAt', JSON.stringify(new Date().toISOString())],
    ['seeded.mode', JSON.stringify(input.data ?? 'empty')],
  ]);
  await db.query("insert into audit_log (id, actor_id, actor_name, action, entity, detail) values ($1,$2,$3,'school.created','school',$4)", [
    newId('aud'), adminId, 'System', JSON.stringify({ name: s.name }),
  ]);
}
