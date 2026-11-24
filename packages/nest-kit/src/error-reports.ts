import { createHash } from 'node:crypto';
import { alert } from './alerts.js';

export interface ErrorEvent {
  source: 'api' | 'console-api' | 'admin' | 'console' | 'app';
  schoolSlug?: string | null;
  message: string;
  stack?: string | null;
  url?: string | null;
  release?: string | null;
}

/** Set by each API at start-up to where errors are kept. The exception filter calls it for every unexpected failure. */
export const errorSink: { report?: (e: ErrorEvent) => void } = {};

// The error log is written by browsers and phones without signing in, so its size and its alerts have ceilings of their own.
const KEEP = 5000;
const ALERTS_PER_HOUR = 20;
let alerts: number[] = [];
let pruned = 0;

/** Keeps one row per problem: the same source, message and first stack frame count up instead of piling up. A new problem alerts the team. */
export async function recordError(pool: { query: (q: string, p: unknown[]) => Promise<{ rows: { fresh: boolean }[] }> }, e: ErrorEvent): Promise<void> {
  const frame = (e.stack ?? '').split('\n').find((l) => /^\s*at\s/.test(l))?.trim() ?? '';
  const message = e.message.slice(0, 500);
  const fingerprint = createHash('sha1').update(`${e.source}|${message.replace(/\d+/g, '#')}|${frame}`).digest('hex').slice(0, 24);
  const r = await pool.query(
    `insert into error_reports (fingerprint, source, school_slug, message, stack, url, release) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (fingerprint) do update set count = error_reports.count + 1, last_at = now(), school_slug = coalesce(excluded.school_slug, error_reports.school_slug),
       stack = coalesce(excluded.stack, error_reports.stack), url = coalesce(excluded.url, error_reports.url), release = coalesce(excluded.release, error_reports.release)
     returning (xmax = 0) fresh`,
    [fingerprint, e.source, e.schoolSlug ?? null, message, e.stack?.slice(0, 4000) ?? null, e.url?.slice(0, 300) ?? null, e.release?.slice(0, 40) ?? null],
  );
  if (!r.rows[0]?.fresh) return;
  const now = Date.now();
  alerts = alerts.filter((t) => now - t < 3600_000);
  if (alerts.length < ALERTS_PER_HOUR) {
    alerts.push(now);
    alert(`New error in the ${e.source}${e.schoolSlug ? ` (${e.schoolSlug})` : ''}: ${message}${e.url ? ` at ${e.url}` : ''}${alerts.length === ALERTS_PER_HOUR ? ' (more new errors this hour are on the Health page, without an alert each)' : ''}`);
  }
  // The oldest problems give way once there are many: a flood of made-up reports cannot fill the database.
  if (now - pruned > 60_000) {
    pruned = now;
    await pool.query(`delete from error_reports where fingerprint in (select fingerprint from error_reports order by last_at desc offset ${KEEP})`, []);
  }
}
