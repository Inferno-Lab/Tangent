import { z } from 'zod';
import { localizedLabels, tx } from './i18n.js';

/**
 * Addresses written the country's way (docs/one-shot-plan.md §3.3.5): the parts it uses, in its order, under its names (PIN
 * code, Postcode, ZIP code, Emirate), with the postal code's format. A record keeps the parts and the address as one line,
 * which receipts, the app and exports read.
 */
export const ADDRESS_PARTS = ['line1', 'line2', 'city', 'region', 'postcode'] as const;
export type AddressPart = (typeof ADDRESS_PARTS)[number];
export const ADDRESS_PART_LABELS: Record<AddressPart, string> = localizedLabels({ line1: 'Address', line2: 'Address line 2', city: 'Town or city', region: 'Region', postcode: 'Postal code' });

export const AddressFormat = z.array(z.object({
  key: z.enum(ADDRESS_PARTS),
  label: z.string().trim().min(1).max(30),
  pattern: z.string().max(120).optional(),
  patternHint: z.string().trim().max(120).optional(),
})).min(1).max(5).refine((l) => new Set(l.map((p) => p.key)).size === l.length, 'Each part once');
export type AddressFormat = z.infer<typeof AddressFormat>;
export const DEFAULT_ADDRESS_FORMAT: AddressFormat = ADDRESS_PARTS.map((key) => ({ key, label: ADDRESS_PART_LABELS[key] }));

const PartText = z.string().trim().max(120).optional();
export const AddressParts = z.object(Object.fromEntries(ADDRESS_PARTS.map((k) => [k, PartText])) as Record<AddressPart, typeof PartText>);
export type AddressParts = Partial<Record<AddressPart, string>>;

/** The address on one line, in the country's order: the region and postal code together at the end. */
export function joinAddress(format: AddressFormat, parts: AddressParts): string {
  const has = (k: AddressPart) => format.some((p) => p.key === k) && parts[k]?.trim();
  const tail = [has('region') ? parts.region : '', has('postcode') ? parts.postcode : ''].filter(Boolean).join(' ');
  return [...(['line1', 'line2', 'city'] as const).filter(has).map((k) => parts[k]!.trim()), tail].filter(Boolean).join(', ').slice(0, 200);
}

/** Problems with the parts typed, by part (a postal code that does not fit the country's format). */
export function addressProblems(format: AddressFormat, parts: AddressParts): Partial<Record<AddressPart, string>> {
  const out: Partial<Record<AddressPart, string>> = {};
  for (const p of format) {
    const v = parts[p.key]?.trim();
    if (v && p.pattern && !new RegExp(p.pattern).test(v.toUpperCase())) out[p.key] = p.patternHint || tx('Check the {part}.', { part: p.label.toLowerCase() });
  }
  return out;
}
