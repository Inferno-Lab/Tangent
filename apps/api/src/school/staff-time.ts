import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Put, Query, Res, type OnModuleInit } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  CheckInInput, DEFAULT_LEAVE_TYPES, DEFAULT_STAFF_MARKS, LeaveAdjustInput, StaffLeaveInput, StaffMarksPut, addDays, fmtDate, leaveBalance, leaveDays, metresBetween, readPlace,
  schoolMinutes, schoolToday, tx, type AttendanceMarkDef, type LeaveBalance, type LeaveType, type MyStaffDay, type StaffDayRow, type StaffLeaveRow, type StaffMonthRow,
} from '@tangent/contracts';
import { newId, toCsv } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { ApprovalsService } from './approvals.service.js';
import { FamilyService } from './family.service.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type User = { id: string; name: string };
/** A leave year; `fallback` when the school counts by academic year but the day is in none of its years. */
type Year = { label: string; from: string; to: string; fallback?: boolean };
type LeaveRaw = { id: string; subject_ref: string; name: string; status: StaffLeaveRow['status']; payload: { type: string; from: string; to: string; halfDay: 'am' | 'pm' | null; days: number; reason?: string };
  decision_note: string | null; decided_by_name: string | null; created_at: Date };
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const STAFF = "select u.id, u.name, coalesce(s.designation, '') designation from users u join staff s on s.user_id = u.id where u.kind = 'staff' and u.status = 'active'";

/**
 * Staff attendance and leave (one-shot plan 6.3). A day is the office's mark or the person's own check-in; leave lives in the
 * approvals (kind staff_leave) and is read from there, so a cancelled or undone leave leaves no trace in the register.
 */
@Injectable()
export class StaffTimeService implements OnModuleInit {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    this.approvals.effect('staff_leave', {
      done: tx('Leave answered'),
      // Approving checks the balance again: other leave of the same type may have been approved since this was asked for.
      check: async (t, r, decision) => {
        if (decision !== 'approve') return;
        const p = r.payload as LeaveRaw['payload'];
        const type = (await this.types(t)).find((x) => x.key === p.type);
        if (!type || !r.subject_ref) return;
        const b = await this.balance(t, r.subject_ref, type, await this.yearOf(t, p.from), p.from, r.id);
        if (b.available !== null && b.available < Number(p.days)) {
          throw new ApiError('conflict', tx('Only {n} days of {type} are left this year. Change the balance first, or decline.', { n: b.available, type: type.name }));
        }
      },
      tell: async (t, r, status) => this.tell(t, r.subject_ref, r.payload as LeaveRaw['payload'], status),
    });
  }

  // ── Settings read through their defaults ─────────────────────────────────────

  private async types(t: TenantCtx): Promise<LeaveType[]> {
    return this.settings.value<LeaveType[]>(t, 'staffLeave.types', DEFAULT_LEAVE_TYPES);
  }

  private async marks(t: TenantCtx): Promise<AttendanceMarkDef[]> {
    return this.settings.value<AttendanceMarkDef[]>(t, 'staffAttendance.marks', DEFAULT_STAFF_MARKS);
  }

  private markFor(marks: AttendanceMarkDef[], meaning: AttendanceMarkDef['meaning']): string {
    return marks.find((m) => m.meaning === meaning)?.key ?? marks.find((m) => m.meaning === 'present')!.key;
  }

  /** The leave year a day falls in: the academic year (or, without one, the calendar year), or the calendar year by choice. */
  private async yearOf(t: TenantCtx, day: string): Promise<Year> {
    const academic = (await this.settings.value<string>(t, 'staffLeave.year', 'academic')) === 'academic';
    if (academic) {
      const y = (await t.pool.query<{ label: string; s: string; e: string }>(
        'select label, starts_on::text s, ends_on::text e from academic_years where starts_on <= $1 and ends_on >= $1 order by current desc limit 1', [day])).rows[0];
      if (y) return { label: y.label, from: y.s, to: y.e };
    }
    return { label: day.slice(0, 4), from: `${day.slice(0, 4)}-01-01`, to: `${day.slice(0, 4)}-12-31`, fallback: academic };
  }

  /** The leave year before this one; none in a school's first academic year (nothing to carry over). */
  private async yearBefore(t: TenantCtx, y: Year): Promise<Year | null> {
    const prev = await this.yearOf(t, addDays(y.from, -1));
    return prev.fallback && !y.fallback ? null : prev;
  }

  // ── Balances ─────────────────────────────────────────────────────────────────

  /** Days of leave taken (approved) and asked for (pending) in a year, per person and type; `skip` leaves one request out. */
  private async taken(t: TenantCtx, y: Year, userIds: string[] | null, skip = ''): Promise<Map<string, { used: number; pending: number }>> {
    const { rows } = await t.pool.query<{ uid: string; type: string; status: string; days: string }>(
      `select subject_ref uid, payload->>'type' type, status, sum((payload->>'days')::numeric) days from approvals
       where kind = 'staff_leave' and status in ('approved','pending') and payload->>'from' between $1 and $2 and ($3::text[] is null or subject_ref = any($3)) and id <> $4
       group by 1, 2, 3`, [y.from, y.to, userIds, skip]);
    const out = new Map<string, { used: number; pending: number }>();
    for (const r of rows) {
      const k = `${r.uid}|${r.type}`;
      const v = out.get(k) ?? { used: 0, pending: 0 };
      v[r.status === 'approved' ? 'used' : 'pending'] += Number(r.days);
      out.set(k, v);
    }
    return out;
  }

  private async adjusted(t: TenantCtx, label: string, userIds: string[] | null): Promise<Map<string, number>> {
    const { rows } = await t.pool.query<{ k: string; days: string }>(
      "select user_id || '|' || type k, sum(days) days from staff_leave_adjustments where year_label = $1 and ($2::text[] is null or user_id = any($2)) group by 1", [label, userIds]);
    return new Map(rows.map((r) => [r.k, Number(r.days)]));
  }

  private monthsStarted(y: Year, at: string): number {
    if (at < y.from) return 0;
    if (at > y.to) return 12;
    return (Number(at.slice(0, 4)) - Number(y.from.slice(0, 4))) * 12 + Number(at.slice(5, 7)) - Number(y.from.slice(5, 7)) + 1;
  }

  /** Everyone's balances for a year (or some people's), each type the school has. */
  async balances(t: TenantCtx, y: Year, userIds: string[] | null, at = schoolToday(), skip = ''): Promise<Map<string, LeaveBalance[]>> {
    const types = await this.types(t);
    const prev = await this.yearBefore(t, y);
    const [now, adj, prevTaken, prevAdj] = await Promise.all([
      this.taken(t, y, userIds, skip), this.adjusted(t, y.label, userIds),
      prev ? this.taken(t, prev, userIds) : Promise.resolve(new Map<string, { used: number; pending: number }>()), prev ? this.adjusted(t, prev.label, userIds) : Promise.resolve(new Map<string, number>()),
    ]);
    const ids = userIds ?? (await t.pool.query<{ id: string }>(STAFF)).rows.map((r) => r.id);
    const months = this.monthsStarted(y, at);
    const out = new Map<string, LeaveBalance[]>();
    for (const uid of ids) {
      out.set(uid, types.map((type) => {
        const k = `${uid}|${type.key}`;
        // ponytail: what was left last year counts last year's own days and adjustments, not what had carried into it.
        const lastYearLeft = prev ? type.days + (prevAdj.get(k) ?? 0) - (prevTaken.get(k)?.used ?? 0) : null;
        const b = leaveBalance(type, { monthsStarted: months, lastYearLeft, adjusted: adj.get(k) ?? 0, used: now.get(k)?.used ?? 0, pending: now.get(k)?.pending ?? 0 });
        return { type: type.key, name: type.name, paid: type.paid, halfDays: type.halfDays, ...b };
      }));
    }
    return out;
  }

  private async balance(t: TenantCtx, uid: string, type: LeaveType, y: Year, at: string, skip = ''): Promise<LeaveBalance> {
    return (await this.balances(t, y, [uid], at, skip)).get(uid)!.find((b) => b.type === type.key)!;
  }

  // ── Leave requests ───────────────────────────────────────────────────────────

  private row(r: LeaveRaw, types: LeaveType[]): StaffLeaveRow {
    const p = r.payload;
    return {
      id: r.id, userId: r.subject_ref, name: r.name, type: p.type, typeName: types.find((x) => x.key === p.type)?.name ?? p.type, from: p.from, to: p.to, halfDay: p.halfDay ?? null,
      days: Number(p.days), reason: p.reason ?? '', status: r.status, decisionNote: r.decision_note ?? '', decidedBy: r.decided_by_name, createdAt: r.created_at.toISOString(),
    };
  }

  async requests(t: TenantCtx, f: { userId?: string; status?: string }): Promise<StaffLeaveRow[]> {
    const { rows } = await t.pool.query<LeaveRaw>(
      `select a.id, a.subject_ref, u.name, a.status, a.payload, a.decision_note, (select name from users d where d.id = a.decided_by) decided_by_name, a.created_at
       from approvals a join users u on u.id = a.subject_ref where a.kind = 'staff_leave' and ($1::text is null or a.subject_ref = $1) and ($2::text is null or a.status = $2)
       order by a.payload->>'from' desc, a.created_at desc limit 400`, [f.userId ?? null, f.status ?? null]);
    const types = await this.types(t);
    return rows.map((r) => this.row(r, types));
  }

  /**
   * Leave asked for in the app (it goes through the school's steps), or recorded by the office for someone (approved at once).
   * Refused when it overlaps their other leave, runs over two leave years, falls only on closed days, or is more than is left.
   */
  async ask(t: TenantCtx, by: User, b: StaffLeaveInput, office: boolean): Promise<StaffLeaveRow> {
    const uid = office && b.userId ? b.userId : by.id;
    const person = (await t.pool.query<{ id: string; name: string }>(`${STAFF} and u.id = $1`, [uid])).rows[0];
    if (!person) throw (office ? notFound(tx('That member of staff')) : forbidden(tx('Leave is for members of staff.')));
    const types = await this.types(t);
    const type = types.find((x) => x.key === b.type && x.active !== false);
    if (!type) throw new ApiError('validation', tx('Choose one of the school’s leave types.'), { fields: { type: tx('Choose a type of leave.') } });
    const from = b.from;
    const to = b.halfDay ? from : b.to;
    if (to < from) throw new ApiError('validation', tx('The last day cannot be before the first day.'), { fields: { to: tx('Pick a later day.') } });
    if (b.halfDay && !type.halfDays) throw new ApiError('validation', tx('{type} is taken in whole days.', { type: type.name }), { fields: { halfDay: tx('Whole days only.') } });
    const today = schoolToday();
    if (!office && from < addDays(today, -30)) throw new ApiError('validation', tx('Leave more than 30 days ago is recorded by the office.'), { fields: { from: tx('Ask the office.') } });
    if (to > addDays(today, 366)) throw new ApiError('validation', tx('Ask for leave within the next year.'), { fields: { to: tx('Too far ahead.') } });
    const y = await this.yearOf(t, from);
    if (to > y.to) throw new ApiError('validation', tx('Ask for each leave year’s days separately: this one ends on {day}.', { day: fmtDate(y.to) }), { fields: { to: tx('Ends after the leave year.') } });
    const days = leaveDays(from, to, b.halfDay, await this.settings.closed(t));
    if (!days) throw new ApiError('validation', tx('The school is closed on all of those days.'), { fields: { from: tx('Pick a day the school is open.') } });
    const clash = await t.pool.query(
      `select 1 from approvals where kind = 'staff_leave' and status in ('pending','approved') and subject_ref = $1
         and (payload->>'from')::date <= $3::date and (payload->>'to')::date >= $2::date
         and not ($4::text is not null and payload->>'halfDay' is not null and payload->>'halfDay' <> $4)`, [uid, from, to, b.halfDay]);
    if (clash.rowCount) throw new ApiError('conflict', tx('There is already leave for some of these days.'), { fields: { from: tx('Overlaps other leave.') } });
    const bal = await this.balance(t, uid, type, y, from);
    if (bal.available !== null && days > bal.available) {
      throw new ApiError('validation', tx('Only {n} days of {type} are left this year.', { n: Math.max(0, bal.available), type: type.name }), { fields: { to: tx('More than is left.') } });
    }
    const when = b.halfDay ? `${fmtDate(from)}, ${b.halfDay === 'am' ? tx('morning') : tx('afternoon')}` : from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
    const id = newId('apr');
    const payload = { type: type.key, from, to, halfDay: b.halfDay, days, reason: b.reason };
    await t.pool.query(
      `insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload, status, decided_by, decided_at, decision_note)
       values ($1,'staff_leave',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, tx('{name}: {type}', { name: person.name, type: type.name }), `${when} · ${tx('{n} days', { n: days })}`, office ? by.name : person.name, by.id, uid, JSON.stringify(payload),
        office ? 'approved' : 'pending', office ? by.id : null, office ? new Date() : null, office ? tx('Recorded by the office') : '']);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: office ? 'staffLeave.recorded' : 'staffLeave.asked', entity: 'staff_leave', entityId: id, detail: { who: person.name, ...payload } });
    if (office && uid !== by.id) await this.tell(t, uid, payload, 'approved');
    return (await this.requests(t, { userId: uid })).find((r) => r.id === id)!;
  }

  /** A request still waiting can be withdrawn by whoever it is for; approved leave is cancelled by the office. */
  async withdraw(t: TenantCtx, user: User, id: string): Promise<{ ok: true }> {
    const r = (await t.pool.query<{ subject_ref: string; status: string }>("select subject_ref, status from approvals where id = $1 and kind = 'staff_leave'", [id])).rows[0];
    if (!r || r.subject_ref !== user.id) throw notFound(tx('That leave request'));
    if (r.status !== 'pending') throw new ApiError('conflict', tx('This request was already answered: ask the office to cancel approved leave.'));
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2 where id = $1 and status = 'pending'", [id, user.id]);
    return { ok: true };
  }

  async cancel(t: TenantCtx, by: User, id: string, note: string): Promise<{ ok: true }> {
    const r = (await t.pool.query<{ subject_ref: string; status: string; payload: LeaveRaw['payload'] }>("select subject_ref, status, payload from approvals where id = $1 and kind = 'staff_leave'", [id])).rows[0];
    if (!r) throw notFound(tx('That leave request'));
    if (r.status !== 'approved' && r.status !== 'pending') throw new ApiError('conflict', tx('Only waiting or approved leave can be cancelled.'));
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2, decision_note = $3 where id = $1", [id, by.id, note || tx('Cancelled by the office')]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'staffLeave.cancelled', entity: 'staff_leave', entityId: id, detail: { ...r.payload, note } });
    await this.tell(t, r.subject_ref, r.payload, 'cancelled');
    return { ok: true };
  }

  async adjust(t: TenantCtx, by: User, b: LeaveAdjustInput): Promise<{ ok: true }> {
    if (!(await t.pool.query(`${STAFF} and u.id = $1`, [b.userId])).rowCount) throw notFound(tx('That member of staff'));
    if (!(await this.types(t)).some((x) => x.key === b.type)) throw new ApiError('validation', tx('Choose one of the school’s leave types.'), { fields: { type: tx('Choose a type of leave.') } });
    const y = await this.yearOf(t, schoolToday());
    await t.pool.query('insert into staff_leave_adjustments (id, user_id, type, year_label, days, note, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [newId('sla'), b.userId, b.type, y.label, b.days, b.note, by.id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'staffLeave.adjusted', entity: 'staff', entityId: b.userId, detail: { type: b.type, days: b.days, note: b.note, year: y.label } });
    return { ok: true };
  }

  /** Everyone's balances this leave year, for the Balances tab. */
  async balanceTable(t: TenantCtx): Promise<{ year: string; rows: { userId: string; name: string; balances: LeaveBalance[] }[] }> {
    const y = await this.yearOf(t, schoolToday());
    const staff = (await t.pool.query<{ id: string; name: string }>(`${STAFF} order by u.name`)).rows;
    const all = await this.balances(t, y, staff.map((s) => s.id));
    return { year: y.label, rows: staff.map((s) => ({ userId: s.id, name: s.name, balances: all.get(s.id) ?? [] })) };
  }

  private async tell(t: TenantCtx, uid: string | null, p: LeaveRaw['payload'], status: string): Promise<void> {
    if (!uid) return;
    const u = (await t.pool.query<{ phone: string | null; email: string | null }>('select phone, email from users where id = $1', [uid])).rows[0];
    if (!u || (!u.phone && !u.email)) return;
    const type = (await this.types(t)).find((x) => x.key === p.type)?.name ?? p.type;
    await this.messenger.notify(t, 'staffLeave.decided', [{ to: u.phone ?? '', email: u.email, vars: { type, from: fmtDate(p.from), to: fmtDate(p.to), status: tx(status) } }]);
  }

  // ── The day ──────────────────────────────────────────────────────────────────

  /** Approved leave covering a day, per person. */
  private async leaveOn(t: TenantCtx, day: string, userIds: string[] | null): Promise<Map<string, StaffDayRow['leave']>> {
    const { rows } = await t.pool.query<{ uid: string; payload: LeaveRaw['payload'] }>(
      "select subject_ref uid, payload from approvals where kind = 'staff_leave' and status = 'approved' and payload->>'from' <= $1 and payload->>'to' >= $1 and ($2::text[] is null or subject_ref = any($2))", [day, userIds]);
    const types = await this.types(t);
    return new Map(rows.map((r) => [r.uid, { type: r.payload.type, typeName: types.find((x) => x.key === r.payload.type)?.name ?? r.payload.type, half: r.payload.halfDay ?? null }]));
  }

  async day(t: TenantCtx, day: string): Promise<StaffDayRow[]> {
    const staff = (await t.pool.query<{ id: string; name: string; designation: string }>(`${STAFF} order by u.name`)).rows;
    const marks = (await t.pool.query<{ user_id: string; status: string | null; check_in: Date | null; check_out: Date | null; late: boolean; early: boolean; source: StaffDayRow['source']; note: string }>(
      'select * from staff_attendance where date = $1', [day])).rows;
    const by = new Map(marks.map((m) => [m.user_id, m]));
    const leave = await this.leaveOn(t, day, null);
    const slot = await this.settings.slotDay(t, day);
    const lessons = slot === null ? new Map<string, number>() : new Map((await t.pool.query<{ tid: string; n: string }>(
      // Who teaches each lesson that date: a cover arranged for the day first, so a lesson already covered is not counted again.
      `select coalesce(sub.teacher_id, ls.cover_teacher_id, ls.teacher_id) tid, count(*) n from live_slots ls left join substitutions sub on sub.slot_id = ls.id and sub.date = $2
       where ls.day = $1 group by 1`, [slot, day])).rows.map((r) => [r.tid, Number(r.n)]));
    const leaveMark = this.markFor(await this.marks(t), 'leave');
    return staff.map((s) => {
      const m = by.get(s.id);
      const l = leave.get(s.id) ?? null;
      return {
        userId: s.id, name: s.name, designation: s.designation, status: m?.status ?? (l && !l.half ? leaveMark : null), checkIn: m?.check_in?.toISOString() ?? null, checkOut: m?.check_out?.toISOString() ?? null,
        late: m?.late ?? false, early: m?.early ?? false, source: m?.source ?? null, note: m?.note ?? '', leave: l, lessons: lessons.get(s.id) ?? 0,
      };
    });
  }

  /** The office marks a day (a mark of null clears it, keeping any check-in times). Never a day still to come. */
  async mark(t: TenantCtx, by: User, day: string, b: StaffMarksPut): Promise<{ ok: true }> {
    if (day > schoolToday()) throw new ApiError('validation', tx('A day still to come cannot be marked.'));
    const keys = new Set((await this.marks(t)).map((m) => m.key));
    const bad = b.marks.find((m) => m.status !== null && !keys.has(m.status));
    if (bad) throw new ApiError('validation', tx('{mark} is not one of the school’s marks for staff.', { mark: bad.status! }));
    const staff = new Set((await t.pool.query<{ id: string }>(STAFF)).rows.map((r) => r.id));
    const stranger = b.marks.find((m) => !staff.has(m.userId));
    if (stranger) throw new ApiError('validation', tx('Someone in the list is not a member of staff now.'));
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      for (const m of b.marks) {
        await client.query(
          `insert into staff_attendance (user_id, date, status, note, source, marked_by) values ($1,$2,$3,$4,'office',$5)
           on conflict (user_id, date) do update set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, updated_at = now()`,
          [m.userId, day, m.status, m.note, by.id]);
      }
      await client.query("delete from staff_attendance where date = $1 and status is null and check_in is null", [day]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'staffAttendance.marked', entity: 'staff_attendance', entityId: day, detail: { count: b.marks.length } });
    return { ok: true };
  }

  /** A month for each member of staff, counted on the days the school was open (to today): what payroll needs. */
  async month(t: TenantCtx, month: string): Promise<StaffMonthRow[]> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError('validation', tx('Pick a month.'));
    const closed = await this.settings.closed(t);
    const first = `${month}-01`;
    const last = [31, 30, 29, 28].map((n) => `${month}-${n}`).find((d) => addDays(d, 0) === d && d.slice(0, 7) === month) ?? `${month}-28`;
    const end = last < schoolToday() ? last : schoolToday();
    const days: string[] = [];
    for (let d = first; d <= end; d = addDays(d, 1)) if (!closed(d)) days.push(d);
    const staff = (await t.pool.query<{ id: string; name: string }>(`${STAFF} order by u.name`)).rows;
    const marks = await this.marks(t);
    const meaning = new Map(marks.map((m) => [m.key, m.meaning]));
    const att = (await t.pool.query<{ user_id: string; date: string; status: string | null; late: boolean; early: boolean }>(
      'select user_id, date::text date, status, late, early from staff_attendance where date between $1 and $2', [first, end])).rows;
    const leave = (await t.pool.query<{ uid: string; payload: LeaveRaw['payload'] }>(
      "select subject_ref uid, payload from approvals where kind = 'staff_leave' and status = 'approved' and payload->>'from' <= $2 and payload->>'to' >= $1", [first, end])).rows;
    const types = await this.types(t);
    const open = new Set(days);
    return staff.map((s) => {
      const r: StaffMonthRow = { userId: s.id, name: s.name, schoolDays: days.length, present: 0, late: 0, early: 0, absent: 0, leavePaid: 0, leaveUnpaid: 0, unmarked: 0 };
      const covered = new Set<string>();
      for (const l of leave.filter((x) => x.uid === s.id)) {
        const paid = types.find((x) => x.key === l.payload.type)?.paid ?? true;
        for (let d = l.payload.from; d <= l.payload.to; d = addDays(d, 1)) {
          if (!open.has(d)) continue;
          const n = l.payload.halfDay ? 0.5 : 1;
          if (paid) r.leavePaid += n; else r.leaveUnpaid += n;
          if (!l.payload.halfDay) covered.add(d);
        }
      }
      for (const a of att.filter((x) => x.user_id === s.id && open.has(x.date))) {
        if (a.late) r.late++;
        if (a.early) r.early++;
        const m = a.status ? meaning.get(a.status) : a.late ? 'late' : 'present';
        if (!m || covered.has(a.date)) continue;
        covered.add(a.date);
        if (m === 'absent') r.absent++;
        else if (m === 'half_day') r.present += 0.5;
        else if (m !== 'leave') r.present++;
      }
      r.unmarked = days.filter((d) => !covered.has(d)).length;
      return r;
    });
  }

  async monthCsv(t: TenantCtx, month: string): Promise<{ name: string; text: string }> {
    const rows = await this.month(t, month);
    const head = [tx('Name'), tx('School days'), tx('Present'), tx('Late'), tx('Left early'), tx('Absent'), tx('Paid leave'), tx('Unpaid leave'), tx('Not marked')];
    return { name: `${tx('Staff attendance')} ${month}.csv`, text: toCsv([head, ...rows.map((r) => [r.name, r.schoolDays, r.present, r.late, r.early, r.absent, r.leavePaid, r.leaveUnpaid, r.unmarked].map(String))]) };
  }

  // ── The app: check in and out, my leave ─────────────────────────────────────

  async me(t: TenantCtx, user: User): Promise<MyStaffDay> {
    const today = schoolToday();
    const [mode, from, until, lateAfter, place, radius] = await Promise.all([
      this.settings.value<string>(t, 'staffAttendance.checkIn', 'app'), this.settings.value<string>(t, 'staffAttendance.from', '07:00'), this.settings.value<string>(t, 'staffAttendance.until', '11:00'),
      this.settings.value<string>(t, 'staffAttendance.lateAfter', '08:15'), this.settings.value<string>(t, 'staffAttendance.place', ''), this.settings.value<number>(t, 'staffAttendance.radius', 0),
    ]);
    const closed = (await this.settings.closed(t))(today);
    const m = (await t.pool.query<{ status: string | null; check_in: Date | null; check_out: Date | null; late: boolean; early: boolean }>('select * from staff_attendance where user_id = $1 and date = $2', [user.id, today])).rows[0];
    const leave = (await this.leaveOn(t, today, [user.id])).get(user.id) ?? null;
    const now = schoolMinutes();
    const why = mode !== 'app' ? tx('The office marks staff attendance at this school.') : closed ? tx('The school is closed today.') : leave && !leave.half ? tx('You are on leave today.')
      : m?.check_in ? '' : now < mins(from) ? tx('Check-in opens at {time}.', { time: from }) : now > mins(until) ? tx('Check-in closed at {time}. Ask the office to mark you.', { time: until }) : '';
    const y = await this.yearOf(t, today);
    const types = await this.types(t);
    return {
      today, closed, checkIn: m?.check_in?.toISOString() ?? null, checkOut: m?.check_out?.toISOString() ?? null, late: m?.late ?? false, early: m?.early ?? false, status: m?.status ?? null, leave,
      canCheckIn: !why && !m?.check_in, why, window: { from, until, lateAfter }, needsPlace: radius > 0 && !!readPlace(place),
      balances: (await this.balances(t, y, [user.id])).get(user.id) ?? [], requests: (await this.requests(t, { userId: user.id })).slice(0, 30),
      types: types.filter((x) => x.active !== false).map((x) => ({ key: x.key, name: x.name, halfDays: x.halfDays })),
    };
  }

  async checkIn(t: TenantCtx, user: User, b: CheckInInput): Promise<MyStaffDay> {
    const me = await this.me(t, user);
    if (me.checkIn) return me;
    if (!me.canCheckIn) throw new ApiError('conflict', me.why);
    if (me.needsPlace) {
      if (b.lat === undefined || b.lng === undefined) throw new ApiError('validation', tx('Turn on location to check in: the school checks you are there.'));
      const at = readPlace(await this.settings.value<string>(t, 'staffAttendance.place', ''))!;
      const radius = await this.settings.value<number>(t, 'staffAttendance.radius', 0);
      // A phone's own uncertainty (up to 100 m) is given the benefit of the doubt.
      const away = metresBetween(at, { lat: b.lat, lng: b.lng }) - Math.min(b.accuracy ?? 0, 100);
      if (away > radius) throw new ApiError('conflict', tx('You are about {m} m from school. Check in when you are there.', { m: Math.round(away) }));
    }
    const late = schoolMinutes() > mins(me.window.lateAfter);
    const marks = await this.marks(t);
    const status = this.markFor(marks, late ? 'late' : 'present');
    // A mark the office already gave stands, unless it was absent (they came after all).
    const absent = marks.filter((x) => x.meaning === 'absent').map((x) => x.key);
    await t.pool.query(
      `insert into staff_attendance (user_id, date, status, check_in, late, source, lat, lng) values ($1,$2,$3,now(),$4,'app',$5,$6)
       on conflict (user_id, date) do update set check_in = coalesce(staff_attendance.check_in, now()), late = excluded.late, lat = excluded.lat, lng = excluded.lng, updated_at = now(),
         status = case when staff_attendance.status is null or staff_attendance.status = any($7) then excluded.status else staff_attendance.status end,
         source = case when staff_attendance.status is null or staff_attendance.status = any($7) then 'app' else staff_attendance.source end`,
      [user.id, me.today, status, late, b.lat ?? null, b.lng ?? null, absent]);
    return this.me(t, user);
  }

  async checkOut(t: TenantCtx, user: User): Promise<MyStaffDay> {
    const me = await this.me(t, user);
    if (!me.checkIn) throw new ApiError('conflict', tx('Check in first.'));
    const early = schoolMinutes() < mins(await this.settings.value<string>(t, 'staffAttendance.earlyBefore', '14:00'));
    await t.pool.query('update staff_attendance set check_out = now(), early = $3, updated_at = now() where user_id = $1 and date = $2', [user.id, me.today, early]);
    return this.me(t, user);
  }

  /** Today in numbers, for the dashboard: in, late, away on leave, not yet in. */
  async today(t: TenantCtx): Promise<{ total: number; in: number; late: number; leave: number; missing: number }> {
    const rows = await this.day(t, schoolToday());
    const leave = rows.filter((r) => r.leave && !r.leave.half).length;
    const inn = rows.filter((r) => r.checkIn || (r.status && r.source === 'office' && !r.leave)).length;
    return { total: rows.length, in: inn, late: rows.filter((r) => r.late).length, leave, missing: Math.max(0, rows.length - inn - leave) };
  }
}

@Controller('v1')
@RequireModule('staffAttendance')
export class StaffTimeController {
  constructor(private readonly s: StaffTimeService) {}

  @Get('staff-attendance') @Require('staffAttendance.read')
  day(@Tenant() t: TenantCtx, @Query('date') date?: string): Promise<StaffDayRow[]> { return this.s.day(t, /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : schoolToday()); }

  @Get('staff-attendance/today') @Require('staffAttendance.read')
  today(@Tenant() t: TenantCtx) { return this.s.today(t); }

  @Put('staff-attendance/:date') @Require('staffAttendance.manage')
  mark(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('date') date: string, @Body(new ZodPipe(StaffMarksPut)) b: StaffMarksPut) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError('validation', tx('Pick a day.'));
    return this.s.mark(t, u, date, b);
  }

  @Get('staff-attendance/month') @Require('staffAttendance.read')
  month(@Tenant() t: TenantCtx, @Query('month') month: string): Promise<StaffMonthRow[]> { return this.s.month(t, month ?? schoolToday().slice(0, 7)); }

  @Get('staff-attendance/month.csv') @Require('staffAttendance.read')
  async monthCsv(@Tenant() t: TenantCtx, @Query('month') month: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const c = await this.s.monthCsv(t, month ?? schoolToday().slice(0, 7));
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${c.name}"`);
    return c.text;
  }

  @Get('staff-leave') @Require('staffAttendance.read')
  requests(@Tenant() t: TenantCtx, @Query('status') status?: string, @Query('userId') userId?: string) { return this.s.requests(t, { status: status || undefined, userId: userId || undefined }); }

  @Post('staff-leave') @HttpCode(200) @Require('staffAttendance.manage')
  record(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(StaffLeaveInput)) b: StaffLeaveInput) {
    if (!b.userId) throw new ApiError('validation', tx('Choose the member of staff.'), { fields: { userId: tx('Choose someone.') } });
    return this.s.ask(t, u, b, true);
  }

  @Post('staff-leave/:id/cancel') @HttpCode(200) @Require('staffAttendance.manage')
  cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body() b: { note?: string }) { return this.s.cancel(t, u, id, String(b?.note ?? '').slice(0, 200)); }

  @Get('staff-leave/balances') @Require('staffAttendance.read')
  balances(@Tenant() t: TenantCtx) { return this.s.balanceTable(t); }

  @Post('staff-leave/adjust') @HttpCode(200) @Require('staffAttendance.manage')
  adjust(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(LeaveAdjustInput)) b: LeaveAdjustInput) { return this.s.adjust(t, u, b); }
}

/** The app's side: a member of staff's own day, check-in and leave. */
@Controller('v1/f/staff')
@RequireModule('staffAttendance')
export class FamilyStaffTimeController {
  constructor(private readonly s: StaffTimeService, private readonly f: FamilyService) {}

  private async staff(t: TenantCtx, u: AuthedUser): Promise<User> {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return w;
  }

  @Get('me')
  async me(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return this.s.me(t, await this.staff(t, u)); }

  @Post('check-in') @HttpCode(200)
  async checkIn(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(CheckInInput)) b: CheckInInput) { return this.s.checkIn(t, await this.staff(t, u), b); }

  @Post('check-out') @HttpCode(200)
  async checkOut(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return this.s.checkOut(t, await this.staff(t, u)); }

  @Post('leave') @HttpCode(200)
  async ask(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(StaffLeaveInput)) b: StaffLeaveInput) {
    return this.s.ask(t, await this.staff(t, u), { ...b, userId: undefined }, false);
  }

  @Post('leave/:id/withdraw') @HttpCode(200)
  async withdraw(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.s.withdraw(t, await this.staff(t, u), id); }
}
