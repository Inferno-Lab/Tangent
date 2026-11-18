import { z } from 'zod';
import { FieldDef, checkCustom, type CustomValues } from './fields.js';
import { tx } from './i18n.js';

/**
 * The school's own forms (docs/one-shot-plan.md §3.6.3): consent forms, surveys, data-update requests, trip forms, feedback.
 * Built from the same field kinds as the school's own fields; a field can show only when another has a given answer. A form
 * is for families (in the app, once per child or once per family), for staff (in the app), or for anyone with its link.
 */
export const FORM_AUDIENCES = ['families', 'staff', 'link'] as const;
export type FormAudience = (typeof FORM_AUDIENCES)[number];
export const FORM_STATES = ['draft', 'open', 'closed'] as const;
export type FormState = (typeof FORM_STATES)[number];

/** Show a field only when another (earlier) field's answer is this ("yes" for a yes/no field, a choice's key). */
export const FormCondition = z.object({ key: z.string().min(1).max(32), equals: z.string().max(60) });
export type FormCondition = z.infer<typeof FormCondition>;

export const FormInput = z.object({
  title: z.string().trim().min(3, 'Name the form').max(100),
  intro: z.string().trim().max(1000).default(''),
  fields: z.array(FieldDef).min(1, 'Add a question').max(40).refine((l) => new Set(l.map((f) => f.key)).size === l.length, 'Two questions have the same key'),
  conditions: z.record(z.string(), FormCondition).default({}),
  audience: z.enum(FORM_AUDIENCES).default('families'),
  /** Families answer once for each child (a consent form), else once per family. */
  perChild: z.boolean().default(false),
  status: z.enum(FORM_STATES).default('draft'),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}).superRefine((f, ctx) => {
  // A condition points at an earlier question (no loops), and at an answer that question can give.
  for (const [key, c] of Object.entries(f.conditions)) {
    const at = f.fields.findIndex((x) => x.key === key);
    const on = f.fields.findIndex((x) => x.key === c.key);
    if (at < 0) ctx.addIssue({ code: 'custom', message: tx('A condition is for a question the form does not have.'), path: ['conditions', key] });
    else if (on < 0 || on >= at) ctx.addIssue({ code: 'custom', message: tx('A question can only depend on one before it.'), path: ['conditions', key] });
    else if (!['choice', 'multi', 'yesno'].includes(f.fields[on]!.kind)) ctx.addIssue({ code: 'custom', message: tx('A question can depend only on a choice or a yes/no question.'), path: ['conditions', key] });
  }
});
export type FormInput = z.infer<typeof FormInput>;

export interface FormRow extends FormInput {
  id: string;
  /** The link's secret part, for forms anyone with the link may fill. */
  token: string | null;
  responses: number;
  createdAt: string;
}
export interface FormResponseRow { id: string; by: string; studentName: string | null; answers: CustomValues; createdAt: string }

/** The questions that apply given the answers so far: each whose condition holds (a hidden question is not asked or kept). */
export function visibleFields(form: Pick<FormInput, 'fields' | 'conditions'>, answers: Record<string, unknown>): FieldDef[] {
  const shown = new Set<string>();
  const out: FieldDef[] = [];
  for (const f of form.fields) {
    const c = form.conditions[f.key];
    if (c) {
      if (!shown.has(c.key)) continue;
      const v = answers[c.key];
      const said = Array.isArray(v) ? v.map(String) : typeof v === 'boolean' ? [v ? 'yes' : 'no'] : v == null ? [] : [String(v).toLowerCase()];
      if (!said.includes(c.equals.toLowerCase())) continue;
    }
    shown.add(f.key);
    out.push(f);
  }
  return out;
}

/** Checks a response: the questions that apply, each as its kind says; answers to hidden or unknown questions are dropped. */
export function checkAnswers(form: Pick<FormInput, 'fields' | 'conditions'>, answers: Record<string, unknown>): { values: CustomValues; errors: Record<string, string> } {
  return checkCustom(visibleFields(form, answers), answers, true);
}

export const FormAnswer = z.object({
  answers: z.record(z.string().max(32), z.unknown()),
  studentId: z.string().max(40).nullable().default(null),
  /** Left empty by people; a robot filling every field gives itself away (link forms). */
  website: z.string().max(200).optional(),
});
export type FormAnswer = z.infer<typeof FormAnswer>;
