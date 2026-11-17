import type { GradingScale, PaymentMethod } from './config.js';
import type { FieldDef } from './fields.js';
import type { AddressFormat } from './address.js';
import type { GradingScheme } from './grading.js';
import { localized } from './i18n.js';

/**
 * Starter packs (docs/one-shot-plan.md §3.2): what a new school starts with, from its country and its curriculum, so it
 * has nothing to set up and changes only what is different for it. A country pack sets how money is taken, the week and the
 * words; a curriculum pack sets grading. The school's own settings win over both, and every value can be changed later.
 */
export interface Curriculum {
  key: string;
  name: string;
  /** Countries it is offered in first; null for every country. */
  countries: string[] | null;
  settings: Record<string, unknown>;
}

const scale = (...rows: [string, number][]): GradingScale => rows.map(([grade, minPct]) => ({ grade, minPct }));
/** A scheme of grades with points (CBSE's grade points, an American GPA). */
const pointsScheme = (key: string, name: string, passPct: number, rows: [string, number, number][], grades?: number[]): GradingScheme =>
  ({ key, name, kind: 'points', passPct, bands: rows.map(([grade, minPct, points]) => ({ grade, minPct, points })), ...(grades ? { grades } : {}) });

export const CURRICULA: Curriculum[] = localized([
  { key: 'CBSE', name: 'CBSE', countries: ['IN'], settings: { 'grading.scale': scale(['A1', 91], ['A2', 81], ['B1', 71], ['B2', 61], ['C1', 51], ['C2', 41], ['D', 33], ['E', 0]), 'grading.passPct': 33,
    'grading.schemes': [pointsScheme('cgpa', 'Grade points (CGPA)', 33, [['A1', 91, 10], ['A2', 81, 9], ['B1', 71, 8], ['B2', 61, 7], ['C1', 51, 6], ['C2', 41, 5], ['D', 33, 4], ['E', 0, 0]], [9, 10])] } },
  { key: 'ICSE', name: 'CISCE (ICSE and ISC)', countries: ['IN'], settings: { 'grading.scale': scale(['A+', 90], ['A', 75], ['B', 60], ['C', 45], ['D', 33], ['E', 0]), 'grading.passPct': 33 } },
  { key: 'State', name: 'State board', countries: ['IN'], settings: { 'grading.scale': scale(['A+', 90], ['A', 75], ['B', 60], ['C', 45], ['D', 35], ['E', 0]), 'grading.passPct': 35 } },
  { key: 'British', name: 'English national curriculum (GCSE, A level)', countries: null, settings: { 'grading.scale': scale(['9', 90], ['8', 80], ['7', 70], ['6', 60], ['5', 50], ['4', 40], ['3', 30], ['2', 20], ['1', 10], ['U', 0]), 'grading.passPct': 40 } },
  { key: 'Cambridge', name: 'Cambridge International', countries: null, settings: { 'grading.scale': scale(['A*', 90], ['A', 80], ['B', 70], ['C', 60], ['D', 50], ['E', 40], ['U', 0]), 'grading.passPct': 40 } },
  { key: 'IB', name: 'International Baccalaureate', countries: null, settings: { 'grading.scale': scale(['7', 80], ['6', 70], ['5', 60], ['4', 50], ['3', 40], ['2', 25], ['1', 0]), 'grading.passPct': 50 } },
  { key: 'American', name: 'American (letter grades)', countries: null, settings: { 'grading.scale': scale(['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]), 'grading.passPct': 60,
    'grading.schemes': [pointsScheme('gpa', 'GPA (4.0)', 60, [['A', 90, 4], ['B', 80, 3], ['C', 70, 2], ['D', 60, 1], ['F', 0, 0]], [9, 10, 11, 12])] } },
  { key: 'International', name: 'Other international', countries: null, settings: {} },
  { key: 'Other', name: 'Other', countries: null, settings: {} },
]);

const method = (key: string, name: string, kind: PaymentMethod['kind']): PaymentMethod => ({ key, name, kind });
/** An identity number a country's schools keep (§3.3.6), as one of the school's own fields with the format it must have. */
const part = (key: AddressFormat[number]['key'], label: string, pattern?: string, patternHint?: string) => ({ key, label, ...(pattern ? { pattern, patternHint } : {}) });
const id = (key: string, label: string, pattern?: string, patternHint?: string): FieldDef => ({ key, label, kind: 'text', ...(pattern ? { pattern, patternHint } : {}) });

/** A country's ways: how money is taken there, the school week and the words families expect. */
export const COUNTRY_PACKS: Record<string, Record<string, unknown>> = {
  IN: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('upi', 'UPI', 'wallet'), method('card', 'Card', 'card'), method('netbanking', 'Net banking', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sun'], 'leave.reasons': ['Unwell', 'Family function', 'Travel', 'Appointment', 'Other'],
    'fees.refundApprovalAbove': 5000, 'app.languages': ['en', 'hi', 'mr'],
    'tax.name': 'GST', 'tax.numberLabel': 'GSTIN', 'tax.code': '999293', 'tax.codeLabel': 'SAC', 'tax.ratePct': 18, 'tax.inclusive': true,
    'tax.split': [{ name: 'CGST', sharePct: 50 }, { name: 'SGST', sharePct: 50 }],
    'people.addressFormat': [part('line1', 'House and street'), part('line2', 'Area or locality'), part('city', 'City or town'), part('region', 'State'), part('postcode', 'PIN code', '^\\d{6}$', 'A PIN code has 6 digits.')],
    'fields.custom': {
      student: [id('aadhaar', 'Aadhaar number', '^\\d{12}$', 'An Aadhaar number has 12 digits.'), id('apaar', 'APAAR ID', '^\\d{12}$', 'An APAAR ID has 12 digits.'), id('passport', 'Passport number')],
      staff: [id('pan', 'PAN', '^[A-Z]{5}\\d{4}[A-Z]$', 'A PAN has 10 characters, like ABCDE1234F.'), id('aadhaar', 'Aadhaar number', '^\\d{12}$', 'An Aadhaar number has 12 digits.')],
    },
  },
  GB: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('bank', 'Bank transfer', 'bank'), method('direct-debit', 'Direct Debit', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Illness', 'Medical appointment', 'Family', 'Religious observance', 'Other'],
    'vocab.words': { en: { student: { one: 'Pupil' }, guardian: { one: 'parent' }, principal: { one: 'head teacher' }, class: { one: 'form' } } }, 'fees.refundApprovalAbove': 100,
    'tax.name': 'VAT', 'tax.numberLabel': 'VAT registration number', 'tax.ratePct': 20, 'tax.inclusive': true,
    'people.addressFormat': [part('line1', 'Address line 1'), part('line2', 'Address line 2'), part('city', 'Town'), part('region', 'County'), part('postcode', 'Postcode', '^[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2}$', 'Like SW1A 1AA.')],
    'fields.custom': {
      student: [id('upn', 'UPN', '^[A-Z]\\d{11}[0-9A-Z]$', 'A UPN has 13 characters: a letter, 11 digits and a last digit or letter.'), id('uln', 'ULN', '^\\d{10}$', 'A ULN has 10 digits.')],
      staff: [id('ni', 'National Insurance number', '^[A-Z]{2}\\d{6}[A-D]$', 'Like QQ123456C.')],
    },
  },
  US: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('check', 'Check', 'cheque'), method('ach', 'ACH transfer', 'bank')],
    'calendar.weekStarts': 'sun', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Sick', 'Medical appointment', 'Family', 'Religious holiday', 'Other'],
    'fees.refundApprovalAbove': 100, 'app.languages': ['en', 'es'], 'tax.name': 'Sales tax', 'tax.numberLabel': 'Tax ID',
    'people.addressFormat': [part('line1', 'Street address'), part('line2', 'Apartment, suite'), part('city', 'City'), part('region', 'State'), part('postcode', 'ZIP code', '^\\d{5}(-\\d{4})?$', 'A ZIP code has 5 digits, or 5 and 4.')],
    'fields.custom': { student: [id('state_id', 'State student ID')] },
  },
  AE: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('bank', 'Bank transfer', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Illness', 'Medical appointment', 'Family', 'Travel', 'Religious observance', 'Other'],
    'fees.refundApprovalAbove': 500, 'app.languages': ['en', 'ar'],
    'tax.name': 'VAT', 'tax.numberLabel': 'TRN', 'tax.ratePct': 5, 'tax.inclusive': true,
    'people.addressFormat': [part('line1', 'Building and street'), part('line2', 'Area'), part('city', 'City'), part('region', 'Emirate'), part('postcode', 'P.O. Box')],
    'fields.custom': {
      student: [id('emirates_id', 'Emirates ID', '^784\\d{12}$', 'An Emirates ID has 15 digits and starts 784.'), id('passport', 'Passport number'), id('visa', 'Residence visa number')],
      staff: [id('emirates_id', 'Emirates ID', '^784\\d{12}$', 'An Emirates ID has 15 digits and starts 784.'), id('passport', 'Passport number')],
    },
  },
};

/** The curricula offered for a country: its own first, then those taught anywhere. */
export const curriculaFor = (country: string): Curriculum[] =>
  [...CURRICULA.filter((c) => c.countries?.includes(country)), ...CURRICULA.filter((c) => !c.countries)];

/** What a new school starts with: its country's pack, then its curriculum's (curriculum wins where both set a value). */
export function packSettings(country: string, curriculum: string): Record<string, unknown> {
  return { ...(COUNTRY_PACKS[country] ?? {}), ...(CURRICULA.find((c) => c.key === curriculum)?.settings ?? {}) };
}
