import { Injectable } from '@nestjs/common';
import { slotDays, tx, type Clash, type CoverRequest, type PeriodDef, type PeriodTimesPut, type PeriodTimesRow, type RoomBookingCreate, type RoomDay, type RoomRow, type RoomSave, type SlotCreate, type SlotPatch, type SlotRow, type TeacherLoad, type TeacherOption, type TimetableDay, type TimetableView, type WeekOf } from '@tangent/contracts';
import { newId } from '@tangent/db';
import { schoolToday } from '@tangent/contracts';
import { ApiError, forbidden, notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { AuditService, Messenger, SettingsService } from './support.js';

interface PeriodRow { idx: number; label: string; starts_at: string; ends_at: string; kind: PeriodDef['kind'] }
interface SlotQ {
  id: string; class_id: string; day: number; period: number; subject_id: string; subject_name: string; subject_color: string;
  teacher_id: string; teacher_name: string; room: string | null; cover_id: string | null; cover_name: string | null;
}

/** Subjects whose teachers can sensibly cover for each other. */
const RELATED: Record<string, string[]> = {
  sub_maths: ['sub_science', 'sub_computer'], sub_science: ['sub_maths', 'sub_computer'], sub_computer: ['sub_maths', 'sub_science'],
  sub_english: ['sub_hindi', 'sub_social'], sub_hindi: ['sub_english', 'sub_social'], sub_social: ['sub_english', 'sub_hindi'], sub_pe: [],
};

/** Teachers needing to be in two rooms in the same period. Cover (when set) replaces the class's own teacher. */
const CLASH_SQL = `
  select eff.teacher_id, u.name teacher_name, eff.day, eff.period, array_agg(eff.id order by c.grade, c.section) slot_ids, array_agg(c.name order by c.grade, c.section) class_names
  from (select id, class_id, day, period, coalesce(cover_teacher_id, teacher_id) teacher_id from timetable_slots) eff
  join classes c on c.id = eff.class_id join users u on u.id = eff.teacher_id
  group by eff.teacher_id, u.name, eff.day, eff.period having count(*) > 1 order by eff.day, eff.period`;

/** Two classes timetabled in one room in the same period (once the school keeps a rooms list: before, a room is only words). */
const ROOM_CLASH_SQL = `
  select lower(ts.room) room_key, min(ts.room) room, ts.day, ts.period, array_agg(ts.id order by c.grade, c.section) slot_ids, array_agg(c.name order by c.grade, c.section) class_names
  from timetable_slots ts join classes c on c.id = ts.class_id where coalesce(ts.room, '') <> '' and exists (select 1 from rooms r where lower(r.name) = lower(ts.room))
  group by lower(ts.room), ts.day, ts.period having count(*) > 1 order by ts.day, ts.period`;

@Injectable()
export class TimetableService {
  constructor(
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly settings: SettingsService,
  ) {}

  /** Lessons in order: periods, with the break and lunch slotted where they fall in the day. */
  async periods(t: TenantCtx): Promise<PeriodDef[]> {
    const { rows } = await t.pool.query<PeriodRow>('select idx, label, starts_at, ends_at, kind from periods order by starts_at');
    return rows.map((r) => ({ idx: r.idx, label: r.label, starts: r.starts_at, ends: r.ends_at, kind: r.kind }));
  }

  private async clashes(t: TenantCtx, classId?: string): Promise<Clash[]> {
    const [teachers, rooms, mine] = await Promise.all([
      t.pool.query<{ teacher_id: string; teacher_name: string; day: number; period: number; slot_ids: string[]; class_names: string[] }>(CLASH_SQL),
      t.pool.query<{ room_key: string; room: string; day: number; period: number; slot_ids: string[]; class_names: string[] }>(ROOM_CLASH_SQL),
      classId ? t.pool.query<{ id: string }>('select id from timetable_slots where class_id = $1', [classId]) : null,
    ]);
    // Only the clashes this class is part of, when a class is asked for.
    const own = mine ? new Set(mine.rows.map((r) => r.id)) : null;
    const out: Clash[] = [];
    for (const r of teachers.rows) {
      if (own && !r.slot_ids.some((s) => own.has(s))) continue;
      out.push({ id: `${r.teacher_id}|${r.day}|${r.period}`, kind: 'teacher', teacherId: r.teacher_id, teacherName: r.teacher_name, day: r.day, period: r.period, slotIds: r.slot_ids, classNames: r.class_names, suggestion: await this.suggest(t, r.slot_ids, r.day, r.period) });
    }
    for (const r of rooms.rows) {
      if (own && !r.slot_ids.some((s) => own.has(s))) continue;
      out.push({ id: `room|${r.room_key}|${r.day}|${r.period}`, kind: 'room', teacherId: r.room_key, teacherName: r.room, day: r.day, period: r.period, slotIds: r.slot_ids, classNames: r.class_names, suggestion: null });
    }
    return out;
  }

  /** The days of the school's cycle the grids show, in order. */
  async days(t: TenantCtx): Promise<TimetableDay[]> {
    const off = (await this.settings.offDays(t)).map((d) => d || 7);
    return slotDays(await this.settings.cycle(t), off);
  }

  /** A room from the school's list when it keeps one (else any name), not taken by another class in that period. */
  private async checkRoom(t: TenantCtx, room: string | null | undefined, day: number, period: number, slotId: string | null): Promise<string | null> {
    const name = room?.trim() || null;
    if (!name) return null;
    const listed = (await t.pool.query<{ name: string }>('select name from rooms')).rows;
    const found = listed.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (listed.length && !found) throw new ApiError('validation', tx('Choose one of the school’s rooms.'), { fields: { room: tx('Not one of the rooms.') } });
    // Without a rooms list a room is only a name ("Lab" may be three rooms), so only a listed room is kept to one class at a time.
    if (found && (await t.pool.query('select 1 from timetable_slots where lower(room) = lower($1) and day = $2 and period = $3 and id is distinct from $4', [name, day, period, slotId])).rowCount) {
      throw new ApiError('conflict', tx('Another class is in {room} then.', { room: name }), { fields: { room: tx('Taken then.') } });
    }
    return found?.name ?? name;
  }

  /** Someone who already teaches one of the classes and is free then: a related subject first, then the lightest week. */
  private async suggest(t: TenantCtx, slotIds: string[], day: number, period: number): Promise<Clash['suggestion']> {
    const subject = await t.pool.query<{ subject_id: string }>('select subject_id from timetable_slots where id = $1', [slotIds[0]]);
    const related = RELATED[subject.rows[0]?.subject_id ?? ''] ?? [];
    const { rows } = await t.pool.query<{ id: string; name: string; load: string; subject: string }>(
      `with cls as (select distinct class_id from timetable_slots where id = any($1)),
       busy as (select coalesce(cover_teacher_id, teacher_id) tid from timetable_slots where day = $2 and period = $3)
       select u.id, u.name, s.name subject, (select count(*) from timetable_slots x where coalesce(x.cover_teacher_id, x.teacher_id) = u.id) load
       from timetable_slots ts join cls on cls.class_id = ts.class_id join users u on u.id = ts.teacher_id join subjects s on s.id = ts.subject_id
       where u.id not in (select tid from busy) group by u.id, u.name, s.name, s.id order by array_position($4::text[], s.id) nulls last, load, u.name limit 1`, [slotIds, day, period, related]);
    const r = rows[0];
    return r ? { teacherId: r.id, teacherName: r.name, reason: `${r.name.split(' ')[0]} teaches ${r.subject} to this class and is free then.` } : null;
  }

  async view(t: TenantCtx, classId: string): Promise<TimetableView> {
    const cls = await t.pool.query<{ name: string }>('select name from classes where id = $1', [classId]);
    if (!cls.rows[0]) throw notFound('That class');
    const [periods, slots, clashes, meta, unplaced, draft, days, times] = await Promise.all([
      this.periods(t),
      t.pool.query<SlotQ>(
        `select ts.id, ts.class_id, ts.day, ts.period, ts.subject_id, s.name subject_name, s.color subject_color, ts.teacher_id, u.name teacher_name, ts.room,
           ts.cover_teacher_id cover_id, cu.name cover_name
         from timetable_slots ts join subjects s on s.id = ts.subject_id join users u on u.id = ts.teacher_id left join users cu on cu.id = ts.cover_teacher_id
         where ts.class_id = $1 order by ts.day, ts.period`, [classId]),
      this.clashes(t, classId),
      t.pool.query<{ key: string; value: unknown }>("select key, value from meta where key in ('timetable.version','timetable.publishedAt')"),
      t.pool.query<{ id: string; name: string; color: string; missing: number }>(
        `select s.id, s.name, s.color, s.per_week - count(ts.id)::int missing from subjects s left join timetable_slots ts on ts.subject_id = s.id and ts.class_id = $1
         group by s.id, s.name, s.color, s.per_week having s.per_week - count(ts.id) > 0 order by s.name`, [classId]),
      t.pool.query<{ n: string }>(
        `select count(*) n from timetable_slots where (teacher_id is distinct from published_teacher_id or subject_id is distinct from published_subject_id or cover_teacher_id is distinct from published_cover_id)`),
      this.days(t),
      // The class's own times win over the school's for that day.
      t.pool.query<{ day: number; period: number; starts_at: string; ends_at: string }>(
        'select day, period, starts_at, ends_at from period_times where class_id is null or class_id = $1 order by class_id nulls first', [classId]),
    ]);
    const m = new Map(meta.rows.map((r) => [r.key, r.value]));
    return {
      classId, className: cls.rows[0].name, periods, days, today: await this.settings.slotDay(t, schoolToday()),
      times: Object.fromEntries(times.rows.map((r) => [`${r.day}|${r.period}`, { starts: r.starts_at, ends: r.ends_at }])),
      slots: slots.rows.map<SlotRow>((r) => ({
        id: r.id, classId: r.class_id, day: r.day, period: r.period, subjectId: r.subject_id, subjectName: r.subject_name, subjectColor: r.subject_color,
        teacherId: r.teacher_id, teacherName: r.teacher_name, room: r.room, substituteId: r.cover_id, substituteName: r.cover_name,
      })),
      clashes, unplaced: unplaced.rows.map((u) => ({ subjectId: u.id, name: u.name, color: u.color, missing: u.missing })),
      publishedAt: (m.get('timetable.publishedAt') as string | undefined) ?? null, draftChanges: Number(draft.rows[0]!.n), version: Number(m.get('timetable.version') ?? 1),
    };
  }

  async patchSlot(t: TenantCtx, user: { id: string; name: string }, id: string, patch: SlotPatch): Promise<void> {
    await this.editable(t);
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (patch.subjectId) add('subject_id', patch.subjectId);
    if (patch.teacherId) { add('teacher_id', patch.teacherId); sets.push('cover_teacher_id = null'); }
    if (patch.room !== undefined) {
      const at = (await t.pool.query<{ day: number; period: number }>('select day, period from timetable_slots where id = $1', [id])).rows[0];
      if (!at) throw notFound('That period');
      add('room', await this.checkRoom(t, patch.room, at.day, at.period, id));
    }
    if (!sets.length) throw new ApiError('validation', 'Nothing to change.');
    const res = await t.pool.query(`update timetable_slots set ${sets.join(', ')} where id = $1`, params);
    if (!res.rowCount) throw notFound('That period');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.slot_changed', entity: 'slot', entityId: id, detail: patch as Record<string, unknown> });
  }

  private async editable(t: TenantCtx): Promise<void> {
    if ((await this.settings.value<boolean>(t, 'timetable.schoolEdits', true)) === false) throw forbidden('Tangent keeps your timetable. Ask Tangent to change it.');
  }

  /** Places a lesson in a free period. A teacher already teaching then is refused, so no clash is made here. */
  async createSlot(t: TenantCtx, user: { id: string; name: string }, b: SlotCreate): Promise<{ id: string }> {
    await this.editable(t);
    if (!(await this.days(t)).some((d) => d.day === b.day)) throw new ApiError('validation', tx('That day is not one of your timetable’s days.'));
    if ((await t.pool.query('select 1 from timetable_slots where class_id = $1 and day = $2 and period = $3', [b.classId, b.day, b.period])).rowCount) throw new ApiError('conflict', 'That period already has a lesson. Change it instead.');
    if (!(await t.pool.query("select 1 from periods where idx = $1 and kind = 'period'", [b.period])).rowCount) throw new ApiError('validation', 'That is not a teaching period.');
    if ((await t.pool.query('select 1 from timetable_slots where day = $1 and period = $2 and coalesce(cover_teacher_id, teacher_id) = $3', [b.day, b.period, b.teacherId])).rowCount) {
      throw new ApiError('conflict', 'That teacher already has a class in this period.', { fields: { teacherId: 'Busy then.' } });
    }
    const room = await this.checkRoom(t, b.room, b.day, b.period, null);
    const id = newId('slt');
    await t.pool.query('insert into timetable_slots (id, class_id, day, period, subject_id, teacher_id, room) values ($1,$2,$3,$4,$5,$6,$7)', [id, b.classId, b.day, b.period, b.subjectId, b.teacherId, room]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.slot_placed', entity: 'slot', entityId: id, detail: { class: b.classId, day: b.day, period: b.period } });
    return { id };
  }

  /** Frees a period: the class has no lesson then. */
  async removeSlot(t: TenantCtx, user: { id: string; name: string }, id: string): Promise<void> {
    await this.editable(t);
    const r = await t.pool.query('delete from timetable_slots where id = $1', [id]);
    if (!r.rowCount) throw notFound('That period');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.slot_freed', entity: 'slot', entityId: id });
  }

  /** A teacher's week (their own lessons and the ones they cover) or a room's, across every class. */
  async weekOf(t: TenantCtx, by: { teacherId?: string; room?: string }): Promise<WeekOf> {
    const where = by.teacherId ? 'coalesce(ts.cover_teacher_id, ts.teacher_id) = $1' : 'lower(ts.room) = lower($1)';
    const [periods, rows, who, days] = await Promise.all([
      this.periods(t),
      t.pool.query<SlotQ & { class_name: string }>(
        `select ts.id, ts.class_id, c.name class_name, ts.day, ts.period, ts.subject_id, s.name subject_name, s.color subject_color, ts.teacher_id, u.name teacher_name, ts.room,
           ts.cover_teacher_id cover_id, cu.name cover_name
         from timetable_slots ts join classes c on c.id = ts.class_id join subjects s on s.id = ts.subject_id join users u on u.id = ts.teacher_id left join users cu on cu.id = ts.cover_teacher_id
         where ${where} order by ts.day, ts.period`, [by.teacherId ?? by.room]),
      by.teacherId ? t.pool.query<{ name: string }>('select name from users where id = $1', [by.teacherId]) : null,
      this.days(t),
    ]);
    if (by.teacherId && !who?.rows[0]) throw notFound('That teacher');
    return {
      title: by.teacherId ? who!.rows[0]!.name : tx('Room {room}', { room: by.room ?? '' }), periods, days,
      slots: rows.rows.map((r) => ({
        id: r.id, classId: r.class_id, className: r.class_name, day: r.day, period: r.period, subjectId: r.subject_id, subjectName: r.subject_name, subjectColor: r.subject_color,
        teacherId: r.teacher_id, teacherName: r.teacher_name, room: r.room, substituteId: r.cover_id, substituteName: r.cover_name,
      })),
    };
  }

  /** The rooms the timetable uses, for the room view: the school's list, and any room a lesson names that is not on it. */
  async rooms(t: TenantCtx): Promise<string[]> {
    return (await t.pool.query<{ room: string }>("select name room from rooms union select distinct room from timetable_slots where coalesce(room, '') <> '' order by 1")).rows.map((r) => r.room);
  }

  // Rooms and their bookings

  async roomList(t: TenantCtx): Promise<RoomRow[]> {
    const { rows } = await t.pool.query<{ id: string; name: string; capacity: number | null; note: string; bookable: boolean; lessons: string }>(
      'select r.*, (select count(*) from timetable_slots ts where lower(ts.room) = lower(r.name)) lessons from rooms r order by lower(r.name)');
    return rows.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity, note: r.note, bookable: r.bookable, lessons: Number(r.lessons) }));
  }

  /** Adds or renames a room; a rename follows into every lesson that used the old name. */
  async saveRoom(t: TenantCtx, user: { id: string; name: string }, id: string | null, b: RoomSave): Promise<RoomRow[]> {
    await this.editable(t);
    if ((await t.pool.query('select 1 from rooms where lower(name) = lower($1) and id is distinct from $2', [b.name, id])).rowCount) {
      throw new ApiError('validation', tx('There is already a room with that name.'), { fields: { name: tx('Already used.') } });
    }
    if (id) {
      const was = (await t.pool.query<{ name: string }>('select name from rooms where id = $1', [id])).rows[0];
      if (!was) throw notFound('That room');
      await t.pool.query('update rooms set name = $2, capacity = $3, note = $4, bookable = $5 where id = $1', [id, b.name, b.capacity ?? null, b.note, b.bookable]);
      if (was.name !== b.name) await t.pool.query('update timetable_slots set room = $2 where lower(room) = lower($1)', [was.name, b.name]);
    } else {
      await t.pool.query('insert into rooms (id, name, capacity, note, bookable) values ($1,$2,$3,$4,$5)', [newId('rm'), b.name, b.capacity ?? null, b.note, b.bookable]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'room.saved', entity: 'room', entityId: id ?? b.name, detail: { name: b.name } });
    return this.roomList(t);
  }

  /** Removes a room no lesson uses (its bookings go with it). */
  async deleteRoom(t: TenantCtx, user: { id: string; name: string }, id: string): Promise<RoomRow[]> {
    await this.editable(t);
    const r = (await this.roomList(t)).find((x) => x.id === id);
    if (!r) throw notFound('That room');
    if (r.lessons) throw new ApiError('conflict', tx('{n, plural, one {# lesson uses} other {# lessons use}} this room. Move them to another room first.', { n: r.lessons }));
    await t.pool.query('delete from rooms where id = $1', [id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'room.removed', entity: 'room', entityId: id, detail: { name: r.name } });
    return this.roomList(t);
  }

  /** A room's day: the lessons the timetable puts in it that day and the bookings made for it. */
  async roomDay(t: TenantCtx, user: { id: string }, roomId: string, date: string): Promise<RoomDay> {
    const room = (await this.roomList(t)).find((x) => x.id === roomId);
    if (!room) throw notFound('That room');
    const day = await this.settings.slotDay(t, date);
    const [lessons, bookings] = await Promise.all([
      day === null ? { rows: [] } : t.pool.query<{ start: string; end: string; label: string }>(
        `select st.starts_at start, st.ends_at "end", c.name || ' · ' || s.name label from timetable_slots ts join slot_times st on st.slot_id = ts.id
         join classes c on c.id = ts.class_id join subjects s on s.id = ts.subject_id where lower(ts.room) = lower($1) and ts.day = $2 order by st.starts_at`, [room.name, day]),
      t.pool.query<{ id: string; starts_at: string; ends_at: string; purpose: string; booked_by: string | null; who: string | null }>(
        'select b.id, b.starts_at, b.ends_at, b.purpose, b.booked_by, u.name who from room_bookings b left join users u on u.id = b.booked_by where b.room_id = $1 and b.date = $2 order by b.starts_at', [roomId, date]),
    ]);
    return {
      room, date, lessons: lessons.rows,
      bookings: bookings.rows.map((b) => ({ id: b.id, roomId, date, start: b.starts_at, end: b.ends_at, purpose: b.purpose, bookedBy: b.who ?? '', mine: b.booked_by === user.id })),
    };
  }

  /** Books a room for a time on a day the school is open, when no lesson or other booking has it then. */
  async book(t: TenantCtx, user: { id: string; name: string }, b: RoomBookingCreate): Promise<RoomDay> {
    const day = await this.roomDay(t, user, b.roomId, b.date);
    if (!day.room.bookable) throw new ApiError('validation', tx('This room is not for booking.'));
    if (b.date < schoolToday()) throw new ApiError('validation', tx('Choose today or a later day.'), { fields: { date: tx('In the past.') } });
    if ((await this.settings.slotDay(t, b.date)) === null) throw new ApiError('validation', tx('The school is closed that day.'), { fields: { date: tx('Closed.') } });
    const over = (s: string, e: string) => s < b.end && e > b.start;
    const lesson = day.lessons.find((l) => over(l.start, l.end));
    if (lesson) throw new ApiError('conflict', tx('{room} has a lesson then ({lesson}, {start}–{end}).', { room: day.room.name, lesson: lesson.label, start: lesson.start, end: lesson.end }));
    const taken = day.bookings.find((x) => over(x.start, x.end));
    if (taken) throw new ApiError('conflict', tx('{room} is booked then ({purpose}, {start}–{end}).', { room: day.room.name, purpose: taken.purpose, start: taken.start, end: taken.end }));
    await t.pool.query('insert into room_bookings (id, room_id, date, starts_at, ends_at, purpose, booked_by) values ($1,$2,$3,$4,$5,$6,$7)', [newId('bk'), b.roomId, b.date, b.start, b.end, b.purpose, user.id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'room.booked', entity: 'room', entityId: b.roomId, detail: { date: b.date, start: b.start, end: b.end } });
    return this.roomDay(t, user, b.roomId, b.date);
  }

  /** Cancels a booking: one's own, or anyone's for someone who may edit the timetable. */
  async cancelBooking(t: TenantCtx, user: { id: string; name: string; permissions: readonly string[] }, id: string): Promise<void> {
    const b = (await t.pool.query<{ booked_by: string | null }>('select booked_by from room_bookings where id = $1', [id])).rows[0];
    if (!b) throw notFound('That booking');
    if (b.booked_by !== user.id && !user.permissions.includes('timetable.edit')) throw forbidden(tx('Only the person who booked it, or someone who edits the timetable, can cancel it.'));
    await t.pool.query('delete from room_bookings where id = $1', [id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'room.unbooked', entity: 'booking', entityId: id });
  }

  // Bell times by day (and by class)

  async periodTimes(t: TenantCtx): Promise<PeriodTimesRow[]> {
    const { rows } = await t.pool.query<{ day: number; class_id: string | null; period: number; starts_at: string; ends_at: string }>('select * from period_times order by day, class_id nulls first, period');
    return rows.map((r) => ({ day: r.day, classId: r.class_id, period: r.period, starts: r.starts_at, ends: r.ends_at }));
  }

  /** Sets one day's own times (for every class, or one), replacing that day's; an empty list puts the usual times back. */
  async putPeriodTimes(t: TenantCtx, user: { id: string; name: string }, b: PeriodTimesPut): Promise<PeriodTimesRow[]> {
    await this.editable(t);
    if (!(await this.days(t)).some((d) => d.day === b.day)) throw new ApiError('validation', tx('That day is not one of your timetable’s days.'));
    if (b.classId && !(await t.pool.query('select 1 from classes where id = $1', [b.classId])).rowCount) throw notFound('That class');
    const known = new Set((await this.periods(t)).map((p) => p.idx));
    const bad = b.times.find((x) => !known.has(x.period));
    if (bad) throw new ApiError('validation', tx('There is no period {p}.', { p: bad.period }));
    // The day's periods must not overlap once the new times are in.
    const sorted = [...b.times].sort((x, y) => x.starts.localeCompare(y.starts));
    for (let i = 1; i < sorted.length; i++) if (sorted[i]!.starts < sorted[i - 1]!.ends) throw new ApiError('validation', tx('Two periods overlap at {time}.', { time: sorted[i]!.starts }));
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from period_times where day = $1 and class_id is not distinct from $2', [b.day, b.classId]);
      for (const x of b.times) await client.query('insert into period_times (day, class_id, period, starts_at, ends_at) values ($1,$2,$3,$4,$5)', [b.day, b.classId, x.period, x.starts, x.ends]);
      await client.query('commit');
    } catch (e) { await client.query('rollback').catch(() => undefined); throw e; } finally { client.release(); }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.times', entity: 'timetable', detail: { day: b.day, classId: b.classId, periods: b.times.length } });
    return this.periodTimes(t);
  }

  async cover(t: TenantCtx, user: { id: string; name: string }, body: CoverRequest): Promise<void> {
    const busy = await t.pool.query<{ n: string }>(
      `select count(*) n from timetable_slots x join timetable_slots me on me.id = $1 where x.day = me.day and x.period = me.period and x.id <> me.id and coalesce(x.cover_teacher_id, x.teacher_id) = $2`, [body.slotId, body.teacherId]);
    if (Number(busy.rows[0]!.n) > 0) throw new ApiError('conflict', 'That teacher already has a class in this period.');
    const res = await t.pool.query('update timetable_slots set cover_teacher_id = $2 where id = $1', [body.slotId, body.teacherId]);
    if (!res.rowCount) throw notFound('That period');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.cover_set', entity: 'slot', entityId: body.slotId, detail: { teacher: body.teacherId } });
  }

  /** Makes the draft the live timetable and tells the people it changes for. Refuses while any clash is open. */
  async publish(t: TenantCtx, user: { id: string; name: string }): Promise<{ families: number; teachers: number; version: number }> {
    if ((await this.clashes(t)).length) throw new ApiError('conflict', 'Fix the clash before publishing.');
    const changed = await t.pool.query<{ class_id: string; teacher_id: string }>(
      `select class_id, coalesce(cover_teacher_id, teacher_id) teacher_id from timetable_slots
       where teacher_id is distinct from published_teacher_id or subject_id is distinct from published_subject_id or cover_teacher_id is distinct from published_cover_id`);
    const classes = [...new Set(changed.rows.map((r) => r.class_id))];
    const teachers = [...new Set(changed.rows.map((r) => r.teacher_id))];
    const fam = classes.length ? await t.pool.query<{ n: string }>('select count(distinct sg.guardian_id) n from students s join student_guardians sg on sg.student_id = s.id where s.class_id = any($1)', [classes]) : null;
    await t.pool.query('update timetable_slots set published_teacher_id = teacher_id, published_subject_id = subject_id, published_cover_id = cover_teacher_id');
    await t.pool.query("update meta set value = to_jsonb((value)::int + 1) where key = 'timetable.version'");
    await t.pool.query("update meta set value = to_jsonb($1::text) where key = 'timetable.publishedAt'", [new Date().toISOString()]);
    const v = await t.pool.query<{ value: number }>("select value from meta where key = 'timetable.version'");
    if (teachers.length) {
      const phones = await t.pool.query<{ phone: string | null }>('select phone from users where id = any($1)', [teachers]);
      await this.messenger.notify(t, 'timetable.published', phones.rows.filter((p) => p.phone).map((p) => ({ to: p.phone!, vars: {} })));
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'timetable.published', entity: 'timetable', detail: { classes: classes.length, teachers: teachers.length } });
    return { families: Number(fam?.rows[0]?.n ?? 0), teachers: teachers.length, version: Number(v.rows[0]!.value) };
  }

  /** Everyone who could take a period, the free ones first. */
  async teachers(t: TenantCtx, slotId: string): Promise<TeacherOption[]> {
    const { rows } = await t.pool.query<{ id: string; name: string; subjects: string[]; load: string; max: number; free: boolean }>(
      `select u.id, u.name, array(select s.name from staff_subjects ss join subjects s on s.id = ss.subject_id where ss.user_id = u.id order by s.name) subjects,
         (select count(*) from timetable_slots x where coalesce(x.cover_teacher_id, x.teacher_id) = u.id) load, st.max_periods_per_week max,
         not exists (select 1 from timetable_slots x join timetable_slots me on me.id = $1 where x.day = me.day and x.period = me.period and x.id <> me.id and coalesce(x.cover_teacher_id, x.teacher_id) = u.id) free
       from users u join staff st on st.user_id = u.id where u.kind = 'staff' and u.status = 'active' and st.designation = 'Teacher' order by free desc, load, u.name`, [slotId]);
    return rows.map((r) => ({ id: r.id, name: r.name, subjects: r.subjects, load: Number(r.load), max: r.max, free: r.free }));
  }

  async loads(t: TenantCtx, classId: string): Promise<TeacherLoad[]> {
    const { rows } = await t.pool.query<{ id: string; name: string; load: string; max: number; subjects: string[] }>(
      `select u.id, u.name, (select count(*) from timetable_slots x where coalesce(x.cover_teacher_id, x.teacher_id) = u.id) load, st.max_periods_per_week max,
         array(select s.name from staff_subjects ss join subjects s on s.id = ss.subject_id where ss.user_id = u.id) subjects
       from users u join staff st on st.user_id = u.id
       where u.id in (select teacher_id from timetable_slots where class_id = $1 union select cover_teacher_id from timetable_slots where class_id = $1 and cover_teacher_id is not null)
       order by 3 desc, u.name`, [classId]);
    return rows.map((r) => ({ teacherId: r.id, name: r.name, periodsPerWeek: Number(r.load), max: r.max, subjects: r.subjects }));
  }

  async classes(t: TenantCtx): Promise<{ id: string; name: string; grade: number; section: string; studentCount: number; classTeacherId: string | null; classTeacherName: string | null }[]> {
    const { rows } = await t.pool.query<{ id: string; name: string; grade: number; section: string; n: string; tid: string | null; tname: string | null }>(
      `select c.id, c.name, c.grade, c.section, (select count(*) from students s where s.class_id = c.id) n, c.class_teacher_id tid, u.name tname
       from classes c left join users u on u.id = c.class_teacher_id order by c.grade, c.section`);
    return rows.map((r) => ({ id: r.id, name: r.name, grade: r.grade, section: r.section, studentCount: Number(r.n), classTeacherId: r.tid, classTeacherName: r.tname }));
  }
}
