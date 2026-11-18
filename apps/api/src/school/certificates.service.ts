import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query, Req, Res, type OnModuleInit } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  CertificateRequest, DEFAULT_CERTIFICATE_TYPES, IdCardsInput, fillCertificate, fmtDate, fmtMoney, schoolToday, tx, type CertificateCheck, type CertificateRow, type CertificateType,
} from '@tangent/contracts';
import { newId, nextNumber } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { CurrentUser, Public, Require, RequireModule } from '../auth/guards.js';
import { ENV, type Env } from '../env.js';
import { requestLanguage } from '@tangent/tenancy';
import { signLink } from '@tangent/integrations';
import type { DocLink } from './hooks.controller.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { ApprovalsService } from './approvals.service.js';
import { DocumentsService } from './documents.service.js';
import { FamilyService } from './family.service.js';
import { FilesService } from './files.service.js';
import { pdf, sendPdf } from './pdf.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type User = { id: string; name: string };
type Raw = { id: string; type: string; type_name: string; student_id: string; student_name: string; class_name: string; purpose: string; number: string | null; state: CertificateRow['state'];
  invoice_id: string | null; token: string; body: string; requested_by_name: string; issued_at: Date | null; issued_by_name: string | null; note: string; created_at: Date; due: string | null };
const SELECT = `select x.*, s.name student_name, c.name class_name, (select name from users u where u.id = x.issued_by) issued_by_name,
  (select i.amount - i.waived_amount - coalesce((select sum(p.amount - p.refunded) from payments p where p.invoice_id = i.id), 0) from fee_invoices i where i.id = x.invoice_id) due
  from certificates x join students s on s.id = x.student_id join classes c on c.id = s.class_id`;
const row = (r: Raw): CertificateRow => ({
  id: r.id, type: r.type, typeName: r.type_name, studentId: r.student_id, studentName: r.student_name, className: r.class_name, purpose: r.purpose, number: r.number, state: r.state,
  feeDue: Math.max(0, Number(r.due ?? 0)), requestedBy: r.requested_by_name, issuedAt: r.issued_at?.toISOString() ?? null, issuedBy: r.issued_by_name, note: r.note, createdAt: r.created_at.toISOString(),
});

/**
 * Certificates and ID cards (one-shot plan 6.24). A certificate is asked for, then issued through the school's steps
 * (`certificate`) once its fee is paid and, for a type that needs it, nothing is owed; its words are kept as issued, and its QR
 * code opens a public page that says only whether it is genuine.
 */
@Injectable()
export class CertificatesService implements OnModuleInit {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly approvals: ApprovalsService,
    private readonly documents: DocumentsService,
    private readonly files: FilesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.approvals.effect('certificate', {
      done: tx('Certificate issued'),
      check: async (t, r, decision) => {
        if (decision !== 'approve') return;
        const c = await this.one(t, String(r.payload.certificateId ?? ''));
        if (c.state !== 'pending') throw new ApiError('conflict', tx('This certificate is no longer waiting.'));
        if (c.feeDue > 0) throw new ApiError('conflict', tx('The fee for this certificate ({amount}) is not paid yet.', { amount: fmtMoney(c.feeDue) }));
        const type = (await this.types(t)).find((x) => x.key === c.type);
        if (type?.noDues) {
          const owed = await this.owed(t, c.studentId);
          if (owed) throw new ApiError('conflict', owed);
        }
      },
      apply: async (client, r, decision, by, t) => {
        const id = String(r.payload.certificateId ?? '');
        if (decision === 'reject') { await client.query("update certificates set state = 'rejected' where id = $1 and state = 'pending'", [id]); return; }
        if (decision === 'undo') { await client.query("update certificates set state = 'pending', issued_at = null, issued_by = null where id = $1 and state in ('issued','rejected')", [id]); return; }
        const c = await this.one(t, id);
        const type = (await this.types(t)).find((x) => x.key === c.type);
        const pattern = type?.series || (await this.settings.value<string>(t, 'certificates.number', 'CERT-{yyyy}-{seq:4}'));
        const ay = ((await client.query('select label from academic_years where current limit 1')).rows[0] as { label?: string } | undefined)?.label ?? '';
        // A certificate undone and issued again keeps its number.
        const number = c.number ?? (await nextNumber(client as never, { pattern, start: 1, day: schoolToday(), ay, table: 'certificates', column: 'number' }));
        const body = fillCertificate(type?.text ?? '', { ...(await this.fill(t, c.studentId, c.purpose)), number });
        await client.query("update certificates set state = 'issued', number = $2, body = $3, issued_at = now(), issued_by = $4 where id = $1 and state = 'pending'", [id, number, body, by.id || null]);
      },
      tell: async (t, r, status) => {
        if (status !== 'approved') return;
        const c = await this.one(t, String(r.payload.certificateId ?? '')).catch(() => null);
        if (!c) return;
        const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(
          'select distinct g.phone, g.email from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = $1 and sg.gets_messages', [c.studentId])).rows;
        await this.messenger.notify(t, 'certificate.ready', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { type: c.typeName, student: c.studentName } })));
      },
    });
  }

  types(t: TenantCtx): Promise<CertificateType[]> {
    return this.settings.value<CertificateType[]>(t, 'certificates.types', DEFAULT_CERTIFICATE_TYPES);
  }

  private async one(t: TenantCtx, id: string): Promise<CertificateRow> {
    const r = (await t.pool.query<Raw>(`${SELECT} where x.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That certificate'));
    return row(r);
  }

  async list(t: TenantCtx, f: { state?: string; studentIds?: string[]; q?: string }): Promise<CertificateRow[]> {
    const { rows } = await t.pool.query<Raw>(`${SELECT} where ($1::text is null or x.state = $1) and ($2::text[] is null or x.student_id = any($2))
      and ($3 = '' or s.name ilike '%' || $3 || '%' or x.number ilike '%' || $3 || '%') order by x.created_at desc limit 500`, [f.state ?? null, f.studentIds ?? null, (f.q ?? '').trim().slice(0, 60)]);
    return rows.map(row);
  }

  /** What stops a no-dues certificate: fees owed, or library items not returned. Null when nothing is owed. */
  private async owed(t: TenantCtx, studentId: string): Promise<string | null> {
    const cfg = await this.settings.effective(t);
    if (cfg.modules.includes('fees')) {
      const due = Number((await t.pool.query<{ n: string }>(
        `select coalesce(sum(greatest(0, i.amount - i.waived_amount - coalesce((select sum(p.amount - p.refunded) from payments p where p.invoice_id = i.id), 0))), 0) n
         from fee_invoices i where i.student_id = $1 and i.due_on <= $2`, [studentId, schoolToday()])).rows[0]!.n);
      if (due > 0) return tx('{amount} in fees is owed. The certificate is issued once nothing is owed.', { amount: fmtMoney(due) });
    }
    if (cfg.modules.includes('library')) {
      const out = Number((await t.pool.query<{ n: string }>('select count(*) n from library_loans where student_id = $1 and returned_on is null', [studentId])).rows[0]!.n);
      if (out) return tx('{n} library items are not returned. The certificate is issued once nothing is owed.', { n: out });
    }
    return null;
  }

  /** The values a certificate's words are filled with. */
  private async fill(t: TenantCtx, studentId: string, purpose: string): Promise<Record<string, string>> {
    const s = (await t.pool.query<{ name: string; admission_no: string; dob: string | null; admitted_on: string | null; left_on: string | null; class: string; guardian: string | null }>(
      `select s.name, s.admission_no, s.dob::text dob, s.admitted_on::text admitted_on, s.left_on::text left_on, c.name class,
         (select g.name from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = s.id order by sg.is_primary desc limit 1) guardian
       from students s join classes c on c.id = s.class_id where s.id = $1`, [studentId])).rows[0];
    if (!s) throw notFound(tx('That student'));
    const school = String((await this.settings.doc(t)).values['school.name'] ?? t.info.name);
    return {
      student: s.name, admissionNo: s.admission_no, dob: s.dob ? fmtDate(s.dob, 'long') : '', admittedOn: s.admitted_on ? fmtDate(s.admitted_on, 'long') : '',
      leftOn: s.left_on ? fmtDate(s.left_on, 'long') : fmtDate(schoolToday(), 'long'), class: s.class, guardian: s.guardian ?? '', purpose: purpose || tx('the purpose asked for'),
      date: fmtDate(schoolToday(), 'long'), school,
    };
  }

  /**
   * Asked for by a family (a type families may ask for, for their own child) or by the office. A fee makes an invoice on the
   * family's fees (when the school has Fees); the request goes into the approvals queue.
   */
  async request(t: TenantCtx, by: User, b: CertificateRequest, family: boolean): Promise<CertificateRow> {
    const type = (await this.types(t)).find((x) => x.key === b.type && x.active !== false);
    if (!type || (family && !type.families)) throw new ApiError('validation', tx('Choose one of the certificates the school gives.'), { fields: { type: tx('Choose a certificate.') } });
    const s = (await t.pool.query<{ name: string; status: string }>('select name, status from students where id = $1', [b.studentId])).rows[0];
    if (!s) throw notFound(tx('That student'));
    if (s.status !== 'active' && s.status !== 'left') throw new ApiError('conflict', tx('This student’s record is closed.'));
    if ((await t.pool.query("select 1 from certificates where student_id = $1 and type = $2 and state = 'pending'", [b.studentId, type.key])).rowCount) {
      throw new ApiError('conflict', tx('A {type} for {name} is already waiting.', { type: type.name, name: s.name }));
    }
    const id = newId('crt');
    const fees = type.fee > 0 && (await this.settings.effective(t)).modules.includes('fees');
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      let invoice: string | null = null;
      if (fees) {
        invoice = newId('inv');
        await client.query("insert into fee_heads (key, name, sort, concession) values ('certificates', 'Certificates', 910, false) on conflict (key) do nothing");
        await client.query('insert into fee_invoices (id, student_id, head, title, amount, due_on) values ($1,$2,$3,$4,$5,$6)',
          [invoice, b.studentId, 'certificates', type.name.slice(0, 80), await this.settings.billed(t, 'certificates', type.fee), schoolToday()]);
      }
      await client.query('insert into certificates (id, type, type_name, student_id, purpose, state, invoice_id, token, requested_by, requested_by_name) values ($1,$2,$3,$4,$5,\'pending\',$6,$7,$8,$9)',
        [id, type.key, type.name, b.studentId, b.purpose, invoice, randomBytes(16).toString('base64url'), by.id, by.name]);
      await client.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'certificate',$2,$3,$4,$5,$6,$7)",
        [newId('apr'), tx('{type} for {name}', { type: type.name, name: s.name }), b.purpose || (fees ? tx('Fee {amount}', { amount: fmtMoney(type.fee) }) : ''), by.name, by.id, b.studentId, JSON.stringify({ certificateId: id })]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'certificate.requested', entity: 'certificate', entityId: id, detail: { type: type.key, student: s.name, family } });
    return this.one(t, id);
  }

  /** A request still waiting is called off (its unpaid fee too). */
  async cancel(t: TenantCtx, by: User, id: string, children: string[] | null): Promise<CertificateRow> {
    const c = await this.one(t, id);
    if (children && !children.includes(c.studentId)) throw notFound(tx('That certificate'));
    if (c.state !== 'pending') throw new ApiError('conflict', tx('Only a request still waiting can be cancelled.'));
    await t.pool.query("update certificates set state = 'cancelled' where id = $1", [id]);
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2 where kind = 'certificate' and payload->>'certificateId' = $1 and status = 'pending'", [id, by.id]);
    // Its fee goes only while nothing was paid on it.
    await t.pool.query('delete from fee_invoices i where i.id = (select invoice_id from certificates where id = $1) and not exists (select 1 from payments p where p.invoice_id = i.id)', [id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'certificate.cancelled', entity: 'certificate', entityId: id, detail: { student: c.studentName } });
    return this.one(t, id);
  }

  /** An issued certificate withdrawn (given in error): its QR page then says so. */
  async revoke(t: TenantCtx, by: User, id: string, note: string): Promise<CertificateRow> {
    const c = await this.one(t, id);
    if (c.state !== 'issued') throw new ApiError('conflict', tx('Only an issued certificate can be revoked.'));
    if (note.trim().length < 3) throw new ApiError('validation', tx('Say why it is revoked.'), { fields: { note: tx('Say why.') } });
    await t.pool.query("update certificates set state = 'revoked', note = $2 where id = $1", [id, note.trim().slice(0, 200)]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'certificate.revoked', entity: 'certificate', entityId: id, detail: { number: c.number, note } });
    return this.one(t, id);
  }

  async pdf(t: TenantCtx, id: string, children: string[] | null): Promise<{ name: string; data: Buffer }> {
    const r = (await t.pool.query<Raw>(`${SELECT} where x.id = $1`, [id])).rows[0];
    if (!r || (children && !children.includes(r.student_id))) throw notFound(tx('That certificate'));
    if (r.state !== 'issued') throw new ApiError('conflict', tx('This certificate has not been issued.'));
    const fill = { school: String((await this.settings.doc(t)).values['school.name'] ?? t.info.name), title: r.type_name, number: r.number ?? '', date: fmtDate(r.issued_at!.toISOString().slice(0, 10), 'long'),
      body: r.body, student: r.student_name, class: r.class_name, admissionNo: '' };
    const qr = `${this.env.API_BASE_URL}/s/${t.info.slug}/verify/${r.token}`;
    return { name: `${r.number}.pdf`, ...(await this.documents.render(t, 'certificate', fill, [], undefined, { qr })) };
  }

  /** What the public page says for a certificate's QR code: genuine or not, and only what identifies it. */
  async verify(t: TenantCtx, token: string): Promise<CertificateCheck> {
    const school = String((await this.settings.doc(t)).values['school.name'] ?? t.info.name);
    const r = token.length >= 16 ? (await t.pool.query<Raw>(`${SELECT} where x.token = $1 and x.state in ('issued','revoked')`, [token])).rows[0] : undefined;
    if (!r) return { genuine: false, revoked: false, school };
    return { genuine: r.state === 'issued', revoked: r.state === 'revoked', school, type: r.type_name, number: r.number ?? '', student: r.student_name, issuedOn: r.issued_at ? fmtDate(r.issued_at, 'long') : '' };
  }

  /** ID cards, one a page at card size: students of classes (or chosen ones), or the staff, each with their photo where there is one. */
  async idCards(t: TenantCtx, by: User, b: IdCardsInput): Promise<{ name: string; data: Buffer }> {
    const until = b.validUntil ?? (await t.pool.query<{ e: string }>('select ends_on::text e from academic_years where current limit 1')).rows[0]?.e ?? null;
    const people = b.staff
      ? (await t.pool.query<{ id: string; name: string; role: string; number: string; blood: string | null; phone: string | null; cls: string }>(
        "select u.id, u.name, coalesce(st.designation, '') role, u.id number, null blood, u.phone, '' cls from users u join staff st on st.user_id = u.id where u.kind = 'staff' and u.status = 'active' order by u.name")).rows
      : (await t.pool.query<{ id: string; name: string; role: string; number: string; blood: string | null; phone: string | null; cls: string }>(
        `select s.id, s.name, '' role, s.admission_no number, s.blood_group blood, null phone, c.name cls from students s join classes c on c.id = s.class_id
         where s.status = 'active' and (s.class_id = any($1) or s.id = any($2)) order by c.grade, c.name, s.roll_no, s.name`, [b.classIds, b.studentIds])).rows;
    if (!people.length) throw new ApiError('validation', tx('Nobody to print a card for.'));
    if (people.length > 2000) throw new ApiError('validation', tx('Print at most 2000 cards at a time.'));
    const school = String((await this.settings.doc(t)).values['school.name'] ?? t.info.name);
    // Each card on its own, then one PDF of them all (card printers take one card a page).
    const { PDFDocument } = await import('pdf-lib');
    const out = await PDFDocument.create();
    for (const p of people) {
      const photo = await this.files.photoOf(t, b.staff ? 'staff_photo' : 'student_photo', p.id);
      const one = await this.documents.render(t, 'idCard', {
        school, name: p.name, role: b.staff ? p.role || tx('Staff') : tx('Student'), class: p.cls, number: b.staff ? '' : p.number, bloodGroup: p.blood ?? '', phone: p.phone ?? '', validUntil: until ? fmtDate(until) : '',
      }, [], undefined, { photo, qr: `${t.info.slug}:${b.staff ? 'staff' : 'student'}:${b.staff ? p.id : p.number}` });
      const doc = await PDFDocument.load(one.data);
      for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'idCards.printed', entity: b.staff ? 'staff' : 'student', detail: { count: people.length } });
    return { name: `${tx('ID cards')} ${schoolToday()}.pdf`, data: Buffer.from(await out.save()) };
  }

  /** The issue register as a printable list. */
  async registerPdf(t: TenantCtx): Promise<{ name: string; data: Buffer }> {
    const rows = await this.list(t, {});
    const issued = rows.filter((r) => r.state === 'issued' || r.state === 'revoked');
    return {
      name: `${tx('Certificate register')} ${schoolToday()}.pdf`,
      data: await pdf([{ text: t.info.name, size: 16, bold: true }, { text: tx('Certificate register'), size: 12 }, { text: '', rule: true },
        ...issued.map((r) => ({ text: `${r.number} · ${r.typeName} · ${r.studentName}${r.state === 'revoked' ? ` (${tx('revoked')})` : ''}`, right: r.issuedAt ? fmtDate(r.issuedAt) : '', size: 10 }))]),
    };
  }
}

@Controller('v1/certificates')
@RequireModule('certificates')
export class CertificatesController {
  constructor(private readonly c: CertificatesService) {}

  @Get() @Require('certificates.read')
  list(@Tenant() t: TenantCtx, @Query('state') state?: string, @Query('studentId') studentId?: string, @Query('q') q?: string) {
    return this.c.list(t, { state: state || undefined, studentIds: studentId ? [studentId] : undefined, q });
  }

  @Get('types') @Require('certificates.read')
  types(@Tenant() t: TenantCtx) { return this.c.types(t); }

  @Post() @HttpCode(200) @Require('certificates.read')
  request(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(CertificateRequest)) b: CertificateRequest) { return this.c.request(t, u, b, false); }

  @Post(':id/cancel') @HttpCode(200) @Require('certificates.read')
  cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.c.cancel(t, u, id, null); }

  @Post(':id/revoke') @HttpCode(200) @Require('certificates.issue')
  revoke(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body() b: { note?: string }) { return this.c.revoke(t, u, id, String(b?.note ?? '')); }

  @Get('register.pdf') @Require('certificates.read')
  async register(@Tenant() t: TenantCtx, @Res() reply: FastifyReply) { sendPdf(reply, await this.c.registerPdf(t)); }

  @Get(':id/certificate.pdf') @Require('certificates.read')
  async file(@Tenant() t: TenantCtx, @Param('id') id: string, @Res() reply: FastifyReply) { sendPdf(reply, await this.c.pdf(t, id, null)); }

  @Post('id-cards') @HttpCode(200) @Require('certificates.issue')
  async cards(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(IdCardsInput)) b: IdCardsInput, @Res() reply: FastifyReply) { sendPdf(reply, await this.c.idCards(t, u, b)); }

  // The page a certificate's QR code opens, before anyone signs in.
  @Public() @Get('verify/:token')
  verify(@Tenant() t: TenantCtx, @Param('token') token: string) { return this.c.verify(t, token); }
}

/** The app: a family asks for a certificate for their child and downloads it once issued. */
@Controller('v1/f/certificates')
@RequireModule('certificates')
export class FamilyCertificatesController {
  constructor(private readonly c: CertificatesService, private readonly f: FamilyService, @Inject(ENV) private readonly env: Env) {}

  private async parent(t: TenantCtx, u: AuthedUser) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'guardian') throw forbidden(tx('A parent asks for a certificate from their own account.'));
    return w;
  }

  @Get()
  async mine(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) {
    const w = await this.parent(t, u);
    const types = (await this.c.types(t)).filter((x) => x.active !== false && x.families).map((x) => ({ key: x.key, name: x.name, fee: x.fee }));
    return { types, certificates: w.children.length ? await this.c.list(t, { studentIds: w.children }) : [] };
  }

  @Post() @HttpCode(200)
  async request(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(CertificateRequest)) b: CertificateRequest) {
    const w = await this.parent(t, u);
    if (!w.children.includes(b.studentId)) throw notFound(tx('That student'));
    return this.c.request(t, w, b, true);
  }

  @Post(':id/cancel') @HttpCode(200)
  async cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { const w = await this.parent(t, u); return this.c.cancel(t, w, id, w.children); }

  @Get(':id/certificate.pdf')
  async file(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Res() reply: FastifyReply) {
    sendPdf(reply, await this.c.pdf(t, id, (await this.parent(t, u)).children));
  }

  /** A ten-minute link the phone opens outside the app (as receipts are), checked now for this family's children. */
  @Post(':id/link') @HttpCode(200)
  async link(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Req() req: { headers: Record<string, string | string[] | undefined> }): Promise<{ url: string }> {
    const kids = (await this.parent(t, u)).children;
    await this.c.pdf(t, id, kids);
    const token = signLink(this.env.SECRETS_KEY, { p: 'doc', slug: t.info.slug, kind: 'certificate', id, kids, lang: requestLanguage(req.headers['accept-language']) } satisfies DocLink, 600);
    return { url: `${this.env.API_BASE_URL.replace(/\/$/, '')}/hooks/doc/${token}` };
  }
}
