import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inject } from 'vitest';
import { DEFAULT_PLANS } from '@tangent/config-engine';
import { addDays, schoolToday } from '@tangent/contracts';
import { migrate, newId, pg } from '@tangent/db';
import { cloneDatabase, dropDatabase, ensureDatabase, ensureTemplate, type DevPostgres } from '@tangent/db/dev';
import { seedSchool } from '@tangent/db/seed';
import { hashPassword, seal } from '@tangent/security';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { REGISTRY } from '../src/tenancy/tenant.js';
import { SettingsService } from '../src/school/support.js';

export const SECRET = 'test-secret-key-for-sealing-0123456789';
/** The password every staff member of the test school has (tools/dataset/load.mjs gives the same one on a dev server). */
export const STAFF_PASSWORD = 'sunrise-valley-26';

/** Someone of the test school a test signs in as (the dataset's manifest, tools/dataset/school.mjs). */
export interface Person { name: string; email: string; phone?: string; class?: string; classes?: string[]; route?: string; admissionNo?: string; children?: { name: string; admissionNo: string; class: string }[] }
export type People = Record<'principal' | 'vicePrincipal' | 'office' | 'accountant' | 'classTeacher' | 'mathsTeacher' | 'driver' | 'parentOfTwo' | 'parentOfOne' | 'student', Person>;

export interface Harness {
  app: NestFastifyApplication;
  server: DevPostgres;
  registry: pg.Pool;
  slug: string;
  /** The test school's people, files and totals: Sunrise Valley School, mid-year, moved in from its old systems' exports. */
  people: People;
  manifest: { expect: Record<string, any>; school: Record<string, string>; files: { name: string; kind: string | null }[] };
  call: (method: string, url: string, opts?: { token?: string; body?: unknown; school?: string; headers?: Record<string, string>; cookies?: Record<string, string> }) => Promise<{ status: number; json: any; text: string; raw: Buffer; cookies: Record<string, string>; headers: Record<string, string | string[] | undefined> }>;
  /** Signs someone in and returns the access token: staff with their password, families with a code; codes come from the Test inbox. */
  login: (identifier?: string, password?: string) => Promise<string>;
  /** The newest Test inbox message to an address (the code a person was just sent). */
  lastMessage: (to: string, slug?: string) => Promise<{ body: string; subject: string | null; channel: string } | undefined>;
  /** The six-digit code in the newest Test inbox message to an address. */
  codeSentTo: (to: string, slug?: string) => Promise<string>;
  /** A class's id by its name, like "8 A". */
  classId: (name: string, slug?: string) => Promise<string>;
  /** A person's user id by their email or phone. */
  userId: (emailOrPhone: string, slug?: string) => Promise<string>;
  /** The day `days` from today, moved on (or back, for a past day) past the school's holidays (its own calendar, brought in). */
  openDay: (days: number, slug?: string) => Promise<string>;
  close: () => Promise<void>;
  /** Writes a school's settings straight into its database, as the console does (schools cannot). */
  setSettings: (changes: Record<string, unknown>, slug?: string) => Promise<void>;
  /** Another school in the registry: `dataset` is a copy of the test school, `empty` a school that has just been created. */
  addSchool: (slug: string, o: { plan: string; data: 'dataset' | 'empty'; status?: string }) => Promise<void>;
  /** Changes a school's entitlement in the registry as the console does (fields given replace the stored ones) and drops the API's cached copy. */
  entitle: (patch: Record<string, unknown>, slug?: string) => Promise<void>;
  /** The connection string of a school's own database (each test file has its own copy). */
  schoolUrl: (slug?: string) => Promise<string>;
  /** Runs one query in a school's own database (for state no route sets, like a family's saved language). */
  schoolSql: <T = any>(sql: string, params?: unknown[], slug?: string) => Promise<T[]>;
}

export async function startHarness(): Promise<Harness> {
  // The run's one PostgreSQL (global-setup.ts); this file works in its own copies of ready-made databases, so test files
  // run side by side and none migrates or seeds a school from nothing.
  const admin = inject('pgUrl');
  const id = `h${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const made: string[] = [];
  await ensureTemplate(admin, 'tpl_registry', async (url) => {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    await migrate(pool, 'registry');
    // The tests exercise every module, so the fleet pauses a migration ships with are lifted here.
    await pool.query("delete from flags where key like 'kill.%'");
    await pool.query("insert into cells (key, target, region, max_schools) values ('local-1','local','local',50)");
    for (const p of DEFAULT_PLANS) await pool.query('insert into plans (key, name, per_student_year, modules, limits) values ($1,$2,$3,$4,$5)', [p.key, p.name, p.perStudentYear, JSON.stringify(p.modules), JSON.stringify(p.limits)]);
    await pool.end();
  });
  const regName = `${id}_registry`;
  const regUrl = await cloneDatabase(admin, 'tpl_registry', regName);
  made.push(regName);
  const registry = new pg.Pool({ connectionString: regUrl, max: 4 });
  const server: DevPostgres = { url: admin, port: Number(new URL(admin).port), stop: async () => undefined };

  // The test school is built once a run, for today on its own clock, from the dataset's files through the import engine.
  const today = schoolToday(new Date(), 'Asia/Kolkata');
  const addSchool = async (slug: string, o: { plan: string; data: 'dataset' | 'empty'; status?: string }) => {
    const plan = DEFAULT_PLANS.find((p) => p.key === o.plan)!;
    const template = (o.data === 'dataset' ? `tpl_school_dataset_${today}` : `tpl_school_${o.plan}_empty`).replace(/-/g, '_');
    await ensureTemplate(admin, template, async (url) => {
      const pool = new pg.Pool({ connectionString: url, max: 4 });
      await migrate(pool, 'school');
      const passwordHash = await hashPassword(STAFF_PASSWORD);
      if (o.data === 'dataset') {
        // tools/ is plain JavaScript outside the package: loaded by its path, as a script would.
        const builder = fileURLToPath(new URL('../../../tools/dataset/build.mjs', import.meta.url));
        const { buildSchool } = await import(pathToFileURL(builder).href);
        const manifest = await buildSchool(pool, { today, passwordHash });
        // Every member of staff has the test password (on a dev server, load.mjs sets it through "Forgot it?").
        await pool.query("update users set password_hash = $1 where kind = 'staff'", [passwordHash]);
        await pool.query("insert into meta (key, value) values ('dataset.manifest', $1)", [JSON.stringify({ people: manifest.people, expect: manifest.expect, school: manifest.school, files: manifest.files })]);
      } else {
        await seedSchool(pool, {
          school: { name: 'Lakeside School', shortName: 'Lakeside', tagline: '', phone: '', email: '', address: '', color: '#1F6FB2', logoText: 'L', language: 'en' },
          admin: { name: 'Asha Rao', email: 'asha.rao@lakeside.example', phone: '+91 98450 99001', passwordHash },
          modules: plan.modules, data: 'empty', today,
        });
      }
      // No quiet hours unless a test sets them: messages are held in quiet hours, so results would depend on the clock. The
      // school is open every day for the same reason (AGENTS.md: any day of the week must work); a test sets its own week.
      // Two-step sign-in is off so a test signs in with one call; the sign-in tests turn it on.
      await pool.query(`insert into settings (key, value) values ('notify.quietFrom', '"00:00"'), ('notify.quietTo', '"00:00"'), ('calendar.weeklyOff', '[]'), ('security.twoFactor', 'false')
        on conflict (key) do update set value = excluded.value`);
      await pool.end();
    });
    const dbName = `${id}_${slug.replace(/-/g, '_')}`;
    const url = await cloneDatabase(admin, template, dbName);
    made.push(dbName);
    const name = o.data === 'dataset' ? ['Sunrise Valley School', 'Sunrise Valley', 'S'] : ['Lakeside School', 'Lakeside', 'L'];
    await registry.query(
      // The test school is in India: its phones, clock and money are India's.
      `insert into schools (id, slug, name, short_name, color, logo_text, status, plan, cell, target, region, db_url_sealed, db_name, entitlement, contact, country, timezone, locale, currency)
       values ($1,$2,$3,$4,'#1F6FB2',$5,$6,$7,'local-1','local','local',$8,$9,$10,$11,'IN','Asia/Kolkata','en-IN','INR')`,
      [newId('sch'), slug, ...name, o.status ?? 'live', o.plan, seal(url, SECRET), dbName,
        JSON.stringify({ modules: plan.modules, limits: plan.limits, locks: [], overrides: {}, version: 1 }), JSON.stringify({ name: 'Office', phone: '+919845004100', email: 'office@school.example' })]);
  };

  const env = loadEnv({ NODE_ENV: 'test', REGISTRY_DATABASE_URL: regUrl, SECRETS_KEY: SECRET, JWT_SECRET: 'jwt-secret-for-tests-0123456789abcd', PORT: '0' });
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const slug = 'sunrise-valley';
  await addSchool(slug, { plan: 'premium', data: 'dataset' });

  const call: Harness['call'] = async (method, url, opts = {}) => {
    const res = await app.inject({
      method: method as 'GET', url,
      headers: {
        'x-school': opts.school ?? slug,
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...opts.headers,
      },
      cookies: opts.cookies,
      payload: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let json: any = null;
    try { json = JSON.parse(res.body); } catch { /* not json */ }
    const cookies: Record<string, string> = {};
    for (const c of res.cookies ?? []) cookies[c.name] = c.value;
    const setCookie = res.headers['set-cookie'];
    for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0 && !cookies[pair.slice(0, eq)]) cookies[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
    return { status: res.statusCode, json, text: res.body, raw: res.rawPayload, cookies, headers: res.headers as Record<string, string | string[] | undefined> };
  };
  const schoolSql: Harness['schoolSql'] = async (sql, params = [], school = slug) => {
    const dbName = (await registry.query<{ db_name: string }>('select db_name from schools where slug = $1', [school])).rows[0]!.db_name;
    const pool = new pg.Pool({ connectionString: await ensureDatabase(server.url, dbName), max: 1 });
    try { return (await pool.query(sql, params)).rows; } finally { await pool.end(); }
  };
  const manifest = (await schoolSql<{ value: Harness['manifest'] & { people: People } }>("select value from meta where key = 'dataset.manifest'"))[0]!.value;
  const people = manifest.people;
  const lastMessage: Harness['lastMessage'] = async (to, school = slug) => (await registry.query(
    "select body, subject, channel from sandbox_messages where school_slug = $1 and lower(replace(to_addr, ' ', '')) = lower(replace($2, ' ', '')) order by created_at desc, id desc limit 1", [school, to])).rows[0];
  const codeSentTo: Harness['codeSentTo'] = async (to, school = slug) => {
    const m = await lastMessage(to, school);
    const code = m && /\b(\d{6})\b/.exec(m.body)?.[1];
    if (!code) throw new Error(`No code was sent to ${to}.`);
    return code;
  };
  const login = async (identifier = people.principal.email, password = STAFF_PASSWORD) => {
    const [u] = await schoolSql<{ kind: string; email: string | null; phone: string | null }>('select kind, email, phone from users where lower(email) = lower($1) or phone = $1 limit 1', [identifier]);
    if (u && u.kind !== 'staff') {
      const challenge = await call('POST', '/v1/auth/code', { body: { identifier } });
      if (challenge.status !== 200) throw new Error(`No code for ${identifier}: ${challenge.text}`);
      const sentTo = challenge.json.channel === 'email' ? u.email! : u.phone!;
      const done = await call('POST', '/v1/auth/verify', { body: { challengeId: challenge.json.challengeId, code: await codeSentTo(sentTo), client: 'mobile' } });
      return done.json.accessToken as string;
    }
    const step1 = await call('POST', '/v1/auth/login', { body: { identifier, password } });
    if (step1.status !== 200) throw new Error(`${identifier} could not sign in: ${step1.text}`);
    if (step1.json.step === 'done') return step1.json.tokens.accessToken as string;
    const sentTo = step1.json.challenge.channel === 'email' ? u?.email : u?.phone;
    const step2 = await call('POST', '/v1/auth/verify', { body: { challengeId: step1.json.challenge.challengeId, code: await codeSentTo(sentTo ?? identifier) } });
    return step2.json.accessToken as string;
  };
  const classId: Harness['classId'] = async (name, school = slug) => {
    const [c] = await schoolSql<{ id: string }>('select id from classes where name = $1', [name], school);
    if (!c) throw new Error(`No class ${name}.`);
    return c.id;
  };
  const openDay: Harness['openDay'] = async (days, school = slug) => {
    const closed = new Set((await schoolSql<{ d: string }>(`select d::date::text d from events e, generate_series((e.starts_at at time zone 'Asia/Kolkata')::date,
      (coalesce(e.ends_at, e.starts_at) at time zone 'Asia/Kolkata')::date, interval '1 day') d where e.kind = 'holiday'`, [], school)).map((r) => r.d));
    let d = addDays(today, days);
    while (closed.has(d)) d = addDays(d, days < 0 ? -1 : 1);
    return d;
  };
  const userId: Harness['userId'] = async (who, school = slug) => {
    const [u] = await schoolSql<{ id: string }>('select id from users where lower(email) = lower($1) or phone = $1', [who], school);
    if (!u) throw new Error(`No one is ${who}.`);
    return u.id;
  };
  const setSettings: Harness['setSettings'] = async (changes, school = slug) => {
    const dbName = (await registry.query<{ db_name: string }>('select db_name from schools where slug = $1', [school])).rows[0]!.db_name;
    const pool = new pg.Pool({ connectionString: await ensureDatabase(server.url, dbName), max: 1 });
    for (const [k, v] of Object.entries(changes)) {
      await pool.query('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [k, JSON.stringify(v)]);
    }
    await pool.query("update meta set value = to_jsonb((value)::int + 1) where key = 'settings.version'");
    await pool.end();
    // The API caches a school's settings for five seconds: drop its copy instead of waiting it out.
    app.get(SettingsService).forget(school);
    app.get<{ invalidate: (s?: string) => void }>(REGISTRY).invalidate(school);
  };
  const entitle: Harness['entitle'] = async (patch, school = slug) => {
    await registry.query('update schools set entitlement = entitlement || $2::jsonb where slug = $1', [school, JSON.stringify(patch)]);
    app.get<{ invalidate: (s?: string) => void }>(REGISTRY).invalidate(school);
  };
  return {
    app, server, registry, slug, people, manifest, call, login, lastMessage, codeSentTo, classId, userId, openDay, addSchool, setSettings, entitle, schoolSql,
    schoolUrl: async (school = slug) => ensureDatabase(admin, (await registry.query<{ db_name: string }>('select db_name from schools where slug = $1', [school])).rows[0]!.db_name),
    close: async () => {
      await app.close();
      await registry.end();
      for (const name of made) await dropDatabase(admin, name).catch(() => undefined);
    },
  };
}
