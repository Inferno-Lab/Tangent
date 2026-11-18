import { z } from 'zod';
import { IsoDate } from './common.js';

/**
 * How the timetable repeats (one-shot plan 4.4): every week, in two alternating weeks (A and B), or as a cycle of N school days
 * ("Day 1" to "Day 6") that moves on only on days the school is open. A lesson is kept against its timetable day: the ISO
 * weekday (1–7) for a week, the weekday plus 7 in week B (8–14), or the day of the cycle (1–N).
 */
export const TimetableCycle = z.object({
  kind: z.enum(['week', 'ab', 'days']).default('week'),
  /** Days in a cycle of school days. */
  length: z.number().int().min(2).max(10).default(6),
  /** The first day of week A, or Day 1 (any date in that week for A/B). */
  startsOn: IsoDate.optional(),
}).refine((c) => c.kind === 'week' || !!c.startsOn, { message: 'Choose the day the cycle starts', path: ['startsOn'] });
export type TimetableCycle = z.infer<typeof TimetableCycle>;

const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const isoDow = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
const dayNum = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const fromNum = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * The timetable day a date uses, or null on a day the school is closed. `closed` says whether a date is a weekly off day or
 * a holiday (a cycle of school days does not move on those).
 */
export function slotDayOf(cycle: TimetableCycle, date: string, closed: (date: string) => boolean): number | null {
  if (closed(date)) return null;
  const dow = isoDow(date);
  if (cycle.kind === 'week' || !cycle.startsOn) return dow;
  if (cycle.kind === 'ab') {
    // Weeks counted from the Monday of the start's week; an odd number of weeks later is week B.
    const monday = dayNum(cycle.startsOn) - (isoDow(cycle.startsOn) - 1);
    const weeks = Math.floor((dayNum(date) - monday) / 7);
    return dow + (((weeks % 2) + 2) % 2) * 7;
  }
  // A cycle of school days: count the open days from the start (backwards for a date before it).
  const start = dayNum(cycle.startsOn), at = dayNum(date);
  let open = 0;
  if (at >= start) { for (let d = start; d < at; d++) if (!closed(fromNum(d))) open++; } else { for (let d = at; d < start; d++) if (!closed(fromNum(d))) open--; }
  return ((open % cycle.length) + cycle.length) % cycle.length + 1;
}

/** The timetable days a school uses, in order, each with a key (mon, mon-b, d3) the apps keep lessons under. */
export function slotDays(cycle: TimetableCycle, offIsoDays: number[]): { day: number; key: string; week?: 'a' | 'b'; n?: number }[] {
  const open = [1, 2, 3, 4, 5, 6, 7].filter((d) => !offIsoDays.includes(d));
  if (cycle.kind === 'days') return Array.from({ length: cycle.length }, (_, i) => ({ day: i + 1, key: `d${i + 1}`, n: i + 1 }));
  if (cycle.kind === 'ab') return [...open.map((d) => ({ day: d, key: `${WEEK_KEYS[d - 1]}-a`, week: 'a' as const })), ...open.map((d) => ({ day: d + 7, key: `${WEEK_KEYS[d - 1]}-b`, week: 'b' as const }))];
  return open.map((d) => ({ day: d, key: WEEK_KEYS[d - 1]! }));
}

/** The key the apps keep a timetable day under. */
export function slotKey(cycle: TimetableCycle, day: number): string {
  if (cycle.kind === 'days') return `d${day}`;
  if (cycle.kind === 'ab') return `${WEEK_KEYS[(day - 1) % 7]}-${day > 7 ? 'b' : 'a'}`;
  return WEEK_KEYS[day - 1] ?? 'mon';
}

/** The ISO weekday a weekly or A/B timetable day falls on (null for a cycle of days, which has no weekday). */
export const slotWeekday = (cycle: TimetableCycle, day: number): number | null => (cycle.kind === 'days' ? null : ((day - 1) % 7) + 1);
