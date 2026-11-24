import { Injectable } from '@nestjs/common';
import { newId } from '@tangent/db';
import {
  schoolToday, gpaOf, roundPct, gradeIn, gradesOf, pctOfGrade, type ExamRemarksPut,
  type ExamCreate, type ExamMarksPut, type ExamMarksView, type ExamResults, type ExamRow, type HomeworkCreate, type HomeworkDetail, type HomeworkMarks, type HomeworkRow, tx } from '@tangent/contracts';
import { ApiError, notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { AuditService, Messenger, SettingsService, mayTeach } from './support.js';

type User = { id: string; name: string; permissions: readonly string[] };


/** Homework and exams: setting them, recording hand-ins and marks, and turning marks into results. */
@Injectable()
export class LearningService {
  constructor(
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly settings: SettingsService,
  ) {}

  // Homework

  async homework(t: TenantCtx, q: { classId?: string; subjectId?: string; draftsOf?: string }): Promise<HomeworkRow[]> {
    const { rows } = await t.pool.query<{
      id: string; class_id: string; class_name: string; subject_id: string; subject_name: string; title: string; description: string; assigned_on: string; due_on: string; max_marks: number;
      graded: boolean; handed: string; on_time: string; total: string; created_by: string | null; teacher_name: string | null;
    }>(
      `select h.id, h.class_id, c.name class_name, h.subject_id, s.name subject_name, h.title, h.description, h.assigned_on::text, h.due_on::text, h.max_marks, h.graded, h.created_by, tu.name teacher_name,
         count(*) filter (where sub.handed_at is not null) handed, count(*) filter (where sub.on_time) on_time, count(sub.student_id) total
       from homework h join classes c on c.id = h.class_id join subjects s on s.id = h.subject_id left join users tu on tu.id = h.created_by left join homework_submissions sub on sub.homework_id = h.id
       where ($1::text is null or h.class_id = $1) and ($2::text is null or h.subject_id = $2) and (h.status = 'set' or h.created_by = $3)
       group by h.id, c.id, s.id, tu.name order by h.assigned_on desc, c.grade, c.section, h.id limit 120`, [q.classId ?? null, q.subjectId ?? null, q.draftsOf ?? '']);
    return rows.map((r) => ({
      id: r.id, classId: r.class_id, className: r.class_name, subjectId: r.subject_id, subjectName: r.subject_name, title: r.title, description: r.description,
      assignedOn: r.assigned_on, dueOn: r.due_on, maxMarks: r.max_marks, graded: r.graded, handedIn: Number(r.handed), onTime: Number(r.on_time), total: Number(r.total),
      teacherId: r.created_by, teacherName: r.teacher_name ?? '',
    }));
  }

  async homeworkDetail(t: TenantCtx, id: string): Promise<HomeworkDetail> {
    const row = await this.homeworkRow(t, id);
    const { rows } = await t.pool.query<{ student_id: string; name: string; roll_no: string; handed_at: Date | null; on_time: boolean; score: number | null; feedback: string }>(
      `select s.id student_id, s.name, s.roll_no, sub.handed_at, coalesce(sub.on_time, false) on_time, sub.score, coalesce(sub.feedback, '') feedback
       from students s left join homework_submissions sub on sub.student_id = s.id and sub.homework_id = $1
       where s.class_id = $2 and s.status = 'active' order by s.roll_no, s.name`, [id, row.classId]);
    // What the teacher attached, and what each student handed in from the app (files that passed their check only).
    const files = (await t.pool.query<{ id: string; name: string; mime: string; kind: string; owner_id: string }>(
      `select id, name, mime, kind, owner_id from files where status = 'clean' and deleted_at is null
       and ((kind = 'homework_attachment' and owner_id = $1) or (kind = 'homework_submission' and owner_id like $1 || ':%')) order by created_at`, [id])).rows;
    const f = (x: { id: string; name: string; mime: string }) => ({ id: x.id, name: x.name, mime: x.mime });
    return {
      ...row, files: files.filter((x) => x.kind === 'homework_attachment').map(f),
      students: rows.map((r) => ({
        studentId: r.student_id, name: r.name, rollNo: r.roll_no, handedAt: r.handed_at?.toISOString() ?? null, onTime: r.on_time, score: r.score, feedback: r.feedback,
        files: files.filter((x) => x.kind === 'homework_submission' && x.owner_id === `${id}:${r.student_id}`).map(f),
      })),
    };
  }

  private async homeworkRow(t: TenantCtx, id: string): Promise<HomeworkRow> {
    const cls = (await t.pool.query<{ class_id: string }>('select class_id from homework where id = $1', [id])).rows[0];
    const hit = cls && (await this.homework(t, { classId: cls.class_id })).find((h) => h.id === id);
    if (!hit) throw notFound('That homework');
    return hit;
  }

  async createHomework(t: TenantCtx, user: User, body: HomeworkCreate): Promise<HomeworkDetail> {
    const id = newId('hw');
    await this.writeHomework(t, user, id, body, true);
    return this.homeworkDetail(t, id);
  }

  /** Changes homework already set (or still a draft); setting a draft tells the families. */
  async updateHomework(t: TenantCtx, user: User, id: string, body: HomeworkCreate): Promise<HomeworkDetail> {
    const h = (await t.pool.query<{ created_by: string | null; status: string; class_id: string }>('select created_by, status, class_id from homework where id = $1', [id])).rows[0];
    if (!h) throw notFound('That homework');
    if (h.class_id !== body.classId) throw new ApiError('validation', 'Homework stays with its class. Delete it and set it for the other class instead.');
    await this.writeHomework(t, user, id, body, false, h.status);
    return this.homeworkDetail(t, id);
  }

  private async writeHomework(t: TenantCtx, user: User, id: string, body: HomeworkCreate, isNew: boolean, was = 'draft'): Promise<void> {
    await mayTeach(t, user, body.classId);
    const [cls, sub] = await Promise.all([
      t.pool.query<{ name: string }>('select name from classes where id = $1', [body.classId]),
      t.pool.query<{ name: string }>('select name from subjects where id = $1', [body.subjectId]),
    ]);
    if (!cls.rows[0]) throw new ApiError('validation', 'Choose a class from the list.', { fields: { classId: 'Choose a class from the list.' } });
    if (!sub.rows[0]) throw new ApiError('validation', 'Choose a subject from the list.', { fields: { subjectId: 'Choose a subject from the list.' } });
    const today = schoolToday();
    if (body.dueOn < today) throw new ApiError('validation', 'The due date cannot be in the past.', { fields: { dueOn: 'Pick today or a later day.' } });
    const status = body.draft ? 'draft' : 'set';
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      if (isNew) {
        await client.query('insert into homework (id, class_id, subject_id, title, description, assigned_on, due_on, max_marks, created_by, status, graded) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [id, body.classId, body.subjectId, body.title, body.description, today, body.dueOn, body.maxMarks, user.id, status, body.graded]);
        await client.query("insert into homework_submissions (homework_id, student_id) select $1, id from students where class_id = $2 and status = 'active'", [id, body.classId]);
      } else {
        await client.query('update homework set subject_id = $2, title = $3, description = $4, due_on = $5, max_marks = $6, status = $7, graded = $8, assigned_on = case when status = $9 then $10 else assigned_on end where id = $1',
          [id, body.subjectId, body.title, body.description, body.dueOn, body.maxMarks, status, body.graded, 'draft', today]);
      }
      if (body.fileIds.length) await client.query("update files set owner_id = $1 where id = any($2) and kind = 'homework_attachment'", [id, body.fileIds]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    // Families hear about homework when it is set, not while it is a draft, and not again for a correction.
    if (status === 'set' && was === 'draft') {
      const g = await t.pool.query<{ phone: string | null; name: string }>(
        `select g.phone, s.name from students s join student_guardians sg on sg.student_id = s.id and sg.gets_messages join guardians g on g.id = sg.guardian_id where s.class_id = $1 and s.status = 'active'`, [body.classId]);
      await this.messenger.notify(t, 'homework.new', g.rows.filter((r) => r.phone).map((r) => ({ to: r.phone!, vars: { student: r.name, subject: sub.rows[0]!.name, title: body.title, due: body.dueOn } })));
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: isNew ? `homework.${status === 'draft' ? 'drafted' : 'set'}` : 'homework.changed', entity: 'homework', entityId: id, detail: { class: cls.rows[0].name, title: body.title } });
  }

  /** Sends handed-in work back for a redo, saying why: the family hands it in again. */
  async returnHomework(t: TenantCtx, user: User, id: string, studentId: string, note: string): Promise<void> {
    await this.mayTeachHomework(t, user, id);
    const r = await t.pool.query('update homework_submissions set returned_at = now(), return_note = $3, score = null, graded_at = null where homework_id = $1 and student_id = $2 and handed_at is not null', [id, studentId, note]);
    if (!r.rowCount) throw new ApiError('conflict', 'Only work that was handed in can be sent back.');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'homework.returned', entity: 'homework', entityId: id, detail: { studentId, note } });
  }

  async markHomework(t: TenantCtx, user: User, id: string, body: HomeworkMarks): Promise<HomeworkDetail> {
    const hw = (await t.pool.query<{ due_on: string; max_marks: number; class_id: string }>('select due_on::text, max_marks, class_id from homework where id = $1', [id])).rows[0];
    if (!hw) throw notFound('That homework');
    await mayTeach(t, user, hw.class_id);
    for (const m of body.marks) {
      if (m.score != null && m.score > hw.max_marks) throw new ApiError('validation', tx('Marks cannot be more than {max_marks}.', { max_marks: hw.max_marks }), { fields: { score: tx('The most is {max_marks}.', { max_marks: hw.max_marks }) } });
    }
    const today = schoolToday();
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      const inClass = new Set((await client.query<{ id: string }>('select id from students where class_id = $1', [hw.class_id])).rows.map((r) => r.id));
      for (const m of body.marks) {
        if (!inClass.has(m.studentId)) throw new ApiError('validation', 'One of those students is not in this class.');
        await client.query(
          `insert into homework_submissions (homework_id, student_id, handed_at, on_time, score, feedback) values ($1,$2,$3,$4,$5,$6)
           on conflict (homework_id, student_id) do update set handed_at = case when $7 then coalesce(homework_submissions.handed_at, excluded.handed_at) else null end,
             on_time = case when $7 then (case when homework_submissions.handed_at is not null then homework_submissions.on_time else excluded.on_time end) else false end,
             score = case when $7 then excluded.score else null end, feedback = excluded.feedback,
             graded_at = case when $7 and excluded.score is not null then now() else homework_submissions.graded_at end, returned_at = case when $7 and excluded.score is not null then null else homework_submissions.returned_at end`,
          [id, m.studentId, m.handed ? new Date() : null, m.handed && today <= hw.due_on, m.handed ? (m.score ?? null) : null, m.feedback ?? '', m.handed]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'homework.marked', entity: 'homework', entityId: id, detail: { students: body.marks.length } });
    return this.homeworkDetail(t, id);
  }

  /** Homework is changed, graded or sent back only by someone who teaches its class (or acts on every class). */
  private async mayTeachHomework(t: TenantCtx, user: User, id: string): Promise<void> {
    const h = (await t.pool.query<{ class_id: string }>('select class_id from homework where id = $1', [id])).rows[0];
    if (!h) throw notFound('That homework');
    await mayTeach(t, user, h.class_id);
  }

  async deleteHomework(t: TenantCtx, user: User, id: string): Promise<void> {
    await this.mayTeachHomework(t, user, id);
    const r = await t.pool.query('delete from homework where id = $1', [id]);
    if (!r.rowCount) throw notFound('That homework');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'homework.removed', entity: 'homework', entityId: id });
  }

  // Exams

  async exams(t: TenantCtx, classId?: string): Promise<ExamRow[]> {
    // An exam that has begun is being marked, whether or not a mark is in yet (it is never "coming up" once written).
    const today = schoolToday();
    const { rows } = await t.pool.query<{ id: string; name: string; kind: string; class_id: string; class_name: string; grade: number; starts_on: string; ends_on: string; status: ExamRow['status']; students: string; reopened_note: string }>(
      `select e.id, e.name, e.kind, e.class_id, c.name class_name, c.grade, e.starts_on::text, e.ends_on::text, e.status, e.reopened_note,
         (select count(*) from students s where s.class_id = e.class_id and s.status = 'active') students
       from exams e join classes c on c.id = e.class_id where ($1::text is null or e.class_id = $1) order by e.starts_on desc, c.grade, c.section limit 100`, [classId ?? null]);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [subs, entered] = await Promise.all([
      t.pool.query<{ exam_id: string; subject_id: string; name: string; on_date: string | null; max_marks: number; starts_at: string | null; ends_at: string | null; room: string; invigilator_id: string | null; invigilator: string | null }>(
        `select x.exam_id, x.subject_id, s.name, x.on_date::text, x.max_marks, x.starts_at, x.ends_at, x.room, x.invigilator_id, u.name invigilator
         from exam_subjects x join subjects s on s.id = x.subject_id left join users u on u.id = x.invigilator_id where x.exam_id = any($1) order by x.on_date nulls last, x.starts_at nulls last, s.name`, [ids]),
      t.pool.query<{ exam_id: string; n: string }>('select exam_id, count(*) n from exam_marks where exam_id = any($1) and (score is not null or grade is not null or absent) group by exam_id', [ids]),
    ]);
    const enteredBy = new Map(entered.rows.map((e) => [e.exam_id, Number(e.n)]));
    // A subject the school grades straight away (its scheme's entry is "grade") lists the grades to pick from.
    const gradings = new Map<number, Awaited<ReturnType<SettingsService['grading']>>>();
    for (const g of new Set(rows.map((r) => r.grade))) gradings.set(g, await this.settings.grading(t, { grade: g }));
    return rows.map((r) => {
      const grading = gradings.get(r.grade)!;
      const subjects = subs.rows.filter((s) => s.exam_id === r.id).map((s) => {
        const scheme = grading.schemeOf(s.subject_id);
        return { subjectId: s.subject_id, name: s.name, onDate: s.on_date, maxMarks: s.max_marks, startsAt: s.starts_at, endsAt: s.ends_at, room: s.room, invigilatorId: s.invigilator_id, invigilatorName: s.invigilator, grades: scheme.entry === 'grade' ? gradesOf(scheme) : [],
          criteria: scheme.kind === 'rubric' ? scheme.criteria ?? [] : [] };
      });
      return { id: r.id, name: r.name, kind: r.kind, classId: r.class_id, className: r.class_name, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status === 'upcoming' && r.starts_on <= today ? 'marking' : r.status, subjects, entered: enteredBy.get(r.id) ?? 0, expected: Number(r.students) * subjects.length, reopenedNote: r.reopened_note };
    });
  }

  /** An exam's papers, with the grades a subject graded without marks takes. */
  async examSubjects(t: TenantCtx, id: string): Promise<ExamRow['subjects']> {
    return (await this.exam(t, id)).subjects;
  }

  private async exam(t: TenantCtx, id: string): Promise<ExamRow> {
    const cls = (await t.pool.query<{ class_id: string }>('select class_id from exams where id = $1', [id])).rows[0];
    if (!cls) throw notFound('That exam');
    return (await this.exams(t, cls.class_id)).find((e) => e.id === id)!;
  }

  /**
   * An exam's kind is one of the school's (exams.types); each invigilator is active staff, and is not in two rooms at once:
   * not two of these papers at the same time, nor a paper of another exam then.
   */
  private async checkPapers(t: TenantCtx, body: ExamCreate, exclude: string[]): Promise<void> {
    if (body.kind) {
      const types = await this.settings.value<{ key: string }[]>(t, 'exams.types', []);
      if (!types.some((x) => x.key === body.kind)) throw new ApiError('validation', tx('Choose one of the school’s kinds of exam.'), { fields: { kind: tx('Choose from the list.') } });
    }
    const people = [...new Set(body.subjects.map((s) => s.invigilatorId).filter((x): x is string => !!x))];
    if (!people.length) return;
    const active = new Set((await t.pool.query<{ id: string }>("select id from users where id = any($1) and kind = 'staff' and status = 'active'", [people])).rows.map((r) => r.id));
    const gone = people.find((p) => !active.has(p));
    if (gone) throw new ApiError('validation', tx('Choose invigilators from the staff list.'), { fields: { subjects: tx('Choose from the staff list.') } });
    const timed = body.subjects.filter((s) => s.invigilatorId && s.onDate && s.startsAt && s.endsAt);
    const over = (a: { startsAt?: string | null; endsAt?: string | null }, b: { starts_at: string | null; ends_at: string | null }) => !!(a.startsAt && a.endsAt && b.starts_at && b.ends_at && a.startsAt < b.ends_at && b.starts_at < a.endsAt);
    for (const [i, a] of timed.entries()) {
      const twice = timed.slice(i + 1).find((b) => b.invigilatorId === a.invigilatorId && b.onDate === a.onDate && over(a, { starts_at: b.startsAt ?? null, ends_at: b.endsAt ?? null }));
      if (twice) throw new ApiError('conflict', tx('The same person invigilates two papers at once on {date}.', { date: a.onDate! }), { fields: { subjects: tx('Two papers at once.') } });
      const elsewhere = (await t.pool.query<{ starts_at: string | null; ends_at: string | null; name: string }>(
        'select x.starts_at, x.ends_at, e.name from exam_subjects x join exams e on e.id = x.exam_id where x.invigilator_id = $1 and x.on_date = $2 and not (x.exam_id = any($3))', [a.invigilatorId, a.onDate, exclude])).rows;
      const clash = elsewhere.find((b) => over(a, b));
      if (clash) throw new ApiError('conflict', tx('That invigilator is already watching {exam} then.', { exam: clash.name }), { fields: { subjects: tx('Busy then.') } });
    }
  }

  async createExam(t: TenantCtx, user: User, body: ExamCreate): Promise<ExamRow> {
    if (body.endsOn < body.startsOn) throw new ApiError('validation', 'The last day cannot be before the first day.', { fields: { endsOn: 'Pick a day on or after the first day.' } });
    await this.checkPapers(t, body, []);
    const classIds = [...new Set([body.classId, ...body.alsoClassIds])];
    const cls = await t.pool.query('select id from classes where id = any($1)', [classIds]);
    if (cls.rowCount !== classIds.length) throw new ApiError('validation', 'Choose classes from the list.', { fields: { classId: 'Choose a class from the list.' } });
    const known = await t.pool.query<{ id: string }>('select id from subjects where id = any($1)', [body.subjects.map((s) => s.subjectId)]);
    if (known.rowCount !== new Set(body.subjects.map((s) => s.subjectId)).size) throw new ApiError('validation', 'One of those subjects does not exist.', { fields: { subjects: 'Pick subjects from the list.' } });
    // Every class gets its own exam (marks and results are per class), made together: all of them or none.
    const ids = classIds.map(() => newId('exm'));
    const id = ids[0]!;
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      for (const [i, classId] of classIds.entries()) {
        await client.query('insert into exams (id, name, kind, class_id, starts_on, ends_on, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [ids[i], body.name, body.kind, classId, body.startsOn, body.endsOn, user.id]);
        for (const s of body.subjects) {
          await client.query('insert into exam_subjects (exam_id, subject_id, on_date, max_marks, starts_at, ends_at, room, invigilator_id) values ($1,$2,$3,$4,$5,$6,$7,$8)',
            [ids[i], s.subjectId, s.onDate ?? null, s.maxMarks, s.startsAt ?? null, s.endsAt ?? null, s.room, s.invigilatorId ?? null]);
        }
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.created', entity: 'exam', entityId: id, detail: { name: body.name, classes: classIds.length } });
    return this.exam(t, id);
  }

  async marksView(t: TenantCtx, id: string): Promise<ExamMarksView> {
    const exam = await this.exam(t, id);
    const [stu, marks, remarks] = await Promise.all([
      t.pool.query<{ id: string; name: string; roll_no: string }>("select id, name, roll_no from students where class_id = $1 and status = 'active' order by roll_no, name", [exam.classId]),
      t.pool.query<{ student_id: string; subject_id: string; score: string | null; absent: boolean; grade: string | null; criteria: Record<string, number> | null }>('select student_id, subject_id, score, absent, grade, criteria from exam_marks where exam_id = $1', [id]),
      t.pool.query<{ student_id: string; remark: string }>('select student_id, remark from exam_remarks where exam_id = $1', [id]),
    ]);
    const by = new Map<string, Record<string, { score: number | null; absent: boolean; grade: string | null; criteria: Record<string, number> | null }>>();
    for (const m of marks.rows) {
      const cur = by.get(m.student_id) ?? {};
      cur[m.subject_id] = { score: m.score == null ? null : Number(m.score), absent: m.absent, grade: m.grade, criteria: m.criteria };
      by.set(m.student_id, cur);
    }
    const said = new Map(remarks.rows.map((r) => [r.student_id, r.remark]));
    return { exam, students: stu.rows.map((s) => ({ studentId: s.id, name: s.name, rollNo: s.roll_no, marks: by.get(s.id) ?? {}, remark: said.get(s.id) ?? '' })) };
  }

  /**
   * Changes an exam's name, days and papers (time, room, maximum marks) while its results are not out. A paper that already has
   * marks keeps its maximum, so marks never end up above it.
   */
  async updateExam(t: TenantCtx, user: User, id: string, body: ExamCreate): Promise<ExamRow> {
    const e = await this.exam(t, id);
    if (e.status === 'published') throw new ApiError('conflict', 'The results are out. Reopen them first to change the exam.');
    if (body.endsOn < body.startsOn) throw new ApiError('validation', 'The last day cannot be before the first day.', { fields: { endsOn: 'Pick a day on or after the first day.' } });
    const marked = new Set((await t.pool.query<{ subject_id: string }>('select distinct subject_id from exam_marks where exam_id = $1', [id])).rows.map((r) => r.subject_id));
    const gone = [...marked].filter((s) => !body.subjects.some((x) => x.subjectId === s));
    if (gone.length) throw new ApiError('conflict', 'A subject that already has marks cannot be taken out of the exam.');
    await this.checkPapers(t, body, [id]);
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('update exams set name = $2, starts_on = $3, ends_on = $4, kind = $5 where id = $1', [id, body.name, body.startsOn, body.endsOn, body.kind]);
      await client.query('delete from exam_subjects where exam_id = $1 and not (subject_id = any($2))', [id, body.subjects.map((s) => s.subjectId)]);
      for (const s of body.subjects) {
        const was = e.subjects.find((x) => x.subjectId === s.subjectId);
        await client.query(
          `insert into exam_subjects (exam_id, subject_id, on_date, max_marks, starts_at, ends_at, room, invigilator_id) values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (exam_id, subject_id) do update set on_date = excluded.on_date, max_marks = excluded.max_marks, starts_at = excluded.starts_at, ends_at = excluded.ends_at, room = excluded.room, invigilator_id = excluded.invigilator_id`,
          [id, s.subjectId, s.onDate ?? null, marked.has(s.subjectId) && was ? was.maxMarks : s.maxMarks, s.startsAt ?? null, s.endsAt ?? null, s.room, s.invigilatorId ?? null]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.changed', entity: 'exam', entityId: id, detail: { name: body.name } });
    return this.exam(t, id);
  }

  /** Published results are locked; reopening them (with why) lets marks be corrected, and families are told why when they go out again. */
  async reopenExam(t: TenantCtx, user: User, id: string, note: string): Promise<ExamRow> {
    const e = await this.exam(t, id);
    if (e.status !== 'published') throw new ApiError('conflict', 'These results are not out yet, so there is nothing to reopen.');
    await t.pool.query("update exams set status = 'marking', reopened_note = $2 where id = $1", [id, note]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.reopened', entity: 'exam', entityId: id, detail: { name: e.name, note } });
    return this.exam(t, id);
  }

  async putMarks(t: TenantCtx, user: User, id: string, body: ExamMarksPut): Promise<ExamMarksView> {
    const exam = await this.exam(t, id);
    await mayTeach(t, user, exam.classId);
    if (exam.status === 'published') throw new ApiError('locked', 'The results are out, so the marks are locked. Someone allowed to publish results can reopen them, saying why.');
    const max = new Map(exam.subjects.map((s) => [s.subjectId, s.maxMarks]));
    const students = new Set((await t.pool.query<{ id: string }>('select id from students where class_id = $1', [exam.classId])).rows.map((r) => r.id));
    const byGrade = new Map(exam.subjects.filter((s) => s.grades.length).map((s) => [s.subjectId, s.grades]));
    const rubric = new Map(exam.subjects.filter((s) => s.criteria.length).map((s) => [s.subjectId, s.criteria]));
    for (const m of body.marks) {
      // A rubric subject: a level for every criterion within its top, and the score is their share of the paper's maximum.
      const crit = rubric.get(m.subjectId);
      if (m.criteria && !crit) throw new ApiError('validation', tx('This subject is not marked on criteria.'));
      if (crit && m.criteria && !m.absent) {
        const missing = crit.filter((c) => m.criteria![c.key] === undefined);
        if (missing.length) throw new ApiError('validation', tx('Give a level for every criterion: {names}.', { names: missing.map((c) => c.name).join(', ') }));
        const over = crit.find((c) => m.criteria![c.key]! > c.max);
        if (over) throw new ApiError('validation', tx('{name} goes up to {max}.', { name: over.name, max: over.max }));
        const extra = Object.keys(m.criteria).find((k) => !crit.some((c) => c.key === k));
        if (extra) throw new ApiError('validation', tx('There is no criterion “{key}”.', { key: extra }));
        const sum = crit.reduce((a, c) => a + m.criteria![c.key]!, 0);
        const most = crit.reduce((a, c) => a + c.max, 0);
        m.score = Math.round((sum / most) * max.get(m.subjectId)! * 100) / 100;
      } else if (!crit || m.absent) m.criteria = undefined;
      const cap = max.get(m.subjectId);
      if (cap === undefined) throw new ApiError('validation', 'That subject is not part of this exam.');
      if (!students.has(m.studentId)) throw new ApiError('validation', 'One of those students is not in this class.');
      const grades = byGrade.get(m.subjectId);
      if (grades) {
        // Graded without marks: a grade of the subject's scheme (or absent), never a score.
        if (m.score != null) throw new ApiError('validation', tx('This subject is graded, not marked: choose a grade.'), { fields: { score: tx('Choose a grade.') } });
        if (m.grade && !grades.some((g) => g.toLowerCase() === m.grade!.toLowerCase())) throw new ApiError('validation', tx('Choose one of the grades: {grades}.', { grades: grades.join(', ') }), { fields: { grade: tx('Choose from the list.') } });
        m.grade = m.grade ? grades.find((g) => g.toLowerCase() === m.grade!.toLowerCase()) : undefined;
      } else {
        if (m.grade) throw new ApiError('validation', tx('This subject takes marks, not a grade.'), { fields: { grade: tx('Enter marks.') } });
        if (m.score != null && m.score > cap) throw new ApiError('validation', tx('Marks cannot be more than {cap}.', { cap }), { fields: { score: tx('The most is {cap}.', { cap }) } });
      }
    }
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      for (const m of body.marks) {
        if (m.score == null && !m.grade && !m.absent) await client.query('delete from exam_marks where exam_id = $1 and student_id = $2 and subject_id = $3', [id, m.studentId, m.subjectId]);
        else await client.query(
          `insert into exam_marks (exam_id, student_id, subject_id, score, absent, grade, criteria) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (exam_id, student_id, subject_id) do update set score = excluded.score, absent = excluded.absent, grade = excluded.grade, criteria = excluded.criteria`,
          [id, m.studentId, m.subjectId, m.absent ? null : m.score, m.absent, m.absent ? null : m.grade ?? null, m.criteria ? JSON.stringify(m.criteria) : null]);
      }
      // Marks that change after publishing no longer match what families see, so the exam goes back to marking.
      await client.query("update exams set status = 'marking' where id = $1 and status in ('upcoming','published')", [id]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.marked', entity: 'exam', entityId: id, detail: { entries: body.marks.length } });
    return this.marksView(t, id);
  }

  /** Each student's total, percentage, grade and GPA in one exam; a grade given straight away counts as the bottom of its band. */
  private async scoreExam(t: TenantCtx, id: string) {
    const { exam, students } = await this.marksView(t, id);
    const year = (await t.pool.query<{ grade: number }>('select grade from classes where id = $1', [exam.classId])).rows[0]?.grade ?? null;
    const grading = await this.settings.grading(t, { grade: year });
    const mode = await this.settings.value<'nearest' | 'up' | 'down'>(t, 'results.rounding', 'nearest');
    const max = new Map(exam.subjects.map((s) => [s.subjectId, s.maxMarks]));
    const rows = students.filter((s) => Object.keys(s.marks).length).map((s) => {
      let total = 0;
      let outOf = 0;
      const points: (number | null)[] = [];
      for (const sub of exam.subjects) {
        const m = s.marks[sub.subjectId];
        if (!m) continue;
        const cap = max.get(sub.subjectId)!;
        const scheme = grading.schemeOf(sub.subjectId);
        const asPct = m.grade ? pctOfGrade(scheme, m.grade) ?? 0 : null;
        outOf += cap;
        total += asPct !== null ? (asPct / 100) * cap : m.score ?? 0;
        if (!m.absent) points.push(gradeIn(scheme, asPct ?? Math.round(((m.score ?? 0) / cap) * 100)).points);
      }
      const pct = outOf ? roundPct((total / outOf) * 100, mode) : 0;
      return { studentId: s.studentId, name: s.name, rollNo: s.rollNo, total: Math.round(total * 100) / 100, max: outOf, pct, grade: grading.grade(pct), rank: 0, gpa: gpaOf(points) };
    });
    return { exam, grading, rows };
  }

  async results(t: TenantCtx, id: string): Promise<ExamResults> {
    const { exam, grading, rows } = await this.scoreExam(t, id);
    const scored = rows.sort((a, b) => b.total / Math.max(b.max, 1) - a.total / Math.max(a.max, 1) || a.name.localeCompare(b.name));
    // Ranked within the class, or among every class of the year group sitting an exam of the same name (results.rankWithin).
    const within = await this.settings.value<string>(t, 'results.rankWithin', 'class');
    const pool = within === 'year' ? await this.yearRows(t, exam, scored) : scored;
    const order = [...new Set(pool.map((r) => r.pct))].sort((a, b) => b - a);
    const ranks = new Map<number, number>();
    let seen = 0;
    for (const pct of order) { ranks.set(pct, seen + 1); seen += pool.filter((r) => r.pct === pct).length; }
    scored.forEach((r) => { r.rank = ranks.get(r.pct) ?? 0; });
    return {
      exam,
      average: scored.length ? Math.round(scored.reduce((a, r) => a + r.pct, 0) / scored.length) : 0,
      passPct: scored.length ? Math.round((scored.filter((r) => r.pct >= grading.pass).length / scored.length) * 100) : 0,
      rows: scored,
    };
  }

  /** Every student's result in the exams of the same name for the same year group (for a rank across the year). */
  private async yearRows(t: TenantCtx, exam: ExamRow, own: { pct: number }[]): Promise<{ pct: number }[]> {
    const others = (await t.pool.query<{ id: string }>(
      'select e.id from exams e join classes c on c.id = e.class_id where e.name = $1 and e.id <> $2 and c.grade = (select grade from classes where id = $3)', [exam.name, exam.id, exam.classId])).rows;
    const out = [...own];
    for (const o of others) out.push(...(await this.scoreExam(t, o.id)).rows);
    return out;
  }

  /** Remarks on students' reports for this exam, written or picked from the school's (exams.remarks); empty removes one. */
  async putRemarks(t: TenantCtx, user: User, id: string, body: ExamRemarksPut): Promise<ExamMarksView> {
    const exam = await this.exam(t, id);
    await mayTeach(t, user, exam.classId);
    if (exam.status === 'published') throw new ApiError('locked', tx('The results are out, so the remarks are locked. Reopen the results to change them.'));
    const students = new Set((await t.pool.query<{ id: string }>('select id from students where class_id = $1', [exam.classId])).rows.map((r) => r.id));
    if (body.remarks.some((r) => !students.has(r.studentId))) throw new ApiError('validation', 'One of those students is not in this class.');
    for (const r of body.remarks) {
      if (!r.remark) await t.pool.query('delete from exam_remarks where exam_id = $1 and student_id = $2', [id, r.studentId]);
      else await t.pool.query(`insert into exam_remarks (exam_id, student_id, remark, by_id) values ($1,$2,$3,$4)
        on conflict (exam_id, student_id) do update set remark = excluded.remark, by_id = excluded.by_id, updated_at = now()`, [id, r.studentId, r.remark, user.id]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.remarks', entity: 'exam', entityId: id, detail: { remarks: body.remarks.length } });
    return this.marksView(t, id);
  }

  async publishExam(t: TenantCtx, user: User, id: string): Promise<{ families: number; exam: ExamRow }> {
    const res = await this.results(t, id);
    const missing = res.exam.expected - res.exam.entered;
    if (missing > 0) throw new ApiError('conflict', tx('{missing, plural, one {# mark is} other {# marks are}} still missing. Enter every mark, or mark the student absent, before publishing.', { missing }));
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query("update exams set status = 'published', published_at = now() where id = $1", [id]);
      for (const r of res.rows) {
        await client.query('insert into exam_results (student_id, exam, grade, pct) values ($1,$2,$3,$4) on conflict (student_id, exam) do update set grade = excluded.grade, pct = excluded.pct', [r.studentId, res.exam.name, r.grade, r.pct]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const g = await t.pool.query<{ phone: string | null; name: string }>(
      `select g.phone, s.name from students s join student_guardians sg on sg.student_id = s.id and sg.gets_messages join guardians g on g.id = sg.guardian_id where s.class_id = $1 and s.status = 'active'`, [res.exam.classId]);
    // Results going out again after a correction say what changed.
    const again = !!res.exam.reopenedNote;
    const families = await this.messenger.notify(t, again ? 'exam.reopened' : 'exam.results', g.rows.filter((r) => r.phone).map((r) => ({ to: r.phone!, vars: { student: r.name, exam: res.exam.name, note: res.exam.reopenedNote } })));
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.published', entity: 'exam', entityId: id, detail: { name: res.exam.name, class: res.exam.className } });
    return { families, exam: await this.exam(t, id) };
  }

  async deleteExam(t: TenantCtx, user: User, id: string): Promise<void> {
    const e = await this.exam(t, id);
    if (e.status === 'published') throw new ApiError('conflict', 'Published results cannot be deleted. Ask Tangent if this exam was created by mistake.');
    await t.pool.query('delete from exams where id = $1', [id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'exam.removed', entity: 'exam', entityId: id, detail: { name: e.name } });
  }
}
