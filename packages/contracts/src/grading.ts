import { z } from 'zod';
import { isLanguage, localizedLabels, tx } from './i18n.js';

/**
 * Grading and assessment schemes (docs/one-shot-plan.md §3.6.6): a school grades the way its curriculum does, and may grade
 * differently by year group or subject (letters in the primary years, 9 to 1 for GCSE, IB's 1 to 7, a GPA in the high school).
 * A scheme is percentage bands; a band may carry points (for a GPA or CGPA) and a descriptor (Secure, Exceeding). A pass or
 * fail scheme only says whether the mark reached the pass mark.
 */
export const SCHEME_KINDS = ['bands', 'points', 'passfail', 'rubric'] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];
export const SCHEME_KIND_LABELS: Record<SchemeKind, string> = localizedLabels({ bands: 'Grades by percentage', points: 'Grades with points (GPA)', passfail: 'Pass or fail', rubric: 'Criteria and levels (rubric)' });

export const GradeBand = z.object({
  grade: z.string().trim().min(1).max(6),
  minPct: z.number().min(0).max(100),
  points: z.number().min(0).max(100).optional(),
  descriptor: z.string().trim().max(40).optional(),
});
export type GradeBand = z.infer<typeof GradeBand>;

/** One criterion of a rubric: its name ("A: Knowing and understanding") and its top level. */
export const RubricCriterion = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,16}$/), name: z.string().trim().min(1).max(60), max: z.number().int().min(1).max(100) });
export type RubricCriterion = z.infer<typeof RubricCriterion>;

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
  /** How a teacher enters it: marks (graded by percentage), or the grade itself (early years, descriptors). */
  entry: z.enum(['marks', 'grade']).optional(),
  /** A rubric's criteria: a level for each is entered, and the grade comes from their total as a percentage of the most. */
  criteria: z.array(RubricCriterion).max(12).optional(),
}).refine((s) => s.kind === 'passfail' || s.bands.length > 0, { message: 'Add the grades', path: ['bands'] })
  .refine((s) => s.kind !== 'rubric' || (s.criteria?.length ?? 0) > 0, { message: 'Add the criteria', path: ['criteria'] })
  .refine((s) => new Set((s.criteria ?? []).map((c) => c.key)).size === (s.criteria ?? []).length, { message: 'Two criteria have the same key', path: ['criteria'] })
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

/**
 * A grade given straight away, as a percentage for totals and averages: the bottom of its band (a pass or fail as the pass
 * mark or 0); null when it is not one of the scheme's grades.
 */
export function pctOfGrade(s: GradingScheme, grade: string): number | null {
  if (s.kind === 'passfail') return grade === tx('Pass') || grade.toLowerCase() === 'pass' ? s.passPct : grade === tx('Fail') || grade.toLowerCase() === 'fail' ? 0 : null;
  return s.bands.find((b) => b.grade.toLowerCase() === grade.toLowerCase())?.minPct ?? null;
}

/** The grades a teacher picks from in a scheme entered by grade. */
export const gradesOf = (s: GradingScheme): string[] => (s.kind === 'passfail' ? [tx('Pass'), tx('Fail')] : [...s.bands].sort((a, b) => b.minPct - a.minPct).map((b) => b.grade));

/** A grade point average of subjects' points, to two places (null when no subject earned points). */
/** A percentage rounded the school's way (results.rounding): to the nearest, always up or always down, to so many decimals. */
export function roundPct(pct: number, mode: 'nearest' | 'up' | 'down' = 'nearest', decimals = 0): number {
  const f = 10 ** decimals;
  // The small nudge keeps 84.999999 (floating point for 85) from rounding down.
  const x = pct * f;
  const r = mode === 'up' ? Math.ceil(x - 1e-9) : mode === 'down' ? Math.floor(x + 1e-9) : Math.round(x + 1e-9 * Math.sign(x));
  return r / f;
}

/** The marks that count when only the best `n` of them do (0 or more than there are: all of them). */
export function bestOf<T>(items: readonly T[], n: number | undefined, score: (x: T) => number): T[] {
  return !n || n >= items.length ? [...items] : [...items].sort((a, b) => score(b) - score(a)).slice(0, n);
}

export function gpaOf(points: readonly (number | null)[]): number | null {
  const got = points.filter((p): p is number => p !== null);
  return got.length ? Math.round((got.reduce((a, p) => a + p, 0) / got.length) * 100) / 100 : null;
}
