import type pg from 'pg';

export { seriesProblem } from '@tangent/contracts';

type Q = pg.Pool | pg.PoolClient;

/**
 * A school's own numbering (docs/one-shot-plan.md §3.6.4): a pattern such as `RCPT-{yyyy}-{seq:5}`, `{yyyy}/{seq:3}` or
 * `ADM/{ay}/{seq}`. Tokens: {yyyy} the year, {yy} its last two digits, {mm} the month, {ay} the academic year's label
 * ("2026-27"), {seq} the running number ({seq:5} pads it to five digits). A series starts again whenever the text around
 * {seq} changes (a new year in the pattern), and otherwise follows the highest number already used, so numbers brought in
 * from the old system carry on. A pattern without {seq} gets one at the end (`RCPT-{year}-` is read as it always was).
 */
export interface SeriesInput {
  pattern: string;
  /** The first number of a series (a school arriving from another system keeps its numbering). */
  start: number;
  /** The day the number is for, YYYY-MM-DD (the school's today). */
  day: string;
  /** The current academic year's label, for {ay}. */
  ay?: string;
  /** Where the numbers already used live. */
  table: string;
  column: string;
}

export function renderSeries(pattern: string, day: string, ay = ''): { before: string; width: number; after: string } {
  const p = /\{seq(?::(\d+))?\}/.test(pattern) ? pattern : `${pattern}{seq:5}`;
  const fill = (s: string) => s.replace(/\{year\}|\{yyyy\}/g, day.slice(0, 4)).replace(/\{yy\}/g, day.slice(2, 4)).replace(/\{mm\}/g, day.slice(5, 7)).replace(/\{ay\}/g, ay);
  const m = /\{seq(?::(\d+))?\}/.exec(p)!;
  return { before: fill(p.slice(0, m.index)), width: Math.min(12, Number(m[1] ?? 0)), after: fill(p.slice(m.index + m[0].length)) };
}

/** The next number in a series, inside the caller's transaction (it takes a lock so two never share a number). */
export async function nextNumber(q: Q, s: SeriesInput): Promise<string> {
  const { before, width, after } = renderSeries(s.pattern, s.day, s.ay);
  await q.query('select pg_advisory_xact_lock(hashtext($1))', [`series:${s.table}.${s.column}`]);
  const last = (await q.query<{ n: string | null }>(
    `select max(substring(${s.column} from char_length($1) + 1 for char_length(${s.column}) - char_length($1) - char_length($2))::bigint) n
     from ${s.table} where starts_with(${s.column}, $1) and right(${s.column}, char_length($2)) = $2
       and substring(${s.column} from char_length($1) + 1 for char_length(${s.column}) - char_length($1) - char_length($2)) ~ '^[0-9]{1,15}$'`,
    [before, after])).rows[0]!.n;
  const n = Math.max(s.start, last === null ? s.start : Number(last) + 1);
  return `${before}${String(n).padStart(width, '0')}${after}`;
}
