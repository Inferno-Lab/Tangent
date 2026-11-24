import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { FormAnswer, FormInput, checkAnswers, schoolToday, tx, type FormResponseRow, type FormRow } from '@tangent/contracts';
import { newId, toCsv } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { Core, CurrentUser, Public, Require } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { FamilyService } from './family.service.js';
import { AuditService } from './support.js';

type User = { id: string; name: string };
type Raw = { id: string; title: string; intro: string; fields: FormRow['fields']; conditions: FormRow['conditions']; audience: FormRow['audience']; per_child: boolean;
  status: FormRow['status']; closes_on: string | null; token: string | null; created_at: Date; responses: string };
const SELECT = `select f.*, f.closes_on::text closes_on, (select count(*) from form_responses r where r.form_id = f.id) responses from forms f`;
const row = (r: Raw): FormRow => ({ id: r.id, title: r.title, intro: r.intro, fields: r.fields, conditions: r.conditions ?? {}, audience: r.audience, perChild: r.per_child, status: r.status,
  closesOn: r.closes_on, token: r.audience === 'link' ? r.token : null, responses: Number(r.responses), createdAt: r.created_at.toISOString() });

/** The school's own forms: built in the admin, answered in the app or by link, the answers read and downloaded in the admin. */
@Injectable()
export class FormsService {
  constructor(private readonly audit: AuditService) {}

  async list(t: TenantCtx): Promise<FormRow[]> {
    return (await t.pool.query<Raw>(`${SELECT} order by f.created_at desc limit 300`)).rows.map(row);
  }

  private async one(t: TenantCtx, id: string): Promise<FormRow> {
    const r = (await t.pool.query<Raw>(`${SELECT} where f.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That form'));
    return row(r);
  }

  /** Open now: its status is open and its closing day (the school's) has not passed. */
  private open(f: FormRow): boolean {
    return f.status === 'open' && (!f.closesOn || f.closesOn >= schoolToday());
  }

  async save(t: TenantCtx, user: User, id: string | null, b: FormInput): Promise<FormRow> {
    if (b.closesOn && b.status === 'open' && b.closesOn < schoolToday()) throw new ApiError('validation', tx('The closing day has passed.'), { fields: { closesOn: tx('Pick today or later.') } });
    if (id) {
      const was = await this.one(t, id);
      // Once answered, the questions stay as they were answered: only the wording around them, who it is for and when it closes change.
      if (was.responses && JSON.stringify(was.fields.map((f) => [f.key, f.kind])) !== JSON.stringify(b.fields.map((f) => [f.key, f.kind]))) {
        throw new ApiError('conflict', tx('This form has answers, so its questions cannot be added, removed or changed in kind. Make a new form instead.'));
      }
      if (was.responses && (was.audience !== b.audience || was.perChild !== b.perChild)) throw new ApiError('conflict', tx('This form has answers, so who answers it cannot change.'));
      await t.pool.query('update forms set title = $2, intro = $3, fields = $4, conditions = $5, audience = $6, per_child = $7, status = $8, closes_on = $9, token = coalesce(token, $10) where id = $1',
        [id, b.title, b.intro, JSON.stringify(b.fields), JSON.stringify(b.conditions), b.audience, b.perChild, b.status, b.closesOn, randomBytes(12).toString('base64url')]);
    } else {
      id = newId('frm');
      await t.pool.query('insert into forms (id, title, intro, fields, conditions, audience, per_child, status, closes_on, token, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [id, b.title, b.intro, JSON.stringify(b.fields), JSON.stringify(b.conditions), b.audience, b.perChild, b.status, b.closesOn, randomBytes(12).toString('base64url'), user.id]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'form.saved', entity: 'form', entityId: id, detail: { title: b.title, status: b.status } });
    return this.one(t, id);
  }

  async remove(t: TenantCtx, user: User, id: string): Promise<void> {
    const f = await this.one(t, id);
    if (f.responses) throw new ApiError('conflict', tx('This form has answers: close it instead, so they are kept.'));
    await t.pool.query('delete from forms where id = $1', [id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'form.removed', entity: 'form', entityId: id, detail: { title: f.title } });
  }

  async responses(t: TenantCtx, id: string): Promise<{ form: FormRow; rows: FormResponseRow[] }> {
    const form = await this.one(t, id);
    const { rows } = await t.pool.query<{ id: string; by_name: string; student: string | null; answers: FormResponseRow['answers']; created_at: Date }>(
      'select r.id, r.by_name, s.name student, r.answers, r.created_at from form_responses r left join students s on s.id = r.student_id where r.form_id = $1 order by r.created_at desc limit 5000', [id]);
    return { form, rows: rows.map((r) => ({ id: r.id, by: r.by_name, studentName: r.student, answers: r.answers, createdAt: r.created_at.toISOString() })) };
  }

  /** The answers as a spreadsheet: who, for which child, when, then a column a question. */
  async csv(t: TenantCtx, id: string): Promise<{ name: string; text: string }> {
    const { form, rows } = await this.responses(t, id);
    const q = (v: unknown) => (Array.isArray(v) ? v.join('; ') : v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? tx('Yes') : tx('No')) : String(v));
    const head = [tx('From'), tx('Child'), tx('When'), ...form.fields.map((f) => f.label)];
    const lines = rows.map((r) => [r.by, r.studentName ?? '', r.createdAt.slice(0, 16).replace('T', ' '), ...form.fields.map((f) => q(r.answers[f.key]))]);
    return { name: `${form.title} - ${schoolToday()}.csv`.replace(/[^\w ,.-]+/g, ' '), text: toCsv([head, ...lines]) };
  }

  // ── Answering ───────────────────────────────────────────────────────────────

  /** The forms open to someone in the app: families' (with which children still to answer for), or staff's. */
  async forPerson(t: TenantCtx, who: { id: string; kind: 'staff' | 'guardian' | 'student'; children: string[] }) {
    const audience = who.kind === 'staff' ? 'staff' : who.kind === 'guardian' ? 'families' : null;
    if (!audience) return [];
    const forms = (await t.pool.query<Raw>(`${SELECT} where f.audience = $1 and f.status = 'open' and (f.closes_on is null or f.closes_on >= $2) order by f.created_at desc`, [audience, schoolToday()])).rows.map(row);
    const mine = (await t.pool.query<{ form_id: string; student_id: string | null }>('select form_id, student_id from form_responses where user_id = $1', [who.id])).rows;
    return forms.map((f) => {
      const done = mine.filter((m) => m.form_id === f.id);
      const pending = f.perChild && audience === 'families' ? who.children.filter((c) => !done.some((d) => d.student_id === c)) : done.length ? [] : [null];
      return { id: f.id, title: f.title, intro: f.intro, fields: f.fields, conditions: f.conditions, perChild: f.perChild, closesOn: f.closesOn, pending, answered: done.length > 0 };
    });
  }

  /** A family's or staff member's answer; a second answer (for the same child) replaces the first. */
  async answer(t: TenantCtx, who: { id: string; name: string; kind: 'staff' | 'guardian' | 'student'; children: string[] }, id: string, b: FormAnswer): Promise<{ ok: true }> {
    const f = await this.one(t, id);
    const audience = who.kind === 'staff' ? 'staff' : who.kind === 'guardian' ? 'families' : null;
    if (f.audience !== audience) throw forbidden(tx('This form is not for you.'));
    if (!this.open(f)) throw new ApiError('conflict', tx('This form is closed.'));
    let student: string | null = null;
    if (f.perChild && audience === 'families') {
      if (!b.studentId || !who.children.includes(b.studentId)) throw new ApiError('validation', tx('Say which child this answer is for.'), { fields: { studentId: tx('Choose your child.') } });
      student = b.studentId;
    }
    const { values, errors } = checkAnswers(f, b.answers);
    if (Object.keys(errors).length) throw new ApiError('validation', Object.values(errors)[0]!, { fields: errors });
    await t.pool.query(
      `insert into form_responses (id, form_id, user_id, student_id, by_name, answers) values ($1,$2,$3,$4,$5,$6)
       on conflict (form_id, user_id, coalesce(student_id, '')) where user_id is not null do update set answers = excluded.answers, created_at = now()`,
      [newId('frs'), id, who.id, student, who.name, JSON.stringify(values)]);
    return { ok: true };
  }

  /** A form anyone with its link may fill (no sign-in): the robot field, and at most ten answers an hour from one address. */
  async byLink(t: TenantCtx, token: string): Promise<Pick<FormRow, 'title' | 'intro' | 'fields' | 'conditions'> & { open: boolean }> {
    const r = (await t.pool.query<Raw>(`${SELECT} where f.token = $1 and f.audience = 'link' and f.status <> 'draft'`, [token])).rows[0];
    if (!r) throw notFound(tx('That form'));
    const f = row(r);
    return { title: f.title, intro: f.intro, fields: f.fields, conditions: f.conditions, open: this.open(f) };
  }

  async answerByLink(t: TenantCtx, token: string, b: FormAnswer, from: string): Promise<{ ok: true }> {
    const r = (await t.pool.query<Raw>(`${SELECT} where f.token = $1 and f.audience = 'link' and f.status <> 'draft'`, [token])).rows[0];
    if (!r) throw notFound(tx('That form'));
    const f = row(r);
    if (!this.open(f)) throw new ApiError('conflict', tx('This form is closed.'));
    if (b.website) return { ok: true };
    const hash = createHash('sha256').update(`${t.info.id}|${from}`).digest('hex');
    const recent = Number((await t.pool.query<{ n: string }>("select count(*) n from form_responses where from_hash = $1 and created_at > now() - interval '1 hour'", [hash])).rows[0]!.n);
    if (recent >= 10) throw new ApiError('rate_limited', tx('Too many answers from here. Try again in an hour.'), { retryAfter: 3600 });
    const { values, errors } = checkAnswers(f, b.answers);
    if (Object.keys(errors).length) throw new ApiError('validation', Object.values(errors)[0]!, { fields: errors });
    await t.pool.query('insert into form_responses (id, form_id, by_name, answers, from_hash) values ($1,$2,$3,$4,$5)', [newId('frs'), f.id, tx('By link'), JSON.stringify(values), hash]);
    return { ok: true };
  }
}

@Controller('v1/forms')
@Core()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get() @Require('forms.manage')
  list(@Tenant() t: TenantCtx): Promise<FormRow[]> { return this.forms.list(t); }

  @Post() @HttpCode(200) @Require('forms.manage')
  add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(FormInput)) b: FormInput): Promise<FormRow> { return this.forms.save(t, u, null, b); }

  @Put(':id') @Require('forms.manage')
  save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(FormInput)) b: FormInput): Promise<FormRow> { return this.forms.save(t, u, id, b); }

  @Delete(':id') @HttpCode(204) @Require('forms.manage')
  remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string): Promise<void> { return this.forms.remove(t, u, id); }

  @Get(':id/responses') @Require('forms.manage')
  responses(@Tenant() t: TenantCtx, @Param('id') id: string) { return this.forms.responses(t, id); }

  @Get(':id/responses.csv') @Require('forms.manage')
  async csv(@Tenant() t: TenantCtx, @Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const c = await this.forms.csv(t, id);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${c.name}"`);
    return c.text;
  }

  // Forms anyone with the link may fill, before anyone signs in.
  @Public() @Get('link/:token')
  link(@Tenant() t: TenantCtx, @Param('token') token: string) { return this.forms.byLink(t, token); }

  @Public() @Post('link/:token') @HttpCode(200)
  answerLink(@Tenant() t: TenantCtx, @Req() req: FastifyRequest, @Param('token') token: string, @Body(new ZodPipe(FormAnswer)) b: FormAnswer): Promise<{ ok: true }> {
    return this.forms.answerByLink(t, token, b, req.ip);
  }
}

/** The app's side: open forms for the signed-in family or member of staff, and their answers. */
@Controller('v1/f/forms')
@Core()
export class FamilyFormsController {
  constructor(private readonly forms: FormsService, private readonly f: FamilyService) {}

  @Get()
  async list(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return this.forms.forPerson(t, await this.f.who(t, u)); }

  @Post(':id') @HttpCode(200)
  async answer(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(FormAnswer)) b: FormAnswer): Promise<{ ok: true }> {
    return this.forms.answer(t, await this.f.who(t, u), id, b);
  }
}
