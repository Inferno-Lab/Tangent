import { z } from 'zod';
import { isLanguage, localizedLabels } from './i18n.js';

/**
 * The template designer (docs/one-shot-plan.md §3.6.2): every printed document is a page of blocks the school arranges,
 * with its own wording in each of its languages and placeholders the document fills. A school without its own template
 * prints the one every school starts with. `school` (its name, address and logo) and `items` (the document's own table:
 * a receipt's fee and tax lines, a report card's subjects) are drawn from the record; the rest is the school's text.
 */
export const DOC_KINDS = ['receipt', 'reportCard'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_KIND_LABELS: Record<DocKind, string> = localizedLabels({ receipt: 'Fee receipt', reportCard: 'Report card' });

export const BLOCK_KINDS = ['school', 'heading', 'text', 'fact', 'items', 'signatures', 'rule', 'gap', 'pageBreak'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_KIND_LABELS: Record<BlockKind, string> = localizedLabels({
  school: 'The school’s name, address and logo', heading: 'Heading', text: 'Text', fact: 'A line with a value at the end', items: 'The document’s lines',
  signatures: 'Places to sign', rule: 'A line across', gap: 'Space', pageBreak: 'New page',
});

/** What each kind of document can fill in, as {placeholder}: the editor offers them, the server fills them. */
export const DOC_PLACEHOLDERS: Record<DocKind, string[]> = {
  receipt: ['school', 'student', 'class', 'admissionNo', 'receiptNo', 'date', 'title', 'amount', 'method', 'reference', 'taxName', 'taxNumber'],
  reportCard: ['school', 'student', 'class', 'admissionNo', 'rollNo', 'exam', 'percent', 'grade', 'gpa', 'result', 'rank', 'classSize'],
};

export const Block = z.object({
  kind: z.enum(BLOCK_KINDS),
  /** The wording, with {placeholders}; for a fact, its label. */
  text: z.string().max(2000).optional(),
  /** A fact's value, with {placeholders}; for signatures, the labels, one per line. */
  value: z.string().max(400).optional(),
  /** The wording in the school's other languages. */
  names: z.record(z.string().refine(isLanguage), z.object({ text: z.string().max(2000).optional(), value: z.string().max(400).optional() })).optional(),
  size: z.number().int().min(7).max(28).optional(),
  bold: z.boolean().optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  /** Leave the block out when this placeholder is empty (a GPA where the year has none). */
  when: z.string().max(30).optional(),
});
export type Block = z.infer<typeof Block>;

export const PAGE_SIZES = ['A4', 'Letter', 'A5'] as const;
export const DocTemplate = z.object({ size: z.enum(PAGE_SIZES).default('A4'), blocks: z.array(Block).min(1).max(60) });
export type DocTemplate = z.infer<typeof DocTemplate>;
export const DocTemplates = z.object(Object.fromEntries(DOC_KINDS.map((k) => [k, DocTemplate.optional()])) as Record<DocKind, z.ZodOptional<typeof DocTemplate>>);
export type DocTemplates = z.infer<typeof DocTemplates>;

/** The documents every school starts with (the layouts Tangent printed before templates). */
export const DEFAULT_TEMPLATES: Record<DocKind, DocTemplate> = {
  receipt: {
    size: 'A4',
    blocks: [
      { kind: 'school' },
      { kind: 'heading', text: '{taxName, select, none {Fee receipt} other {Tax receipt}}' },
      { kind: 'fact', text: 'Receipt number', value: '{receiptNo}' },
      { kind: 'fact', text: 'Date', value: '{date}' },
      { kind: 'fact', text: 'Student', value: '{student} ({admissionNo})' },
      { kind: 'fact', text: 'Class', value: '{class}' },
      { kind: 'rule' },
      { kind: 'items' },
      { kind: 'rule' },
      { kind: 'fact', text: 'Paid by', value: '{method}', size: 10 },
      { kind: 'text', text: 'This receipt was made by Tangent and needs no signature.', size: 9 },
    ],
  },
  reportCard: {
    size: 'A4',
    blocks: [
      { kind: 'school' },
      { kind: 'heading', text: 'Report card: {exam}' },
      { kind: 'fact', text: 'Student', value: '{student} ({admissionNo})' },
      { kind: 'fact', text: 'Class and roll number', value: '{class} · {rollNo}' },
      { kind: 'rule' },
      { kind: 'items' },
      { kind: 'rule' },
      { kind: 'fact', text: 'Overall', value: '{percent}% · grade {grade}', bold: true },
      { kind: 'fact', text: 'Grade point average', value: '{gpa}', when: 'gpa' },
      { kind: 'fact', text: 'Result', value: '{result}' },
      { kind: 'fact', text: 'Rank in class', value: '{rank} of {classSize}', when: 'rank' },
      { kind: 'signatures', value: 'Class teacher\n{@Principal}\n{@Guardian}' },
    ],
  },
};
