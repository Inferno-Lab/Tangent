import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put } from '@nestjs/common';
import { SETUP_KINDS, SetupSave, importKind, schoolCountry, schoolToday, schoolZone, tx, type SetupSection } from '@tangent/contracts';
import { commitImport, exportRows, newId, previewImport } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { Core, CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { AuditService, SettingsService } from './support.js';
import { HubService } from './hub.service.js';

const REMOVE: Record<string, { sql: string; inUse: string }> = {
  years: { sql: 'delete from academic_years where id = $1', inUse: 'Classes still belong to this year. Move them to another year first.' },
  terms: { sql: 'delete from terms where id = $1', inUse: 'Something still uses this term.' },
  holidays: { sql: "delete from events where id = $1 and kind = 'holiday'", inUse: 'Something still uses this holiday.' },
  classes: { sql: 'delete from classes where id = $1', inUse: 'Students are still in this class. Move them to another class first.' },
  subjects: { sql: 'delete from subjects where id = $1', inUse: 'The timetable, homework or exams still use this subject.' },
  periods: { sql: "delete from periods where idx::text = $1", inUse: 'The timetable still uses this period. Move those lessons first.' },
  fee_structures: { sql: 'delete from fee_structures where id = $1', inUse: 'Something still uses this fee.' },
};
const LOCKED: Record<string, string> = {
  'calendar.schoolEdits': 'Tangent keeps your years, terms and holidays. Ask Tangent to change them.',
  'classes.schoolEdits': 'Tangent keeps your classes, subjects and periods. Ask Tangent to change them.',
  'feeStructures.schoolEdits': 'Tangent keeps your fee structures. Ask Tangent to change them.',
};

/** Classes and calendar: the school edits its own structure through the import engine, so a typed row gets the same checks (and undo) as a file. */
@Injectable()
export class SetupService {
  constructor(private readonly audit: AuditService, private readonly settings: SettingsService, private readonly hubs: HubService) {}

  /**
   * The country's public holidays in the current school year (which may span two calendar years), from the Public holidays
   * connection, each marked when the school already has a holiday that day. The school picks which to add (Year → Holidays).
   */
  async publicHolidays(t: TenantCtx): Promise<{ date: string; name: string; have: boolean }[]> {
    const country = schoolCountry();
    if (!country) throw new ApiError('validation', tx('Set the school’s country first (School profile).'));
    const y = (await t.pool.query<{ s: string; e: string }>('select starts_on::text s, ends_on::text e from academic_years where current limit 1')).rows[0];
    const today = schoolToday();
    const [from, to] = y ? [y.s, y.e] : [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    const r = await this.hubs.hub.resolve('holidays', t.info.id, t.info.slug).catch(() => null);
    if (!r?.adapter.holidays) throw new ApiError('school_unavailable', tx('Public holidays are not connected for this school yet. Ask Tangent to connect them (Integrations → Public holidays).'));
    const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
    const found = (await Promise.all(years.map((n) => r.adapter.holidays!(r.ctx, country, n)))
      .catch((e: Error) => { throw new ApiError('school_unavailable', tx('The public holidays could not be read: {message}', { message: e.message })); })).flat();
    const have = new Set((await t.pool.query<{ d: string }>("select (starts_at at time zone $1)::date::text d from events where kind = 'holiday'", [schoolZone()])).rows.map((x) => x.d));
    const seen = new Set<string>();
    return found.filter((h) => h.date >= from && h.date <= to && !seen.has(`${h.date}|${h.name}`) && seen.add(`${h.date}|${h.name}`))
      .sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ ...h, have: have.has(h.date) }));
  }

  async sections(t: TenantCtx): Promise<SetupSection[]> {
    const modules = (await this.settings.effective(t)).modules;
    const out: SetupSection[] = [];
    for (const s of SETUP_KINDS) {
      const kind = importKind(s.key)!;
      if (kind.module !== 'core' && !modules.includes(kind.module)) continue;
      const rows = (await exportRows(t.pool, s.key)) as SetupSection['rows'];
      out.push({ kind: s.key, label: kind.label, locked: (await this.settings.value<boolean>(t, s.lock, true)) === false, columns: kind.columns, rows });
    }
    return out;
  }

  private async open(t: TenantCtx, key: string): Promise<void> {
    const s = SETUP_KINDS.find((k) => k.key === key);
    const kind = importKind(key);
    if (!s || !kind) throw notFound('That part of setup');
    if (kind.module !== 'core' && !(await this.settings.effective(t)).modules.includes(kind.module)) throw new ApiError('locked', 'This feature is not part of your school’s plan.');
    if ((await this.settings.value<boolean>(t, s.lock, true)) === false) throw forbidden(LOCKED[s.lock]!);
  }

  async save(t: TenantCtx, key: string, row: Record<string, string>, user: { id: string; name: string }): Promise<SetupSection[]> {
    await this.open(t, key);
    const input = { kind: key, rows: [row], fileName: 'School setup' };
    const check = (await previewImport(t.pool, input)).rows[0]!;
    if (check.errors.length) throw new ApiError('validation', check.errors.join(' '));
    await commitImport(t.pool, input, user.name);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'setup.saved', entity: key, detail: { added: check.action === 'create' } });
    return this.sections(t);
  }

  async remove(t: TenantCtx, key: string, id: string, user: { id: string; name: string }): Promise<SetupSection[]> {
    await this.open(t, key);
    try {
      const { rowCount } = await t.pool.query(REMOVE[key]!.sql, [id]);
      if (!rowCount) throw notFound('That row');
    } catch (err) {
      if ((err as { code?: string }).code === '23503') throw new ApiError('conflict', REMOVE[key]!.inUse);
      throw err;
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'setup.removed', entity: key, entityId: id });
    return this.sections(t);
  }

  /** Bills every active student in the fee's grade (or every grade) once: a student who already has a fee with this name is left alone. */
  async apply(t: TenantCtx, id: string, user: { id: string; name: string }): Promise<{ created: number }> {
    const fee = (await t.pool.query<{ head: string; title: string; amount: number; due_on: string; grade: number | null; category: string | null }>('select head, title, amount, due_on::text, grade, category from fee_structures where id = $1', [id])).rows[0];
    if (!fee) throw notFound('That fee');
    // A category's own fee goes to that category only; the everyone fee goes to every other student, and to a category's
    // students only where the category has no fee of its own for that head (for their grade or every grade).
    const { rows } = await t.pool.query<{ id: string }>(
      `select s.id from students s join classes c on c.id = s.class_id where s.status = 'active' and ($1::int is null or c.grade = $1)
       and not exists (select 1 from fee_invoices i where i.student_id = s.id and lower(i.title) = lower($2))
       and (case when $3::text is not null then s.fee_category = $3
            else s.fee_category is null or not exists (select 1 from fee_structures o where o.category = s.fee_category and o.head = $4 and (o.grade is null or o.grade = c.grade)) end)`,
      [fee.grade, fee.title, fee.category, fee.head]);
    if (rows.length) {
      await t.pool.query('insert into fee_invoices (id, student_id, head, title, amount, due_on) select unnest($1::text[]), unnest($2::text[]), $3, $4, $5, $6',
        [rows.map(() => newId('inv')), rows.map((r) => r.id), fee.head, fee.title, await this.settings.billed(t, fee.head, fee.amount), fee.due_on]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'fee.assigned', entity: 'fee_structure', entityId: id, detail: { count: rows.length, title: fee.title, amount: fee.amount } });
    return { created: rows.length };
  }
}

@Controller('v1/setup')
@Core()
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get() @Require('students.read')
  sections(@Tenant() t: TenantCtx): Promise<SetupSection[]> {
    return this.setup.sections(t);
  }

  @Get('holidays/public') @Require('setup.write')
  publicHolidays(@Tenant() t: TenantCtx): Promise<{ date: string; name: string; have: boolean }[]> {
    return this.setup.publicHolidays(t);
  }

  // Each kind belongs to a module (fee structures to fees); `open` checks it, since the kind is in the path.
  @Put(':kind') @Require('setup.write')
  save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('kind') kind: string, @Body(new ZodPipe(SetupSave)) body: SetupSave): Promise<SetupSection[]> {
    return this.setup.save(t, kind, body.row, u);
  }

  @Delete(':kind/:id') @Require('setup.write')
  remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('kind') kind: string, @Param('id') id: string): Promise<SetupSection[]> {
    return this.setup.remove(t, kind, id, u);
  }

  @Post('fee_structures/:id/apply') @HttpCode(200) @RequireModule('fees') @Require('fees.collect')
  apply(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string): Promise<{ created: number }> {
    return this.setup.apply(t, id, u);
  }
}
