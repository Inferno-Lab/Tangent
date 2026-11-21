import path from 'node:path';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setLocaleSource, setZoneSource, type EntitlementDoc, setTextSource, isLanguage, wordsFor, type Catalogue, type Vocabulary } from '@tangent/contracts';
import { pg } from '@tangent/db';
import { schools } from '@tangent/db/registry';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { unseal } from '@tangent/security';

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  status: string;
  plan: string;
  cell: string;
  target: string;
  dbUrl: string;
  entitlement: EntitlementDoc;
  configVersion: number;
  apiVersion: string;
  /** Console flags that apply to this school (its own value beats the fleet-wide one). */
  flags: Record<string, boolean>;
  /** Tangent pressed Go live: the school has moved in. */
  wentLive: boolean;
  /** Where the school is (ISO 3166 country), its IANA time zone, BCP 47 locale and ISO 4217 currency. */
  country: string;
  timezone: string;
  locale: string;
  currency: string;
}

export interface RegistryOptions {
  url: string;
  /** Key that seals school connection strings at rest. */
  secret: string;
  max?: number;
}

/** How long a school's record (and so its database address) is cached by each server. */
export const TENANT_CACHE_MS = 15_000;
const POSITIVE_TTL_MS = TENANT_CACHE_MS;
const NEGATIVE_TTL_MS = 5_000;

/** Read access to the school registry for the school API. The console API uses the same database with full rights. */

export class Registry {
  readonly pool: pg.Pool;
  readonly db;
  private readonly cache = new Map<string, { at: number; value: TenantInfo | null }>();

  constructor(private readonly opts: RegistryOptions) {
    this.pool = new pg.Pool({
      connectionString: opts.url,
      max: opts.max ?? 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'tangent-registry',
    });
    this.db = drizzle(this.pool);
    // Translations kept on the console's Languages page reach every page and message within a minute.
    watchTranslations(this.pool);
  }

  async school(slug: string): Promise<TenantInfo | null> {
    const hit = this.cache.get(slug);
    const now = Date.now();
    if (hit && now - hit.at < (hit.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) return hit.value;
    const [row] = await this.db.select().from(schools).where(and(eq(schools.slug, slug), isNull(schools.deletedAt))).limit(1);
    let value: TenantInfo | null = null;
    if (row?.dbUrlSealed) {
      const fl = await this.pool.query<{ key: string; enabled: boolean }>("select key, enabled from flags where school_id in ('*', $1) order by (school_id = '*') desc", [row.id]).catch(() => ({ rows: [] as { key: string; enabled: boolean }[] }));
      value = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        shortName: row.shortName,
        status: row.status,
        plan: row.plan,
        cell: row.cell,
        target: row.target,
        dbUrl: unseal(row.dbUrlSealed, this.opts.secret),
        entitlement: { plan: row.plan, ...row.entitlement },
        configVersion: row.configVersion,
        apiVersion: row.apiVersion,
        flags: Object.fromEntries(fl.rows.map((f) => [f.key, f.enabled])),
        wentLive: !!row.wentLiveAt,
        country: row.country, timezone: row.timezone, locale: row.locale, currency: row.currency,
      };
    }
    this.cache.set(slug, { at: now, value });
    return value;
  }

  invalidate(slug?: string): void {
    if (slug) this.cache.delete(slug);
    else this.cache.clear();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface Entry {
  pool: pg.Pool;
  lastUsed: number;
  url: string;
}

/**
 * Keeps a bounded set of pools, one per school database, closing the least recently used.
 * Hundreds of schools share a few connections: each pool is small and idle pools are dropped.
 */
/**
 * 20 schools × 3 connections = 60, plus the registry pool: fits a 100-connection database. Behind a connection pooler (PgBouncer,
 * or Neon's "-pooler" address) raise TENANT_MAX_POOLS so busy schools stop closing and reopening pools. Limits are set per database (school 0007).
 */
export function poolManagerFromEnv(source: NodeJS.ProcessEnv = process.env): PoolManager {
  const maxPools = Number(source.TENANT_MAX_POOLS) || 20;
  const perPool = Number(source.TENANT_PER_POOL) || 3;
  return new PoolManager({ maxPools, perPool });
}

export class PoolManager {
  private readonly pools = new Map<string, Entry>();
  private sweeper: NodeJS.Timeout | undefined;

  constructor(private readonly opts: { maxPools?: number; perPool?: number; idleMs?: number } = {}) {
    this.sweeper = setInterval(() => void this.sweep(), 30_000);
    this.sweeper.unref();
  }

  get(slug: string, url: string): pg.Pool {
    const hit = this.pools.get(slug);
    if (hit && hit.url === url) {
      hit.lastUsed = Date.now();
      return hit.pool;
    }
    if (hit) void hit.pool.end().catch(() => undefined);
    const pool = new pg.Pool({
      connectionString: url,
      max: this.opts.perPool ?? 3,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 15_000,
      application_name: `tangent-${slug}`.slice(0, 63),
    });
    pool.on('error', () => undefined); // a dropped idle connection must not crash the process
    this.pools.set(slug, { pool, lastUsed: Date.now(), url });
    this.evictOverflow();
    return pool;
  }

  evict(slug: string): void {
    const hit = this.pools.get(slug);
    if (hit) void hit.pool.end().catch(() => undefined);
    this.pools.delete(slug);
  }

  size(): number {
    return this.pools.size;
  }

  private evictOverflow(): void {
    const max = this.opts.maxPools ?? 20;
    while (this.pools.size > max) {
      const oldest = [...this.pools.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) break;
      this.evict(oldest[0]);
    }
  }

  private async sweep(): Promise<void> {
    const idle = this.opts.idleMs ?? 5 * 60_000;
    const now = Date.now();
    for (const [slug, e] of this.pools) if (now - e.lastUsed > idle) this.evict(slug);
  }

  async closeAll(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    await Promise.all([...this.pools.values()].map((e) => e.pool.end().catch(() => undefined)));
    this.pools.clear();
  }
}

/**
 * Which school the code running now is for, so "today", amounts and dates follow its own zone, locale and currency
 * (docs/one-shot-plan.md §3.3). A request runs inside one context (the API's onRequest hook) that the tenant guard fills in;
 * a job runs inside `withSchool`. Code that serves two schools at once passes their zones explicitly.
 */
export const schoolContext = new AsyncLocalStorage<{ zone?: string; locale?: string; currency?: string; country?: string; lang?: string; vocab?: Vocabulary }>();
setZoneSource(() => schoolContext.getStore()?.zone);
setLocaleSource(() => schoolContext.getStore());
// Server text (errors, labels, PDFs) in the reader's language: the request's Accept-Language, catalogues from contracts/i18n.
// The school's own words ({@Principal} is its head teacher) come with it, in the reader's language.
setTextSource(() => {
  const store = schoolContext.getStore();
  if (!store) return undefined;
  const lang = store.lang && store.lang !== 'en' ? store.lang : 'en';
  const cat = lang === 'en' ? {} : serverCatalogue(lang);
  return { lang, cat, words: wordsFor(lang, store.vocab, cat) };
});

/**
 * Where each surface's catalogues live in the repository: `<dir>/<lang>.json`, English always there. Translations kept in the
 * registry (`translations`, edited on the console's Languages page) are laid over them, so a language or a fix needs no release.
 */
export const SURFACES = { admin: 'apps/admin/src/i18n', console: 'apps/console/src/i18n', ui: 'packages/web-ui/src/i18n', text: 'packages/contracts/i18n', app: 'assets/i18n' } as const;
export type Surface = keyof typeof SURFACES;
export const isSurface = (s: string): s is Surface => s in SURFACES;
const REPO = path.resolve(path.dirname(createRequire(import.meta.url).resolve('@tangent/contracts/package.json')), '../..');
const files = new Map<string, Catalogue>();

/** A surface's catalogue as the repository ships it (empty when the language has none yet). */
export function repoCatalogue(surface: Surface, lang: string): Catalogue {
  const k = `${surface}|${lang}`;
  let c = files.get(k);
  if (!c) {
    try { c = JSON.parse(readFileSync(path.join(REPO, SURFACES[surface], `${lang}.json`), 'utf8')) as Catalogue; } catch { c = {}; }
    files.set(k, c);
  }
  return c;
}

let stored = new Map<string, Catalogue>();
let storedVersion = 0;
/** Reads the registry's translations into memory (at start and every minute; the Languages page also calls it after a change). */
export async function refreshTranslations(pool: pg.Pool): Promise<void> {
  try {
    const rows = (await pool.query<{ lang: string; surface: string; key: string; text: string; v: string }>(
      'select lang, surface, key, text, extract(epoch from updated_at)::bigint::text v from translations')).rows;
    const next = new Map<string, Catalogue>();
    let v = 0;
    for (const r of rows) {
      const k = `${r.surface}|${r.lang}`;
      (next.get(k) ?? next.set(k, {}).get(k)!)[r.key] = r.text;
      v = Math.max(v, Number(r.v));
    }
    stored = next;
    storedVersion = v;
    merged.clear();
  } catch { /* the table arrives with registry migration 0018; until then the repository's files serve alone */ }
}
const watched = new WeakSet<pg.Pool>();
export function watchTranslations(pool: pg.Pool): void {
  if (watched.has(pool)) return;
  watched.add(pool);
  void refreshTranslations(pool);
  setInterval(() => void refreshTranslations(pool), 60_000).unref();
}

/** A surface's catalogue in a language: the repository's, with the registry's translations over it; and its version for caches. */
const merged = new Map<string, Catalogue>();
export function catalogue(surface: Surface, lang: string): { messages: Catalogue; version: number } {
  const k = `${surface}|${lang}`;
  let m = merged.get(k);
  if (!m) merged.set(k, (m = { ...repoCatalogue(surface, lang), ...stored.get(k) }));
  return { messages: m, version: storedVersion };
}

/** The languages a surface has words in: English, the repository's files and those kept on the Languages page. */
export function cataloguedLanguages(surface: Surface): string[] {
  let shipped: string[] = [];
  try { shipped = readdirSync(path.join(REPO, SURFACES[surface])).filter((f) => /^[a-z]{2,3}\.json$/.test(f)).map((f) => f.slice(0, -5)); } catch { /* none yet */ }
  const kept = [...stored.keys()].filter((k) => k.startsWith(`${surface}|`)).map((k) => k.split('|')[1]!);
  return ['en', ...[...new Set([...shipped, ...kept])].filter((l) => l !== 'en').sort()];
}

/** The shared-text catalogue of a language (errors, labels, PDFs); none yet means English. */
export function serverCatalogue(lang: string): Catalogue {
  return catalogue('text', lang).messages;
}

/** The first language of an Accept-Language header that Tangent knows ("fr-CA,fr;q=0.9" → "fr"), else English. */
export function requestLanguage(header: string | string[] | undefined): string {
  const tags = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((x) => x.split(';')[0]!.trim().toLowerCase()).filter(Boolean);
  for (const tag of tags) {
    if (isLanguage(tag)) return tag;
    const base = tag.split('-')[0]!;
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export function enterSchool(info: Pick<TenantInfo, 'timezone' | 'locale' | 'currency' | 'country'>, vocab?: Vocabulary): void {
  const store = schoolContext.getStore();
  if (store) Object.assign(store, { zone: info.timezone, locale: info.locale, currency: info.currency, country: info.country, vocab });
}

export function withSchool<T>(info: Pick<TenantInfo, 'timezone' | 'locale' | 'currency' | 'country'> | null | undefined, fn: () => T): T {
  return schoolContext.run(info ? { zone: info.timezone, locale: info.locale, currency: info.currency, country: info.country } : {}, fn);
}
