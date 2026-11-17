import { z } from 'zod';
import { isLanguage, localizedLabels, tx } from './i18n.js';

/**
 * Grading and assessment schemes (docs/one-shot-plan.md §3.6.6): a school grades the way its curriculum does, and may grade
 * differently by year group or subject (letters in the primary years, 9 to 1 for GCSE, IB's 1 to 7, a GPA in the high school).
 * A scheme is percentage bands; a band may carry points (for a GPA or CGPA) and a descriptor (Secure, Exceeding). A pass or
 * fail scheme only says whether the mark reached the pass mark.
 */
export const SCHEME_KINDS = ['bands', 'points', 'passfail'] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];
export const SCHEME_KIND_LABELS: Record<SchemeKind, string> = localizedLabels({ bands: 'Grades by percentage', points: 'Grades with points (GPA)', passfail: 'Pass or fail' });

export const GradeBand = z.object({
  grade: z.string().trim().min(1).max(6),
  minPct: z.number().min(0).max(100),
  points: z.number().min(0).max(100).optional(),
  descriptor: z.string().trim().max(40).optional(),
});
export type GradeBand = z.infer<typeof GradeBand>;

export const GradingScheme = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  name: z.string().trim().min(1, 'Name the scheme').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  kind: z.enum(SCHEME_KINDS).default('bands'),
  bands: z.array(GradeBand).max(15).default([]),
  passPct: z.number().min(0).max(100),
  /** The year groups (class grade levels) it is for; none: every year group. */
  grades: z.array(z.number().int().min(-3).max(20)).max(20).optional(),
  /** The subjects (ids) it is for; none: every subject. */
  subjects: z.array(z.string()).max(40).optional(),
}).refine((s) => s.kind === 'passfail' || s.bands.length > 0, { message: 'Add the grades', path: ['bands'] })
  .refine((s) => s.kind !== 'points' || s.bands.every((b) => b.points !== undefined), { message: 'Give every grade its points', path: ['bands'] });
export type GradingScheme = z.infer<typeof GradingScheme>;
export const GradingSchemes = z.array(GradingScheme).max(12).refine((l) => new Set(l.map((s) => s.key)).size === l.length, 'Two schemes have the same key');

/**
 * The scheme for a mark: one for this subject and year group, else this subject, else this year group, else one for
 * everything, else the school's single scale (grading.scale and grading.passPct, which every school has).
 */
export function schemeFor(schemes: readonly GradingScheme[] | undefined, fallback: GradingScheme, at: { grade?: number | null; subject?: string | null } = {}): GradingScheme {
  const fits = (s: GradingScheme, bySubject: boolean, byGrade: boolean) =>
    (bySubject ? !!at.subject && !!s.subjects?.includes(at.subject) : !s.subjects?.length)
    && (byGrade ? at.grade != null && !!s.grades?.includes(at.grade) : !s.grades?.length);
  const list = schemes ?? [];
  return list.find((s) => fits(s, true, true)) ?? list.find((s) => fits(s, true, false)) ?? list.find((s) => fits(s, false, true)) ?? list.find((s) => fits(s, false, false)) ?? fallback;
}

/** What a percentage earns in a scheme: the grade, its points and descriptor where the scheme has them, and whether it passes. */
export function gradeIn(s: GradingScheme, pct: number): { grade: string; points: number | null; descriptor: string; pass: boolean } {
  const pass = pct >= s.passPct;
  if (s.kind === 'passfail') return { grade: pass ? tx('Pass') : tx('Fail'), points: null, descriptor: '', pass };
  const band = [...s.bands].sort((a, b) => b.minPct - a.minPct).find((b) => pct >= b.minPct);
  return { grade: band?.grade ?? '', points: s.kind === 'points' ? band?.points ?? 0 : null, descriptor: band?.descriptor ?? '', pass };
}

/** A grade point average of subjects' points, to two places (null when no subject earned points). */
export function gpaOf(points: readonly (number | null)[]): number | null {
  const got = points.filter((p): p is number => p !== null);
  return got.length ? Math.round((got.reduce((a, p) => a + p, 0) / got.length) * 100) / 100 : null;
}
