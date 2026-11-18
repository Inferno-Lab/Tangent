import { describe, expect, it } from 'vitest';
import { renderSeries, seriesProblem } from './numbers.js';

describe('a school’s own numbering', () => {
  it('fills the pattern for the day, and puts the running number where it says', () => {
    expect(renderSeries('RCPT-{yyyy}-{seq:5}', '2026-11-15')).toEqual({ before: 'RCPT-2026-', width: 5, after: '' });
    expect(renderSeries('ADM/{ay}/{seq}', '2026-11-15', '2026-27')).toEqual({ before: 'ADM/2026-27/', width: 0, after: '' });
    expect(renderSeries('{seq:3}/{yy}{mm}', '2026-11-15')).toEqual({ before: '', width: 3, after: '/2611' });
    // A pattern saved before {seq} existed reads as it always did.
    expect(renderSeries('RCPT-{year}-', '2026-01-02')).toEqual({ before: 'RCPT-2026-', width: 5, after: '' });
  });
  it('refuses a pattern the school could not mean', () => {
    expect(seriesProblem('INV-{yyyy}-{seq}')).toBeNull();
    expect(seriesProblem('{seq}-{seq}')).toContain('once');
    expect(seriesProblem('X-{date}-{seq}')).toContain('{date}');
    expect(seriesProblem('')).toBeTruthy();
  });
});
