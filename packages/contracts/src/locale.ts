/**
 * Where a school is and how it writes dates, numbers and money (docs/one-shot-plan.md §3.3, §3.4). Everything here uses the
 * platform's own `Intl`, so any country, zone, locale or currency works without a list to keep up to date.
 */

import { z } from 'zod';

/** An amount in the school's currency: positive, with no more decimals than any currency has (three, for the dinars). */
export const Money = (empty = 'Enter an amount') => z.number({ message: empty }).positive(empty).max(1_000_000_000_000)
  .refine((n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, 'Use at most three decimals');

/** The same, where zero is allowed (a free route, no fine). */
export const MoneyOrZero = () => z.number().min(0).max(1_000_000_000_000).refine((n) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6, 'Use at most three decimals');

/** Rounds a sum of amounts to the thousandth, so 0.1 + 0.2 is 0.3 and an amount compares equal to what is due. */
export const roundMoney = (n: number): number => Math.round(n * 1000) / 1000;

/** How many decimals a currency is paid in (2 for most, 0 for yen, 3 for dinars): providers take amounts in those units. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** An amount rounded to what the currency can be paid in (whole yen, cents, fils): tax lines, fines, a share of a fee. */
export const roundToCurrency = (n: number, currency = schoolCurrency()): number => {
  const f = 10 ** currencyDigits(currency);
  return Math.round(n * f) / f;
};

/**
 * An amount typed by a person, read the school's way: "12,50" in French, "1.250,75" in German, "1,250.75" in English, with or
 * without a currency sign; rounded to what the currency can be paid in. NaN when it is not an amount.
 */
export function readAmount(text: string, locale = schoolLocale(), currency = schoolCurrency()): number {
  if (/-/.test(text)) return NaN;
  let dec = '.';
  try { dec = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'; } catch { /* an unknown locale reads as English */ }
  // Arabic and Persian digits and the Arabic decimal sign read as their Latin forms; anything else (a sign, spaces) goes.
  let s = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, '.').replace(/[^\d.,]/g, '');
  const comma = dec === ',';
  s = s.split(comma ? '.' : ',').join('');
  if (comma) s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return roundToCurrency(Number(s), currency);
}

/** An amount written for a person to edit, the way readAmount reads it back ("12,5" in French, no grouping). */
export const amountText = (n: number, locale = schoolLocale(), currency = schoolCurrency()): string =>
  new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: currencyDigits(currency) }).format(roundToCurrency(n, currency));

/** An amount in the currency's smallest unit (paise, cents, fils), as payment providers take it. */
export const toMinor = (n: number, currency: string): number => Math.round(n * 10 ** currencyDigits(currency));

/** ISO 3166-1 alpha-2 country codes; names come from `Intl.DisplayNames` in the person's language. */
export const COUNTRIES = (
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE ' +
  'DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM ' +
  'KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG ' +
  'PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ ' +
  'VA VC VE VN VU WS XK YE ZA ZM ZW'
).split(' ');

export const isZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const isLocale = (l: string): boolean => {
  try {
    return Intl.getCanonicalLocales(l).length === 1;
  } catch {
    return false;
  }
};

export const isCurrency = (c: string): boolean => {
  if (!/^[A-Z]{3}$/.test(c)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: c });
    return true;
  } catch {
    return false;
  }
};

/** Every IANA time zone the platform knows (the editor's choices). */
export const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  } catch {
    return ['UTC'];
  }
})();

/** The locales the editor offers first: a language and the country whose way of writing numbers and dates it follows. */
export const LOCALES: [string, string][] = [
  ['en', 'English'], ['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)'], ['en-IN', 'English (India)'], ['en-AE', 'English (United Arab Emirates)'],
  ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-SG', 'English (Singapore)'], ['en-ZA', 'English (South Africa)'], ['en-NG', 'English (Nigeria)'], ['en-KE', 'English (Kenya)'],
  ['hi-IN', 'हिन्दी (भारत)'], ['mr-IN', 'मराठी (भारत)'], ['bn-IN', 'বাংলা (ভারত)'], ['ta-IN', 'தமிழ் (இந்தியா)'], ['te-IN', 'తెలుగు (భారతదేశం)'], ['gu-IN', 'ગુજરાતી (ભારત)'], ['kn-IN', 'ಕನ್ನಡ (ಭಾರತ)'],
  ['ar', 'العربية'], ['ar-AE', 'العربية (الإمارات)'], ['ar-SA', 'العربية (السعودية)'], ['ar-EG', 'العربية (مصر)'],
  ['fr-FR', 'Français (France)'], ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['pt-BR', 'Português (Brasil)'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'],
  ['ur-PK', 'اردو (پاکستان)'], ['id-ID', 'Bahasa Indonesia'], ['ms-MY', 'Bahasa Melayu'], ['sw-KE', 'Kiswahili'], ['tr-TR', 'Türkçe'], ['zh-CN', '中文 (中国)'], ['ja-JP', '日本語'],
];

// The school whose "today" and money are meant when a caller does not say: the server sets it per request and per job, a
// web page from the school it is open on. ponytail: one source per process; anything that serves two schools at once passes them explicitly.
let zoneSource: () => string | undefined = () => undefined;
let localeSource: () => { locale?: string; currency?: string; country?: string } | undefined = () => undefined;

/** Where the current school's time zone comes from (the API's request context, a page's loaded configuration). */
export function setZoneSource(fn: () => string | undefined): void {
  zoneSource = fn;
}
export function setLocaleSource(fn: () => { locale?: string; currency?: string; country?: string } | undefined): void {
  localeSource = fn;
}

/** The current school's zone; UTC when nothing has said which school this is. */
export const schoolZone = (): string => zoneSource() || 'UTC';
export const schoolLocale = (): string => localeSource()?.locale || 'en';
export const schoolCurrency = (): string => localeSource()?.currency || 'USD';
/** The current school's country (ISO 3166), for phone numbers and the country's rules; empty when not known. */
export const schoolCountry = (): string => localeSource()?.country || '';

const zoneFmt = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const QUARTER = 15 * 60_000;

/**
 * Minutes the zone is ahead of UTC at that instant (330 for India, -300 for New York in winter). Asking Intl is slow (an
 * import of a year's attendance asked 130,000 times and held the server for seconds), and a zone's offset only changes at
 * its switches, which fall on a quarter hour, so it is asked once per zone per quarter hour.
 */
export function zoneOffsetMinutes(at: Date, tz = schoolZone()): number {
  const key = `${tz}|${Math.floor(at.getTime() / QUARTER)}`;
  const hit = offsets.get(key);
  if (hit !== undefined) return hit;
  let f = zoneFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    zoneFmt.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  const off = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  if (offsets.size > 5000) offsets.clear();
  offsets.set(key, off);
  return off;
}

/** The school's wall clock at an instant, as a Date whose UTC fields read it. */
const wall = (at: Date, tz: string): Date => new Date(at.getTime() + zoneOffsetMinutes(at, tz) * 60_000);

/** The instant a school's wall clock reads `day` at `time` ("08:30"), in its zone. */
export function schoolInstant(day: string, time = '00:00', tz = schoolZone()): Date {
  const naive = new Date(`${day}T${time.length === 5 ? `${time}:00` : time}Z`);
  // Two passes settle the offset across a daylight-saving change.
  let at = new Date(naive.getTime() - zoneOffsetMinutes(naive, tz) * 60_000);
  at = new Date(naive.getTime() - zoneOffsetMinutes(at, tz) * 60_000);
  return at;
}

/** A Date whose UTC fields read the school's wall clock (getUTCHours() is the hour at the school). */
export function schoolNow(now: Date = new Date(), tz = schoolZone()): Date {
  return wall(now, tz);
}

/** YYYY-MM-DD at the school, now or at an instant. */
export function schoolToday(now: Date = new Date(), tz = schoolZone()): string {
  return wall(now, tz).toISOString().slice(0, 10);
}

/** Minutes since midnight at the school. */
export function schoolMinutes(now: Date = new Date(), tz = schoolZone()): number {
  const w = wall(now, tz);
  return w.getUTCHours() * 60 + w.getUTCMinutes();
}

const fmtCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = fmtCache.get(key) as T | undefined;
  if (!f) {
    f = make();
    fmtCache.set(key, f);
  }
  return f;
}

/** A count in the school's way of writing numbers ("1,49,800" in India, "149,800" elsewhere). */
export function fmtNumber(n: number, locale = schoolLocale()): string {
  return cached(`n|${locale}`, () => new Intl.NumberFormat(locale)).format(n);
}

/** An amount in the school's currency: whole amounts without decimals ("₹22,000", "$1,250"), others with the currency's own. */
export function fmtMoney(n: number, currency = schoolCurrency(), locale = schoolLocale()): string {
  const whole = Number.isInteger(n);
  return cached(`m|${locale}|${currency}|${whole}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, ...(whole ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}) })).format(n);
}

/** A short amount for a tile or a chart label ("₹18L" in India, "$1.8M" elsewhere). */
export function fmtMoneyShort(n: number, currency = schoolCurrency(), locale = schoolLocale()): string {
  return cached(`ms|${locale}|${currency}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })).format(n);
}

/** The currency's own symbol in the school's way ("₹", "$", "AED"), for a field's label or a glyph. */
export function currencySymbol(currency = schoolCurrency(), locale = schoolLocale()): string {
  return cached(`s|${locale}|${currency}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency })).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

export type DateStyle = 'day' | 'dayYear' | 'long' | 'weekday' | 'weekdayLong' | 'month' | 'time' | 'stamp';
const DATE_OPTS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  day: { day: 'numeric', month: 'short' },
  dayYear: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  weekdayLong: { weekday: 'long', day: 'numeric', month: 'long' },
  month: { month: 'long', year: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit' },
  stamp: { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
};

/**
 * A day ("2026-10-14", written as that calendar day wherever it is read) or an instant (an ISO time or a Date, shown at the
 * school's clock) in the school's language: "14 Oct", "Wed 14 Oct", "8:30 am".
 */
export function fmtDate(value: string | Date, style: DateStyle = 'day', locale = schoolLocale(), tz = schoolZone()): string {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const zone = day ? 'UTC' : tz;
  const at = day ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  return cached(`d|${locale}|${zone}|${style}`, () => new Intl.DateTimeFormat(locale, { ...DATE_OPTS[style], timeZone: zone })).format(at);
}

/** What the onboarding wizard fills in when a country is picked: its main time zone, a locale and its currency. Any can be changed. */
export const COUNTRY_DEFAULTS: Record<string, { zone: string; locale: string; currency: string }> = {
  IN: { zone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR' }, GB: { zone: 'Europe/London', locale: 'en-GB', currency: 'GBP' },
  US: { zone: 'America/New_York', locale: 'en-US', currency: 'USD' }, AE: { zone: 'Asia/Dubai', locale: 'en-AE', currency: 'AED' },
  SA: { zone: 'Asia/Riyadh', locale: 'ar-SA', currency: 'SAR' }, QA: { zone: 'Asia/Qatar', locale: 'en', currency: 'QAR' }, KW: { zone: 'Asia/Kuwait', locale: 'en', currency: 'KWD' },
  OM: { zone: 'Asia/Muscat', locale: 'en', currency: 'OMR' }, BH: { zone: 'Asia/Bahrain', locale: 'en', currency: 'BHD' }, EG: { zone: 'Africa/Cairo', locale: 'ar-EG', currency: 'EGP' },
  SG: { zone: 'Asia/Singapore', locale: 'en-SG', currency: 'SGD' }, MY: { zone: 'Asia/Kuala_Lumpur', locale: 'ms-MY', currency: 'MYR' }, ID: { zone: 'Asia/Jakarta', locale: 'id-ID', currency: 'IDR' },
  NG: { zone: 'Africa/Lagos', locale: 'en-NG', currency: 'NGN' }, KE: { zone: 'Africa/Nairobi', locale: 'en-KE', currency: 'KES' }, ZA: { zone: 'Africa/Johannesburg', locale: 'en-ZA', currency: 'ZAR' },
  AU: { zone: 'Australia/Sydney', locale: 'en-AU', currency: 'AUD' }, CA: { zone: 'America/Toronto', locale: 'en-CA', currency: 'CAD' }, NZ: { zone: 'Pacific/Auckland', locale: 'en', currency: 'NZD' },
  PK: { zone: 'Asia/Karachi', locale: 'ur-PK', currency: 'PKR' }, BD: { zone: 'Asia/Dhaka', locale: 'en', currency: 'BDT' }, LK: { zone: 'Asia/Colombo', locale: 'en', currency: 'LKR' },
  NP: { zone: 'Asia/Kathmandu', locale: 'en', currency: 'NPR' }, FR: { zone: 'Europe/Paris', locale: 'fr-FR', currency: 'EUR' }, DE: { zone: 'Europe/Berlin', locale: 'de-DE', currency: 'EUR' },
  ES: { zone: 'Europe/Madrid', locale: 'es-ES', currency: 'EUR' }, IT: { zone: 'Europe/Rome', locale: 'it-IT', currency: 'EUR' }, IE: { zone: 'Europe/Dublin', locale: 'en', currency: 'EUR' },
  MX: { zone: 'America/Mexico_City', locale: 'es-MX', currency: 'MXN' }, BR: { zone: 'America/Sao_Paulo', locale: 'pt-BR', currency: 'BRL' }, TR: { zone: 'Europe/Istanbul', locale: 'tr-TR', currency: 'TRY' },
  JP: { zone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' }, CN: { zone: 'Asia/Shanghai', locale: 'zh-CN', currency: 'CNY' },
};

/** A country's name in English, from the platform. */
export function countryName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The tax on one receipt (§3.4.2), as it was when paid: what it is called, the registration, and each part. */
export interface ReceiptTax {
  name: string; number: string; numberLabel: string; code: string; codeLabel: string; ratePct: number; inclusive: boolean;
  /** The amount the tax is worked on (inside an inclusive fee, the fee less its tax). */
  taxable: number;
  parts: { name: string; pct: number; amount: number }[];
}
/**
 * Works out the tax inside a payment (a fee billed without tax had it added when it was billed, so what is paid always
 * includes it), split into the country's parts; the last part takes the rounding so the parts add up to the tax.
 * `round` rounds to the currency's minor unit.
 */
export function receiptTax(o: Omit<ReceiptTax, 'taxable' | 'parts'> & { split: { name: string; sharePct: number }[] }, amount: number, round: (n: number) => number): ReceiptTax {
  const taxable = round((amount * 100) / (100 + o.ratePct));
  const total = amount - taxable;
  const split = o.split.length ? o.split : [{ name: o.name, sharePct: 100 }];
  let left = total;
  const parts = split.map((p, i) => {
    const share = i === split.length - 1 ? left : round((total * p.sharePct) / 100);
    left -= share;
    return { name: p.name, pct: (o.ratePct * p.sharePct) / 100, amount: share };
  });
  const { split: _s, ...rest } = o;
  return { ...rest, taxable, parts };
}
/** A receipt's tax as it was kept before the tax model (an Indian GST receipt): read as the same parts. */
export function readReceiptTax(raw: Record<string, unknown> | null): ReceiptTax | null {
  if (!raw) return null;
  if ('parts' in raw) return raw as unknown as ReceiptTax;
  const r = raw as { gstin?: string; sac?: string; ratePct?: number; taxable?: number; cgst?: number; sgst?: number };
  return { name: 'GST', number: r.gstin ?? '', numberLabel: 'GSTIN', code: r.sac ?? '', codeLabel: 'SAC', ratePct: r.ratePct ?? 0, inclusive: true, taxable: r.taxable ?? 0,
    parts: [{ name: 'CGST', pct: (r.ratePct ?? 0) / 2, amount: r.cgst ?? 0 }, { name: 'SGST', pct: (r.ratePct ?? 0) / 2, amount: r.sgst ?? 0 }] };
}
