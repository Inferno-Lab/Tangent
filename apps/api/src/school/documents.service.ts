import { Injectable } from '@nestjs/common';
import { notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { FilesService } from './files.service.js';
import { LearningService } from './learning.service.js';
import { pdf, type PdfLine } from './pdf.js';
import { SettingsService } from './support.js';
import { DEFAULT_TEMPLATES, schoolToday, fmtDate, fmtMoney, fmtNumber, readReceiptTax, tx, type Block, type DocKind, type DocTemplate, type DocTemplates } from '@tangent/contracts';
import { schoolContext } from '@tangent/tenancy';

// A receipt or report card is written in the school's own way: its currency, its dates.
const date = (d: string) => fmtDate(d, 'long');

/** Printable receipts and report cards, made on request (nothing to keep in sync): the school's header, then the facts. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly learning: LearningService,
    private readonly files: FilesService,
  ) {}

  private async header(t: TenantCtx): Promise<PdfLine[]> {
    const v = (await this.settings.doc(t)).values;
    const address = [v['school.address'], v['school.place']].filter(Boolean).map(String).join(', ');
    return [
      { text: String(v['school.name'] ?? t.info.name), size: 18, bold: true },
      ...(address ? [{ text: address, size: 10 }] : []),
      ...(v['school.phone'] || v['school.email'] ? [{ text: [v['school.phone'], v['school.email']].filter(Boolean).join(' · '), size: 10 }] : []),
      ...(v['fees.receiptNote'] ? String(v['fees.receiptNote']).split('\n').map((l) => ({ text: l, size: 9 })) : []),
      { text: '', rule: true, gap: 14 },
    ];
  }

  /**
   * A document from its template (§3.6.2): the school's own for this kind, or `draft` (a preview of one being edited), else
   * the starter layout. Words of the starter layout come from the catalogue; the school's own come in the reader's language
   * where it wrote them. `items` is the document's own lines.
   */
  async render(t: TenantCtx, kind: DocKind, fill: Record<string, string>, items: PdfLine[], draft?: DocTemplate): Promise<{ data: Buffer }> {
    const own = draft ?? (await this.settings.value<DocTemplates>(t, 'documents.templates', {}))[kind];
    const tpl = own ?? DEFAULT_TEMPLATES[kind];
    const lang = schoolContext.getStore()?.lang ?? 'en';
    const say = (b: Block, field: 'text' | 'value') => tx(b.names?.[lang]?.[field] || b[field] || '', fill);
    const lines: PdfLine[] = [];
    for (const b of tpl.blocks) {
      if (b.when && ['', '0', 'none'].includes(fill[b.when] ?? '')) continue;
      const style = { size: b.size, bold: b.bold, align: b.align };
      if (b.kind === 'school') lines.push(...(await this.header(t)));
      else if (b.kind === 'heading') lines.push({ text: say(b, 'text'), size: b.size ?? 14, bold: b.bold ?? true, gap: 26, align: b.align });
      else if (b.kind === 'text') lines.push({ text: say(b, 'text'), ...style });
      else if (b.kind === 'fact') lines.push({ text: say(b, 'text'), right: say(b, 'value'), ...style });
      else if (b.kind === 'items') lines.push(...items);
      else if (b.kind === 'rule') lines.push({ text: '', rule: true, gap: 18 });
      else if (b.kind === 'gap') lines.push({ text: '', gap: (b.size ?? 12) * 2 });
      else if (b.kind === 'pageBreak') lines.push({ text: '', page: true });
      else if (b.kind === 'signatures') {
        // Two places to sign a row, under room to sign.
        const names = say(b, 'value').split('\n').map((x) => x.trim()).filter(Boolean);
        for (let i = 0; i < names.length; i += 2) lines.push({ text: names[i]!, right: names[i + 1], gap: 60, ...style });
      }
    }
    return { data: await pdf(lines, { logo: await this.files.logoBytes(t), size: tpl.size }) };
  }

  /** A receipt for one payment; `students` limits it to a family's own children. */
  async receipt(t: TenantCtx, paymentId: string, students: string[] | null, draft?: DocTemplate): Promise<{ name: string; data: Buffer }> {
    const p = (await t.pool.query<{ receipt_no: string; amount: number; refunded: number; method: string; reference: string | null; paid_on: string; title: string; student: string; student_id: string; admission_no: string; class: string; tax: Record<string, any> | null; cancelled_at: Date | null; cancel_reason: string }>(
      `select p.receipt_no, p.amount, p.refunded, p.method, p.reference, p.paid_on::text, i.title, s.name student, s.id student_id, s.admission_no, c.name class, p.tax, p.cancelled_at, p.cancel_reason
       from payments p join fee_invoices i on i.id = p.invoice_id join students s on s.id = i.student_id join classes c on c.id = s.class_id where p.id = $1`, [paymentId])).rows[0];
    if (!p || (students && !students.includes(p.student_id))) throw notFound('That receipt');
    const lines: PdfLine[] = [{ text: p.title, right: fmtMoney(p.amount), bold: true, gap: 22 }];
    const methods = await this.settings.value<{ key: string; name: string }[]>(t, 'fees.paymentMethods', []);
    const tax = readReceiptTax(p.tax);
    if (tax) {
      lines.push({ text: tax.code ? tx('Taxable value ({codeLabel} {code})', { codeLabel: tax.codeLabel, code: tax.code }) : tx('Taxable value'), right: fmtMoney(tax.taxable), size: 10 });
      for (const part of tax.parts) lines.push({ text: `${part.name} ${fmtNumber(part.pct)}%`, right: fmtMoney(part.amount), size: 10 });
      lines.push({ text: `${tax.numberLabel} ${tax.number}`, size: 10 });
    }
    if (p.cancelled_at) lines.push({ text: tx('Cancelled on {day}: {reason}', { day: date(p.cancelled_at.toISOString().slice(0, 10)), reason: p.cancel_reason }), bold: true, size: 10 });
    else if (p.refunded) lines.push({ text: tx('Refunded'), right: `- ${fmtMoney(p.refunded)}`, size: 10 });
    const method = `${methods.find((m) => m.key === p.method)?.name ?? p.method}${p.reference ? ` · ${p.reference}` : ''}`;
    const fill = { school: String((await this.settings.doc(t)).values['school.name'] ?? t.info.name), student: p.student, class: p.class, admissionNo: p.admission_no, receiptNo: p.receipt_no,
      date: date(p.paid_on), title: p.title, amount: fmtMoney(p.amount), method, reference: p.reference ?? '', taxName: tax?.name ?? 'none', taxNumber: tax?.number ?? '' };
    return { name: `${p.receipt_no}.pdf`, ...(await this.render(t, 'receipt', fill, lines, draft)) };
  }

  /**
   * A template being edited, printed with the school's latest receipt or published result, or with sample values while it has
   * none, so the school sees its layout before it saves it.
   */
  async preview(t: TenantCtx, kind: DocKind, draft: DocTemplate): Promise<{ name: string; data: Buffer }> {
    if (kind === 'receipt') {
      const id = (await t.pool.query<{ id: string }>('select id from payments order by created_at desc limit 1')).rows[0]?.id;
      if (id) return this.receipt(t, id, null, draft);
    } else {
      const r = (await t.pool.query<{ exam: string; student: string }>(
        "select e.id exam, m.student_id student from exams e join exam_marks m on m.exam_id = e.id where e.status = 'published' order by e.published_at desc nulls last, m.student_id limit 1")).rows[0];
      if (r) return this.reportCard(t, r.exam, r.student, null, draft);
    }
    const school = String((await this.settings.doc(t)).values['school.name'] ?? t.info.name);
    const fill: Record<string, string> = {
      school, student: 'Alex Morgan', class: '5 A', admissionNo: '2026/0001', rollNo: '12', receiptNo: 'RCPT-2026-00001', date: date(schoolToday()), title: tx('Tuition, first term'),
      amount: fmtMoney(1000), method: tx('Cash'), reference: '', taxName: 'none', taxNumber: '', exam: tx('Mid-term exams'), percent: '82', grade: 'A', gpa: '', result: tx('Passed'), rank: '', classSize: '30',
    };
    const items: PdfLine[] = kind === 'receipt' ? [{ text: fill.title!, right: fill.amount, bold: true, gap: 22 }]
      : [{ text: tx('Subject'), right: tx('Marks · grade'), bold: true, gap: 22 }, { text: tx('Mathematics'), right: '82 / 100 · A' }, { text: tx('Science'), right: '78 / 100 · B' }];
    return { name: 'preview.pdf', ...(await this.render(t, kind, fill, items, draft)) };
  }

  /** A report card for one student in one published exam. */
  async reportCard(t: TenantCtx, examId: string, studentId: string, students: string[] | null, draft?: DocTemplate): Promise<{ name: string; data: Buffer }> {
    if (students && !students.includes(studentId)) throw notFound('That report card');
    const res = await this.learning.results(t, examId);
    const row = res.rows.find((r) => r.studentId === studentId);
    if (!row || (students && res.exam.status !== 'published')) throw notFound('That report card');
    const s = (await t.pool.query<{ name: string; admission_no: string; class: string; roll_no: string; grade: number }>(
      'select s.name, s.admission_no, c.name class, s.roll_no, c.grade from students s join classes c on c.id = s.class_id where s.id = $1', [studentId])).rows[0]!;
    // Each subject in its own scheme where the school grades it differently (§3.6.6).
    const grading = await this.settings.grading(t, { grade: s.grade });
    // A family sees the class rank only when the console says so (results.showRank); the office always does.
    const showRank = !students || (await this.settings.value<boolean>(t, 'results.showRank', false));
    const marks = (await t.pool.query<{ subject: string; subject_id: string; score: string | null; absent: boolean; max_marks: number }>(
      `select coalesce(sub.name, m.subject_id) subject, m.subject_id, m.score, m.absent, x.max_marks from exam_marks m join exam_subjects x on x.exam_id = m.exam_id and x.subject_id = m.subject_id
       left join subjects sub on sub.id = m.subject_id where m.exam_id = $1 and m.student_id = $2 order by subject`, [examId, studentId])).rows;
    const lines: PdfLine[] = [
      { text: tx('Subject'), right: tx('Marks · grade'), bold: true, gap: 22 },
      ...marks.map((m) => {
        const g = grading.of(Math.round((Number(m.score ?? 0) / m.max_marks) * 100), m.subject_id);
        return { text: m.subject, right: m.absent ? tx('Absent') : `${Math.round(Number(m.score ?? 0))} / ${m.max_marks} · ${g.grade}${g.descriptor ? ` (${g.descriptor})` : ''}` };
      }),
    ];
    const fill = {
      school: String((await this.settings.doc(t)).values['school.name'] ?? t.info.name), student: s.name, class: s.class, admissionNo: s.admission_no, rollNo: s.roll_no || '-',
      exam: res.exam.name, percent: fmtNumber(row.pct), grade: row.grade, gpa: row.gpa !== null ? fmtNumber(row.gpa) : '', result: row.pct >= grading.pass ? tx('Passed') : tx('Needs support'),
      rank: showRank ? String(row.rank) : '', classSize: String(res.rows.length),
    };
    return { name: `${s.admission_no}-${res.exam.name.replace(/[^\w-]+/g, '_')}.pdf`, ...(await this.render(t, 'reportCard', fill, lines, draft)) };
  }
}
