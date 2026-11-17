import { z } from 'zod';
import { isLanguage, localizedLabels } from './i18n.js';

/**
 * Steps and approvals (docs/one-shot-plan.md §3.6.1): each request the school decides goes through the school's own steps,
 * in order. One step (anyone allowed to decide that kind) is how every school starts; a school adds steps (the bursar, then
 * the principal for a large waiver), says who takes each one, and what happens when a step waits too long.
 */
export const WORKFLOW_PROCESSES = ['leave', 'fee_waiver', 'notice', 'admission', 'photo', 'receipt_cancel'] as const;
export type WorkflowProcess = (typeof WORKFLOW_PROCESSES)[number];
export const PROCESS_LABELS: Record<WorkflowProcess, string> = localizedLabels({
  leave: 'Leave requests', fee_waiver: 'Fee waivers and concessions', notice: 'Notices before they go out', admission: 'Admissions',
  photo: 'Photos families send', receipt_cancel: 'Cancelled receipts',
});

/** Who takes a step: whoever may decide the kind (its permissions), a role, one named person, or the child's class teacher. */
export const STEP_ACTORS = ['permission', 'role', 'person', 'classTeacher'] as const;
export const STEP_ACTOR_LABELS: Record<(typeof STEP_ACTORS)[number], string> = localizedLabels({
  permission: 'Anyone allowed to decide it', role: 'Someone with a role', person: 'One person', classTeacher: 'The child’s class teacher',
});
/** When a step waits longer than its days: remind whoever takes it, let anyone allowed to decide the kind take it, or approve it. */
export const STEP_TIMEOUTS = ['remind', 'escalate', 'approve'] as const;
export const STEP_TIMEOUT_LABELS: Record<(typeof STEP_TIMEOUTS)[number], string> = localizedLabels({
  remind: 'Remind them', escalate: 'Anyone allowed to decide may take it', approve: 'Approve it',
});

export const StepDef = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  name: z.string().trim().min(1, 'Name the step').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  who: z.enum(STEP_ACTORS).default('permission'),
  /** The role's key or the person's id, for `role` and `person`. */
  ref: z.string().max(40).optional(),
  /** The step is only needed when the request's amount is above this (in the currency's minor unit). */
  above: z.number().int().min(0).optional(),
  days: z.number().int().min(1).max(60).optional(),
  then: z.enum(STEP_TIMEOUTS).optional(),
}).refine((s) => !['role', 'person'].includes(s.who) || !!s.ref, { message: 'Choose who takes this step', path: ['ref'] });
export type StepDef = z.infer<typeof StepDef>;

const Steps = z.array(StepDef).min(1).max(6).refine((l) => new Set(l.map((s) => s.key)).size === l.length, 'Two steps have the same key').optional();
export const WorkflowsSetting = z.object(Object.fromEntries(WORKFLOW_PROCESSES.map((p) => [p, Steps])) as Record<WorkflowProcess, typeof Steps>);
export type WorkflowsSetting = z.infer<typeof WorkflowsSetting>;

export const DEFAULT_STEP: StepDef = { key: 'decide', name: 'Decide', who: 'permission' };

/** The steps a request goes through: the school's for its kind (those its amount calls for), else the one step every school starts with. */
export function stepsFor(setting: WorkflowsSetting | undefined, kind: string, amount?: number): StepDef[] {
  const own = (setting as Record<string, StepDef[] | undefined> | undefined)?.[kind];
  const steps = (own?.length ? own : [DEFAULT_STEP]).filter((s) => s.above === undefined || (amount ?? 0) > s.above);
  return steps.length ? steps : [DEFAULT_STEP];
}

/** One step taken: who, when, what they said. */
export interface StepDone { key: string; name: string; by: string; at: string; note: string }
