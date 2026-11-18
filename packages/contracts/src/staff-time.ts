import { z } from 'zod';
import { isLanguage, localizedLabels } from './i18n.js';
import { addDays } from './dates.js';

/**
 * Staff attendance and leave (docs/one-shot-plan.md §6.3): the office marks the day, or staff check in from the app within
 * the school's window (and near the school, where it sets a radius); leave is asked for in the app, goes through the school's
 * steps (`staff_leave`), and counts against the year's balance of its type.
 */
export const LeaveType = z.object({
  key: z.string().regex(/^[A-Za-z0-9+\-_]{1,32}$/, 'Keys use letters, digits, + - and _'),
  name: z.string().trim().min(1, 'Name the leave type').max(40),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(40)).optional(),
  active: z.boolean().optional(),
  /** Days a year; 0 keeps no balance (unpaid leave, leave on duty). */
  days: z.number().min(0).max(366).default(0),
  /** All the year's days from its first day, or a twelfth of them as each month starts. */
  accrual: z.enum(['year', 'month']).default('year'),
  /** Days left over that carry into the next year, at most. */
  carry: z.number().min(0).max(366).default(0),
  halfDays: z.boolean().default(true),
  paid: z.boolean().default(true),
});
export type LeaveType = z.infer<typeof LeaveType>;
export const LeaveTypes = z.array(LeaveType).min(1).max(20).refine((l) => new Set(l.map((i) => i.key)).size === l.length, 'Two leave types have the same key');
export const DEFAULT_LEAVE_TYPES: LeaveType[] = [
  { key: 'casual', name: 'Casual leave', days: 12, accrual: 'year', carry: 0, halfDays: true, paid: true },
  { key: 'sick', name: 'Sick leave', days: 10, accrual: 'year', carry: 0, halfDays: true, paid: true },
  { key: 'earned', name: 'Earned leave', days: 15, accrual: 'month', carry: 30, halfDays: false, paid: true },
  { key: 'unpaid', name: 'Unpaid leave', days: 0, accrual: 'year', carry: 0, halfDays: true, paid: false },
];
export const LEAVE_ACCRUAL_LABELS = localizedLabels({ year: 'All at the start of the year', month: 'A twelfth each month' });

/** Staff check in from the app, or only the office marks the day. */
export const STAFF_CHECK_IN = ['app', 'office'] as const;
export const STAFF_CHECK_IN_LABELS = localizedLabels({ app: 'Staff check in from the app', office: 'Only the office marks staff' });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day');
export const StaffLeaveInput = z.object({
  type: z.string().min(1, 'Choose a type of leave').max(32),
  from: day,
  to: day,
  halfDay: z.enum(['am', 'pm']).nullable().default(null),
  reason: z.string().trim().max(500).default(''),
  /** The office records leave for someone (approved at once); in the app it is always the person asking. */
  userId: z.string().max(60).optional(),
});
export type StaffLeaveInput = z.infer<typeof StaffLeaveInput>;

export const StaffMarksPut = z.object({
  marks: z.array(z.object({ userId: z.string().min(1).max(60), status: z.string().min(1).max(24).nullable(), note: z.string().trim().max(200).default('') })).min(1).max(1000),
});
export type StaffMarksPut = z.infer<typeof StaffMarksPut>;

export const CheckInInput = z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).max(100000).optional() });
export type CheckInInput = z.infer<typeof CheckInInput>;

export const LeaveAdjustInput = z.object({
  userId: z.string().min(1).max(60),
  type: z.string().min(1).max(32),
  /** Whole or half days; negative takes days away. */
  days: z.number().min(-366).max(366).refine((n) => n !== 0 && Number.isInteger(n * 2), 'Use whole or half days'),
  note: z.string().trim().min(3, 'Say why').max(200),
});
export type LeaveAdjustInput = z.infer<typeof LeaveAdjustInput>;

export interface StaffDayRow {
  userId: string;
  name: string;
  designation: string;
  /** The mark's key, or null while nobody marked the day. */
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  late: boolean;
  early: boolean;
  source: 'office' | 'app' | 'device' | null;
  note: string;
  /** Approved leave that covers the day. */
  leave: { type: string; typeName: string; half: 'am' | 'pm' | null } | null;
  /** Lessons they teach that day (to arrange cover when they are away). */
  lessons: number;
}

export interface LeaveBalance {
  type: string;
  name: string;
  paid: boolean;
  halfDays: boolean;
  /** Days given so far this year (all of them, or the months started so far). */
  allowance: number;
  carried: number;
  adjusted: number;
  used: number;
  pending: number;
  /** What can still be asked for; null when the type keeps no balance. */
  available: number | null;
}

export interface StaffLeaveRow {
  id: string;
  userId: string;
  name: string;
  type: string;
  typeName: string;
  from: string;
  to: string;
  halfDay: 'am' | 'pm' | null;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decisionNote: string;
  decidedBy: string | null;
  createdAt: string;
}

export interface StaffMonthRow {
  userId: string;
  name: string;
  schoolDays: number;
  present: number;
  late: number;
  early: number;
  absent: number;
  leavePaid: number;
  leaveUnpaid: number;
  unmarked: number;
}

/** What the app shows a member of staff about their own day, balances and requests. */
export interface MyStaffDay {
  today: string;
  closed: boolean;
  checkIn: string | null;
  checkOut: string | null;
  late: boolean;
  early: boolean;
  status: string | null;
  leave: StaffDayRow['leave'];
  /** Whether the check-in button works now, and if not why. */
  canCheckIn: boolean;
  why: string;
  window: { from: string; until: string; lateAfter: string };
  needsPlace: boolean;
  balances: LeaveBalance[];
  requests: StaffLeaveRow[];
  types: { key: string; name: string; halfDays: boolean }[];
}

/** Leave days between two dates: each day the school is open, half of one when asked for half a day. */
export function leaveDays(from: string, to: string, halfDay: 'am' | 'pm' | null, closed: (d: string) => boolean): number {
  if (halfDay) return closed(from) ? 0 : 0.5;
  let n = 0;
  for (let d = from; d <= to && n < 400; d = addDays(d, 1)) if (!closed(d)) n++;
  return n;
}

/**
 * A type's balance for a year: its days (a twelfth a month started when it accrues monthly, to the half day), what carried
 * from last year (at most `carry`, never below nothing), the office's adjustments, less what was taken.
 */
export function leaveBalance(type: LeaveType, b: { monthsStarted: number; lastYearLeft: number | null; adjusted: number; used: number; pending: number }): Omit<LeaveBalance, 'type' | 'name' | 'paid' | 'halfDays'> {
  const allowance = type.accrual === 'month' ? Math.floor((type.days * Math.min(12, Math.max(0, b.monthsStarted)) / 12) * 2) / 2 : type.days;
  const carried = type.carry && b.lastYearLeft !== null ? Math.min(type.carry, Math.max(0, b.lastYearLeft)) : 0;
  const available = type.days || carried || b.adjusted ? allowance + carried + b.adjusted - b.used - b.pending : null;
  return { allowance, carried, adjusted: b.adjusted, used: b.used, pending: b.pending, available };
}

/** Metres between two points on the earth (the check-in radius). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** "12.97, 77.59" as a point, or null when it is not one. */
export function readPlace(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
