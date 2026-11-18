/**
 * Phone numbers anywhere (docs/one-shot-plan.md §3.3): every number is kept in one international form (E.164,
 * "+971501234567"), so the same person is found whether they type their number locally ("050 123 4567") or with the
 * country code. A local number takes the school's country. No library: the calling codes and usual lengths are below.
 */

/** Country calling codes (ITU-T E.164). */
export const CALLING_CODES: Record<string, string> = {
  AD: '376', AE: '971', AF: '93', AG: '1', AI: '1', AL: '355', AM: '374', AO: '244', AR: '54', AT: '43', AU: '61', AW: '297', AZ: '994', BA: '387', BB: '1',
  BD: '880', BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BM: '1', BN: '673', BO: '591', BR: '55', BS: '1', BT: '975', BW: '267', BY: '375',
  BZ: '501', CA: '1', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CY: '357',
  CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1', DO: '1', DZ: '213', EC: '593', EE: '372', EG: '20', ER: '291', ES: '34', ET: '251', FI: '358', FJ: '679',
  FM: '691', FR: '33', GA: '241', GB: '44', GD: '1', GE: '995', GH: '233', GM: '220', GN: '224', GQ: '240', GR: '30', GT: '502', GW: '245', GY: '592', HK: '852',
  HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IN: '91', IQ: '964', IR: '98', IS: '354', IT: '39', JM: '1', JO: '962', JP: '81',
  KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1', KR: '82', KW: '965', KY: '1', KZ: '7', LA: '856', LB: '961', LC: '1', LI: '423', LK: '94',
  LR: '231', LS: '266', LT: '370', LU: '352', LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MG: '261', MH: '692', MK: '389', ML: '223',
  MM: '95', MN: '976', MO: '853', MR: '222', MT: '356', MU: '230', MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264', NE: '227', NG: '234',
  NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NZ: '64', OM: '968', PA: '507', PE: '51', PG: '675', PH: '63', PK: '92', PL: '48', PS: '970', PT: '351',
  PW: '680', PY: '595', QA: '974', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249', SE: '46', SG: '65', SI: '386',
  SK: '421', SL: '232', SM: '378', SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SY: '963', SZ: '268', TD: '235', TG: '228', TH: '66',
  TJ: '992', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1', TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598', UZ: '998',
  VA: '39', VC: '1', VE: '58', VN: '84', VU: '678', WS: '685', XK: '383', YE: '967', ZA: '27', ZM: '260', ZW: '263',
};

/** The usual length of a national number (without the trunk 0) where it is fixed; elsewhere 6 to 12 digits are accepted. */
const LENGTHS: Record<string, [number, number]> = {
  IN: [10, 10], US: [10, 10], CA: [10, 10], GB: [9, 10], AE: [8, 9], SA: [8, 9], QA: [8, 8], KW: [8, 8], OM: [8, 8], BH: [8, 8], SG: [8, 8], MY: [9, 10],
  NG: [8, 10], KE: [9, 9], ZA: [9, 9], AU: [9, 9], PK: [10, 10], BD: [10, 10], LK: [9, 9], NP: [8, 10], FR: [9, 9], DE: [6, 11], ES: [9, 9], IT: [6, 11],
  IE: [7, 9], MX: [10, 10], BR: [10, 11], TR: [10, 10], JP: [9, 10], CN: [11, 11], EG: [9, 10], ID: [8, 12], NZ: [8, 10],
};

/** Countries whose numbers keep their leading 0 inside the international form (Italy's landlines). */
const KEEPS_ZERO = new Set(['IT', 'VA', 'SM']);

/**
 * A phone number in international form, or null when it cannot be one. A number written with + or 00 is taken as it is;
 * otherwise it is a local number in `country` (its trunk 0, or the 1 in North America, is dropped).
 */
export function toE164(raw: string, country: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') || s.startsWith('00')) {
    const d = s.startsWith('00') ? digits.slice(2) : digits;
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }
  const code = CALLING_CODES[country];
  if (!code) return null;
  // Someone may type the country code without the + ("919822041200").
  let national = digits.startsWith(code) && digits.length > (LENGTHS[country]?.[1] ?? 12) ? digits.slice(code.length) : digits;
  if (code === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1);
  if (!KEEPS_ZERO.has(country)) national = national.replace(/^0+/, '');
  const [min, max] = LENGTHS[country] ?? [6, 12];
  return national.length >= min && national.length <= max ? `+${code}${national}` : null;
}

/** The calling code an international number starts with (the longest that matches), and the rest. */
export function splitE164(e164: string): { code: string; national: string } {
  const d = e164.replace(/\D/g, '');
  const codes = [...new Set(Object.values(CALLING_CODES))].sort((a, b) => b.length - a.length);
  const code = codes.find((c) => d.startsWith(c)) ?? d.slice(0, 2);
  return { code, national: d.slice(code.length) };
}

/** What a field says when a number cannot be read: the shape that country uses. */
export function phoneProblem(raw: string, country: string): string | null {
  if (toE164(raw, country)) return null;
  const len = LENGTHS[country];
  const code = CALLING_CODES[country];
  return len && code ? `Write a ${len[0] === len[1] ? len[0] : `${len[0]} to ${len[1]}`}-digit number, or the full number starting +${code}.` : 'Write the full number, starting with + and the country code.';
}
