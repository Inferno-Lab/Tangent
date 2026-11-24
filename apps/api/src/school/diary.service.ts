import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { DEFAULT_DIARY_KINDS, DiaryInput, addDays, listLabel, listOptions, schoolToday, tx, type DiaryRow, type FamilyDiaryEntry, type ListItem } from '@tangent/contracts';
import { newId } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { FamilyService } from './family.service.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type Who = { id: string; name: string; perms: readonly string[] };
type Raw = { id: string; class_id: string; class_name: string; date: string; kind: string; subject_id: string | null; subject_name: string | null; text: string; file_ids: string[];
  by_name: string; created_by: string | null; created_at: Date; acks: string; children: string };
const SELECT = `select e.*, e.date::text date, c.name class_name, s.name subject_name,
  (select count(*) from diary_acks a where a.entry_id = e.id) acks, (select count(*) from students st where st.class_id = e.class_id and st.status = 'active') children
  from diary_entries e join classes c on c.id = e.class_id left join subjects s on s.id = e.subject_id`;

/**
 * The class diary (one-shot plan 6.7). A teacher writes for the classes they may (the class teacher, or every teacher of the
 * class where the school says so); the office reads every class. A remark for one child is read only by that child's family.
 */
@Injectable()
export class DiaryService {
  constructor(private readonly settings: SettingsService, private readonly audit: AuditService, private readonly messenger: Messenger) {}

  private kinds(t: TenantCtx): Promise<ListItem[]> {
    return this.settings.value<ListItem[]>(t, 'diary.kinds', DEFAULT_DIARY_KINDS);
  }

  /** Everyone who reads every class's diary may write in any; others only for classes they teach, as the school says. */
  private async writable(t: TenantCtx, who: Who): Promise<{ classId: string; className: string; classTeacher: boolean; subjects: { id: string; name: string }[] }[] | 'all'> {
    if (!who.perms.includes('diary.write')) return [];
    if (who.perms.includes('diary.read')) return 'all';
    const every = (await this.settings.value<string>(t, 'diary.writers', 'subjectTeachers')) === 'subjectTeachers';
    const { rows } = await t.pool.query<{ class_id: string; class_name: string; ct: boolean; subject_id: string | null; subject_name: string | null }>(
      `select c.id class_id, c.name class_name, c.class_teacher_id = $1 ct, x.subject_id, s.name subject_name from classes c
       left join (select distinct class_id, subject_id from live_slots where coalesce(cover_teacher_id, teacher_id) = $1) x on x.class_id = c.id
       left join subjects s on s.id = x.subject_id
       where c.class_teacher_id = $1 or ($2 and x.class_id is not null) order by c.grade, c.name, s.name`, [who.id, every]);
    const out = new Map<string, { classId: string; className: string; classTeacher: boolean; subjects: { id: string; name: string }[] }>();
    for (const r of rows) {
      const c = out.get(r.class_id) ?? { classId: r.class_id, className: r.class_name, classTeacher: r.ct, subjects: [] };
      if (r.subject_id && every) c.subjects.push({ id: r.subject_id, name: r.subject_name ?? r.subject_id });
      out.set(r.class_id, c);
    }
    return [...out.values()];
  }

  /** The school's kinds of entry it offers now (the app's picker). */
  async kindOptions(t: TenantCtx): Promise<{ key: string; name: string }[]> {
    return listOptions(await this.kinds(t)).map((k) => ({ key: k.key, name: k.name }));
  }

  /** The classes this person writes for, with the subjects they teach in each (the app's class picker). */
  async myClasses(t: TenantCtx, who: Who) {
    const w = await this.writable(t, who);
    if (w !== 'all') return w;
    const { rows } = await t.pool.query<{ id: string; name: string }>('select c.id, c.name from classes c join academic_years y on y.id = c.year_id and y.current order by c.grade, c.name');
    return rows.map((r) => ({ classId: r.id, className: r.name, classTeacher: true, subjects: [] }));
  }

  private async mayWrite(t: TenantCtx, who: Who, classId: string, subjectId: string | null): Promise<void> {
    const w = await this.writable(t, who);
    if (w === 'all') return;
    const c = w.find((x) => x.classId === classId);
    if (!c) throw forbidden(tx('You write the diary only for classes you teach.'));
    // A subject teacher writes for their own subject; the class teacher for the whole class.
    if (!c.classTeacher && !c.subjects.some((s) => s.id === subjectId)) {
      throw new ApiError('validation', tx('Choose the subject you teach this class.'), { fields: { subjectId: tx('Choose your subject.') } });
    }
  }

  private async row(t: TenantCtx, r: Raw, withRemarks = true): Promise<DiaryRow> {
    const kinds = await this.kinds(t);
    const files = r.file_ids.length ? (await t.pool.query<{ id: string; name: string }>('select id, name from files where id = any($1) and deleted_at is null', [r.file_ids])).rows : [];
    const remarks = withRemarks ? (await t.pool.query<{ student_id: string; name: string; text: string }>(
      'select r.student_id, s.name, r.text from diary_remarks r join students s on s.id = r.student_id where r.entry_id = $1 order by s.name', [r.id])).rows : [];
    return {
      id: r.id, classId: r.class_id, className: r.class_name, date: r.date, kind: r.kind, kindName: listLabel(kinds, r.kind), subjectId: r.subject_id, subjectName: r.subject_name, text: r.text,
      files, remarks: remarks.map((x) => ({ studentId: x.student_id, studentName: x.name, text: x.text })), acks: Number(r.acks), families: Number(r.children), by: r.by_name, byId: r.created_by ?? '',
      createdAt: r.created_at.toISOString(),
    };
  }

  private async one(t: TenantCtx, id: string): Promise<Raw> {
    const r = (await t.pool.query<Raw>(`${SELECT} where e.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That diary entry'));
    return r;
  }

  /** A class's entries between two days (a fortnight around today by default), newest first. */
  async list(t: TenantCtx, who: Who, f: { classId?: string; from?: string; to?: string }): Promise<DiaryRow[]> {
    if (!who.perms.includes('diary.read') && !who.perms.includes('diary.write')) throw forbidden(tx('You do not have access to this. Ask your principal to change your role.'));
    const w = who.perms.includes('diary.read') ? 'all' : await this.writable(t, who);
    if (w !== 'all' && f.classId && !w.some((c) => c.classId === f.classId)) throw forbidden(tx('You see the diary only of classes you teach.'));
    const mine = w === 'all' ? null : w.map((c) => c.classId);
    const from = f.from ?? addDays(schoolToday(), -14), to = f.to ?? addDays(schoolToday(), 14);
    const { rows } = await t.pool.query<Raw>(`${SELECT} where ($1::text is null or e.class_id = $1) and ($2::text[] is null or e.class_id = any($2)) and e.date between $3 and $4
      order by e.date desc, e.created_at desc limit 300`, [f.classId ?? null, mine, from, to]);
    return Promise.all(rows.map((r) => this.row(t, r)));
  }

  private async check(t: TenantCtx, who: Who, b: DiaryInput): Promise<void> {
    await this.mayWrite(t, who, b.classId, b.subjectId);
    if (!listOptions(await this.kinds(t)).some((k) => k.key === b.kind)) throw new ApiError('validation', tx('Choose one of the school’s kinds of entry.'), { fields: { kind: tx('Choose a kind.') } });
    const today = schoolToday();
    if (b.date < addDays(today, -30) || b.date > addDays(today, 30)) throw new ApiError('validation', tx('Write the diary for a day within a month of today.'), { fields: { date: tx('Pick a nearer day.') } });
    if (b.subjectId && !(await t.pool.query('select 1 from subjects where id = $1', [b.subjectId])).rowCount) throw new ApiError('validation', tx('That subject does not exist.'), { fields: { subjectId: tx('Choose a subject.') } });
    if (b.remarks.length) {
      const ids = b.remarks.map((r) => r.studentId);
      if (new Set(ids).size !== ids.length) throw new ApiError('validation', tx('Write one remark for each student.'));
      const n = Number((await t.pool.query<{ n: string }>("select count(*) n from students where id = any($1) and class_id = $2 and status = 'active'", [ids, b.classId])).rows[0]!.n);
      if (n !== ids.length) throw new ApiError('validation', tx('A remark is for a student of this class.'));
    }
    if (b.fileIds.length) {
      const n = Number((await t.pool.query<{ n: string }>("select count(*) n from files where id = any($1) and kind = 'diary_attachment' and deleted_at is null", [b.fileIds])).rows[0]!.n);
      if (n !== new Set(b.fileIds).size) throw new ApiError('validation', tx('An attached file is missing. Attach it again.'));
    }
  }

  private async writeRemarks(q: { query: TenantCtx['pool']['query'] }, id: string, b: DiaryInput): Promise<void> {
    await q.query('delete from diary_remarks where entry_id = $1', [id]);
    for (const r of b.remarks) await q.query('insert into diary_remarks (entry_id, student_id, text) values ($1,$2,$3)', [id, r.studentId, r.text]);
  }

  async add(t: TenantCtx, who: Who, b: DiaryInput): Promise<DiaryRow> {
    await this.check(t, who, b);
    const id = newId('dia');
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into diary_entries (id, class_id, date, kind, subject_id, text, file_ids, created_by, by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, b.classId, b.date, b.kind, b.subjectId, b.text, JSON.stringify(b.fileIds), who.id, who.name]);
      await this.writeRemarks(client, id, b);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: who.id, actorName: who.name, action: 'diary.written', entity: 'diary', entityId: id, detail: { classId: b.classId, date: b.date } });
    const row = await this.row(t, await this.one(t, id));
    // Families hear of an entry for today or later; one written for a past day only fills in the record.
    if (b.date >= schoolToday()) {
      const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(
        `select distinct g.phone, g.email from students s join student_guardians sg on sg.student_id = s.id and sg.gets_messages join guardians g on g.id = sg.guardian_id
         where s.class_id = $1 and s.status = 'active'`, [b.classId])).rows;
      await this.messenger.notify(t, 'diary.entry', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { class: row.className, kind: row.kindName, text: b.text.slice(0, 120) } })));
    }
    return row;
  }

  /** Its writer changes it (or anyone who reads every class); a family's acknowledgement stays. */
  async save(t: TenantCtx, who: Who, id: string, b: DiaryInput): Promise<DiaryRow> {
    const was = await this.one(t, id);
    if (was.created_by !== who.id && !who.perms.includes('diary.read')) throw forbidden(tx('Only whoever wrote an entry changes it.'));
    if (was.class_id !== b.classId) throw new ApiError('validation', tx('An entry stays with its class: write a new one for another class.'));
    await this.check(t, who, b);
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('update diary_entries set date = $2, kind = $3, subject_id = $4, text = $5, file_ids = $6, updated_at = now() where id = $1', [id, b.date, b.kind, b.subjectId, b.text, JSON.stringify(b.fileIds)]);
      await this.writeRemarks(client, id, b);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return this.row(t, await this.one(t, id));
  }

  async remove(t: TenantCtx, who: Who, id: string): Promise<void> {
    const was = await this.one(t, id);
    if (was.created_by !== who.id && !who.perms.includes('diary.read')) throw forbidden(tx('Only whoever wrote an entry removes it.'));
    await t.pool.query('delete from diary_entries where id = $1', [id]);
    await this.audit.record(t, { actorId: who.id, actorName: who.name, action: 'diary.removed', entity: 'diary', entityId: id, detail: { classId: was.class_id, date: was.date } });
  }

  /** Who acknowledged an entry: each child of the class, ticked or not. */
  async acks(t: TenantCtx, who: Who, id: string): Promise<{ studentId: string; name: string; at: string | null }[]> {
    const e = await this.one(t, id);
    if (!who.perms.includes('diary.read')) {
      if (!who.perms.includes('diary.write')) throw forbidden(tx('You do not have access to this. Ask your principal to change your role.'));
      const w = await this.writable(t, who);
      if (w !== 'all' && !w.some((c) => c.classId === e.class_id)) throw forbidden(tx('You see the diary only of classes you teach.'));
    }
    const { rows } = await t.pool.query<{ id: string; name: string; at: Date | null }>(
      "select s.id, s.name, a.at from students s left join diary_acks a on a.student_id = s.id and a.entry_id = $1 where s.class_id = $2 and s.status = 'active' order by s.roll_no, s.name", [id, e.class_id]);
    return rows.map((r) => ({ studentId: r.id, name: r.name, at: r.at?.toISOString() ?? null }));
  }

  // ── Families and students ────────────────────────────────────────────────────

  async forChild(t: TenantCtx, children: string[], studentId: string, f: { from?: string; to?: string }): Promise<FamilyDiaryEntry[]> {
    if (!children.includes(studentId)) throw notFound(tx('That student'));
    const s = (await t.pool.query<{ class_id: string }>('select class_id from students where id = $1', [studentId])).rows[0];
    if (!s) throw notFound(tx('That student'));
    const from = f.from ?? addDays(schoolToday(), -14), to = f.to ?? addDays(schoolToday(), 14);
    const { rows } = await t.pool.query<Raw & { remark: string | null; acked: boolean }>(
      `${SELECT.replace('from diary_entries e', `, (select r.text from diary_remarks r where r.entry_id = e.id and r.student_id = $2) remark,
        exists (select 1 from diary_acks a where a.entry_id = e.id and a.student_id = $2) acked from diary_entries e`)}
       where e.class_id = $1 and e.date between $3 and $4 order by e.date desc, e.created_at desc limit 200`, [s.class_id, studentId, from, to]);
    const kinds = await this.kinds(t);
    const ack = await this.settings.value<boolean>(t, 'diary.ack', true);
    const files = new Map((await t.pool.query<{ id: string; name: string }>('select id, name from files where id = any($1) and deleted_at is null', [rows.flatMap((r) => r.file_ids)])).rows.map((x) => [x.id, x]));
    return rows.map((r) => ({
      id: r.id, date: r.date, kind: r.kind, kindName: listLabel(kinds, r.kind), subject: r.subject_name, text: r.text, files: r.file_ids.map((x) => files.get(x)).filter((x): x is { id: string; name: string } => !!x),
      remark: r.remark, by: r.by_name, acknowledged: r.acked, needsAck: ack && !r.acked,
    }));
  }

  async acknowledge(t: TenantCtx, user: { id: string; children: string[] }, id: string, studentId: string): Promise<{ ok: true }> {
    if (!user.children.includes(studentId)) throw notFound(tx('That student'));
    const ok = await t.pool.query('select 1 from diary_entries e join students s on s.class_id = e.class_id where e.id = $1 and s.id = $2', [id, studentId]);
    if (!ok.rowCount) throw notFound(tx('That diary entry'));
    await t.pool.query('insert into diary_acks (entry_id, student_id, user_id) values ($1,$2,$3) on conflict do nothing', [id, studentId, user.id]);
    return { ok: true };
  }
}

@Controller('v1/diary')
@RequireModule('diary')
export class DiaryController {
  constructor(private readonly d: DiaryService) {}

  private who(u: AuthedUser): Who { return { id: u.id, name: u.name, perms: u.permissions }; }

  @Get()
  list(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Query('classId') classId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.d.list(t, this.who(u), { classId: classId || undefined, from: from || undefined, to: to || undefined });
  }

  @Get('classes') @Require('diary.write')
  classes(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return this.d.myClasses(t, this.who(u)); }

  @Post() @HttpCode(200) @Require('diary.write')
  add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(DiaryInput)) b: DiaryInput) { return this.d.add(t, this.who(u), b); }

  @Put(':id') @Require('diary.write')
  save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(DiaryInput)) b: DiaryInput) { return this.d.save(t, this.who(u), id, b); }

  @Delete(':id') @HttpCode(204) @Require('diary.write')
  remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.d.remove(t, this.who(u), id); }

  @Get(':id/acks')
  acks(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.d.acks(t, this.who(u), id); }
}

/** The app: families read their child's diary and acknowledge it; teachers write it (the same rules as the admin). */
@Controller('v1/f/diary')
@RequireModule('diary')
export class FamilyDiaryController {
  constructor(private readonly d: DiaryService, private readonly f: FamilyService) {}

  private async teacher(t: TenantCtx, u: AuthedUser): Promise<Who> {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return { id: w.id, name: w.name, perms: w.perms };
  }

  @Get('student/:id')
  async forChild(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.d.forChild(t, (await this.f.who(t, u)).children, id, { from: from || undefined, to: to || undefined });
  }

  @Post(':id/ack') @HttpCode(200)
  async ack(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body() b: { studentId?: string }) {
    return this.d.acknowledge(t, await this.f.who(t, u), id, String(b?.studentId ?? ''));
  }

  @Get('classes')
  async classes(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) { return { classes: await this.d.myClasses(t, await this.teacher(t, u)), kinds: await this.d.kindOptions(t) }; }

  @Get()
  async list(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Query('classId') classId?: string) { return this.d.list(t, await this.teacher(t, u), { classId: classId || undefined }); }

  @Post() @HttpCode(200)
  async add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(DiaryInput)) b: DiaryInput) { return this.d.add(t, await this.teacher(t, u), b); }

  @Put(':id')
  async save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(DiaryInput)) b: DiaryInput) { return this.d.save(t, await this.teacher(t, u), id, b); }

  @Delete(':id') @HttpCode(204)
  async remove(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.d.remove(t, await this.teacher(t, u), id); }
}
