import { describe, expect, it } from 'vitest';
import { readReceiptTax, receiptTax, fmtDate, fmtMoney, fmtMoneyShort, isCurrency, isLocale, isZone, schoolInstant, schoolMinutes, schoolToday, zoneOffsetMinutes } from './locale.js';

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

describe('starter packs', () => {
  it('a new school starts with its country’s and curriculum’s ways, and nothing Indian elsewhere', async () => {
    const { packSettings, curriculaFor } = await import('./packs.js');
    const india = packSettings('IN', 'CBSE');
    expect((india['fees.paymentMethods'] as { key: string }[]).map((m) => m.key)).toContain('upi');
    expect(india['grading.passPct']).toBe(33);
    const uk = packSettings('GB', 'British');
    expect((uk['fees.paymentMethods'] as { key: string }[]).map((m) => m.key)).not.toContain('upi');
    expect((uk['grading.scale'] as { grade: string }[])[0]!.grade).toBe('9');
    expect(uk['calendar.weeklyOff']).toEqual(['sat', 'sun']);
    expect(curriculaFor('IN')[0]!.key).toBe('CBSE');
    expect(curriculaFor('US').some((c) => c.key === 'CBSE')).toBe(false);
    // A country without a pack yet still starts cleanly from the neutral defaults and its curriculum.
    expect(packSettings('KE', 'IB')['grading.passPct']).toBe(50);
  });
});

describe('tax on a receipt', () => {
  const round = (n: number) => Math.round(n * 100) / 100;
  it('finds GST inside a fee and splits it into its two halves, the last taking the rounding', () => {
    const t = receiptTax({ name: 'GST', number: '27AAAAA0000A1Z5', numberLabel: 'GSTIN', code: '999293', codeLabel: 'SAC', ratePct: 18, inclusive: true, split: [{ name: 'CGST', sharePct: 50 }, { name: 'SGST', sharePct: 50 }] }, 1180, round);
    expect(t.taxable).toBe(1000);
    expect(t.parts).toEqual([{ name: 'CGST', pct: 9, amount: 90 }, { name: 'SGST', pct: 9, amount: 90 }]);
    const odd = receiptTax({ name: 'GST', number: 'x', numberLabel: 'GSTIN', code: '', codeLabel: '', ratePct: 18, inclusive: true, split: [{ name: 'CGST', sharePct: 50 }, { name: 'SGST', sharePct: 50 }] }, 1000.01, round);
    expect(round(odd.taxable + odd.parts[0]!.amount + odd.parts[1]!.amount)).toBe(1000.01);
  });
  it('shows one line under the tax’s own name when the country does not split it, and reads old GST receipts', () => {
    expect(receiptTax({ name: 'VAT', number: 'GB123456789', numberLabel: 'VAT number', code: '', codeLabel: '', ratePct: 20, inclusive: true, split: [] }, 120, round).parts).toEqual([{ name: 'VAT', pct: 20, amount: 20 }]);
    expect(readReceiptTax({ gstin: 'G', sac: '999293', ratePct: 18, taxable: 1000, cgst: 90, sgst: 90 })!.parts.map((p) => p.amount)).toEqual([90, 90]);
  });
});
