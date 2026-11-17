import type { GradingScale, PaymentMethod } from './config.js';
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

export const CURRICULA: Curriculum[] = localized([
  { key: 'CBSE', name: 'CBSE', countries: ['IN'], settings: { 'grading.scale': scale(['A1', 91], ['A2', 81], ['B1', 71], ['B2', 61], ['C1', 51], ['C2', 41], ['D', 33], ['E', 0]), 'grading.passPct': 33 } },
  { key: 'ICSE', name: 'CISCE (ICSE and ISC)', countries: ['IN'], settings: { 'grading.scale': scale(['A+', 90], ['A', 75], ['B', 60], ['C', 45], ['D', 33], ['E', 0]), 'grading.passPct': 33 } },
  { key: 'State', name: 'State board', countries: ['IN'], settings: { 'grading.scale': scale(['A+', 90], ['A', 75], ['B', 60], ['C', 45], ['D', 35], ['E', 0]), 'grading.passPct': 35 } },
  { key: 'British', name: 'English national curriculum (GCSE, A level)', countries: null, settings: { 'grading.scale': scale(['9', 90], ['8', 80], ['7', 70], ['6', 60], ['5', 50], ['4', 40], ['3', 30], ['2', 20], ['1', 10], ['U', 0]), 'grading.passPct': 40 } },
  { key: 'Cambridge', name: 'Cambridge International', countries: null, settings: { 'grading.scale': scale(['A*', 90], ['A', 80], ['B', 70], ['C', 60], ['D', 50], ['E', 40], ['U', 0]), 'grading.passPct': 40 } },
  { key: 'IB', name: 'International Baccalaureate', countries: null, settings: { 'grading.scale': scale(['7', 80], ['6', 70], ['5', 60], ['4', 50], ['3', 40], ['2', 25], ['1', 0]), 'grading.passPct': 50 } },
  { key: 'American', name: 'American (letter grades)', countries: null, settings: { 'grading.scale': scale(['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]), 'grading.passPct': 60 } },
  { key: 'International', name: 'Other international', countries: null, settings: {} },
  { key: 'Other', name: 'Other', countries: null, settings: {} },
]);

const method = (key: string, name: string, kind: PaymentMethod['kind']): PaymentMethod => ({ key, name, kind });

/** A country's ways: how money is taken there, the school week and the words families expect. */
export const COUNTRY_PACKS: Record<string, Record<string, unknown>> = {
  IN: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('upi', 'UPI', 'wallet'), method('card', 'Card', 'card'), method('netbanking', 'Net banking', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sun'], 'leave.reasons': ['Unwell', 'Family function', 'Travel', 'Appointment', 'Other'],
    'fees.refundApprovalAbove': 5000, 'app.languages': ['en', 'hi', 'mr'],
    'tax.name': 'GST', 'tax.numberLabel': 'GSTIN', 'tax.code': '999293', 'tax.codeLabel': 'SAC', 'tax.ratePct': 18, 'tax.inclusive': true,
    'tax.split': [{ name: 'CGST', sharePct: 50 }, { name: 'SGST', sharePct: 50 }],
  },
  GB: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('bank', 'Bank transfer', 'bank'), method('direct-debit', 'Direct Debit', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Illness', 'Medical appointment', 'Family', 'Religious observance', 'Other'],
    'vocab.words': { en: { student: { one: 'Pupil' }, guardian: { one: 'parent' }, principal: { one: 'head teacher' }, class: { one: 'form' } } }, 'fees.refundApprovalAbove': 100,
    'tax.name': 'VAT', 'tax.numberLabel': 'VAT registration number', 'tax.ratePct': 20, 'tax.inclusive': true,
  },
  US: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('check', 'Check', 'cheque'), method('ach', 'ACH transfer', 'bank')],
    'calendar.weekStarts': 'sun', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Sick', 'Medical appointment', 'Family', 'Religious holiday', 'Other'],
    'fees.refundApprovalAbove': 100, 'app.languages': ['en', 'es'], 'tax.name': 'Sales tax', 'tax.numberLabel': 'Tax ID',
  },
  AE: {
    'fees.paymentMethods': [method('cash', 'Cash', 'cash'), method('card', 'Card', 'card'), method('bank', 'Bank transfer', 'bank'), method('cheque', 'Cheque', 'cheque')],
    'calendar.weekStarts': 'mon', 'calendar.weeklyOff': ['sat', 'sun'], 'leave.reasons': ['Illness', 'Medical appointment', 'Family', 'Travel', 'Religious observance', 'Other'],
    'fees.refundApprovalAbove': 500, 'app.languages': ['en', 'ar'],
    'tax.name': 'VAT', 'tax.numberLabel': 'TRN', 'tax.ratePct': 5, 'tax.inclusive': true,
  },
};

/** The curricula offered for a country: its own first, then those taught anywhere. */
export const curriculaFor = (country: string): Curriculum[] =>
  [...CURRICULA.filter((c) => c.countries?.includes(country)), ...CURRICULA.filter((c) => !c.countries)];

/** What a new school starts with: its country's pack, then its curriculum's (curriculum wins where both set a value). */
export function packSettings(country: string, curriculum: string): Record<string, unknown> {
  return { ...(COUNTRY_PACKS[country] ?? {}), ...(CURRICULA.find((c) => c.key === curriculum)?.settings ?? {}) };
}
