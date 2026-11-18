import { describe, expect, it } from 'vitest';
import { bestOf, gpaOf, gradeIn, roundPct, schemeFor, type GradingScheme } from './grading.js';

const school: GradingScheme = { key: 'school', name: 'Grades', kind: 'bands', passPct: 40, bands: [{ grade: 'A', minPct: 80 }, { grade: 'B', minPct: 50 }, { grade: 'C', minPct: 0 }] };
const gpa: GradingScheme = { key: 'gpa', name: 'GPA', kind: 'points', passPct: 60, grades: [9, 10], bands: [{ grade: 'A', minPct: 90, points: 4 }, { grade: 'B', minPct: 80, points: 3 }, { grade: 'F', minPct: 0, points: 0 }] };
const art: GradingScheme = { key: 'art', name: 'Art', kind: 'bands', passPct: 0, subjects: ['art'], bands: [{ grade: 'Exceeding', minPct: 70, descriptor: 'Exceeding' }, { grade: 'Secure', minPct: 0 }] };
const club: GradingScheme = { key: 'club', name: 'Clubs', kind: 'passfail', passPct: 50, subjects: ['club'], grades: [9] };

describe('grading schemes', () => {
  it('picks the scheme for a subject and year group, most particular first, else the school’s scale', () => {
    const all = [gpa, art, club];
    expect(schemeFor(all, school, { grade: 9, subject: 'club' }).key).toBe('club');
    expect(schemeFor(all, school, { grade: 9, subject: 'art' }).key).toBe('art');
    expect(schemeFor(all, school, { grade: 10, subject: 'maths' }).key).toBe('gpa');
    expect(schemeFor(all, school, { grade: 6, subject: 'maths' }).key).toBe('school');
  });
  it('grades with points, descriptors or pass and fail', () => {
    expect(gradeIn(gpa, 85)).toEqual({ grade: 'B', points: 3, descriptor: '', pass: true });
    expect(gradeIn(art, 75)).toMatchObject({ grade: 'Exceeding', descriptor: 'Exceeding', points: null });
    expect(gradeIn(club, 49)).toMatchObject({ grade: 'Fail', pass: false });
  });
  it('averages points into a GPA, leaving out subjects without points', () => {
    expect(gpaOf([4, 3, null, 3])).toBe(3.33);
    expect(gpaOf([null])).toBeNull();
  });
});

describe('rounding and best-of', () => {
  it('rounds the school’s way, without floating-point surprises', () => {
    expect(roundPct(84.5)).toBe(85);
    expect(roundPct(84.5, 'down')).toBe(84);
    expect(roundPct(84.01, 'up')).toBe(85);
    expect(roundPct(85.00000000001, 'up')).toBe(85);
    expect(roundPct((17 / 20) * 100, 'down')).toBe(85);
    expect(roundPct(84.456, 'nearest', 2)).toBe(84.46);
    expect(roundPct(84.451, 'down', 1)).toBe(84.4);
  });
  it('keeps only the best n, or all when n is not set or more than there are', () => {
    expect(bestOf([60, 90, 75, 80], 3, (x) => x)).toEqual([90, 80, 75]);
    expect(bestOf([60, 90], 3, (x) => x)).toEqual([60, 90]);
    expect(bestOf([60, 90], 0, (x) => x)).toEqual([60, 90]);
  });
});

