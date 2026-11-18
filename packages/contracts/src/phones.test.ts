import { describe, expect, it } from 'vitest';
import { phoneProblem, splitE164, toE164 } from './phones.js';

describe('phone numbers anywhere', () => {
  it('turns a number written locally or internationally into one form', () => {
    expect(toE164('98220 41200', 'IN')).toBe('+919822041200');
    expect(toE164('+91 98220 41200', 'IN')).toBe('+919822041200');
    expect(toE164('09822041200', 'IN')).toBe('+919822041200');
    expect(toE164('919822041200', 'IN')).toBe('+919822041200');
    expect(toE164('050 123 4567', 'AE')).toBe('+971501234567');
    expect(toE164('+971 50 123 4567', 'GB')).toBe('+971501234567');
    expect(toE164('07911 123456', 'GB')).toBe('+447911123456');
    expect(toE164('(212) 555-0187', 'US')).toBe('+12125550187');
    expect(toE164('1 212 555 0187', 'US')).toBe('+12125550187');
    expect(toE164('0044 7911 123456', 'IN')).toBe('+447911123456');
  });
  it('refuses what cannot be a phone number, and says what the country expects', () => {
    expect(toE164('12345', 'IN')).toBeNull();
    expect(toE164('', 'IN')).toBeNull();
    expect(phoneProblem('12345', 'IN')).toContain('10-digit');
    expect(phoneProblem('050 123 4567', 'AE')).toBeNull();
  });
  it('splits an international number into its calling code and the rest', () => {
    expect(splitE164('+971501234567')).toEqual({ code: '971', national: '501234567' });
    expect(splitE164('+12125550187')).toEqual({ code: '1', national: '2125550187' });
  });
});
