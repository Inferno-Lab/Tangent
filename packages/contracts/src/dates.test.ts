import { describe, expect, it } from 'vitest';
import { addDays, hasReachedAge, isSchoolDay, latestSchoolDay, plural, schoolDaysEnding, weekday } from './dates.js';

describe('dates', () => {
  it('knows the weekday (14 Oct 2026 is a Wednesday)', () => {
    expect(weekday('2026-10-14')).toBe(3);
    expect(isSchoolDay('2026-10-18')).toBe(false);
  });
  it('steps back from a Sunday to Saturday', () => {
    expect(latestSchoolDay('2026-10-18')).toBe('2026-10-17');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('lists school days oldest first and skips Sundays', () => {
    expect(schoolDaysEnding('2026-10-14', 6)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14']);
  });
  it('names more than one the school’s way', () => {
    expect(['Student', 'Pupil', 'Class', 'Batch', 'Nursery', 'Day'].map(plural)).toEqual(['Students', 'Pupils', 'Classes', 'Batches', 'Nurseries', 'Days']);
  });
});

describe('a birthday', () => {
  it('counts an age reached on the day itself, and a 29 February birthday on 1 March', () => {
    expect(hasReachedAge('2008-11-17', '2026-11-17', 18)).toBe(true);
    expect(hasReachedAge('2008-11-18', '2026-11-17', 18)).toBe(false);
    expect(hasReachedAge('2008-02-29', '2026-02-28', 18)).toBe(false);
    expect(hasReachedAge('2008-02-29', '2026-03-01', 18)).toBe(true);
  });
});
