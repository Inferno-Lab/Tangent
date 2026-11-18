import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, type OnModuleInit } from '@nestjs/common';
import { addDays, schoolToday, tx } from '@tangent/contracts';
import { newId, type Job } from '@tangent/db';
import { ApiError, ZodPipe, notFound } from '@tangent/nest-kit';
import { schoolContext } from '@tangent/tenancy';
import { z } from 'zod';
import { Core, CurrentUser, Require } from '../auth/guards.js';
import { Tenant, TenantService, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { HubService } from './hub.service.js';
import { OfficeService } from './office.service.js';
import { AuditService, Messenger } from './support.js';

export const ScheduleInput = z.object({
  reportId: z.string().min(1).max(40),
  classId: z.string().max(60).nullable().default(null),
  every: z.enum(['week', 'month']),
  /** A week's day (1 Monday … 7 Sunday), or a month's (1 to 28: every month has it). */
  day: z.number().int().min(1).max(28),
  to: z.array(z.string().min(1)).min(1, 'Choose who gets it').max(20),
}).refine((s) => s.every === 'month' || s.day <= 7, { message: 'Choose a day of the week', path: ['day'] });
export type ScheduleInput = z.infer<typeof ScheduleInput>;
export interface ScheduleRow extends ScheduleInput { id: string; title: string; toNames: string[]; lastSent: string | null }

/** The days a scheduled report covers: the seven days before the day it goes, or the whole month before. */
export function coverOf(every: 'week' | 'month', day: string): [string, string] {
  if (every === 'week') return [addDays(day, -7), addDays(day, -1)];
  const first = `${day.slice(0, 7)}-01`;
  const prev = addDays(first, -1);
  return [`${prev.slice(0, 7)}-01`, prev];
}
/** Whether a schedule goes on this day (the school's). */
export function dueOn(s: { every: 'week' | 'month'; day: number }, day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return s.every === 'week' ? ((d.getUTCDay() + 6) % 7) + 1 === s.day : d.getUTCDate() === s.day;
}

/**
 * Reports sent by themselves (one-shot plan 5.2.3): any report with its class filter, every week or month, to chosen staff by
 * email, each in their own language, covering the week or the month before.
 */
@Injectable()
export class ReportSchedules implements OnModuleInit {
  constructor(private readonly office: OfficeService, private readonly hubs: HubService, private readonly tenants: TenantService,
    private readonly messenger: Messenger, private readonly audit: AuditService) {}

  onModuleInit(): void {
    this.hubs.handle('reports.scheduled', async (job: Job) => {
      const s = await this.hubs.schoolPool(job.schoolId ?? '');
      if (!s) return 'School not found.';
      return this.sendDue(await this.tenants.resolve(s.slug), String(job.payload.day ?? schoolToday()));
    });
  }

  async list(t: TenantCtx): Promise<ScheduleRow[]> {
    const reports = await this.office.reportList(t);
    const { rows } = await t.pool.query<{ id: string; report_id: string; class_id: string | null; every: 'week' | 'month'; day: number; to_ids: string[]; last_sent: string | null }>(
      'select id, report_id, class_id, every, day, to_ids, last_sent::text from report_schedules order by created_at');
    const names = new Map((await t.pool.query<{ id: string; name: string }>("select id, name from users where kind = 'staff'")).rows.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, reportId: r.report_id, classId: r.class_id, every: r.every, day: r.day, to: r.to_ids, lastSent: r.last_sent,
      title: reports.find((x) => x.id === r.report_id)?.title ?? r.report_id, toNames: r.to_ids.map((x) => names.get(x) ?? '?') }));
  }

  async add(t: TenantCtx, user: AuthedUser, b: ScheduleInput): Promise<ScheduleRow[]> {
    if (!(await this.office.reportList(t)).some((r) => r.id === b.reportId)) throw notFound(tx('That report'));
    // Only staff who may read reports and have an email get them.
    const ok = (await t.pool.query<{ id: string }>(
      `select u.id from users u where u.id = any($1) and u.kind = 'staff' and u.status = 'active' and coalesce(u.email, '') <> ''
       and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and (r.locked or r.permissions ? 'reports.read'))`, [b.to])).rows.map((r) => r.id);
    const bad = b.to.filter((x) => !ok.includes(x));
    if (bad.length) throw new ApiError('validation', tx('Reports go only to staff who may read reports and have an email.'), { fields: { to: tx('Choose someone else.') } });
    if (Number((await t.pool.query<{ n: string }>('select count(*) n from report_schedules')).rows[0]!.n) >= 50) throw new ApiError('conflict', tx('A school keeps at most 50 scheduled reports.'));
    await t.pool.query('insert into report_schedules (id, report_id, class_id, every, day, to_ids, created_by) values ($1,$2,$3,$4,$5,$6,$7)',
      [newId('rsc'), b.reportId, b.classId, b.every, b.day, b.to, user.id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'report.scheduled', entity: 'report', entityId: b.reportId, detail: { every: b.every, to: b.to.length } });
    return this.list(t);
  }

  async remove(t: TenantCtx, user: AuthedUser, id: string): Promise<ScheduleRow[]> {
    const r = await t.pool.query('delete from report_schedules where id = $1', [id]);
    if (!r.rowCount) throw notFound(tx('That schedule'));
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'report.unscheduled', entity: 'report', entityId: id });
    return this.list(t);
  }

  /** Each schedule due today, once a day: the report for the days it covers, in each recipient's language. */
  async sendDue(t: TenantCtx, day: string): Promise<string> {
    const due = (await this.list(t)).filter((s) => dueOn(s, day) && s.lastSent !== day);
    let sent = 0;
    const store = schoolContext.getStore() ?? {};
    for (const s of due) {
      const [from, to] = coverOf(s.every, day);
      const people = (await t.pool.query<{ id: string; email: string; lang: string | null }>(
        "select u.id, u.email, (select p.value #>> '{}' from user_prefs p where p.user_id = u.id and p.key = 'language') lang from users u where u.id = any($1) and u.status = 'active' and coalesce(u.email, '') <> ''", [s.to])).rows;
      for (const lang of new Set(people.map((p) => p.lang ?? store.lang ?? 'en'))) {
        // The report's words in the reader's language: worked out once per language.
        const body = await schoolContext.run({ ...store, lang }, async () => {
          const r = await this.office.report(t, s.reportId, { ...(s.classId ? { classId: s.classId } : {}), from, to });
          const lines = r.rows.slice(0, 30).map((row) => r.columns.map((c) => String(row[c.key] ?? '')).join(' · '));
          return { subject: `${r.title}: ${r.scope}`, text: [r.title, r.scope, '', ...r.summary.map((x) => `${x.label}: ${x.value}`), '', ...lines, r.rows.length > 30 ? tx('… and {n} more in the admin, under Reports.', { n: r.rows.length - 30 }) : ''].join('\n') };
        });
        const group = people.filter((p) => (p.lang ?? store.lang ?? 'en') === lang);
        await this.messenger.sendMany(t, group.map((p) => ({ channel: 'email' as const, to: p.email, subject: body.subject, body: body.text, key: 'report.scheduled' })));
        sent += group.length;
      }
      await t.pool.query('update report_schedules set last_sent = $2 where id = $1', [s.id, day]);
    }
    return `${due.length} scheduled reports, ${sent} emails.`;
  }
}

@Controller('v1/reports/schedules')
@Core()
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedules) {}

  @Get() @Require('reports.read')
  list(@Tenant() t: TenantCtx): Promise<ScheduleRow[]> { return this.schedules.list(t); }

  @Post() @HttpCode(200) @Require('reports.read')
  add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(ScheduleInput)) b: ScheduleInput): Promise<ScheduleRow[]> { return this.schedules.add(t, u, b); }

  @Delete(':id') @Require('reports.read')
  remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string): Promise<ScheduleRow[]> { return this.schedules.remove(t, u, id); }
}
