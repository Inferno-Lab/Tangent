import { z } from 'zod';
import { localizedLabels } from './i18n.js';
import type { ListItem } from './lists.js';

/**
 * The class diary (docs/one-shot-plan.md §6.7): what was done in class, what to bring, notes and holiday work, a line a day or
 * many, with remarks for single students that only their family reads. Families acknowledge an entry where the school asks.
 */
export const DEFAULT_DIARY_KINDS: ListItem[] = [
  { key: 'classwork', name: 'Done in class' }, { key: 'bring', name: 'Bring tomorrow' }, { key: 'note', name: 'Note to families' },
  { key: 'holiday', name: 'Holiday work' }, { key: 'worksheet', name: 'Worksheet' },
];
/** Who writes a class's diary: its class teacher, or also every teacher who teaches the class. */
export const DIARY_WRITERS = ['classTeacher', 'subjectTeachers'] as const;
export const DIARY_WRITER_LABELS = localizedLabels({ classTeacher: 'The class teacher', subjectTeachers: 'Every teacher of the class' });

export const DiaryInput = z.object({
  classId: z.string().min(1, 'Choose a class').max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day'),
  kind: z.string().min(1, 'Choose a kind').max(32),
  subjectId: z.string().max(60).nullable().default(null),
  text: z.string().trim().min(2, 'Write the entry').max(2000),
  fileIds: z.array(z.string().max(60)).max(5).default([]),
  /** Lines for single students, read only by their own family. */
  remarks: z.array(z.object({ studentId: z.string().min(1).max(60), text: z.string().trim().min(1).max(500) })).max(100).default([]),
});
export type DiaryInput = z.infer<typeof DiaryInput>;

export interface DiaryRow {
  id: string;
  classId: string;
  className: string;
  date: string;
  kind: string;
  kindName: string;
  subjectId: string | null;
  subjectName: string | null;
  text: string;
  files: { id: string; name: string }[];
  remarks: { studentId: string; studentName: string; text: string }[];
  /** Families who acknowledged, of the families of the class. */
  acks: number;
  families: number;
  by: string;
  byId: string;
  createdAt: string;
}

/** An entry as a family or a student reads it: the class's line, and the remark for this child alone. */
export interface FamilyDiaryEntry {
  id: string;
  date: string;
  kind: string;
  kindName: string;
  subject: string | null;
  text: string;
  files: { id: string; name: string }[];
  remark: string | null;
  by: string;
  acknowledged: boolean;
  needsAck: boolean;
}
