import { z } from 'zod';
import type { AppMode } from './theme.js';
import { COUNTRIES, isCurrency, isLocale, isZone } from './locale.js';
import { localizedLabels, VOCAB_CONCEPTS, isLanguage, type Vocabulary } from './i18n.js';
import { DEFAULT_BLOOD_GROUPS, DEFAULT_GENDERS, DEFAULT_RELATIONSHIPS, schoolList } from './lists.js';
import { CustomFieldsSetting } from './fields.js';
import { WorkflowsSetting } from './workflows.js';
import { AddressFormat, DEFAULT_ADDRESS_FORMAT } from './address.js';
import { GradingSchemes } from './grading.js';
import { DocTemplates } from './templates.js';


/** Attendance marks the data model knows; a school picks which it uses (`attendance.statuses`). */
/**
 * What an attendance mark means: every count and percentage works on these, whatever the school calls its marks. `leave` is
 * an authorised absence (on leave, medical, a school trip elsewhere); `absent` is one that was not authorised.
 */
export const ATTENDANCE_MARKS = ['present', 'absent', 'late', 'half_day', 'leave'] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];
export const MARK_MEANING_LABELS: Record<AttendanceMark, string> = localizedLabels({ present: 'Present', late: 'Late', half_day: 'Half day', leave: 'Away, authorised', absent: 'Absent, not authorised' });

/** One of the school's own attendance marks: its name, what it means, and the code it is written as (a register's letter). */
export const AttendanceMarkDef = z.object({
  key: z.string().regex(/^[a-z0-9-_]{1,24}$/),
  name: z.string().trim().min(1, 'Name the mark').max(30),
  meaning: z.enum(ATTENDANCE_MARKS),
  code: z.string().trim().max(3).default(''),
});
export type AttendanceMarkDef = z.infer<typeof AttendanceMarkDef>;
const OLD_MARKS: Record<string, [string, string]> = { present: ['Present', 'P'], absent: ['Absent', 'A'], late: ['Late', 'L'], half_day: ['Half day', 'H'], leave: ['On leave', 'V'] };
const AttendanceMarks = z.preprocess(
  (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { key: x, name: OLD_MARKS[x]?.[0] ?? x, meaning: x, code: OLD_MARKS[x]?.[1] ?? '' } : x)) : v),
  z.array(AttendanceMarkDef).min(2).max(20)
    .refine((l) => l.some((m) => m.meaning === 'present') && l.some((m) => m.meaning === 'absent'), 'Keep at least one mark for present and one for absent')
    .refine((l) => new Set(l.map((m) => m.key)).size === l.length, 'Two marks have the same key'),
);
export const DEFAULT_ATTENDANCE_MARKS: AttendanceMarkDef[] = [
  { key: 'present', name: 'Present', meaning: 'present', code: 'P' }, { key: 'absent', name: 'Absent', meaning: 'absent', code: 'A' },
  { key: 'late', name: 'Late', meaning: 'late', code: 'L' }, { key: 'leave', name: 'On leave', meaning: 'leave', code: 'V' },
];
/** The meaning of a mark the school uses; a meaning's own name (an app sending "present") stands for the first mark with it. */
export function markMeaning(marks: readonly AttendanceMarkDef[], key: string): AttendanceMark | null {
  return marks.find((m) => m.key === key)?.meaning ?? ((ATTENDANCE_MARKS as readonly string[]).includes(key) && marks.some((m) => m.meaning === key) ? (key as AttendanceMark) : null);
}

/** A category of notices or events: its name, and the tone (a theme colour pair) it is drawn in. */
export const CATEGORY_TONES = ['v', 'g', 'a', 'c'] as const;
export const CATEGORY_TONE_LABELS: Record<(typeof CATEGORY_TONES)[number], string> = localizedLabels({ v: 'Violet', g: 'Green', a: 'Amber', c: 'Coral' });
const CATEGORY = z.object({ key: z.string().regex(/^[a-z0-9-]{1,24}$/), name: z.string().trim().min(1).max(24), tone: z.enum(CATEGORY_TONES) });
export type Category = z.infer<typeof CATEGORY>;

/** The app's roles (config-engine's APP_ROLES is the same list). */
export const APP_ROLE_KEYS = ['parent', 'student', 'teacher', 'driver'] as const;
export type AppRoleKey = (typeof APP_ROLE_KEYS)[number];
const APP_LAYOUT = z.object({ dock: z.array(z.string()).max(4), home: z.array(z.string()).max(12), quick: z.array(z.string()).max(6) });
export type AppLayout = z.infer<typeof APP_LAYOUT>;
export const DEFAULT_APP_LAYOUT: Record<AppRoleKey, AppLayout> = {
  parent: { dock: ['home', 'academics', 'fees', 'chat'], home: ['dayRibbon', 'dueStack', 'attendance', 'nextExam', 'homework', 'notices', 'events'], quick: ['payFees', 'applyLeave', 'messageTeacher', 'timetable'] },
  student: { dock: ['home', 'homework', 'timetable', 'chat'], home: ['dayRibbon', 'homework', 'nextExam', 'notices', 'events'], quick: ['homework', 'timetable', 'events'] },
  teacher: { dock: ['home', 'classes', 'timetable', 'chat'], home: ['dayRibbon', 'notices', 'events'], quick: ['markAttendance', 'assignHomework', 'grade', 'postNotice'] },
  driver: { dock: ['home', 'trips', 'chat'], home: [], quick: [] },
};

/** Every setting a school can change (config layer 4). Defaults here are the platform defaults (layer 1). */
/** Whether a number-series pattern is one a school may use: some text, at most one {seq}, only known tokens, short enough to print. */
export function seriesProblem(pattern: string): string | null {
  if (!pattern.trim()) return 'Write the pattern, like RCPT-{yyyy}-{seq:5}.';
  if ((pattern.match(/\{seq/g) ?? []).length > 1) return 'Use {seq} once.';
  const unknown = (pattern.match(/\{[^}]*\}/g) ?? []).find((t) => !/^\{(yyyy|year|yy|mm|ay|seq(:\d{1,2})?)\}$/.test(t));
  if (unknown) return `${unknown} is not a token. Use {yyyy}, {yy}, {mm}, {ay} or {seq}.`;
  return pattern.length > 40 ? 'Keep the pattern under 40 characters.' : null;
}
const seriesCheck = (v: string, ctx: z.RefinementCtx) => {
  const problem = seriesProblem(v);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
};

/** What kind of money a payment method is: reports and reconciliation group by it, whatever the school calls the method. */
export const PAYMENT_KINDS = ['cash', 'card', 'bank', 'cheque', 'wallet', 'online', 'other'] as const;
export const PAYMENT_KIND_LABELS: Record<(typeof PAYMENT_KINDS)[number], string> = localizedLabels({ cash: 'Cash', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque', wallet: 'Wallet or app', online: 'Online', other: 'Other' });
export const PaymentMethod = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,24}$/),
  name: z.string().trim().min(1, 'Name the method').max(30),
  kind: z.enum(PAYMENT_KINDS),
});
export type PaymentMethod = z.infer<typeof PaymentMethod>;
// Schools saved before methods had names kept plain keys: each is read as the method it always was.
const OLD_METHODS: Record<string, [string, PaymentMethod['kind']]> = { cash: ['Cash', 'cash'], upi: ['UPI', 'wallet'], card: ['Card', 'card'], netbanking: ['Net banking', 'bank'], cheque: ['Cheque', 'cheque'] };
const PaymentMethods = z.preprocess(
  (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { key: x, name: OLD_METHODS[x]?.[0] ?? x, kind: OLD_METHODS[x]?.[1] ?? 'other' } : x)) : v),
  z.array(PaymentMethod).min(1, 'Keep at least one way to pay').max(16),
);
/** A school anywhere starts with these; a country's pack adds its own (UPI in India, direct debit in the United Kingdom). */
export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { key: 'cash', name: 'Cash', kind: 'cash' }, { key: 'card', name: 'Card', kind: 'card' }, { key: 'bank', name: 'Bank transfer', kind: 'bank' }, { key: 'cheque', name: 'Cheque', kind: 'cheque' },
];

export const SchoolSettingsSchema = z.object({
  'school.name': z.string().min(2).max(80),
  'school.shortName': z.string().min(2).max(20),
  'school.tagline': z.string().max(120).default(''),
  'school.place': z.string().max(60).default(''),
  'school.phone': z.string().max(24).default(''),
  'school.email': z.string().max(120).default(''),
  'school.address': z.string().max(240).default(''),
  'school.language': z.string().refine(isLanguage, 'Pick a language from the list').default('en'),
  // Where the school is and how it writes dates, numbers and money (locale.ts). The wizard sets them from the country.
  'school.country': z.string().trim().refine((c) => c === '' || COUNTRIES.includes(c), 'Choose a country from the list').default(''),
  'school.timezone': z.string().refine(isZone, 'Choose a time zone from the list').default('UTC'),
  'school.locale': z.string().refine(isLocale, 'Write a locale like en-GB').default('en'),
  'school.currency': z.string().trim().toUpperCase().refine(isCurrency, 'Write a currency code like USD or INR').default('USD'),
  'brand.color': z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #6A4CF5'),
  'brand.logoText': z.string().max(2).default(''),
  'approvals.notice': z.enum(['required', 'off']).default('required'),
  // The school's own steps for each kind of request (§3.6.1); a kind without any is decided in one step.
  'workflows.steps': WorkflowsSetting.default({}),
  'attendance.notifyParents': z.boolean().default(true),
  'attendance.lockAfterDays': z.number().int().min(0).max(30).default(2),
  'fees.lateFeePct': z.number().min(0).max(25).default(0),
  'fees.remindDaysBefore': z.number().int().min(0).max(30).default(3),
  // 0: no daily target (the dashboard shows the collection without a goal line).
  'fees.dailyTarget': z.number().int().min(0).max(100000000).default(0),
  'attendance.goalPct': z.number().min(50).max(100).default(95),
  'homework.goalPct': z.number().min(50).max(100).default(85),
  'dashboard.rollClasses': z.array(z.string()).max(8).default([]),
  'security.twoFactor': z.boolean().default(true),
  'security.passwordMinLength': z.number().int().min(8).max(64).default(8),
  'security.webSessionDays': z.number().int().min(1).max(30).default(7),
  'security.appSessionDays': z.number().int().min(1).max(90).default(30),
  // Whether the school may put its own staff into the roles Tangent made for it. Roles themselves are set from the console only.
  'staff.schoolAssignsRoles': z.boolean().default(true),
  // The school's own data (its timetable today; classes, terms, holidays and fee structures as their screens arrive) stays with the
  // school, inside limits set here: each area has a switch that can lock it so only Tangent changes it.
  'timetable.schoolEdits': z.boolean().default(true),
  'classes.schoolEdits': z.boolean().default(true),
  'calendar.schoolEdits': z.boolean().default(true),
  // The days the school is closed every week (holidays and second Saturdays are calendar entries). At least one day is a school day.
  'calendar.weeklyOff': z.array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).max(6).default(['sat', 'sun']),
  'feeStructures.schoolEdits': z.boolean().default(true),
  // Receipt numbers: {year} becomes the year. The start lets a school arriving from another system keep its numbering.
  // Number series (packages/db numbers.ts): {yyyy} {yy} {mm} {ay} and {seq} or {seq:5}; without {seq} it goes at the end.
  'fees.receiptPrefix': z.string().trim().min(1).max(40).superRefine(seriesCheck).default('RCPT-{yyyy}-{seq:5}'),
  'fees.receiptStart': z.number().int().min(1).max(99_999_999).default(1),
  'people.admissionNumber': z.string().trim().min(1).max(40).superRefine(seriesCheck).default('{yyyy}/{seq:4}'),
  'people.admissionStart': z.number().int().min(1).max(99_999_999).default(1),
  // Printed under the school's name on every receipt: the trust, its registration or GST number.
  'fees.receiptNote': z.string().max(300).default(''),
  // How the office may record a payment (families pay in the app by UPI, card or net banking).
  // Tax on fees (§3.4.2, feature fees.taxReceipts): what the country calls it, the school's registration and service code
  // (with the names they go by there), the rate, whether fees include it, how a receipt splits it, and which fee heads carry it.
  'tax.name': z.string().trim().min(1).max(20).default('Tax'),
  'tax.number': z.string().trim().max(30).default(''),
  'tax.numberLabel': z.string().trim().min(1).max(30).default('Tax number'),
  'tax.code': z.string().trim().max(12).default(''),
  'tax.codeLabel': z.string().trim().max(30).default(''),
  'tax.ratePct': z.number().min(0).max(50).default(0),
  'tax.inclusive': z.boolean().default(true),
  'tax.split': z.array(z.object({ name: z.string().trim().min(1).max(20), sharePct: z.number().min(0).max(100) })).max(4)
    .refine((l) => !l.length || Math.abs(l.reduce((a, x) => a + x.sharePct, 0) - 100) < 0.01, 'The parts add up to 100%').default([]),
  'tax.heads': z.array(z.string()).default([]),
  // Refunds above this many rupees need a second person in the school (fees.refund on both).
  // 0: every refund needs a second person until the school sets an amount in its own currency.
  'fees.refundApprovalAbove': z.number().int().min(0).max(10_000_000).default(0),
  // The school's logo image (a file kept in its storage); the letters stand in until there is one.
  'brand.logoFileId': z.string().default(''),
  // Library rules.
  'library.loanDays': z.number().int().min(1).max(60).default(14),
  'library.finePerDay': z.number().int().min(0).max(100).default(1),
  'library.maxRenewals': z.number().int().min(0).max(5).default(1),
  // Books a student, and a member of staff, may have out at once.
  'library.maxLoans': z.number().int().min(1).max(20).default(3),
  'library.staffMaxLoans': z.number().int().min(1).max(50).default(5),
  // Families are told the bus is near when it is this many minutes from their stop.
  'transport.nearMinutes': z.number().int().min(2).max(30).default(10),
  'fees.paymentMethods': PaymentMethods.default(DEFAULT_PAYMENT_METHODS),
  // The school's own words per language (student or pupil, class or form): `{ en: { student: { one: 'Pupil' } } }`.
  'vocab.words': z.record(z.string().refine(isLanguage), z.object(Object.fromEntries(VOCAB_CONCEPTS.map((c) => [c.key, z.object({ one: z.string().trim().max(30), many: z.string().trim().max(30).optional() }).optional()]))))
    .default({}) as unknown as z.ZodDefault<z.ZodType<Vocabulary>>,
  // Where enquiries come from, as the school counts them (Admissions and its reports).
  'admissions.sources': z.array(z.string().trim().min(1).max(40)).min(1).max(16).default(['Walk-in', 'Phone', 'Website', 'Referral', 'Event']),
  // The stages between enquiry and enrolment the school uses (some have no entrance test).
  'admissions.stages': z.array(z.enum(['applied', 'test', 'offer'])).max(3).default(['applied', 'test', 'offer']),
  // The school's houses, if it has them: on student profiles, the roll-call grid and the app.
  /** The letters sent home to start families and students on the app (placeholders: {school} {student} {class} {guardian} {phoneEnd} {link}). */
  'letters.family': z.string().max(3000).default('Dear {guardian},\n\n{school} now has its own app. You can follow {student}’s school day on your phone: attendance, homework, results, fees and notices, as your school uses them.\n\n1. Scan the code, or open {link}, to get the {school} app.\n2. Sign in with your phone number ending {phoneEnd}.\n3. Type the code we send you. There is no password to remember.\n\nIf your phone number has changed, tell the school office.'),
  'letters.student': z.string().max(3000).default('Dear {student},\n\n{school} now has its own app for you: your timetable, homework, results and notices.\n\n1. Scan the code, or open {link}, to get the {school} app.\n2. Sign in with the phone number or email the school has for you.\n3. Type the code we send you.\n\nAsk your class teacher if you need help.'),
  'students.required': z.array(z.enum(['gender', 'house', 'admissionNo', 'bloodGroup', 'address'])).default([]),
  // School lists (§3.6.5) the people records use.
  'lists.genders': schoolList(DEFAULT_GENDERS),
  'lists.relationships': schoolList(DEFAULT_RELATIONSHIPS),
  'lists.bloodGroups': schoolList(DEFAULT_BLOOD_GROUPS),
  // The school's own fields on its records (§3.6.3), per kind of record.
  'fields.custom': CustomFieldsSetting.default({}),
  // How addresses are written in the school's country (§3.3.5): its parts, names and postal code format.
  'people.addressFormat': AddressFormat.default(DEFAULT_ADDRESS_FORMAT),
  'people.houses': z.array(z.object({ key: z.string().regex(/^[a-z0-9-]{1,24}$/), name: z.string().min(1).max(24), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(12).default([]),
  // The first column of every week grid (attendance, leave, the app's calendars).
  'calendar.weekStarts': z.enum(['mon', 'sun']).default('mon'),
  // The attendance marks the school uses (present and absent always).
  'attendance.statuses': AttendanceMarks.default(DEFAULT_ATTENDANCE_MARKS),
  // Reasons a family picks when asking for leave.
  'leave.reasons': z.array(z.string().trim().min(1).max(40)).min(1).max(12).default(['Unwell', 'Family', 'Travel', 'Medical appointment', 'Other']),
  // Families see how many classmates have handed in; who may hand in from the app.
  'homework.showClassProgress': z.boolean().default(false),
  'homework.defaultDueDays': z.number().int().min(1).max(30).default(2),
  'homework.defaultMarks': z.number().int().min(1).max(100).default(20),
  'homework.handedInBy': z.enum(['parent', 'student', 'either']).default('either'),
  // Results: class rank shown to families; the grading scale (highest first) and the pass mark.
  'exams.defaultMaxMarks': z.number().int().min(1).max(200).default(100),
  'exams.leadDays': z.number().int().min(0).max(120).default(7),
  'results.showRank': z.boolean().default(false),
  'grading.scale': z.array(z.object({ grade: z.string().min(1).max(4), minPct: z.number().min(0).max(100) })).min(1).max(12).default([
    { grade: 'A', minPct: 90 }, { grade: 'B', minPct: 80 }, { grade: 'C', minPct: 70 }, { grade: 'D', minPct: 60 }, { grade: 'E', minPct: 50 }, { grade: 'F', minPct: 0 },
  ]),
  'grading.passPct': z.number().min(0).max(100).default(50),
  // More grading schemes for some year groups or subjects (§3.6.6); without them every mark uses the scale above.
  'grading.schemes': GradingSchemes.default([]),
  // The school's own layouts for its printed documents (§3.6.2); a kind without one prints the starter layout.
  'documents.templates': DocTemplates.default({}),
  // Categories of notices and events: one list each, used by the people who write them and the people who read them.
  'notices.categories': z.array(CATEGORY).min(1).max(16).default([
    { key: 'academic', name: 'Academic', tone: 'v' }, { key: 'exams', name: 'Exams', tone: 'c' }, { key: 'events', name: 'Events', tone: 'g' },
    { key: 'sports', name: 'Sports', tone: 'a' }, { key: 'holiday', name: 'Holiday', tone: 'g' }, { key: 'fees', name: 'Fees', tone: 'a' },
  ]),
  'events.categories': z.array(CATEGORY).min(1).max(16).default([
    { key: 'academic', name: 'Academic', tone: 'v' }, { key: 'cultural', name: 'Cultural', tone: 'g' }, { key: 'sports', name: 'Sports', tone: 'a' },
    { key: 'meeting', name: 'Meeting', tone: 'v' }, { key: 'holiday', name: 'Holiday', tone: 'c' },
  ]),
  // Families see how many are going to an event.
  'events.showGoing': z.boolean().default(false),
  // Who a family may call about the bus from the app (never the driver while driving).
  'transport.familyCalls': z.enum(['attendant', 'office', 'none']).default('office'),
  // Who signs in to the app, and what each role sees: its bottom tabs, Home cards and quick buttons.
  'app.roles': z.array(z.enum(APP_ROLE_KEYS)).default(['parent', 'teacher']),
  'app.layout': z.object({ parent: APP_LAYOUT, student: APP_LAYOUT, teacher: APP_LAYOUT, driver: APP_LAYOUT }).default(DEFAULT_APP_LAYOUT),
  // Which languages the app offers; the school's default language comes first.
  'app.languages': z.array(z.string().refine(isLanguage, 'Pick languages from the list')).min(1).max(12).default(['en']),
  // Notifications: which message goes out on which channel, and when families are left in peace.
  'notify.rules': z.record(z.string(), z.object({ push: z.boolean(), sms: z.boolean(), email: z.boolean(), whatsapp: z.boolean().default(false) })).default({}),
  'notify.quietFrom': z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 21:00').default('21:00'),
  'notify.quietTo': z.string().regex(/^\d{2}:\d{2}$/, 'Use a time like 07:00').default('07:00'),
  // Message templates by key, with {placeholders}. Empty means the built-in wording.
  // The school's own wording of a message: one text (in its default language) or one per language (`{ hi: '…', en: '…' }`).
  'templates.messages': z.record(z.string(), z.union([z.string().max(320), z.record(z.string().refine(isLanguage), z.string().max(320))])).default({}),
  // Privacy and consent.
  'privacy.notice': z.string().max(4000).default(''),
  // From this age a student agrees to the privacy notice for themself (§3.7); a younger one is covered by their family's consent.
  'privacy.consentAge': z.number().int().min(10).max(21).default(16),
  'privacy.officerName': z.string().max(80).default(''),
  'privacy.officerEmail': z.string().max(120).default(''),
  'privacy.officerPhone': z.string().max(24).default(''),
  'privacy.retentionMonths': z.number().int().min(12).max(120).default(36),
  'privacy.photoConsent': z.boolean().default(true),
  'privacy.consentRequired': z.boolean().default(true),
});
export type SchoolSettings = z.infer<typeof SchoolSettingsSchema>;
export type SettingKey = keyof SchoolSettings;

export const SettingsPatch = z.object({
  expectedVersion: z.number().int().optional(),
  changes: z.record(z.string(), z.unknown()),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export interface SettingsDoc {
  version: number;
  values: Record<string, unknown>;
  /** Keys the platform has locked: the school cannot change them. */
  locked: string[];
  updatedAt: string | null;
}

export interface SettingsResponse extends SettingsDoc {
  modules: { key: string; name: string; blurb: string; requires: string[]; core: boolean; backend: boolean; entitled: boolean }[];
  /** What the plan card shows: how much of the plan the school is using this month. */
  usage: { plan: string; students: number; staff: number; studentLimit: number; smsUsed: number; smsLimit: number };
}

/** A school's limits. Staff is optional because older entitlements did not have it (no limit then). */
export interface Limits { students: number; staff?: number; storageGb: number; smsPerMonth: number }

/** One module's dates for one school, ISO days in IST: a trial (until), a module that starts later (from), a contract end. */
export interface ModuleDates { from?: string; until?: string }

export interface EntitlementDoc {
  plan: string;
  modules: string[];
  /** Features switched away from the catalogue's default for this school (false takes a built feature away). */
  features?: Record<string, boolean>;
  /** Per-module dates; a module outside its dates counts as off everywhere. */
  dates?: Record<string, ModuleDates>;
  /** The school pays nothing until this day (inclusive). */
  trialUntil?: string;
  limits: Limits;
  /** Settings Tangent fixed for this school (their values are in `overrides`); a tightened one is a floor (TIGHTEN). */
  locks: string[];
  overrides: Record<string, unknown>;
  /** Why each lock is there, shown to the school next to the setting. */
  lockNotes?: Record<string, string>;
  version: number;
}

/** What a school's sign-in pages show before anyone signs in: who the school is, and its privacy notice. */
export interface SchoolBrand {
  name: string;
  shortName: string;
  color: string;
  logoText: string;
  /** A link to the school's logo image (valid an hour), or null while it has only letters. */
  logoUrl: string | null;
  tagline: string;
  language: string;
  demoMode: boolean;
  /** The seed hue (0–359) of the school's colours, from its brand colour, so the sign-in pages wear them before anyone signs in. */
  hue: number;
  /** The app's full palette for each of its themes (hue.ts `hueTokens`), so the app needs no colour arithmetic. */
  palette: Record<AppMode, Record<string, string>>;
  privacy: { notice: string; officerName: string; officerEmail: string; officerPhone: string };
}

export interface MenuGroup {
  group: string;
  pages: { id: string; module: string; label: string; icon: string; keys: string; href: string; tabs: { key: string; label: string; href: string }[]; /** The school's settings on this page's Settings tab. */ settings: string[] }[];
}

/** What the apps fetch: layers 1 to 5 resolved for one audience, with the version it was built from. */
export interface EffectiveConfig {
  version: number;
  school: { name: string; shortName: string; color: string; logoText: string; language: string; tagline: string; place: string; address: string; phone: string; email: string };
  modules: string[];
  /** Features inside those modules the school has (catalogue keys like fees.onlinePayment). */
  features: string[];
  /** The admin menu for this audience, built from the module definitions: groups of pages, each with its tabs. */
  menu: MenuGroup[];
  settings: Record<string, unknown>;
  /** The school's words in its default language (`student`, `students`…). */
  vocabulary: Record<string, string>;
  /** Its words per language, for apps that show another language. */
  vocab: Vocabulary;
  limits: EntitlementDoc['limits'];
  /** The app: which roles may sign in, and each role's dock, Home cards and quick buttons, already limited to what the school has. */
  app: { roles: AppRoleKey[]; layout: Record<AppRoleKey, AppLayout> };
  privacy: { notice: string; officerName: string; officerEmail: string; officerPhone: string };
  /** Kill switches and rollouts the console set for this school. */
  flags: Record<string, boolean>;
}

/** What a person chooses for themselves (`/v1/me/prefs`): saved to their account, so it follows them from browser to phone. */
export const USER_PREFS = {
  /** The class the admin's Students page opens on. */
  'students.class': z.string().max(60).nullable(),
  /** The admin dashboard's widgets this person hid. */
  'dashboard.widgets': z.array(z.string().max(40)).max(12),
  /** Messages this person turned off in the app (message keys; urgent ones cannot be). */
  'notify.off': z.array(z.string().max(60)).max(60),
  /** The language this person reads (the app's picker): messages reach them in it. */
  language: z.string().refine(isLanguage, 'Pick a language from the list'),
  /** The app's welcome after the first sign-in has been seen. */
  'welcome.seen': z.boolean(),
} as const;
export type UserPrefKey = keyof typeof USER_PREFS;
export const UserPrefPut = z.object({ key: z.enum(Object.keys(USER_PREFS) as [UserPrefKey, ...UserPrefKey[]]), value: z.unknown() });

/** A grading scale (`grading.scale`): each grade from the lowest percentage that earns it. */
export type GradingScale = { grade: string; minPct: number }[];
/** The grade a percentage earns on the school's scale ('' when the scale has no grade that low). */
export function gradeFor(pct: number, scale: GradingScale): string {
  return [...scale].sort((a, b) => b.minPct - a.minPct).find((g) => pct >= g.minPct)?.grade ?? '';
}
