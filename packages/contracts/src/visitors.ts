import { z } from 'zod';
import type { ListItem } from './lists.js';

/**
 * Visitors, gate passes and pick-up (docs/one-shot-plan.md §6.23): the front desk signs visitors in and out (or staff invite
 * them ahead with a pass code), a student leaves early only on an approved gate pass, families name who may collect their
 * child and show a code at the gate, late arrivals are written down, and in an emergency everyone on site is one list.
 */
export const DEFAULT_VISITOR_PURPOSES: ListItem[] = [
  { key: 'meeting', name: 'Meeting a member of staff' }, { key: 'parent', name: 'Parent visit' }, { key: 'delivery', name: 'Delivery' },
  { key: 'contractor', name: 'Contractor or repair' }, { key: 'interview', name: 'Interview' }, { key: 'other', name: 'Other' },
];
export const DEFAULT_ID_TYPES: ListItem[] = [{ key: 'national', name: 'National identity card' }, { key: 'licence', name: 'Driving licence' }, { key: 'passport', name: 'Passport' }, { key: 'other', name: 'Other' }];

export const VISITOR_STATES = ['pending', 'invited', 'in', 'out', 'cancelled', 'declined'] as const;
export type VisitorState = (typeof VISITOR_STATES)[number];

const phone = z.string().trim().max(20).regex(/^[+\d][\d\s-]{5,19}$/, 'Give a phone number').or(z.literal(''));
export const VisitorInput = z.object({
  name: z.string().trim().min(2, 'Write the visitor’s name').max(80),
  phone: phone.default(''),
  purpose: z.string().min(1, 'Choose why they came').max(32),
  hostId: z.string().max(60).nullable().default(null),
  idType: z.string().max(32).default(''),
  idNumber: z.string().trim().max(40).default(''),
  photoFileId: z.string().max(60).nullable().default(null),
  vehicle: z.string().trim().max(20).default(''),
  note: z.string().trim().max(300).default(''),
  custom: z.record(z.string(), z.unknown()).default({}),
  /** An invitation for a later day (a pass code is sent); without it the visitor is signed in now. */
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});
export type VisitorInput = z.infer<typeof VisitorInput>;

export interface VisitorRow {
  id: string;
  name: string;
  phone: string;
  purpose: string;
  purposeName: string;
  hostId: string | null;
  hostName: string | null;
  idType: string;
  idNumber: string;
  photoFileId: string | null;
  vehicle: string;
  note: string;
  custom: Record<string, unknown>;
  badgeNo: string | null;
  code: string | null;
  state: VisitorState;
  expectedOn: string | null;
  inAt: string | null;
  outAt: string | null;
  createdBy: string;
}

export const GATE_PASS_STATES = ['consent', 'pending', 'approved', 'rejected', 'left', 'cancelled'] as const;
export type GatePassState = (typeof GATE_PASS_STATES)[number];
export const GatePassInput = z.object({
  studentId: z.string().min(1, 'Choose the student').max(60),
  /** When they leave, in the school's day (an ISO time with its offset). */
  leaveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3, 'Say why they leave early').max(300),
  /** Who collects them: one of the family's named people, or a name for the office to check. */
  pickupId: z.string().max(60).nullable().default(null),
  collector: z.string().trim().max(80).default(''),
  returns: z.boolean().default(false),
});
export type GatePassInput = z.infer<typeof GatePassInput>;

export interface GatePassRow {
  id: string;
  number: string | null;
  studentId: string;
  studentName: string;
  className: string;
  leaveAt: string;
  reason: string;
  collector: string;
  pickupId: string | null;
  returns: boolean;
  state: GatePassState;
  requestedBy: string;
  outAt: string | null;
  createdAt: string;
}

export const PickupInput = z.object({
  studentIds: z.array(z.string().max(60)).min(1, 'Choose the children they collect').max(10),
  name: z.string().trim().min(2, 'Write their name').max(80),
  relation: z.string().trim().min(2, 'Say who they are').max(40),
  phone: phone.default(''),
  photoFileId: z.string().max(60).nullable().default(null),
});
export type PickupInput = z.infer<typeof PickupInput>;

export interface PickupPerson { id: string; studentId: string; name: string; relation: string; phone: string; photoFileId: string | null; active: boolean }

export const PickupCheck = z.object({ code: z.string().trim().min(4).max(64) });
export const PickupRecord = z.object({ studentId: z.string().min(1).max(60), pickupId: z.string().max(60).nullable().default(null), name: z.string().trim().min(2, 'Write who collected them').max(80), code: z.string().trim().max(64).default('') });
export type PickupRecord = z.infer<typeof PickupRecord>;

export const LateInput = z.object({ studentId: z.string().min(1).max(60), reason: z.string().trim().max(200).default(''), at: z.string().datetime({ offset: true }).optional() });
export type LateInput = z.infer<typeof LateInput>;

/** Everyone on site now, for an emergency: students in school, staff in, visitors not yet out. */
export interface RollCall {
  at: string;
  students: { id: string; name: string; className: string }[];
  staff: { id: string; name: string }[];
  visitors: { id: string; name: string; hostName: string | null; inAt: string }[];
  /** Whether students' and staff's lists come from attendance marked today (else they are everyone expected). */
  marked: { students: boolean; staff: boolean };
}
