import { z } from 'zod';
import { isLanguage } from './i18n.js';

/**
 * One item of a school list (docs/one-shot-plan.md §3.6.5): genders, relationships, blood groups and every list a module
 * declares. Records keep the key; people read the name, in their language when the school wrote one (`names`). An item the
 * school retires (`active: false`) still names old records but is no longer offered.
 */
export const ListItem = z.object({
  key: z.string().regex(/^[A-Za-z0-9+\-_]{1,32}$/, 'Keys use letters, digits, + - and _'),
  name: z.string().trim().min(1, 'Name the item').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  code: z.string().trim().max(8).optional(),
  active: z.boolean().optional(),
});
export type ListItem = z.infer<typeof ListItem>;
const item = (key: string, name: string): ListItem => ({ key, name });
// A list saved as plain words (before lists had keys) reads as items named by those words.
export const schoolList = (defaults: ListItem[], min = 1, max = 40) => z.preprocess(
  (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { key: x.toLowerCase().replace(/[^a-z0-9+\-_]+/g, '-').slice(0, 32) || 'item', name: x } : x)) : v),
  z.array(ListItem).min(min).max(max).refine((l) => new Set(l.map((i) => i.key)).size === l.length, 'Two items have the same key'),
).default(defaults);
/** The items a form offers: the active ones, plus the record's own value if it was retired since. */
export const listOptions = (list: readonly ListItem[] | undefined, current?: string | null): ListItem[] =>
  (list ?? []).filter((i) => i.active !== false || i.key === current);
/** What a person reads for a stored value: the item's name in their language, else its name, else the value as it was typed. */
export function listLabel(list: readonly ListItem[] | undefined, value: string | null | undefined, lang = 'en'): string {
  if (!value) return '';
  const v = value.toLowerCase();
  const it = (list ?? []).find((i) => i.key.toLowerCase() === v || i.name.toLowerCase() === v);
  return it ? it.names?.[lang] || it.name : value;
}
/** The key a typed value stands for (an import's "F" or "Female"), or null when the list has no such item. */
export function listKey(list: readonly ListItem[] | undefined, typed: string): string | null {
  const v = typed.trim().toLowerCase();
  const it = (list ?? []).find((i) => i.key.toLowerCase() === v || i.name.toLowerCase() === v || (i.code && i.code.toLowerCase() === v) || Object.values(i.names ?? {}).some((n) => n.toLowerCase() === v));
  return it?.key ?? null;
}
export const DEFAULT_GENDERS = [item('female', 'Female'), item('male', 'Male'), item('other', 'Another gender'), item('unsaid', 'Prefer not to say')];
export const DEFAULT_RELATIONSHIPS = [item('mother', 'Mother'), item('father', 'Father'), item('parent', 'Parent'), item('guardian', 'Guardian'), item('grandparent', 'Grandparent'), item('carer', 'Carer'), item('sibling', 'Brother or sister'), item('other', 'Other')];
export const DEFAULT_LEAVE_REASONS = [item('unwell', 'Unwell'), item('family', 'Family'), item('travel', 'Travel'), item('medical', 'Medical appointment'), item('other', 'Other')];
export const DEFAULT_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => item(g, g));
