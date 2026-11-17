import { z } from 'zod';
import { isLanguage } from './i18n.js';

/**
 * The school's own admission stages between an enquiry and enrolment (§4.2): any number, any names. Each says what it
 * needs: a day (a test, an interview, a visit), a score, documents to collect, and whether the family is told on reaching
 * it. "enquiry" is where every child starts, "enrolled" and "declined" where they end; those three are not the school's.
 */
export const FIXED_STAGES = ['enquiry', 'enrolled', 'declined'] as const;

export const AdmissionStage = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,24}$/, 'Use letters, numbers and dashes').refine((k) => !(FIXED_STAGES as readonly string[]).includes(k), 'That name is kept for the start and the end'),
  name: z.string().trim().min(1, 'Name the stage').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  hint: z.string().trim().max(80).default(''),
  /** The stage happens on a day (a test, an interview, a visit): moving into it asks for the day. */
  needsDate: z.boolean().default(false),
  /** A score or result is written down at this stage (a test mark, an interview grade). */
  scored: z.boolean().default(false),
  /** Documents to collect at this stage; each is ticked when received. */
  documents: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  /** The family hears about it (an offer, an interview invitation). */
  tellFamily: z.boolean().default(false),
});
export type AdmissionStage = z.infer<typeof AdmissionStage>;

/** The stages every school used before stages were its own; a saved list of their keys reads as these. */
export const DEFAULT_ADMISSION_STAGES: AdmissionStage[] = [
  { key: 'applied', name: 'Applied', hint: 'Form received', needsDate: false, scored: false, documents: [], tellFamily: false },
  { key: 'test', name: 'Entrance test', hint: 'Entrance test booked', needsDate: true, scored: true, documents: [], tellFamily: false },
  { key: 'offer', name: 'Offer', hint: 'Seat offered; the family is told', needsDate: false, scored: false, documents: [], tellFamily: true },
];

export const AdmissionStages = z.preprocess(
  (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? DEFAULT_ADMISSION_STAGES.find((d) => d.key === x) ?? { key: x, name: x } : x)) : v),
  z.array(AdmissionStage).max(10, 'At most ten stages')
    .refine((l) => new Set(l.map((s) => s.key)).size === l.length, 'Each stage needs its own name'),
);

/**
 * The grades a school teaches, from its classes, each named the school's way: "8 A" and "8 B" make grade 8 named "8";
 * "Nursery Rose" makes grade -1 named "Nursery". A name that is only a number reads "Grade 8" where it is shown.
 */
export function gradeChoices(classes: { grade: number; name: string; section: string }[]): { value: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const c of classes) if (!seen.has(c.grade)) seen.set(c.grade, c.section && c.name.endsWith(c.section) ? c.name.slice(0, -c.section.length).trim() : c.name);
  return [...seen].sort((a, b) => a[0] - b[0]).map(([value, name]) => ({ value, name }));
}

/** A stage's name in a language, else the school's own wording. */
export function stageName(stages: AdmissionStage[], key: string, lang?: string): string {
  const s = stages.find((x) => x.key === key);
  return (s && ((lang && s.names?.[lang]) || s.name)) || key;
}
