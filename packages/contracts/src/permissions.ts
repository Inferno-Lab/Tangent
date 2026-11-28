import { z } from 'zod';
import { localized } from './i18n.js';

/**
 * Every action a role can be allowed to do. The admin hides UI and the API refuses requests from this one list.
 * `settings.manage` lets a person change the school's own settings, for the modules they may also change (Library settings
 * need `library.write` too); Tangent's own settings and locks stay with the console.
 */
export const PERMISSIONS = [
  'students.read',
  'students.write',
  'attendance.read',
  'attendance.mark',
  'fees.read',
  'fees.collect',
  'fees.waive',
  'notices.read',
  'notices.write',
  'notices.publish',
  'notices.pin',
  'approvals.read',
  'approvals.decide',
  'timetable.read',
  'timetable.edit',
  'timetable.publish',
  'settings.read',
  'settings.manage',
  'privacy.manage',
  'staff.read',
  'staff.write',
  'classes.all',
  'audit.read',
  'reports.read',
  'homework.read',
  'homework.write',
  'exams.read',
  'exams.write',
  'exams.publish',
  'admissions.read',
  'admissions.write',
  'messages.read',
  'messages.write',
  'events.read',
  'events.write',
  'setup.write',
  'fees.refund',
  'library.read',
  'library.write',
  'transport.read',
  'transport.write',
  'gallery.read',
  'gallery.write',
  'year.manage',
  'forms.manage',
  'staffAttendance.read',
  'staffAttendance.manage',
  'diary.read',
  'diary.write',
  'meetings.read',
  'meetings.manage',
  'visitors.read',
  'visitors.manage',
  'certificates.read',
  'certificates.issue',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export interface PermissionInfo {
  key: Permission;
  area: string;
  label: string;
  /** Needs a second person to approve when the school turns approvals on. */
  sensitive?: boolean;
}

/** The module (or feature) a permission belongs to. A school without it never sees the permission in a role. The rest are core. */
export const PERMISSION_NEEDS: Partial<Record<Permission, string>> = {
  'attendance.read': 'attendance', 'attendance.mark': 'attendance',
  'fees.read': 'fees', 'fees.collect': 'fees', 'fees.waive': 'fees',
  'notices.read': 'notices', 'notices.write': 'notices', 'notices.publish': 'notices', 'notices.pin': 'notices',
  'timetable.read': 'timetable', 'timetable.edit': 'timetable', 'timetable.publish': 'timetable',
  'homework.read': 'homework', 'homework.write': 'homework',
  'exams.read': 'exams', 'exams.write': 'exams', 'exams.publish': 'exams',
  'admissions.read': 'people.admissions', 'admissions.write': 'people.admissions',
  'messages.read': 'chat', 'messages.write': 'chat',
  'events.read': 'events', 'events.write': 'events',
  'fees.refund': 'fees.refunds',
  'library.read': 'library', 'library.write': 'library',
  'transport.read': 'transport', 'transport.write': 'transport',
  'gallery.read': 'gallery', 'gallery.write': 'gallery',
  'staffAttendance.read': 'staffAttendance', 'staffAttendance.manage': 'staffAttendance', 'diary.read': 'diary', 'diary.write': 'diary',
  'meetings.read': 'ptm', 'meetings.manage': 'ptm', 'visitors.read': 'visitors', 'visitors.manage': 'visitors', 'certificates.read': 'certificates', 'certificates.issue': 'certificates',
};

/** Whether a school with these modules and features can use the permission. */
export function permissionAvailable(p: string, has: { modules: readonly string[]; features: readonly string[] }): boolean {
  const need = PERMISSION_NEEDS[p as Permission];
  return !need || has.modules.includes(need) || has.features.includes(need);
}

export const PERMISSION_CATALOG: PermissionInfo[] = localized([
  { key: 'students.read', area: 'People', label: 'See students and guardians' },
  { key: 'students.write', area: 'People', label: 'Add and edit students' },
  { key: 'staff.read', area: 'People', label: 'See staff' },
  { key: 'staff.write', area: 'People', label: 'Add and edit staff', sensitive: true },
  { key: 'classes.all', area: 'People', label: 'See and work with every class (students, attendance, homework, marks, diary, family messages), not only the ones they teach', sensitive: true },
  { key: 'attendance.read', area: 'Attendance', label: 'See attendance' },
  { key: 'attendance.mark', area: 'Attendance', label: 'Mark attendance' },
  { key: 'fees.read', area: 'Fees', label: 'See fees and payments' },
  { key: 'fees.collect', area: 'Fees', label: 'Record payments' },
  { key: 'fees.waive', area: 'Fees', label: 'Waive or reduce fees', sensitive: true },
  { key: 'notices.read', area: 'Notices', label: 'See notices' },
  { key: 'notices.write', area: 'Notices', label: 'Write notices' },
  { key: 'notices.publish', area: 'Notices', label: 'Publish notices to families and to the whole school' },
  { key: 'notices.pin', area: 'Notices', label: 'Pin notices to the top' },
  { key: 'approvals.read', area: 'Approvals', label: 'See the approvals queue' },
  { key: 'approvals.decide', area: 'Approvals', label: 'Approve or decline requests' },
  { key: 'timetable.read', area: 'Timetable', label: 'See the timetable' },
  { key: 'timetable.edit', area: 'Timetable', label: 'Edit periods and cover' },
  { key: 'timetable.publish', area: 'Timetable', label: 'Publish the timetable' },
  { key: 'settings.read', area: 'Settings', label: 'See the school’s settings' },
  { key: 'settings.manage', area: 'Settings', label: 'Change the school’s settings (each module’s with its own write permission)', sensitive: true },
  { key: 'privacy.manage', area: 'Settings', label: 'Log and answer families’ data requests', sensitive: true },
  { key: 'audit.read', area: 'Settings', label: 'Read the audit log' },
  { key: 'reports.read', area: 'Reports', label: 'See reports' },
  { key: 'homework.read', area: 'Homework', label: 'See homework' },
  { key: 'homework.write', area: 'Homework', label: 'Set homework and record hand-ins' },
  { key: 'exams.read', area: 'Exams', label: 'See exams and results' },
  { key: 'exams.write', area: 'Exams', label: 'Create exams and enter marks' },
  { key: 'exams.publish', area: 'Exams', label: 'Publish results to families', sensitive: true },
  { key: 'admissions.read', area: 'Admissions', label: 'See enquiries and applications' },
  { key: 'admissions.write', area: 'Admissions', label: 'Move applications and enrol students' },
  { key: 'messages.read', area: 'Messages', label: 'See family messages' },
  { key: 'messages.write', area: 'Messages', label: 'Write to families' },
  { key: 'events.read', area: 'Events', label: 'See the calendar' },
  { key: 'events.write', area: 'Events', label: 'Add and change events' },
  { key: 'fees.refund', area: 'Fees', label: 'Refund online payments', sensitive: true },
  { key: 'library.read', area: 'Library', label: 'See the catalogue and loans' },
  { key: 'library.write', area: 'Library', label: 'Add books, issue and take back' },
  { key: 'transport.read', area: 'Transport', label: 'See routes, stops and the bus' },
  { key: 'transport.write', area: 'Transport', label: 'Change routes and who rides them' },
  { key: 'gallery.read', area: 'Gallery', label: 'See albums' },
  { key: 'gallery.write', area: 'Gallery', label: 'Add albums and photos, publish them to families' },
  { key: 'year.manage', area: 'School setup', label: 'Promote students, start a new year and record leavers', sensitive: true },
  { key: 'forms.manage', area: 'Forms', label: 'Make forms and read their answers' },
  { key: 'staffAttendance.read', area: 'Staff attendance', label: 'See staff attendance, leave and balances' },
  { key: 'staffAttendance.manage', area: 'Staff attendance', label: 'Mark staff attendance, record leave and change balances', sensitive: true },
  { key: 'diary.read', area: 'Diary', label: 'Read every class’s diary' },
  { key: 'diary.write', area: 'Diary', label: 'Write in the diary of classes they teach' },
  { key: 'meetings.read', area: 'Meetings', label: 'See parent-teacher meetings and bookings' },
  { key: 'meetings.manage', area: 'Meetings', label: 'Set up parent-teacher meetings and change bookings' },
  { key: 'visitors.read', area: 'Visitors', label: 'See visitors, gate passes and pick-ups' },
  { key: 'visitors.manage', area: 'Visitors', label: 'Sign visitors in and out, let students leave and record pick-ups' },
  { key: 'certificates.read', area: 'Certificates', label: 'See certificates and the issue register' },
  { key: 'certificates.issue', area: 'Certificates', label: 'Issue, cancel and revoke certificates; print ID cards', sensitive: true },
  { key: 'setup.write', area: 'School setup', label: 'Edit classes, subjects, periods, terms, holidays and fee structures (where Tangent allows)' },
]);

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

const ALL: Permission[] = [...PERMISSIONS];

/** The starting roles as the console saves them: the built-in ones stay (they can be renamed and changed), more can be added. */
export const RoleTemplatesPut = z.array(z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,23}$/, 'Use 2 to 24 lowercase letters, numbers or _'),
  name: z.string().trim().min(2, 'Name the role').max(40),
  description: z.string().trim().max(160).default(''),
  permissions: z.array(z.enum(PERMISSIONS)),
})).min(1).max(30);

/** Work that spans the whole school: a role holding any of these sees every class (classes.all) when a school is set up. */
export const WHOLE_SCHOOL_PERMISSIONS: readonly Permission[] = ['students.write', 'settings.manage', 'fees.read', 'fees.collect', 'fees.refund', 'admissions.read', 'admissions.write', 'staff.write', 'reports.read',
  'transport.read', 'transport.write', 'library.read', 'library.write', 'visitors.read', 'visitors.manage', 'certificates.read', 'certificates.issue', 'staffAttendance.manage', 'privacy.manage'];
/** A starting role's permissions with classes.all added where its work spans the whole school (school migrations 0073 and 0075 do the same for existing schools). */
export const withWholeSchool = (perms: readonly Permission[]): Permission[] => (perms.some((x) => WHOLE_SCHOOL_PERMISSIONS.includes(x)) && !perms.includes('classes.all') ? [...perms, 'classes.all'] : [...perms]);

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'principal', name: 'Principal', description: 'Everything in the school.', permissions: ALL },
  {
    key: 'office',
    name: 'Office staff',
    description: 'Admissions, people, notices and the timetable.',
    permissions: [
      'students.read', 'students.write', 'staff.read', 'classes.all', 'attendance.read', 'notices.read', 'notices.write', 'notices.pin',
      'approvals.read', 'timetable.read', 'timetable.edit', 'reports.read', 'admissions.read', 'admissions.write', 'messages.read', 'messages.write',
      'events.read', 'events.write', 'homework.read', 'exams.read', 'setup.write', 'library.read', 'library.write', 'transport.read', 'transport.write', 'gallery.read', 'gallery.write',
      'forms.manage', 'staffAttendance.read', 'diary.read', 'meetings.read', 'meetings.manage', 'visitors.read', 'visitors.manage', 'certificates.read',
    ],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Fees, payments and reports.',
    permissions: ['students.read', 'classes.all', 'fees.read', 'fees.collect', 'fees.refund', 'reports.read', 'notices.read', 'events.read'],
  },
  {
    key: 'teacher',
    name: 'Teacher',
    description: 'Marks attendance and sees their classes.',
    permissions: [
      'students.read', 'attendance.read', 'attendance.mark', 'notices.read', 'timetable.read', 'homework.read', 'homework.write', 'exams.read', 'exams.write',
      'messages.read', 'messages.write', 'events.read', 'diary.write', 'meetings.read',
    ],
  },
];

