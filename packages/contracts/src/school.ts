import { ATTENDANCE_MARKS, type MenuGroup } from './config.js';
import { isLanguage, localizedLabels, type Vocabulary } from './i18n.js';
import { z } from 'zod';
import { Money } from './locale.js';
import { IsoDate } from './common.js';
import { CustomValues } from './fields.js';
import { AddressParts } from './address.js';
import type { StepDone } from './workflows.js';

export const AttendanceStatus = z.enum(ATTENDANCE_MARKS);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const FeeStatus = z.enum(['paid', 'due', 'overdue', 'partial']);
export type FeeStatus = z.infer<typeof FeeStatus>;

export interface ClassInfo {
  id: string;
  name: string;
  grade: number;
  section: string;
  studentCount: number;
  classTeacherId: string | null;
  classTeacherName: string | null;
}

export interface StudentRow {
  id: string;
  admissionNo: string;
  name: string;
  initials: string;
  classId: string;
  className: string;
  rollNo: string;
  house: string | null;
  guardianName: string;
  feeStatus: FeeStatus;
  amountDue: number;
  /** Last ten school days, oldest first. null means no school that day. */
  attendance10: (AttendanceStatus | null)[];
  attendancePct: number;
  status: 'active' | 'inactive';
}

export interface StudentDetail extends StudentRow {
  dob: string;
  bloodGroup: string | null;
  house: string | null;
  address: string | null;
  /** Masked. Use the reveal call for the full number; that is written to the audit log. */
  guardianPhone: string | null;
  guardianEmail: string | null;
  guardianName: string;
  routeName: string | null;
  facts: { attendancePct: number; exam: { name: string; grade: string; pct: number } | null; homework: { onTime: number; total: number }; libraryOut: number };
  chips: { house: string | null };
  admittedOn: string | null;
  recentActivity: { id: string; at: string; label: string; sub: string; tone: 'g' | 'v' | 'a' }[];
  roll24: (AttendanceStatus | null)[];
  /** The school's own fields (fields.custom.student), by key. */
  custom: CustomValues;
  addressParts: AddressParts;
  gender: string | null;
  givenName: string | null;
  familyName: string | null;
  nameLocal: string | null;
  feeCategory: string | null;
  /** When and why a student who left the school left (null while on the roll). */
  left: { on: string; reason: string; kind: LeavingKind; transferTo: string | null } | null;
  /** Every guardian (phones masked: the reveal call shows one in full). */
  guardians: GuardianRow[];
  /** The student's own app account (when the school uses the student role): how they sign in, and whether they have yet. */
  appAccount: { phone: string; email: string; lastSignIn: string | null } | null;
}

export const StudentQuery = z.object({
  query: z.string().trim().max(80).optional(),
  classId: z.string().optional(),
  house: z.string().max(20).optional(),
  feeStatus: z.enum(['paid', 'due', 'overdue']).optional(),
  attendance: z.enum(['low', 'perfect']).optional(),
  newThisYear: z.stringbool().optional(),
  /** Students who left the school, instead of those on the roll. */
  left: z.stringbool().optional(),
  sort: z.enum(['name', 'class', 'attendance', 'due']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
export type StudentQuery = z.infer<typeof StudentQuery>;

export interface StudentSummary {
  inView: number;
  total: number;
  /** Present or late, on the latest school day, among students in view. */
  presentToday: number;
  /** Students in view that have a mark on that day. */
  markedToday: number;
  /** Of those present, how many were marked after 09:00. */
  presentSince: number;
  overdueAmount: number;
  overdueFamilies: number;
  avgAttendance: number;
  /** Percentage points against the previous period of the same length. */
  avgDelta: number;
  dayLabel: string;
}

export interface StudentViews {
  all: number;
  pinned: { classId: string; name: string; count: number } | null;
  overdue: number;
  newThisYear: number;
  /** Students who left (kept until the retention period ends). */
  left: number;
}

export interface ContactReveal {
  phone: string;
  email: string | null;
}

export const StudentImport = z.object({ csv: z.string().min(10).max(25_000_000) });
export type StudentImport = z.infer<typeof StudentImport>;
export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

export const MessageRequest = z.object({
  ids: z.array(z.string()).min(1).max(500),
  body: z.string().trim().min(2, 'Write the message').max(500),
});
export type MessageRequest = z.infer<typeof MessageRequest>;

/** A fee head's key: one of the school's own fee heads (`/v1/fees/heads`). */
export const FeeHeadKey = z.string().regex(/^[a-z0-9_]{1,40}$/, 'Choose a kind of fee');

/** A kind of fee the school charges. The list is the school's own data, edited with its fee structures. */
export interface FeeHead { key: string; name: string; sort: number; concession: boolean }
export const FeeHeadsPut = z.object({
  heads: z.array(z.object({ key: FeeHeadKey.optional(), name: z.string().trim().min(2, 'Name the fee head').max(40), concession: z.boolean().default(false) })).min(1).max(30),
});
export type FeeHeadsPut = z.infer<typeof FeeHeadsPut>;

export const AssignFee = z.object({
  ids: z.array(z.string()).min(1).max(500),
  head: FeeHeadKey,
  title: z.string().trim().min(3, 'Name the fee').max(80),
  amount: Money(),
  dueOn: IsoDate,
});
export type AssignFee = z.infer<typeof AssignFee>;

/** The channels a school reaches families on, and which a guardian may turn off for themselves. */
export const CONTACT_CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** The fields of a student's record a school may require (console: People → fields the office must fill). */
export const STUDENT_FIELDS = ['gender', 'house', 'admissionNo', 'bloodGroup', 'address'] as const;
const StudentFields = {
  name: z.string().trim().min(2, 'Enter the full name').max(80),
  // Given and family names: when either is sent, the server writes `name` from both in the school's order (people.nameOrder).
  givenName: z.string().trim().max(60).optional(),
  familyName: z.string().trim().max(60).optional(),
  // The name in a second script (Arabic, Devanagari…), shown beside the name and found by search.
  nameLocal: z.string().trim().max(80).optional(),
  // A key of the school's fee categories (fees.categories); '' takes the student out of any.
  feeCategory: z.string().trim().max(32).optional(),
  classId: z.string().min(1, 'Choose a class'),
  rollNo: z.string().trim().max(10).optional(),
  dob: IsoDate,
  // A key of the school's lists.genders (the service checks it against the school's list).
  gender: z.string().trim().max(32).optional(),
  house: z.string().trim().max(24).optional(),
  admissionNo: z.string().trim().max(30).optional(),
  bloodGroup: z.string().trim().max(4).optional(),
  address: z.string().trim().max(200).optional(),
  // The address in the country's parts (people.addressFormat); the service writes `address` from them.
  addressParts: AddressParts.optional(),
  custom: CustomValues.optional(),
};
export const StudentCreate = z.object({
  ...StudentFields,
  // The full name, or a given and a family name to make it from.
  name: StudentFields.name.optional(),
  guardianName: z.string().trim().min(2).max(80),
  guardianPhone: z.string().trim().min(1, 'Enter a phone number').max(24),
}).refine((b) => !!b.name || (!!b.givenName && !!b.familyName), { message: 'Enter the full name, or the given and family names', path: ['name'] });
export type StudentCreate = z.infer<typeof StudentCreate>;
/** Changes to a student's own record; a change of class keeps their marks and attendance. */
export const StudentPatch = z.object(StudentFields).partial();
export type StudentPatch = z.infer<typeof StudentPatch>;
/** A student's guardians, all at once: who they are, which one is first, and who may collect the child. */
export const GuardiansPut = z.object({
  guardians: z.array(z.object({
    id: z.string().optional(), name: z.string().trim().min(2, 'Enter the name').max(80), phone: z.string().trim().min(1, 'Enter the phone number').max(24),
    email: z.string().trim().email('Check the email').max(120).or(z.literal('')).optional(), relation: z.string().trim().min(1, 'Choose how they are related').max(30), canCollect: z.boolean(), isPrimary: z.boolean(),
    language: z.string().refine((l) => !l || isLanguage(l), 'Pick a language from the list').optional(),
    // Separated parents: each guardian can get the messages, the bills, both or neither. Left out: only the first one does.
    getsMessages: z.boolean().optional(),
    getsBills: z.boolean().optional(),
    // Channels this guardian asked not to be reached on; a message always keeps at least one of the school's channels.
    channelsOff: z.array(z.enum(CONTACT_CHANNELS)).max(4).optional(),
  })).min(1, 'A student needs at least one guardian').max(4),
}).refine((b) => b.guardians.filter((g) => g.isPrimary).length === 1, { message: 'Choose one guardian to contact first.', path: ['guardians'] })
  .refine((b) => b.guardians.some((g) => g.getsMessages ?? g.isPrimary), { message: 'Choose at least one guardian to get the school’s messages.', path: ['guardians'] })
  .refine((b) => b.guardians.some((g) => g.getsBills ?? g.isPrimary), { message: 'Choose at least one guardian to get the bills.', path: ['guardians'] });
export type GuardiansPut = z.infer<typeof GuardiansPut>;
export interface GuardianRow {
  id: string; name: string; phone: string; email: string; relation: string; canCollect: boolean; isPrimary: boolean; hasApp: boolean; /** The language they read; '' for the school's own. */ language: string;
  getsMessages: boolean; getsBills: boolean; channelsOff: ContactChannel[];
}

/** A full name from a given and a family name, in the school's order (people.nameOrder). */
export function composeName(given: string, family: string, order: 'given-family' | 'family-given' = 'given-family'): string {
  const [a, b] = order === 'family-given' ? [family, given] : [given, family];
  return `${a.trim()} ${b.trim()}`.trim();
}

/** Why a student left: the school's records and reports (and, for graduates, its alumni) count them apart. */
export const LEAVING_KINDS = ['withdrawn', 'transferred', 'graduated', 'other'] as const;
export type LeavingKind = (typeof LEAVING_KINDS)[number];
export const LEAVING_KIND_LABELS: Record<LeavingKind, string> = localizedLabels({ withdrawn: 'Withdrawn', transferred: 'Moved to another school', graduated: 'Finished school', other: 'Other' });

/** Leave the office records itself (a long illness, a family move abroad): approved at once, the roll call starts with it. */
export const StudentLeaveInput = z.object({
  from: IsoDate, to: IsoDate,
  halfDay: z.enum(['am', 'pm']).optional(),
  reason: z.string().trim().min(2, 'Give a reason').max(200),
});
export type StudentLeaveInput = z.infer<typeof StudentLeaveInput>;

export const BulkStudentAction = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(['remind-fees', 'message', 'export']),
});
export type BulkStudentAction = z.infer<typeof BulkStudentAction>;

// Attendance
/** A roll call is for the whole day, or for its morning or afternoon where the school keeps two registers. */
export const REGISTER_PARTS = ['day', 'am', 'pm'] as const;
export type RegisterPart = (typeof REGISTER_PARTS)[number];

export const AttendanceDayPut = z.object({
  classId: z.string(),
  date: IsoDate,
  /** Left out: the whole day, or the half it is now where the school keeps two registers. */
  part: z.enum(REGISTER_PARTS).optional(),
  /** Each a mark the school uses (attendance.statuses), by its key. */
  marks: z.array(z.object({ studentId: z.string(), status: z.string().min(1).max(24) })).min(1).max(200),
});
export type AttendanceDayPut = z.infer<typeof AttendanceDayPut>;

export interface AttendanceDay {
  classId: string;
  date: string;
  /** Which register this is, and which the school keeps (['day'], or ['am', 'pm']). */
  part: RegisterPart;
  parts: RegisterPart[];
  submitted: boolean;
  /** onLeave: an approved leave covers the day; until the roll is taken its mark is filled in from the leave. */
  /** status: the school's mark (its key); null until the roll is taken. */
  marks: { studentId: string; name: string; rollNo: string; status: string | null; onLeave: boolean }[];
}

/** Attendance every period (feature attendance.periodWise): only present, late and absent; leave comes from the day. */
export const PERIOD_MARKS = ['present', 'late', 'absent'] as const;
export const PeriodMarksPut = z.object({
  classId: z.string(),
  date: IsoDate,
  period: z.number().int().min(0).max(30),
  marks: z.array(z.object({ studentId: z.string(), status: z.enum(PERIOD_MARKS) })).min(1).max(200),
});
export type PeriodMarksPut = z.infer<typeof PeriodMarksPut>;

/** One day's periods for a class: who teaches each, whether it was marked, and each student's mark. */
export interface PeriodRoll {
  classId: string;
  date: string;
  students: { studentId: string; name: string; rollNo: string; day: string | null }[];
  periods: {
    period: number; label: string; startsAt: string; endsAt: string; subject: string; teacherId: string; teacherName: string;
    /** Whether the person asking may mark it: the period's teacher (or its cover), or someone who approves requests. */
    mine: boolean;
    markedBy: string | null;
    marks: Record<string, (typeof PERIOD_MARKS)[number]>;
  }[];
}

export interface AttendanceWeekPoint {
  date: string;
  label: string;
  present: number;
  total: number;
  pct: number;
  previousPct: number | null;
  isToday: boolean;
}

// Fees
export interface FeeSummary {
  monthLabel: string;
  due: number;
  collected: number;
  pending: number;
  overdue: number;
  overdueFamilies: number;
  pct: number;
  collectedDelta: number;
  byHead: { head: string; label: string; due: number; collected: number; pct: number }[];
  daily: { date: string; label: string; full: string; amount: number; isToday: boolean }[];
  dailyTarget: number;
}

export const PaymentCreate = z.object({
  studentId: z.string(),
  invoiceId: z.string(),
  amount: Money(),
  /** One of the school's own payment methods (fees.paymentMethods). */
  method: z.string().regex(/^[a-z0-9-]{1,24}$/, 'Choose how it was paid'),
  reference: z.string().trim().max(60).optional(),
});
export type PaymentCreate = z.infer<typeof PaymentCreate>;

export interface InvoiceRow {
  id: string;
  studentId: string;
  title: string;
  amount: number;
  paid: number;
  dueOn: string;
  status: FeeStatus;
}

/** One invoice opened: what it is for, every payment against it, and any waiver asked for or given. */
export interface InvoiceDetail extends InvoiceRow {
  studentName: string;
  className: string;
  head: string;
  headName: string;
  waived: number;
  outstanding: number;
  payments: { id: string; receiptNo: string; amount: number; refunded: number; method: string; paidOn: string; cancelled: boolean; cancelReason: string }[];
  /** A waiver or cancellation waiting for a second person, if any. */
  pending: { id: string; title: string } | null;
}
/** Asks for part of an invoice to be waived, or all of what is left of it (cancel); a second person decides in Approvals. */
export const WaiverRequest = z.object({ amount: Money(), reason: z.string().trim().min(3, 'Say why').max(300), cancel: z.boolean().default(false) });
export type WaiverRequest = z.infer<typeof WaiverRequest>;
export const ReceiptCancel = z.object({ reason: z.string().trim().min(3, 'Say why').max(300) });
export type ReceiptCancel = z.infer<typeof ReceiptCancel>;

// Notices
/**
 * A notice as written in the admin or the teachers' app. Who it goes to: everyone, parents, students, staff, or one class.
 * Writing to the whole school needs notices.publish, pinning needs notices.pin; anyone else writes to their own classes.
 */
export const NoticeCreate = z.object({
  title: z.string().trim().min(3, 'Give the notice a title').max(120),
  body: z.string().trim().min(3, 'Write the notice').max(4000),
  audience: z.enum(['everyone', 'parents', 'students', 'staff', 'class']).default('everyone'),
  classId: z.string().optional(),
  /** One of the school's notice categories. */
  category: z.string().trim().min(1).max(24).default('academic'),
  pinned: z.boolean().default(false),
  needsAck: z.boolean().default(false),
  /** Publish now (true), keep as a draft (false); with publishAt, it goes out then instead. */
  publish: z.boolean().default(false),
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
  fileIds: z.array(z.string()).max(5).default([]),
}).refine((n) => n.audience !== 'class' || !!n.classId, { message: 'Choose the class', path: ['classId'] });
export type NoticeCreate = z.infer<typeof NoticeCreate>;

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  audience: string;
  classId: string | null;
  className: string | null;
  category: string;
  pinned: boolean;
  needsAck: boolean;
  status: 'draft' | 'pending' | 'scheduled' | 'published';
  author: string;
  authorId: string | null;
  publishedAt: string | null;
  publishAt: string | null;
  editedAt: string | null;
  createdAt: string;
  files: { id: string; name: string; mime: string }[];
  /** For a published notice: how many it reached, how many opened it, and (when asked) acknowledged it. */
  reach: { audience: number; read: number; acked: number };
}

// Approvals
export type ApprovalKind = 'leave' | 'fee_waiver' | 'admission' | 'notice' | 'attendance' | 'photo' | 'receipt_cancel' | 'settings';
export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  title: string;
  subtitle: string;
  initials: string;
  tone: 'coral' | 'amber' | 'blue' | 'mint' | 'violet';
  /** Button label, and the line shown after it is done. */
  action: string;
  doneText: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  createdAt: string;
  decidedAt: string | null;
  /** Who asked, and who decided with the reason they gave (a decline always has one). */
  requesterName?: string;
  decidedByName?: string | null;
  decisionNote?: string;
  /** Where it is in the school's steps (§3.6.1): the step waiting now, how many there are, and the ones already taken. */
  step?: { name: string; at: number; of: number; done: StepDone[] };
}
export const ApprovalDecision = z.object({ decision: z.enum(['approve', 'reject', 'undo']), note: z.string().trim().max(300).optional() })
  .refine((d) => d.decision !== 'reject' || !!d.note, { message: 'Say why, so the person who asked knows what to do next.', path: ['note'] });
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

// Timetable
export interface PeriodDef {
  idx: number;
  label: string;
  starts: string;
  ends: string;
  kind: 'period' | 'break' | 'lunch';
}
export interface SlotRow {
  id: string;
  classId: string;
  day: number;
  period: number;
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  teacherId: string;
  teacherName: string;
  room: string | null;
  substituteId: string | null;
  substituteName: string | null;
}
export interface Clash {
  id: string;
  /** A teacher in two classes at once, or two classes in one room (teacherId and teacherName then name the room). */
  kind: 'teacher' | 'room';
  teacherId: string;
  teacherName: string;
  day: number;
  period: number;
  slotIds: string[];
  classNames: string[];
  suggestion: { teacherId: string; teacherName: string; reason: string } | null;
}
export interface TimetableView {
  classId: string;
  className: string;
  periods: PeriodDef[];
  /** The days of the school's cycle the grid shows, in order, and the one today is (null when the school is closed). */
  days: TimetableDay[];
  today: number | null;
  /** Times that differ from the periods' own on some day (for every class or this one), by `${day}|${period}`. */
  times: Record<string, { starts: string; ends: string }>;
  slots: SlotRow[];
  clashes: Clash[];
  unplaced: { subjectId: string; name: string; color: string; missing: number }[];
  publishedAt: string | null;
  draftChanges: number;
  version: number;
}
export const SlotPatch = z.object({
  subjectId: z.string().optional(),
  teacherId: z.string().optional(),
  room: z.string().max(20).nullable().optional(),
});
export type SlotPatch = z.infer<typeof SlotPatch>;
/** Puts a lesson in a free period of a class. */
// `day` is a timetable day of the school's cycle (1–7 for a week, 1–14 for A/B weeks, 1–N for a cycle of days).
export const SlotCreate = z.object({ classId: z.string().min(1), day: z.number().int().min(1).max(14), period: z.number().int().min(0), subjectId: z.string().min(1, 'Choose a subject'), teacherId: z.string().min(1, 'Choose a teacher'), room: z.string().max(20).nullable().optional() });
export type SlotCreate = z.infer<typeof SlotCreate>;
/** One teacher's or one room's week, across classes. */
export interface WeekOf { title: string; periods: PeriodDef[]; days: TimetableDay[]; slots: (SlotRow & { className: string })[] }
/** A timetable day of the school's cycle, as the grids show it. */
export interface TimetableDay { day: number; key: string; week?: 'a' | 'b'; n?: number }

/** A room the school timetables and books (Timetable → Rooms). */
export interface RoomRow { id: string; name: string; capacity: number | null; note: string; bookable: boolean; lessons: number }
export const RoomSave = z.object({
  name: z.string().trim().min(1, 'Name the room').max(20),
  capacity: z.number().int().min(1).max(5000).nullable().optional(),
  note: z.string().trim().max(120).default(''),
  bookable: z.boolean().default(true),
});
export type RoomSave = z.infer<typeof RoomSave>;
/** A room's day: its lessons from the timetable and the bookings made for it. */
export interface RoomDay { room: RoomRow; date: string; lessons: { start: string; end: string; label: string }[]; bookings: RoomBookingRow[] }
export interface RoomBookingRow { id: string; roomId: string; date: string; start: string; end: string; purpose: string; bookedBy: string; mine: boolean }
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 14:30');
export const RoomBookingCreate = z.object({ roomId: z.string().min(1), date: IsoDate, start: HHMM, end: HHMM, purpose: z.string().trim().min(2, 'Say what it is for').max(120) })
  .refine((b) => b.end > b.start, { message: 'It must end after it starts', path: ['end'] });
export type RoomBookingCreate = z.infer<typeof RoomBookingCreate>;
/** A period's times on one timetable day, for every class or for one (a short Friday, the youngest leaving early). */
export const PeriodTimesPut = z.object({
  day: z.number().int().min(1).max(14),
  classId: z.string().min(1).nullable(),
  times: z.array(z.object({ period: z.number().int().min(0), starts: HHMM, ends: HHMM }).refine((x) => x.ends > x.starts, { message: 'A period must end after it starts', path: ['ends'] })).max(20),
});
export type PeriodTimesPut = z.infer<typeof PeriodTimesPut>;
export interface PeriodTimesRow { day: number; classId: string | null; period: number; starts: string; ends: string }
export const CoverRequest = z.object({ slotId: z.string(), teacherId: z.string(), date: IsoDate.optional() });
export type CoverRequest = z.infer<typeof CoverRequest>;
export interface TeacherLoad {
  teacherId: string;
  name: string;
  periodsPerWeek: number;
  max: number;
  subjects: string[];
}

export interface TeacherOption {
  id: string;
  name: string;
  subjects: string[];
  load: number;
  max: number;
  /** Not teaching another class in the period being changed. */
  free: boolean;
}

// Dashboard
export interface DashboardData {
  /** Modules the school has: the dashboard shows only their tiles, charts and actions (their numbers are not sent at all). */
  modules: string[];
  greetingName: string;
  roleLabel: string;
  schoolName: string;
  /** The latest school day shown, and whether it is today. */
  day: { date: string; label: string; isToday: boolean; clock: string };
  /** The term today is in (empty when the calendar has none) and the next exam (empty label and null days when none is scheduled). */
  term: { name: string; examsLabel: string; daysToGo: number | null; progress: number };
  subtitle: { marked: number; classes: number };
  present: { value: number; total: number; deltaPct: number; versus: string };
  fees: { collected: number; due: number; pct: number; deltaPct: number; overdueFamilies: number; monthLabel: string };
  approvals: { count: number; avatars: { initials: string; tone: ApprovalRow['tone'] }[] };
  charts: {
    attendance: { goal: number; points: AttendanceWeekPoint[] };
    fees: { goal: number; points: { date: string; label: string; full: string; amount: number; isToday: boolean }[] };
    homework: { goal: number; points: { date: string; label: string; full: string; pct: number; isToday: boolean }[] };
  };
  feeHeads: FeeSummary['byHead'];
  classRolls: { classId: string; name: string; present: number; late: number; absent: number; unmarked: number; size: number; pct: number }[];
  needsYou: ApprovalRow[];
  timeline: { id: string; time: string; title: string; subtitle: string; state: 'done' | 'now' | 'next' }[];
  timelineProgress: number;
  badges: { attendance: number; admissions: number; messages: number };
}

/** What the menu needs on every page: who the school is, the term card, and the counts beside menu items. */
export interface ShellData {
  school: { name: string; shortName: string; logoText: string; logoUrl: string | null; place: string; color: string; address: string; phone: string; receiptNote: string; paymentMethods: { key: string; name: string; kind: string }[] };
  term: DashboardData['term'];
  badges: DashboardData['badges'];
  modules: string[];
  /** Features inside those modules (like people.admissions): pages and menu items for a missing one are hidden. */
  features: string[];
  /** The menu for this person, built from the module definitions (config-engine `adminMenu`). */
  menu: MenuGroup[];
  /** The seed hue (0–359) of the school's colours, from its brand colour. */
  hue: number;
  /** Where the school is and how it writes dates, numbers and money (locale.ts): every page formats with these. */
  locale: SchoolLocale;
}

export interface SchoolLocale {
  country: string; zone: string; locale: string; currency: string;
  /** The school's language (the person's own choice comes first once they make one) and its own words (i18n.ts). */
  language?: string; vocab?: Vocabulary;
}

// Search (command palette)
export interface SearchHit {
  group: 'People' | 'Go to' | 'Actions';
  title: string;
  hint: string;
  href: string;
  keys?: string;
}

// Audit
export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}
