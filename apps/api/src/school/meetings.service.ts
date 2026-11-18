import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Put, type OnModuleInit } from '@nestjs/common';
import { MeetingBookInput, MeetingInput, MeetingSlotPatch, addDays, fmtDate, meetingSlots, schoolInstant, schoolToday, tx, type MeetingRow, type MeetingSlotRow } from '@tangent/contracts';
import { newId, type Job } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, TenantService, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { FamilyService } from './family.service.js';
import { HubService } from './hub.service.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type User = { id: string; name: string };
type Raw = { id: string; title: string; date: string; from_time: string; to_time: string; slot_minutes: number; gap_minutes: number; mode: MeetingRow['mode']; place: string; link: string;
  class_ids: string[]; teacher_ids: string[]; closes_at: Date | null; status: MeetingRow['status']; slots: string; booked: string };
type SlotRaw = { id: string; meeting_id: string; teacher_id: string; teacher_name: string; starts_at: Date; ends_at: Date; closed: boolean; link: string; student_id: string | null;
  student_name: string | null; booked_by: string | null; booked_by_name: string | null; booked_mode: 'inPerson' | 'online' | null; note: string };
const SELECT = `select m.*, m.date::text date, (select count(*) from meeting_slots s where s.meeting_id = m.id) slots,
  (select count(*) from meeting_slots s where s.meeting_id = m.id and s.student_id is not null) booked from meetings m`;
const SLOTS = `select s.*, u.name teacher_name, st.name student_name, b.name booked_by_name from meeting_slots s join users u on u.id = s.teacher_id
  left join students st on st.id = s.student_id left join users b on b.id = s.booked_by`;
const row = (r: Raw): MeetingRow => ({
  id: r.id, title: r.title, date: r.date, from: r.from_time, to: r.to_time, slotMinutes: r.slot_minutes, gapMinutes: r.gap_minutes, mode: r.mode, place: r.place, link: r.link,
  classIds: r.class_ids, teacherIds: r.teacher_ids, closesAt: r.closes_at?.toISOString() ?? null, status: r.status, slots: Number(r.slots), booked: Number(r.booked),
});
const slotRow = (s: SlotRaw, full: boolean): MeetingSlotRow => ({
  id: s.id, teacherId: s.teacher_id, teacherName: s.teacher_name, startsAt: s.starts_at.toISOString(), endsAt: s.ends_at.toISOString(),
  state: s.student_id ? 'booked' : s.closed ? 'closed' : 'open', studentId: full ? s.student_id : null, studentName: full ? s.student_name : null, bookedBy: full ? s.booked_by_name : null,
  mode: full ? s.booked_mode : null, link: full ? s.link : '', note: full ? s.note : '',
});

/**
 * Parent-teacher meetings (one-shot plan 6.21). A meeting day makes each teacher's slots from its hours; families book one slot
 * per child with each of the child's teachers there, never two at the same time, until booking closes; a day before, each
 * booked family is reminded.
 */
@Injectable()
export class MeetingsService implements OnModuleInit {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly hubs: HubService,
    private readonly tenants: TenantService,
  ) {}

  onModuleInit(): void {
    this.hubs.handle('meetings.remind', async (job: Job) => {
      const s = await this.hubs.schoolPool(job.schoolId ?? '');
      return s ? this.remind(await this.tenants.resolve(s.slug)) : 'School not found.';
    });
  }

  async list(t: TenantCtx): Promise<MeetingRow[]> {
    return (await t.pool.query<Raw>(`${SELECT} order by m.date desc limit 200`)).rows.map(row);
  }

  private async one(t: TenantCtx, id: string): Promise<MeetingRow> {
    const r = (await t.pool.query<Raw>(`${SELECT} where m.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That meeting'));
    return row(r);
  }

  /** The teachers who meet families: those chosen, or each class's class teacher. */
  private async teachersOf(t: TenantCtx, b: MeetingInput): Promise<string[]> {
    if (b.teacherIds.length) {
      const ok = (await t.pool.query<{ id: string }>("select id from users where id = any($1) and kind = 'staff' and status = 'active'", [b.teacherIds])).rows.map((r) => r.id);
      if (ok.length !== new Set(b.teacherIds).size) throw new ApiError('validation', tx('Someone chosen is not a member of staff now.'), { fields: { teacherIds: tx('Choose again.') } });
      return [...new Set(b.teacherIds)];
    }
    const ids = (await t.pool.query<{ id: string }>(
      "select distinct u.id from classes c join users u on u.id = c.class_teacher_id and u.status = 'active' where c.id = any($1)", [b.classIds])).rows.map((r) => r.id);
    if (!ids.length) throw new ApiError('validation', tx('These classes have no class teacher: choose the teachers who meet families.'), { fields: { teacherIds: tx('Choose the teachers.') } });
    return ids;
  }

  private times(b: MeetingInput): [Date, Date][] {
    return meetingSlots(b.from, b.to, b.slotMinutes, b.gapMinutes).map(([s, e]) => [schoolInstant(b.date, s), schoolInstant(b.date, e)]);
  }

  /**
   * A meeting saved: its slots are made for each teacher. Once families have booked, its day and hours stay, and nobody
   * booked is taken out (a teacher or a class); opening it tells the families of its classes.
   */
  async save(t: TenantCtx, by: User, id: string | null, b: MeetingInput): Promise<MeetingRow> {
    const classes = (await t.pool.query<{ id: string }>('select id from classes where id = any($1)', [b.classIds])).rows.length;
    if (classes !== new Set(b.classIds).size) throw new ApiError('validation', tx('A class chosen no longer exists.'), { fields: { classIds: tx('Choose again.') } });
    const teachers = await this.teachersOf(t, b);
    const times = this.times(b);
    if (!times.length) throw new ApiError('validation', tx('The hours are shorter than one slot.'), { fields: { to: tx('Make the meeting longer.') } });
    if (b.closesAt && new Date(b.closesAt) > times[times.length - 1]![0]) throw new ApiError('validation', tx('Booking closes before the last slot starts.'), { fields: { closesAt: tx('Pick an earlier time.') } });
    const was = id ? await this.one(t, id) : null;
    if (!was && b.date < schoolToday()) throw new ApiError('validation', tx('Pick today or a later day.'), { fields: { date: tx('This day has passed.') } });
    if (was?.booked) {
      if (was.date !== b.date || was.from !== b.from || was.to !== b.to || was.slotMinutes !== b.slotMinutes || was.gapMinutes !== b.gapMinutes) {
        throw new ApiError('conflict', tx('Families have booked this meeting, so its day and hours stay. Cancel their bookings first.'));
      }
      const lost = (await t.pool.query<{ n: string }>(
        `select count(*) n from meeting_slots s join students st on st.id = s.student_id where s.meeting_id = $1 and (not (s.teacher_id = any($2)) or not (st.class_id = any($3)))`,
        [id, teachers, b.classIds])).rows[0]!.n;
      if (Number(lost)) throw new ApiError('conflict', tx('A teacher or class you took out has bookings. Cancel those first.'));
    }
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      const vals = [b.title, b.date, b.from, b.to, b.slotMinutes, b.gapMinutes, b.mode, b.place, b.link, JSON.stringify(b.classIds), JSON.stringify(b.teacherIds), b.closesAt, b.status];
      if (was) await client.query('update meetings set title=$2, date=$3, from_time=$4, to_time=$5, slot_minutes=$6, gap_minutes=$7, mode=$8, place=$9, link=$10, class_ids=$11, teacher_ids=$12, closes_at=$13, status=$14 where id=$1', [id, ...vals]);
      else {
        id = newId('mtg');
        await client.query('insert into meetings (id, title, date, from_time, to_time, slot_minutes, gap_minutes, mode, place, link, class_ids, teacher_ids, closes_at, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [id, ...vals, by.id]);
      }
      // Slots: open ones of teachers no longer there, or at times no longer in the hours, go; the rest stay with their bookings.
      await client.query('delete from meeting_slots where meeting_id = $1 and student_id is null and (not (teacher_id = any($2)) or not (starts_at = any($3)))', [id, teachers, times.map(([s]) => s)]);
      for (const tid of teachers) for (const [s, e] of times) {
        await client.query('insert into meeting_slots (id, meeting_id, teacher_id, starts_at, ends_at) values ($1,$2,$3,$4,$5) on conflict (meeting_id, teacher_id, starts_at) do nothing', [newId('mts'), id, tid, s, e]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: was ? 'meeting.saved' : 'meeting.created', entity: 'meeting', entityId: id!, detail: { title: b.title, status: b.status } });
    if (b.status === 'open' && was?.status !== 'open') await this.announce(t, id!);
    return this.one(t, id!);
  }

  private async announce(t: TenantCtx, id: string): Promise<void> {
    const m = await this.one(t, id);
    const fam = (await t.pool.query<{ phone: string | null; email: string | null; student: string }>(
      `select distinct on (g.id, s.id) g.phone, g.email, s.name student from students s join student_guardians sg on sg.student_id = s.id and sg.gets_messages
       join guardians g on g.id = sg.guardian_id where s.class_id = any($1) and s.status = 'active'`, [m.classIds])).rows;
    await this.messenger.notify(t, 'meeting.open', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { title: m.title, date: fmtDate(m.date, 'weekday'), student: f.student.split(' ')[0]! } })));
  }

  /** Removing a meeting tells every booked family it is off. */
  async remove(t: TenantCtx, by: User, id: string): Promise<void> {
    const m = await this.one(t, id);
    const booked = (await t.pool.query<SlotRaw>(`${SLOTS} where s.meeting_id = $1 and s.student_id is not null`, [id])).rows;
    await t.pool.query('delete from meetings where id = $1', [id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'meeting.removed', entity: 'meeting', entityId: id, detail: { title: m.title, bookings: booked.length } });
    for (const s of booked) await this.tellCancelled(t, s);
  }

  async slots(t: TenantCtx, id: string): Promise<MeetingSlotRow[]> {
    await this.one(t, id);
    return (await t.pool.query<SlotRaw>(`${SLOTS} where s.meeting_id = $1 order by u.name, s.starts_at`, [id])).rows.map((s) => slotRow(s, true));
  }

  private async slot(t: TenantCtx, id: string): Promise<SlotRaw> {
    const s = (await t.pool.query<SlotRaw>(`${SLOTS} where s.id = $1`, [id])).rows[0];
    if (!s) throw notFound(tx('That time'));
    return s;
  }

  private async tellCancelled(t: TenantCtx, s: SlotRaw): Promise<void> {
    if (!s.booked_by || s.starts_at < new Date()) return;
    const u = (await t.pool.query<{ phone: string | null; email: string | null }>('select phone, email from users where id = $1', [s.booked_by])).rows[0];
    if (u && (u.phone || u.email)) {
      await this.messenger.notify(t, 'meeting.cancelled', [{ to: u.phone ?? '', email: u.email, vars: { teacher: s.teacher_name, time: fmtDate(s.starts_at, 'time'), date: fmtDate(s.starts_at, 'weekday') } }]);
    }
  }

  /** Frees a booked slot (the office, the teacher, or the family who booked it). */
  async cancel(t: TenantCtx, by: User, slotId: string, why: 'office' | 'teacher' | 'family'): Promise<{ ok: true }> {
    const s = await this.slot(t, slotId);
    if (!s.student_id) throw new ApiError('conflict', tx('Nobody has booked this time.'));
    await t.pool.query("update meeting_slots set student_id = null, booked_by = null, booked_mode = null, note = '', booked_at = null where id = $1", [slotId]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'meeting.cancelled', entity: 'meeting', entityId: s.meeting_id, detail: { slot: slotId, student: s.student_name, by: why } });
    if (why !== 'family') await this.tellCancelled(t, s);
    return { ok: true };
  }

  // ── Families ──────────────────────────────────────────────────────────────────

  /** The teachers a child meets at a meeting: those chosen who teach the child's class, or the class teacher. */
  private async teachersFor(t: TenantCtx, m: MeetingRow, studentId: string): Promise<string[]> {
    const { rows } = await t.pool.query<{ id: string; ct: boolean }>(
      `select c.class_teacher_id id, true ct from students s join classes c on c.id = s.class_id where s.id = $1 and c.class_teacher_id is not null
       union select coalesce(ts.cover_teacher_id, ts.teacher_id), false from students s join timetable_slots ts on ts.class_id = s.class_id where s.id = $1`, [studentId]);
    if (!m.teacherIds.length) return rows.filter((r) => r.ct).map((r) => r.id);
    const theirs = rows.map((r) => r.id);
    return m.teacherIds.filter((x) => theirs.includes(x));
  }

  private closesAt(t: TenantCtx, m: MeetingRow): Promise<Date> {
    return m.closesAt ? Promise.resolve(new Date(m.closesAt))
      : t.pool.query<{ s: Date }>('select min(starts_at) s from meeting_slots where meeting_id = $1', [m.id]).then((r) => r.rows[0]?.s ?? schoolInstant(m.date, m.from));
  }

  /** What a family sees: each open meeting for their children, each child's teachers there and their times. */
  async forFamily(t: TenantCtx, who: { id: string; children: string[] }) {
    if (!who.children.length) return [];
    const kids = (await t.pool.query<{ id: string; name: string; class_id: string }>('select id, name, class_id from students where id = any($1) and status = \'active\'', [who.children])).rows;
    const meetings = (await t.pool.query<Raw>(`${SELECT} where m.status in ('open','closed') and m.date >= $1 order by m.date`, [addDays(schoolToday(), -1)])).rows.map(row)
      .filter((m) => kids.some((k) => m.classIds.includes(k.class_id)));
    const cancel = await this.settings.value<boolean>(t, 'ptm.familiesCancel', true);
    const out = [];
    for (const m of meetings) {
      const closes = await this.closesAt(t, m);
      const slots = (await t.pool.query<SlotRaw>(`${SLOTS} where s.meeting_id = $1 order by s.starts_at`, [m.id])).rows;
      const children = [];
      for (const k of kids.filter((x) => m.classIds.includes(x.class_id))) {
        const teachers = await this.teachersFor(t, m, k.id);
        children.push({
          studentId: k.id, name: k.name,
          teachers: teachers.map((tid) => {
            const own = slots.filter((s) => s.teacher_id === tid);
            const mine = own.find((s) => s.student_id === k.id);
            return { teacherId: tid, name: own[0]?.teacher_name ?? '', booked: mine ? slotRow(mine, true) : null,
              slots: own.filter((s) => s.starts_at > new Date()).map((s) => slotRow(s, s.student_id === k.id || s.booked_by === who.id)) };
          }).filter((x) => x.name),
        });
      }
      out.push({ ...m, link: '', canBook: m.status === 'open' && closes > new Date(), canCancel: cancel && closes > new Date(), closesAt: closes.toISOString(), children });
    }
    return out;
  }

  async book(t: TenantCtx, who: { id: string; name: string; kind: string; children: string[] }, b: MeetingBookInput, office = false): Promise<MeetingSlotRow> {
    if (!office && who.kind !== 'guardian') throw forbidden(tx('A parent books from their own account.'));
    if (!office && !who.children.includes(b.studentId)) throw notFound(tx('That student'));
    const s = await this.slot(t, b.slotId);
    const m = await this.one(t, s.meeting_id);
    const kid = (await t.pool.query<{ class_id: string }>("select class_id from students where id = $1 and status = 'active'", [b.studentId])).rows[0];
    if (!kid || !m.classIds.includes(kid.class_id)) throw new ApiError('validation', tx('This meeting is not for this child’s class.'));
    if (!office && (m.status !== 'open' || (await this.closesAt(t, m)) <= new Date())) throw new ApiError('conflict', tx('Booking for this meeting has closed.'));
    if (s.starts_at <= new Date()) throw new ApiError('conflict', tx('This time has passed. Pick a later one.'));
    if (!(await this.teachersFor(t, m, b.studentId)).includes(s.teacher_id)) throw new ApiError('validation', tx('This teacher does not meet this child’s family at this meeting.'));
    const mode = m.mode === 'either' ? b.mode : m.mode;
    if (!mode) throw new ApiError('validation', tx('Choose in person or online.'), { fields: { mode: tx('Choose one.') } });
    if ((await t.pool.query('select 1 from meeting_slots where meeting_id = $1 and teacher_id = $2 and student_id = $3', [m.id, s.teacher_id, b.studentId])).rowCount) {
      throw new ApiError('conflict', tx('This child already has a time with {teacher}. Cancel it to pick another.', { teacher: s.teacher_name }));
    }
    // One family cannot be in two meetings at once (two children with two teachers at the same time).
    const clash = await t.pool.query('select 1 from meeting_slots where meeting_id = $1 and (booked_by = $2 or student_id = $3) and starts_at < $5 and ends_at > $4',
      [m.id, office ? '' : who.id, b.studentId, s.starts_at, s.ends_at]);
    if (clash.rowCount) throw new ApiError('conflict', tx('You already have a meeting at this time. Pick another time.'));
    const got = await t.pool.query(
      "update meeting_slots set student_id = $2, booked_by = $3, booked_mode = $4, note = $5, booked_at = now() where id = $1 and student_id is null and not closed",
      [s.id, b.studentId, office ? null : who.id, mode, b.note]).catch((e: { code?: string }) => {
      if (e.code === '23505') throw new ApiError('conflict', tx('This child already has a time with {teacher}. Cancel it to pick another.', { teacher: s.teacher_name }));
      throw e;
    });
    if (!got.rowCount) throw new ApiError('conflict', tx('Someone has just taken this time. Pick another.'));
    await this.audit.record(t, { actorId: who.id, actorName: who.name, action: 'meeting.booked', entity: 'meeting', entityId: m.id, detail: { slot: s.id, student: b.studentId, office } });
    return slotRow(await this.slot(t, s.id), true);
  }

  async familyCancel(t: TenantCtx, who: { id: string; name: string; children: string[] }, slotId: string): Promise<{ ok: true }> {
    const s = await this.slot(t, slotId);
    if (!s.student_id || (s.booked_by !== who.id && !who.children.includes(s.student_id))) throw notFound(tx('That booking'));
    if (!(await this.settings.value<boolean>(t, 'ptm.familiesCancel', true))) throw forbidden(tx('Ask the school to change your booking.'));
    if ((await this.closesAt(t, await this.one(t, s.meeting_id))) <= new Date()) throw new ApiError('conflict', tx('Booking has closed: ask the school to change it.'));
    return this.cancel(t, who, slotId, 'family');
  }

  // ── Teachers ──────────────────────────────────────────────────────────────────

  async forTeacher(t: TenantCtx, who: { id: string }) {
    const meetings = (await t.pool.query<Raw>(`${SELECT} where m.status in ('open','closed') and m.date >= $1 and exists (select 1 from meeting_slots s where s.meeting_id = m.id and s.teacher_id = $2) order by m.date`,
      [addDays(schoolToday(), -1), who.id])).rows.map(row);
    return Promise.all(meetings.map(async (m) => ({
      ...m, slots: (await t.pool.query<SlotRaw>(`${SLOTS} where s.meeting_id = $1 and s.teacher_id = $2 order by s.starts_at`, [m.id, who.id])).rows.map((s) => slotRow(s, true)),
    })));
  }

  /** A teacher closes a time (a booked one is cancelled, and the family told) or gives their own link for online meetings. */
  async patchSlot(t: TenantCtx, who: { id: string; name: string }, slotId: string, p: MeetingSlotPatch): Promise<MeetingSlotRow> {
    const s = await this.slot(t, slotId);
    if (s.teacher_id !== who.id) throw notFound(tx('That time'));
    if (p.closed && s.student_id) await this.cancel(t, who, slotId, 'teacher');
    if (p.closed !== undefined) await t.pool.query('update meeting_slots set closed = $2 where id = $1', [slotId, p.closed]);
    if (p.link !== undefined) await t.pool.query('update meeting_slots set link = $2 where id = $1', [slotId, p.link]);
    return slotRow(await this.slot(t, slotId), true);
  }

  // ── Reminders ─────────────────────────────────────────────────────────────────

  /** The day before a meeting, each booked family hears when and with whom (once). */
  async remind(t: TenantCtx): Promise<string> {
    if (!(await this.settings.value<boolean>(t, 'ptm.remind', true))) return 'Reminders are off.';
    const tomorrow = addDays(schoolToday(), 1);
    const ms = (await t.pool.query<Raw>(`${SELECT} where m.date = $1 and m.status <> 'draft' and not m.reminded`, [tomorrow])).rows.map(row);
    let n = 0;
    for (const m of ms) {
      const booked = (await t.pool.query<SlotRaw>(`${SLOTS} where s.meeting_id = $1 and s.booked_by is not null`, [m.id])).rows;
      for (const s of booked) {
        const u = (await t.pool.query<{ phone: string | null; email: string | null }>('select phone, email from users where id = $1', [s.booked_by])).rows[0];
        if (!u || (!u.phone && !u.email)) continue;
        const where = s.booked_mode === 'online' ? (s.link || m.link || tx('The link is in the app.')) : m.place;
        n += await this.messenger.notify(t, 'meeting.reminder', [{ to: u.phone ?? '', email: u.email, vars: { teacher: s.teacher_name, time: fmtDate(s.starts_at, 'time'), date: fmtDate(s.starts_at, 'weekday'), place: where } }]);
      }
      await t.pool.query('update meetings set reminded = true where id = $1', [m.id]);
    }
    return `${n} reminded`;
  }
}

@Controller('v1/meetings')
@RequireModule('ptm')
export class MeetingsController {
  constructor(private readonly m: MeetingsService) {}

  @Get() @Require('meetings.read')
  list(@Tenant() t: TenantCtx) { return this.m.list(t); }

  @Post() @HttpCode(200) @Require('meetings.manage')
  add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(MeetingInput)) b: MeetingInput) { return this.m.save(t, u, null, b); }

  @Put(':id') @Require('meetings.manage')
  save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(MeetingInput)) b: MeetingInput) { return this.m.save(t, u, id, b); }

  @Delete(':id') @HttpCode(204) @Require('meetings.manage')
  remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.m.remove(t, u, id); }

  @Get(':id/slots') @Require('meetings.read')
  slots(@Tenant() t: TenantCtx, @Param('id') id: string) { return this.m.slots(t, id); }

  @Post('slots/:id/cancel') @HttpCode(200) @Require('meetings.manage')
  cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.m.cancel(t, u, id, 'office'); }

  /** The office books for a family that phoned. */
  @Post('book') @HttpCode(200) @Require('meetings.manage')
  book(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(MeetingBookInput)) b: MeetingBookInput) { return this.m.book(t, { ...u, kind: 'staff', children: [] }, b, true); }
}

@Controller('v1/f/meetings')
@RequireModule('ptm')
export class FamilyMeetingsController {
  constructor(private readonly m: MeetingsService, private readonly f: FamilyService) {}

  @Get()
  async list(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return this.m.forFamily(t, await this.f.who(t, u)); }

  @Post('book') @HttpCode(200)
  async book(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(MeetingBookInput)) b: MeetingBookInput) { return this.m.book(t, await this.f.who(t, u), b); }

  @Post('slots/:id/cancel') @HttpCode(200)
  async cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.m.familyCancel(t, await this.f.who(t, u), id); }

  @Get('mine')
  async mine(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return this.m.forTeacher(t, w);
  }

  @Patch('slots/:id')
  async patch(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(MeetingSlotPatch)) p: MeetingSlotPatch) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return this.m.patchSlot(t, w, id, p);
  }
}
