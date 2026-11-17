import { z } from 'zod';
import { ListItem, listKey } from './lists.js';
import { isLanguage, tx } from './i18n.js';

/**
 * The school's own fields on its records (docs/one-shot-plan.md §3.6.3): a school that keeps a passport number, a bus pass or
 * a previous school adds the field, and the admin's forms, the record, the import and its template all carry it. Values are
 * kept by the field's key in the record's `custom` column; a field taken away leaves its values in place but no longer shows.
 */
export const FIELD_KINDS = ['text', 'longText', 'number', 'date', 'choice', 'multi', 'yesno', 'phone', 'email'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
/** The records that take custom fields. */
export const CUSTOM_ENTITIES = ['student', 'staff'] as const;
export type CustomEntity = (typeof CUSTOM_ENTITIES)[number];

export const FieldDef = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Keys are lower-case letters, digits and _'),
  label: z.string().trim().min(1, 'Name the field').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  kind: z.enum(FIELD_KINDS),
  /** The choices of a choice or multi field. */
  options: z.array(ListItem).max(40).optional(),
  required: z.boolean().optional(),
  /** Families (and the person themself) see it in the app. */
  app: z.boolean().optional(),
  hint: z.string().trim().max(120).optional(),
  /** A format the value must have (an ID number's): a regular expression, and what to tell someone whose value does not fit. */
  pattern: z.string().max(200).refine((p) => { try { new RegExp(p); return true; } catch { return false; } }, 'Check the pattern').optional(),
  patternHint: z.string().trim().max(120).optional(),
}).refine((f) => !['choice', 'multi'].includes(f.kind) || (f.options?.length ?? 0) > 0, { message: 'Give the choices', path: ['options'] });
export type FieldDef = z.infer<typeof FieldDef>;

const FieldList = z.array(FieldDef).max(30).refine((l) => new Set(l.map((f) => f.key)).size === l.length, 'Two fields have the same key').optional();
export const CustomFieldsSetting = z.object(Object.fromEntries(CUSTOM_ENTITIES.map((e) => [e, FieldList])) as Record<CustomEntity, typeof FieldList>);
export type CustomFieldsSetting = z.infer<typeof CustomFieldsSetting>;

export type CustomValue = string | number | boolean | string[] | null;
export const CustomValues = z.record(z.string().max(32), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(40)).max(40), z.null()]));
export type CustomValues = Record<string, CustomValue>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const YES = ['yes', 'y', 'true', '1', 'si', 'oui', 'ja', 'haan', 'हाँ', 'होय', 'نعم'];
const NO = ['no', 'n', 'false', '0', 'non', 'nein', 'nahi', 'नहीं', 'नाही', 'لا'];

/**
 * Checks values typed for a record's custom fields (a form sends values as they are, an import sends text) and returns them in
 * the shape they are kept in. `whole`: the record is new, so a required field must be there; otherwise only the values sent change.
 */
export function checkCustom(defs: readonly FieldDef[], input: Record<string, unknown>, whole: boolean): { values: CustomValues; errors: Record<string, string> } {
  const values: CustomValues = {};
  const errors: Record<string, string> = {};
  for (const f of defs) {
    if (!(f.key in input)) {
      if (whole && f.required) errors[f.key] = tx('Fill this in.');
      continue;
    }
    const raw = input[f.key];
    const empty = raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length);
    if (empty) {
      if (f.required) errors[f.key] = tx('Fill this in.');
      else values[f.key] = null;
      continue;
    }
    const text = Array.isArray(raw) ? '' : String(raw).trim();
    switch (f.kind) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(text.replace(/[\s,]/g, ''));
        if (Number.isFinite(n)) values[f.key] = n; else errors[f.key] = tx('Write a number.');
        break;
      }
      case 'date':
        if (DAY.test(text) && !Number.isNaN(Date.parse(text))) values[f.key] = text; else errors[f.key] = tx('Write the date as 2026-04-18.');
        break;
      case 'yesno': {
        const v = typeof raw === 'boolean' ? raw : YES.includes(text.toLowerCase()) ? true : NO.includes(text.toLowerCase()) ? false : null;
        if (v === null) errors[f.key] = tx('Answer yes or no.'); else values[f.key] = v;
        break;
      }
      case 'choice': {
        const k = listKey(f.options, text);
        if (k) values[f.key] = k; else errors[f.key] = tx('Choose from the list.');
        break;
      }
      case 'multi': {
        const parts = Array.isArray(raw) ? raw.map(String) : text.split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
        const keys = parts.map((p) => listKey(f.options, p));
        if (keys.some((k) => !k)) errors[f.key] = tx('Choose from the list.'); else values[f.key] = [...new Set(keys as string[])];
        break;
      }
      case 'email':
        if (EMAIL.test(text)) values[f.key] = text.toLowerCase(); else errors[f.key] = tx('Check the email.');
        break;
      case 'phone':
        if (/^\+?[\d\s()-]{6,20}$/.test(text)) values[f.key] = text; else errors[f.key] = tx('Check the phone number.');
        break;
      default:
        // An ID's format is checked without the spaces and dashes people type between groups of digits.
        if (f.pattern && !new RegExp(f.pattern).test(text.replace(/[\s-]/g, '').toUpperCase())) errors[f.key] = f.patternHint || tx('This does not look right.');
        else values[f.key] = text.slice(0, f.kind === 'longText' ? 2000 : 200);
    }
  }
  return { values, errors };
}

/** A kept value as a person reads it (choices by their name in the reader's language). */
export function customText(f: FieldDef, v: CustomValue | undefined, lang = 'en'): string {
  if (v === null || v === undefined || v === '') return '';
  const name = (k: string) => { const it = f.options?.find((o) => o.key === k); return it ? it.names?.[lang] || it.name : k; };
  if (Array.isArray(v)) return v.map(name).join(', ');
  if (typeof v === 'boolean') return v ? tx('Yes') : tx('No');
  return f.kind === 'choice' ? name(String(v)) : String(v);
}
