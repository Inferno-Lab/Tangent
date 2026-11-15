import { describe, expect, it } from 'vitest';
import { fmtDate, fmtMoney, fmtMoneyShort, isCurrency, isLocale, isZone, schoolInstant, schoolMinutes, schoolToday, zoneOffsetMinutes } from './locale.js';

describe('a school’s own clock', () => {
  it('“today” is the school’s day, not the server’s', () => {
    const late = new Date('2026-11-15T20:30:00Z');
    expect(schoolToday(late, 'Asia/Kolkata')).toBe('2026-11-16');
    expect(schoolToday(late, 'America/Los_Angeles')).toBe('2026-11-15');
    expect(schoolMinutes(new Date('2026-11-15T03:30:00Z'), 'Asia/Kolkata')).toBe(9 * 60);
  });
  it('a wall-clock time becomes the right instant, across a daylight-saving change', () => {
    expect(schoolInstant('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(schoolInstant('2026-03-08', '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(schoolInstant('2026-11-15', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-11-15T03:30:00.000Z');
    expect(zoneOffsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Europe/London')).toBe(60);
  });
});

describe('a school’s way of writing numbers, money and dates', () => {
  it('money in its currency, grouped its way', () => {
    expect(fmtMoney(150000, 'INR', 'en-IN')).toBe('₹1,50,000');
    expect(fmtMoney(1250, 'USD', 'en-US')).toBe('$1,250');
    expect(fmtMoney(12.5, 'GBP', 'en-GB')).toBe('£12.50');
    expect(fmtMoneyShort(1800000, 'INR', 'en-IN')).toBe('₹18L');
    expect(fmtMoneyShort(1800000, 'USD', 'en-US')).toBe('$1.8M');
  });
  it('a day stays that day wherever it is read; an instant shows at the school’s clock', () => {
    expect(fmtDate('2026-10-14', 'day', 'en-GB')).toBe('14 Oct');
    expect(fmtDate('2026-11-15T03:00:00Z', 'time', 'en-GB', 'Asia/Kolkata')).toBe('8:30');
  });
  it('checks zones, locales and currencies against the platform', () => {
    expect(isZone('Asia/Dubai')).toBe(true);
    expect(isZone('Mars/Olympus')).toBe(false);
    expect(isLocale('ar-AE')).toBe(true);
    expect(isCurrency('AED')).toBe(true);
    expect(isCurrency('XYZ1')).toBe(false);
  });
});
