import { describe, expect, it } from 'vitest';
import { slotDayOf, slotDays, slotKey } from './cycles.js';

const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

describe('how a timetable repeats', () => {
  it('uses the weekday for a week, and the weekday of week B after an odd number of weeks', () => {
    expect(slotDayOf({ kind: 'week', length: 6 }, '2026-11-18', weekend)).toBe(3);
    const ab = { kind: 'ab' as const, length: 6, startsOn: '2026-11-04' };
    expect(slotDayOf(ab, '2026-11-02', weekend)).toBe(1); // the Monday of the start's week is A
    expect(slotDayOf(ab, '2026-11-10', weekend)).toBe(9); // a week later: Tuesday of B
    expect(slotDayOf(ab, '2026-11-17', weekend)).toBe(2);
    expect(slotDayOf(ab, '2026-10-27', weekend)).toBe(9); // the week before the start is B too
    expect(slotDayOf(ab, '2026-11-15', weekend)).toBeNull();
  });

  it('moves a cycle of days on only on open days, holidays included, and backwards before its start', () => {
    const holiday = (d: string) => weekend(d) || d === '2026-11-19';
    const six = { kind: 'days' as const, length: 6, startsOn: '2026-11-16' }; // a Monday
    expect(slotDayOf(six, '2026-11-16', holiday)).toBe(1);
    expect(slotDayOf(six, '2026-11-18', holiday)).toBe(3);
    expect(slotDayOf(six, '2026-11-19', holiday)).toBeNull();
    expect(slotDayOf(six, '2026-11-20', holiday)).toBe(4); // the holiday did not use up Day 4
    expect(slotDayOf(six, '2026-11-25', holiday)).toBe(1); // Mon 23 is Day 5, Tue 24 Day 6, Wed 25 Day 1 again
    expect(slotDayOf(six, '2026-11-13', holiday)).toBe(6); // the Friday before Day 1
  });

  it('lists the days a school keeps lessons under', () => {
    expect(slotDays({ kind: 'week', length: 6 }, [6, 7]).map((d) => d.key)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(slotDays({ kind: 'ab', length: 6, startsOn: '2026-11-02' }, [6, 7]).map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12]);
    expect(slotDays({ kind: 'days', length: 3, startsOn: '2026-11-02' }, []).map((d) => d.key)).toEqual(['d1', 'd2', 'd3']);
    expect(slotKey({ kind: 'ab', length: 6, startsOn: '2026-11-02' }, 12)).toBe('fri-b');
  });
});
