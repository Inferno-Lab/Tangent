import { z } from 'zod';

/**
 * Parent-teacher meetings (docs/one-shot-plan.md §6.21): the school sets a day, its hours and the length of a slot, and which
 * classes' families may book; each teacher's slots are made from that, a teacher can close some or give a link for online
 * ones, and each family books one slot per child with each teacher, until the booking closes. A day before, everyone is reminded.
 */
export const MEETING_MODES = ['inPerson', 'online', 'either'] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];
export const MEETING_STATES = ['draft', 'open', 'closed'] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00');
export const MeetingInput = z.object({
  title: z.string().trim().min(3, 'Name the meeting').max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day'),
  from: time,
  to: time,
  slotMinutes: z.number().int().min(5).max(60).default(10),
  /** Minutes between slots, for the teacher to write notes. */
  gapMinutes: z.number().int().min(0).max(30).default(0),
  mode: z.enum(MEETING_MODES).default('inPerson'),
  place: z.string().trim().max(100).default(''),
  /** A link everyone joins for online meetings (a teacher can give their own). */
  link: z.string().trim().max(300).default(''),
  classIds: z.array(z.string().max(60)).min(1, 'Choose the classes whose families book').max(200),
  /** Teachers who meet families; none means each class's class teacher. */
  teacherIds: z.array(z.string().max(60)).max(200).default([]),
  /** The last moment to book or cancel; by default, when the first slot starts. */
  closesAt: z.string().datetime({ offset: true }).nullable().default(null),
  status: z.enum(MEETING_STATES).default('draft'),
}).refine((m) => m.from < m.to, { message: 'The meeting ends after it starts', path: ['to'] })
  .refine((m) => !m.link || /^https:\/\/\S+$/.test(m.link), { message: 'Give a link that starts with https://', path: ['link'] });
export type MeetingInput = z.infer<typeof MeetingInput>;

export interface MeetingRow {
  id: string;
  title: string;
  date: string;
  from: string;
  to: string;
  slotMinutes: number;
  gapMinutes: number;
  mode: MeetingMode;
  place: string;
  link: string;
  classIds: string[];
  teacherIds: string[];
  closesAt: string | null;
  status: (typeof MEETING_STATES)[number];
  slots: number;
  booked: number;
}

export interface MeetingSlotRow {
  id: string;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  state: 'open' | 'booked' | 'closed';
  /** Who booked (the office and the teacher see it; another family only sees the slot is taken). */
  studentId: string | null;
  studentName: string | null;
  bookedBy: string | null;
  mode: 'inPerson' | 'online' | null;
  link: string;
  note: string;
}

export const MeetingBookInput = z.object({ slotId: z.string().min(1).max(60), studentId: z.string().min(1).max(60), mode: z.enum(['inPerson', 'online']).optional(), note: z.string().trim().max(300).default('') });
export type MeetingBookInput = z.infer<typeof MeetingBookInput>;
export const MeetingSlotPatch = z.object({ closed: z.boolean().optional(), link: z.string().trim().max(300).optional() })
  .refine((p) => !p.link || /^https:\/\/\S+$/.test(p.link), { message: 'Give a link that starts with https://', path: ['link'] });
export type MeetingSlotPatch = z.infer<typeof MeetingSlotPatch>;

/** The slots of one teacher between two times: each `slot` minutes long with `gap` minutes after it, all inside the hours. */
export function meetingSlots(from: string, to: string, slot: number, gap: number): [string, string][] {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const out: [string, string][] = [];
  for (let at = m(from); at + slot <= m(to) && out.length < 200; at += slot + gap) out.push([hm(at), hm(at + slot)]);
  return out;
}
