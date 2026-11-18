import { z } from 'zod';
import { isLanguage } from './i18n.js';

/**
 * Certificates and ID cards (docs/one-shot-plan.md §6.24): each kind of certificate is the school's own wording with
 * {placeholders}, numbered in its own series, asked for by a family or the office, decided through the school's steps
 * (`certificate`) after the fee and the no-dues check, then kept in the issue register. Each printed one carries a QR code to a
 * public page that says only whether it is genuine.
 */
export const CertificateType = z.object({
  key: z.string().regex(/^[A-Za-z0-9+\-_]{1,32}$/, 'Keys use letters, digits, + - and _'),
  name: z.string().trim().min(1, 'Name the certificate').max(60),
  names: z.record(z.string().refine(isLanguage), z.string().trim().max(60)).optional(),
  active: z.boolean().optional(),
  /** The certificate's words, with {student}, {class}, {admissionNo}, {dob}, {guardian}, {admittedOn}, {leftOn}, {purpose}, {date}, {school}. */
  text: z.string().trim().min(10, 'Write the certificate’s words').max(3000),
  /** Its own number series; empty uses the school's certificate series. */
  series: z.string().trim().max(40).default(''),
  /** What it costs (the school's currency); 0 is free. */
  fee: z.number().min(0).max(1_000_000).default(0),
  /** Issued only when nothing is owed: fees, and library books. */
  noDues: z.boolean().default(false),
  /** Families may ask for it in the app. */
  families: z.boolean().default(true),
});
export type CertificateType = z.infer<typeof CertificateType>;
export const CertificateTypes = z.array(CertificateType).min(1).max(30).refine((l) => new Set(l.map((i) => i.key)).size === l.length, 'Two certificates have the same key');
export const CERTIFICATE_PLACEHOLDERS = ['student', 'class', 'admissionNo', 'dob', 'guardian', 'admittedOn', 'leftOn', 'purpose', 'date', 'school', 'number'] as const;
export const DEFAULT_CERTIFICATE_TYPES: CertificateType[] = [
  { key: 'bonafide', name: 'Enrolment certificate', text: 'This is to certify that {student}, admission number {admissionNo}, born on {dob}, is a student of {class} at {school} this year. This certificate is issued for {purpose}.', series: '', fee: 0, noDues: false, families: true },
  { key: 'character', name: 'Character certificate', text: 'This is to certify that {student}, admission number {admissionNo}, was a student of {school}. To the best of our knowledge they bear a good moral character.', series: '', fee: 0, noDues: false, families: true },
  { key: 'transfer', name: 'Leaving certificate', text: 'This is to certify that {student}, child of {guardian}, born on {dob}, admitted on {admittedOn} with admission number {admissionNo}, studied at {school} and left on {leftOn} from {class}. Nothing is owed to the school.', series: 'LC-{yyyy}-{seq:4}', fee: 0, noDues: true, families: true },
  { key: 'participation', name: 'Certificate of participation', text: 'Awarded to {student} of {class} for taking part in {purpose}.', series: '', fee: 0, noDues: false, families: false },
];

export const CERTIFICATE_STATES = ['pending', 'issued', 'rejected', 'cancelled', 'revoked'] as const;
export type CertificateState = (typeof CERTIFICATE_STATES)[number];

export const CertificateRequest = z.object({
  type: z.string().min(1, 'Choose the certificate').max(32),
  studentId: z.string().min(1, 'Choose the student').max(60),
  purpose: z.string().trim().max(200).default(''),
});
export type CertificateRequest = z.infer<typeof CertificateRequest>;

export interface CertificateRow {
  id: string;
  type: string;
  typeName: string;
  studentId: string;
  studentName: string;
  className: string;
  purpose: string;
  number: string | null;
  state: CertificateState;
  /** The fee invoice it waits on, while unpaid. */
  feeDue: number;
  requestedBy: string;
  issuedAt: string | null;
  issuedBy: string | null;
  note: string;
  createdAt: string;
}

export const IdCardsInput = z.object({
  /** Students of these classes, these students, or (staff: true) the staff. */
  classIds: z.array(z.string().max(60)).max(200).default([]),
  studentIds: z.array(z.string().max(60)).max(2000).default([]),
  staff: z.boolean().default(false),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}).refine((b) => b.staff || b.classIds.length || b.studentIds.length, 'Choose whose cards to print');
export type IdCardsInput = z.infer<typeof IdCardsInput>;

/** What the public check of a certificate's QR code says: genuine (and not revoked), with only what identifies it. */
export interface CertificateCheck { genuine: boolean; revoked: boolean; school: string; type?: string; number?: string; student?: string; issuedOn?: string }

/** Fills {placeholders} in a certificate's words; one it does not know stays as written. */
export const fillCertificate = (text: string, fill: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => fill[k] ?? m);
