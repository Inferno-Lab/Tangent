/** Days as YYYY-MM-DD and the school's "today" (locale.ts: the school's own time zone). All "today" logic goes through these. */

export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 Sunday .. 6 Saturday. */
export function weekday(day: string): number {
  return parseDay(day).getUTCDay();
}

export const DEFAULT_OFF_DAYS: readonly number[] = [0];

export function isSchoolDay(day: string, offDays: readonly number[] = DEFAULT_OFF_DAYS): boolean {
  return !offDays.includes(weekday(day));
}

/** The latest school day on or before `day`. */
export function latestSchoolDay(day: string, offDays: readonly number[] = DEFAULT_OFF_DAYS): string {
  let d = day;
  for (let i = 0; i < 8 && !isSchoolDay(d, offDays); i++) d = addDays(d, -1);
  return d;
}

/** The `n` school days ending at `end` (inclusive if it is one), oldest first. */
export function schoolDaysEnding(end: string, n: number, offDays: readonly number[] = DEFAULT_OFF_DAYS): string[] {
  const out: string[] = [];
  let d = latestSchoolDay(end, offDays);
  while (out.length < n) {
    out.push(d);
    d = latestSchoolDay(addDays(d, -1), offDays);
  }
  return out.reverse();
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayName(day: string, short = false): string {
  const n = DAY_NAMES[weekday(day)]!;
  return short ? n.slice(0, 3) : n;
}

/** "14 Oct" */
export function dayMonth(day: string): string {
  const d = parseDay(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Wed 14 Oct" */
export function dayLabel(day: string): string {
  return `${dayName(day, true)} ${dayMonth(day)}`;
}

/** "Pupil" → "Pupils", "Class" → "Classes", "Batch" → "Batches", "Nursery" → "Nurseries". ponytail: regular English plurals only. */
export const plural = (word: string): string =>
  /(s|x|z|ch|sh)$/i.test(word) ? `${word}es` : /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
