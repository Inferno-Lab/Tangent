import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@tangent/db';
import { tx, schoolNow, hasReachedAge, customText, listKey, listLabel, listOptions, SchoolSettingsSchema, DEFAULT_LEAVE_REASONS, type ListItem, type CustomFieldsSetting, type CustomValues, type FieldDef, type AttendanceMarkDef, MESSAGE_EVENTS, addDays, schoolToday, type AttendanceStatus, type NoticeCreate, type PeriodMarksPut } from '@tangent/contracts';
import { ApiError, forbidden, notFound } from '@tangent/nest-kit';
import { schoolContext, type Registry } from '@tangent/tenancy';
import { REGISTRY, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { AttendanceService } from './attendance.service.js';
import { ApprovalsService } from './approvals.service.js';
import { FilesService } from './files.service.js';
import { GalleryService } from './gallery.service.js';
import { LearningService } from './learning.service.js';
import { LibraryService } from './library.service.js';
import { ChatService, type ChatSender } from './chat.service.js';
import { NoticesService } from './notices.service.js';
import { AuditService, Messenger, SettingsService, checkLeaveClash } from './support.js';
import { TransportService } from './transport.service.js';

const DAYS = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const key = (subjectId: string) => subjectId.replace(/^sub_/, '');

/** What a teacher sends to set or change homework from the app. */
export interface HomeworkInput { classId: string; subject?: string; title: string; description?: string; dueOn: string; maxMarks?: number; graded?: boolean; draft?: boolean; fileIds?: string[] }

/** What a parent sends to ask for leave. */
export interface LeaveInput { studentId: string; from: string; to: string; reason: string; halfDay?: 'am' | 'pm' | null; note?: string; fileIds?: string[] }

interface Who {
  id: string;
  name: string;
  kind: 'staff' | 'guardian' | 'student';
  /** The app role: guardians are parents, students students, staff who drive a route drivers, other staff teachers. */
  role: 'parent' | 'student' | 'teacher' | 'driver';
  phone: string | null;
  email: string | null;
  /** The students this person looks after. */
  children: string[];
  guardianIds: string[];
  perms: string[];
}

/** The family API: what the mobile app reads and writes, in the shapes the app already parses. Scoped by who is signed in. */
@Injectable()
export class FamilyService {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    private readonly attendance: AttendanceService,
    private readonly approvals: ApprovalsService,
    private readonly learning: LearningService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly library: LibraryService,
    private readonly transportService: TransportService,
    private readonly gallerySvc: GalleryService,
    private readonly files: FilesService,
    private readonly chat: ChatService,
    private readonly noticesSvc: NoticesService,
    private readonly messenger: Messenger,
  ) {}

  async who(t: TenantCtx, user: AuthedUser): Promise<Who> {
    const u = (await t.pool.query<{ id: string; kind: Who['kind']; name: string; phone: string | null; email: string | null }>('select id, kind, name, phone, email from users where id = $1', [user.id])).rows[0];
    if (!u) throw new ApiError('unauthenticated', 'Your session has ended. Sign in again.');
    // A student looks after only themselves.
    if (u.kind === 'student') {
      const own = (await t.pool.query<{ id: string }>("select id from students where user_id = $1 and status = 'active'", [u.id])).rows.map((r) => r.id);
      return { id: u.id, kind: 'student', role: 'student', name: u.name, phone: u.phone, email: u.email, children: own, guardianIds: [], perms: user.permissions };
    }
    let children: string[] = [];
    let guardianIds: string[] = [];
    // A teacher can be a parent at the same school: their children come with their account either way.
    guardianIds = (await t.pool.query<{ id: string }>('select id from guardians where user_id = $1', [u.id])).rows.map((g) => g.id);
    if (guardianIds.length) {
      children = (await t.pool.query<{ student_id: string }>('select distinct student_id from student_guardians where guardian_id = any($1)', [guardianIds])).rows.map((r) => r.student_id);
    }
    const drives = u.kind === 'staff' && !!(await t.pool.query('select 1 from transport_routes where driver_user_id = $1 limit 1', [u.id])).rowCount;
    return { id: u.id, kind: u.kind, role: u.kind === 'guardian' ? 'parent' : drives ? 'driver' : 'teacher', name: u.name, phone: u.phone, email: u.email, children, guardianIds, perms: user.permissions };
  }

  /** Things only a parent does for a child: pay, ask for leave, consent for them. */
  private parentOnly(w: Who): void {
    if (w.kind !== 'guardian') throw forbidden('A parent does this from their own account.');
  }

  /** Staff see a student when their role reads students, or when they teach the student's class or drive their bus. */
  private async mayStudent(w: Who, studentId: string, t: TenantCtx): Promise<void> {
    if (w.children.includes(studentId)) return;
    if (w.kind === 'staff' && w.perms.includes('students.read')) return;
    if (w.kind === 'staff' && (await t.pool.query(
      `select 1 from students s where s.id = $1 and (s.class_id in (select id from classes where class_teacher_id = $2 union select class_id from timetable_slots where teacher_id = $2)
         or s.id in (select a.student_id from transport_assignments a join transport_routes r on r.id = a.route_id where r.driver_user_id = $2))`, [studentId, w.id])).rowCount) return;
    throw forbidden('That student is not yours to look at.');
  }

  private async mayClass(t: TenantCtx, w: Who, classId: string): Promise<void> {
    if (w.kind === 'staff') return;
    const r = await t.pool.query('select 1 from students where class_id = $1 and id = any($2) limit 1', [classId, w.children]);
    if (!r.rowCount) throw forbidden('That class is not yours to look at.');
  }

  // Identity and directory

  async me(t: TenantCtx, user: AuthedUser): Promise<Record<string, unknown>> {
    const w = await this.who(t, user);
    const c = (await t.pool.query<{ consented_at: Date | null; photo_consent: boolean | null }>('select consented_at, photo_consent from users where id = $1', [user.id])).rows[0];
    // A student agrees for themself from the country's age of consent; a younger one is covered by their family (§3.7).
    const consentFor = w.kind === 'student' ? ((await this.ofConsentAge(t, w.children[0])) ? 'self' : 'guardian') : 'self';
    return {
      consentFor,
      id: w.id, role: w.role, name: w.name, email: w.email ?? '', phone: w.phone ?? '', avatarUrl: '', password: '',
      childIds: w.kind === 'guardian' ? w.children : [], ...(w.kind === 'student' ? { studentId: w.children[0] ?? null } : {}), ...(w.kind === 'staff' ? { teacherId: w.id } : {}),
      consentedAt: c?.consented_at?.toISOString() ?? null, photoConsent: c?.photo_consent ?? null,
    };
  }

  /** A family agrees to the school's privacy notice (once), and says whether the school may share photos of the child. */
  /** Whether a student is old enough to agree to the privacy notice for themself (privacy.consentAge, from their birth date). */
  private async ofConsentAge(t: TenantCtx, studentId: string | undefined): Promise<boolean> {
    if (!studentId) return false;
    const age = await this.settings.value<number>(t, 'privacy.consentAge', 16);
    const dob = (await t.pool.query<{ dob: string | null }>('select dob::text from students where id = $1', [studentId])).rows[0]?.dob;
    return !!dob && hasReachedAge(dob, schoolToday(), age);
  }

  async consent(t: TenantCtx, user: AuthedUser, photos: boolean | undefined): Promise<{ consentedAt: string; photoConsent: boolean | null }> {
    const w = await this.who(t, user);
    if (w.kind === 'student' && !(await this.ofConsentAge(t, w.children[0]))) throw forbidden('Your parent or guardian agrees to this for you.');
    // The photo answer can be changed at any time (Settings → Privacy); the consent itself is given once.
    const { rows } = await t.pool.query<{ consented_at: Date; photo_consent: boolean | null }>(
      'update users set consented_at = coalesce(consented_at, now()), photo_consent = case when $2::boolean is null then photo_consent else $2 end where id = $1 returning consented_at, photo_consent', [user.id, photos ?? null]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'privacy.consented', entity: 'user', entityId: user.id, detail: { photos: photos ?? null } });
    return { consentedAt: rows[0]!.consented_at.toISOString(), photoConsent: rows[0]!.photo_consent };
  }

  /**
   * Withdraws consent: the person's photos are no longer shared, the school is told through a data request it must act on, and
   * the app asks for consent again before it can be used.
   */
  async withdrawConsent(t: TenantCtx, user: AuthedUser) {
    await t.pool.query('update users set consented_at = null, photo_consent = false where id = $1', [user.id]);
    await this.dataRequest(t, user, 'erasure', 'Withdrew consent in the app. Stop processing what is not required by law, and say what is kept.');
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'privacy.consent.withdrawn', entity: 'user', entityId: user.id });
    return { ok: true };
  }

  /** Asks the school for a copy of the family's data, a correction, or its deletion; the office answers in Privacy requests. */
  async dataRequest(t: TenantCtx, user: AuthedUser, kind: 'access' | 'correction' | 'erasure', note: string) {
    const w = await this.who(t, user);
    const names = w.children.length ? (await t.pool.query<{ name: string }>('select name from students where id = any($1)', [w.children])).rows.map((r) => r.name) : [];
    const id = newId('dr');
    await t.pool.query('insert into data_requests (id, kind, subject_name, requested_by, note, user_id) values ($1,$2,$3,$4,$5,$6)',
      [id, kind, [w.name, ...names].join(', ').slice(0, 80), w.name, note, w.id]);
    return { id };
  }

  async dataRequests(t: TenantCtx, user: AuthedUser) {
    const { rows } = await t.pool.query<{ id: string; kind: string; status: string; note: string; answer: string; created_at: Date; resolved_at: Date | null }>(
      'select id, kind, status, note, answer, created_at, resolved_at from data_requests where user_id = $1 order by created_at desc', [user.id]);
    return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, note: r.note, answer: r.answer, createdAt: r.created_at.toISOString(), answeredAt: r.resolved_at?.toISOString() ?? null }));
  }

  /** A parent sends a new photo of their child (already uploaded as "pending:<student>"); the office approves it first. */
  async proposePhoto(t: TenantCtx, user: AuthedUser, studentId: string, fileId: string) {
    const w = await this.who(t, user);
    this.parentOnly(w);
    await this.mayStudent(w, studentId, t);
    await this.files.done(t, user.id, fileId);
    const s = (await t.pool.query<{ name: string }>('select name from students where id = $1', [studentId])).rows[0];
    if (!s) throw notFound('That student');
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now() where kind = 'photo' and subject_ref = $1 and status = 'pending'", [studentId]);
    await t.pool.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'photo',$2,$3,$4,$5,$6,$7)",
      [newId('apr'), `New photo of ${s.name}`, `Sent by ${w.name}`, w.name, w.id, studentId, JSON.stringify({ fileId, studentId })]);
    return { ok: true, status: 'pending' };
  }

  async school(t: TenantCtx): Promise<Record<string, unknown>> {
    const v = (await this.settings.doc(t)).values;
    const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
    const principal = (await t.pool.query<{ name: string }>("select u.name from staff st join users u on u.id = st.user_id where st.designation = 'Principal' limit 1")).rows[0]?.name ?? '';
    // The term the school is in, as its calendar says (terms start any month; none: empty).
    const term = (await t.pool.query<{ s: string }>('select starts_on::text s from terms where starts_on <= $1 and ends_on >= $1 order by starts_on desc limit 1', [schoolToday()])).rows[0]?.s ?? '';
    return {
      termStart: term,
      // The school's own facts only: the year it was founded and its office hours are not recorded, so they are left empty.
      name: s('school.name') || t.info.name, tagline: s('school.tagline'), address: s('school.address'), phone: s('school.phone'), email: s('school.email'), website: '', principal, founded: 0,
      officeHours: '', about: s('school.tagline'),
    };
  }

  /**
   * Whose week of lessons a calendar link gives (§5.1.2): a class this person may see (a family's child's, a teacher's), or the
   * teacher's own when no class is named. The lessons repeat weekly until the term (else the year) ends.
   */
  async lessonsOf(t: TenantCtx, user: AuthedUser, classId?: string): Promise<{ classId?: string; teacherId?: string }> {
    const w = await this.who(t, user);
    if (classId) { await this.mayClass(t, w, classId); return { classId }; }
    if (w.kind !== 'staff') throw new ApiError('validation', 'Say which class.');
    return { teacherId: w.id };
  }

  /** The lessons of `lessonsOf`, built when the calendar link is opened. */
  async lessonEvents(t: TenantCtx, by: { classId?: string; teacherId?: string }): Promise<{ title: string; start: string; end: string; place?: string; weeklyUntil: string }[]> {
    const classId = by.classId;
    const today = schoolToday();
    const until = (await t.pool.query<{ e: string }>(
      "select ends_on::text e from terms where starts_on <= $1 and ends_on >= $1 union all select ends_on::text from academic_years where current limit 1", [today])).rows[0]?.e ?? addDays(today, 120);
    const { rows } = await t.pool.query<{ day: number; subject: string; room: string | null; starts_at: string; ends_at: string; class_name: string }>(
      `select ts.day, coalesce(sub.name, ts.subject_id) subject, ts.room, p.starts_at, p.ends_at, c.name class_name from timetable_slots ts join periods p on p.idx = ts.period
         join classes c on c.id = ts.class_id left join subjects sub on sub.id = ts.subject_id
       where ${classId ? 'ts.class_id = $1' : 'coalesce(ts.cover_teacher_id, ts.teacher_id) = $1'} order by ts.day, p.starts_at`, [classId ?? by.teacherId]);
    // Each lesson starts on its weekday's next date from today (ISO weekday 1 is Monday, as timetable_slots counts).
    const iso = (d: string) => { const n = new Date(`${d}T00:00:00Z`).getUTCDay(); return n === 0 ? 7 : n; };
    const first = (dayNo: number) => addDays(today, (dayNo - iso(today) + 7) % 7);
    return rows.map((r) => ({
      title: classId ? r.subject : `${r.subject} · ${r.class_name}`, start: `${first(r.day)}T${r.starts_at}`, end: `${first(r.day)}T${r.ends_at}`,
      ...(r.room ? { place: r.room } : {}), weeklyUntil: until,
    }));
  }

  async userName(t: TenantCtx, id: string): Promise<{ id: string; name: string }> {
    const r = (await t.pool.query<{ id: string; name: string }>('select id, name from users where id = $1', [id])).rows[0];
    if (!r) throw notFound('That person');
    return r;
  }

  /** Guardian contact, birth date and address go to the family and to staff whose role reads students; never to the rest. */
  private studentJson(w: Who, r: { id: string; user_id: string | null; name: string; name_local?: string | null; class_id: string; roll_no: string; admission_no: string | null; dob: string; blood_group: string | null; house: string | null; address: string | null; g_name: string | null; g_phone: string | null; photo: string | null; custom: CustomValues | null }, own: FieldDef[]) {
    const full = w.children.includes(r.id) || (w.kind === 'staff' && w.perms.includes('students.read'));
    // The school's own fields it shows in the app (§3.6.3), named and written in the reader's language; only to those who see the full record.
    const lang = schoolContext.getStore()?.lang ?? 'en';
    const fields = full ? Object.fromEntries(own.map((f) => [f.names?.[lang] || f.label, customText(f, r.custom?.[f.key], lang)]).filter(([, v]) => v)) : {};
    return {
      fields, admissionNo: r.admission_no ?? '', nameLocal: r.name_local ?? '',
      id: r.id, userId: r.user_id, name: r.name, classId: r.class_id, rollNo: r.roll_no, dob: full ? r.dob : '', bloodGroup: r.blood_group ?? '', house: r.house ?? '', avatarUrl: '',
      photoFileId: r.photo, guardianName: full ? r.g_name ?? '' : '', guardianPhone: full ? r.g_phone ?? '' : '', address: full ? r.address ?? '' : '',
    };
  }

  private async appFields(t: TenantCtx): Promise<FieldDef[]> {
    return ((await this.settings.value<CustomFieldsSetting>(t, 'fields.custom', {})).student ?? []).filter((f) => f.app);
  }

  private readonly studentSql = `select s.id, s.user_id, s.name, s.name_local, s.class_id, s.roll_no, s.admission_no, s.dob::text, s.blood_group, s.house, s.address, s.custom, g.name g_name, g.phone g_phone,
      (select f.id from files f where f.kind = 'student_photo' and f.owner_id = s.id and f.status = 'clean' and f.deleted_at is null order by f.created_at desc limit 1) photo
    from students s left join student_guardians sg on sg.student_id = s.id and sg.is_primary left join guardians g on g.id = sg.guardian_id`;

  async student(t: TenantCtx, user: AuthedUser, id: string) {
    const w = await this.who(t, user);
    await this.mayStudent(w, id, t);
    const r = (await t.pool.query(`${this.studentSql} where s.id = $1`, [id])).rows[0];
    if (!r) throw notFound('That student');
    return this.studentJson(w, r, await this.appFields(t));
  }

  /**
   * A class list. For staff it is the roster: each student with this term's attendance (share of marked days present) and the
   * average of their published results, so a teacher sees who needs a word without opening every record.
   */
  async studentsIn(t: TenantCtx, user: AuthedUser, classId: string) {
    const w = await this.who(t, user);
    await this.mayClass(t, w, classId);
    if (w.kind === 'staff' && !w.perms.includes('students.read') && !(await t.pool.query(
      'select 1 from classes where id = $1 and class_teacher_id = $2 union select 1 from timetable_slots where class_id = $1 and teacher_id = $2', [classId, w.id])).rowCount) {
      throw forbidden('That class is not yours to look at.');
    }
    const { rows } = await t.pool.query(`${this.studentSql} where s.class_id = $1 and s.status = 'active' order by s.roll_no, s.name`, [classId]);
    const own = await this.appFields(t);
    const list = rows.map((r) => this.studentJson(w, r, own));
    if (w.kind !== 'staff') return list;
    const today = schoolToday();
    const from = (await t.pool.query<{ d: string }>('select starts_on::text d from terms where starts_on <= $1 order by starts_on desc limit 1', [today])).rows[0]?.d ?? addDays(today, -120);
    const [att, res] = await Promise.all([
      t.pool.query<{ student_id: string; days: string; present: string; absent_today: boolean }>(
        `select m.student_id, count(*) days, count(*) filter (where m.status in ('present','late','half_day')) present, coalesce(bool_or(x.date = $3 and m.status in ('absent','leave')), false) absent_today
         from attendance_marks m join attendance_sessions x on x.id = m.session_id where x.class_id = $1 and x.date >= $2 group by m.student_id`, [classId, from, today]),
      t.pool.query<{ student_id: string; pct: string | null }>(
        `select m.student_id, avg(m.score * 100.0 / nullif(x.max_marks, 0)) pct from exam_marks m join exams e on e.id = m.exam_id
           join exam_subjects x on x.exam_id = m.exam_id and x.subject_id = m.subject_id
         where e.class_id = $1 and e.status = 'published' and m.score is not null group by m.student_id`, [classId]),
    ]);
    return list.map((s) => {
      const a = att.rows.find((x) => x.student_id === s.id);
      const p = res.rows.find((x) => x.student_id === s.id)?.pct;
      return { ...s, attendancePct: a && Number(a.days) ? Math.round((Number(a.present) / Number(a.days)) * 100) : null, absentToday: a?.absent_today ?? false, resultsPct: p == null ? null : Math.round(Number(p)) };
    });
  }

  private async classJson(t: TenantCtx, id: string) {
    const c = (await t.pool.query<{ id: string; name: string; grade: number; section: string; class_teacher_id: string | null; room: string | null }>(
      `select c.id, c.name, c.grade, c.section, c.class_teacher_id, (select room from timetable_slots ts where ts.class_id = c.id and room is not null limit 1) room from classes c where c.id = $1`, [id])).rows[0];
    if (!c) throw notFound('That class');
    const ids = (await t.pool.query<{ id: string }>("select id from students where class_id = $1 and status = 'active' order by roll_no", [id])).rows.map((r) => r.id);
    // The school's own name for the class ("8 A", "Year 7 Blue"); the app adds the section only when the name lacks it.
    return { id: c.id, name: c.name, section: c.section, classTeacherId: c.class_teacher_id ?? '', room: c.room ?? '', studentIds: ids };
  }

  async schoolClass(t: TenantCtx, user: AuthedUser, id: string) {
    await this.mayClass(t, await this.who(t, user), id);
    return this.classJson(t, id);
  }

  private async teacherJson(t: TenantCtx, rows: { id: string; name: string; email: string | null; phone: string | null; subject: string | null }[]) {
    const ids = rows.map((r) => r.id);
    const cls = await t.pool.query<{ t: string; c: string }>(
      `select class_teacher_id t, id c from classes where class_teacher_id = any($1) union select distinct teacher_id, class_id from timetable_slots where teacher_id = any($1)`, [ids]);
    return rows.map((r) => ({ id: r.id, userId: r.id, name: r.name, subject: r.subject ?? '', email: r.email ?? '', phone: r.phone ?? '', avatarUrl: '', classIds: cls.rows.filter((c) => c.t === r.id).map((c) => c.c) }));
  }

  private readonly teacherSql = `select u.id, u.name, u.email, u.phone, (select min(ss.subject_id) from staff_subjects ss where ss.user_id = u.id) subject from users u join staff s on s.user_id = u.id where u.status = 'active'`;

  async teachers(t: TenantCtx) {
    const { rows } = await t.pool.query<{ id: string; name: string; email: string | null; phone: string | null; subject: string | null }>(`${this.teacherSql} order by u.name limit 300`);
    return this.teacherJson(t, rows.map((r) => ({ ...r, subject: r.subject ? key(r.subject) : null })));
  }

  async teacher(t: TenantCtx, id: string) {
    const { rows } = await t.pool.query<{ id: string; name: string; email: string | null; phone: string | null; subject: string | null }>(`${this.teacherSql} and u.id = $1`, [id]);
    if (!rows[0]) throw notFound('That teacher');
    return (await this.teacherJson(t, rows.map((r) => ({ ...r, subject: r.subject ? key(r.subject) : null }))))[0]!;
  }

  async classesForTeacher(t: TenantCtx, id: string) {
    const ids = (await t.pool.query<{ c: string }>('select id c from classes where class_teacher_id = $1 union select distinct class_id from timetable_slots where teacher_id = $1', [id])).rows.map((r) => r.c);
    return Promise.all(ids.map((c) => this.classJson(t, c)));
  }

  // Attendance

  async attendanceOf(t: TenantCtx, user: AuthedUser, studentId: string) {
    await this.mayStudent(await this.who(t, user), studentId, t);
    const { rows } = await t.pool.query<{ date: string; status: AttendanceStatus; code: string | null }>(
      `select d.date::text date, d.status, d.code from attendance_days d where d.student_id = $1 and d.date >= $2 order by d.date`, [studentId, addDays(schoolToday(), -120)]);
    // The app draws each day by what the mark means and names it the school's way.
    const used = await this.settings.value<AttendanceMarkDef[]>(t, 'attendance.statuses', []);
    const name = (r: { status: string; code: string | null }) => used.find((m) => m.key === (r.code ?? r.status))?.name ?? used.find((m) => m.meaning === r.status)?.name ?? '';
    return rows.map((r) => ({ studentId, date: r.date, status: r.status, label: name(r) }));
  }

  async today(t: TenantCtx, user: AuthedUser, students: string[]) {
    const w = await this.who(t, user);
    if (w.kind !== 'staff') students = students.filter((s) => w.children.includes(s));
    const { rows } = await t.pool.query<{ student_id: string; status: string }>(
      `select d.student_id, d.status from attendance_days d where d.date = $1 and d.student_id = any($2)`, [schoolToday(), students]);
    return Object.fromEntries(rows.map((r) => [r.student_id, r.status === 'leave' ? 'absent' : r.status]));
  }

  /** A class's roll call for one day, as the teacher marks it in the app (approved leave already filled in). */
  async rollCall(t: TenantCtx, user: AuthedUser, classId: string, date: string) {
    if (!user.permissions.includes('attendance.mark')) throw forbidden('You are not allowed to mark attendance.');
    return this.attendance.day(t, classId, date);
  }

  /** A class's periods on a day, for the teacher marking the one they teach. */
  async periods(t: TenantCtx, user: AuthedUser, classId: string, date: string) {
    if (!user.permissions.includes('attendance.mark')) throw forbidden('You are not allowed to mark attendance.');
    return this.attendance.periods(t, user, classId, date);
  }

  async putPeriod(t: TenantCtx, user: AuthedUser, b: PeriodMarksPut) {
    if (!user.permissions.includes('attendance.mark')) throw forbidden('You are not allowed to mark attendance.');
    return this.attendance.putPeriod(t, user, b);
  }

  /** Marks a day (today unless said): any mark the school uses; a day past the correction window is refused by AttendanceService. */
  async markToday(t: TenantCtx, user: AuthedUser, byStudent: Record<string, string>, date = schoolToday()) {
    if (!user.permissions.includes('attendance.mark')) throw forbidden('You are not allowed to mark attendance.');
    const ids = Object.keys(byStudent);
    const { rows } = await t.pool.query<{ id: string; class_id: string }>('select id, class_id from students where id = any($1)', [ids]);
    const { part } = await this.attendance.partOf(t, undefined, date);
    for (const cls of new Set(rows.map((r) => r.class_id))) {
      const existing = await t.pool.query<{ student_id: string; status: string }>(
        'select m.student_id, coalesce(m.code, m.status) status from attendance_marks m join attendance_sessions x on x.id = m.session_id where x.class_id = $1 and x.date = $2 and x.part = $3', [cls, date, part]);
      const merged = new Map(existing.rows.map((e) => [e.student_id, e.status]));
      for (const r of rows.filter((x) => x.class_id === cls)) {
        // Any mark the school uses, by its key or by its meaning (the app sends present, late or absent).
        if (byStudent[r.id]) merged.set(r.id, byStudent[r.id]!);
      }
      await this.attendance.put(t, user, { classId: cls, date, part, marks: [...merged].map(([studentId, status]) => ({ studentId, status })) });
    }
    return { ok: true };
  }

  // Timetable

  async timetable(t: TenantCtx, user: AuthedUser, classId: string) {
    await this.mayClass(t, await this.who(t, user), classId);
    const [slots, periods] = await Promise.all([
      t.pool.query<{ day: number; period: number; subject_id: string; teacher_id: string; room: string | null; starts_at: string; ends_at: string }>(
        `select ts.day, ts.period, ts.subject_id, coalesce(ts.cover_teacher_id, ts.teacher_id) teacher_id, ts.room, p.starts_at, p.ends_at from timetable_slots ts join periods p on p.idx = ts.period where ts.class_id = $1`, [classId]),
      t.pool.query<{ idx: number; kind: string; starts_at: string; ends_at: string }>("select idx, kind, starts_at, ends_at from periods where kind <> 'period'"),
    ]);
    const days = [...new Set(slots.rows.map((s) => s.day))].sort();
    return days.map((d) => ({
      classId, day: DAYS[d],
      periods: [
        ...slots.rows.filter((s) => s.day === d).map((s) => ({ id: `${classId}-${DAYS[d]}-${s.period}`, subject: key(s.subject_id), teacherId: s.teacher_id, start: s.starts_at, end: s.ends_at, room: s.room ?? '', kind: 'class' })),
        ...periods.rows.map((p) => ({ id: `${classId}-${DAYS[d]}-b${p.idx}`, subject: 'break', start: p.starts_at, end: p.ends_at, room: '', kind: p.kind === 'lunch' ? 'recess' : 'break' })),
      ].sort((a, b) => a.start.localeCompare(b.start)),
    }));
  }

  // Homework

  /**
   * Homework as the app shows it. A family sees only its own children's hand-ins (never a classmate's marks or feedback), and how
   * many in the class have handed in only when the school allows it; staff see every student's; drafts only their author.
   */
  private async homeworkRows(t: TenantCtx, w: Who, where: string, params: unknown[]) {
    const hw = await t.pool.query<{ id: string; class_id: string; subject_id: string; title: string; description: string; assigned_on: string; due_on: string; max_marks: number; graded: boolean; status: string; created_by: string | null }>(
      `select id, class_id, subject_id, title, description, assigned_on::text, due_on::text, max_marks, graded, status, created_by from homework ${where}
       and (status = 'set' or created_by = $${params.length + 1}) order by assigned_on desc, id limit 80`, [...params, w.id]);
    if (!hw.rowCount) return [];
    const ids = hw.rows.map((h) => h.id);
    const subs = await t.pool.query<{ homework_id: string; student_id: string; handed_at: Date | null; score: number | null; feedback: string; returned_at: Date | null; return_note: string }>(
      'select homework_id, student_id, handed_at, score, feedback, returned_at, return_note from homework_submissions where homework_id = any($1)', [ids]);
    const mine = (studentId: string) => w.kind === 'staff' || w.children.includes(studentId);
    const visible = subs.rows.filter((x) => mine(x.student_id));
    const attached = await this.files.list(t, 'homework_attachment', ids);
    const handed = await this.files.list(t, 'homework_submission', visible.map((x) => `${x.homework_id}:${x.student_id}`));
    const files = (list: typeof attached, owner: string) => list.filter((f) => f.ownerId === owner && f.status === 'clean').map((f) => ({ id: f.id, name: f.name, mime: f.mime }));
    const grading = await this.settings.grading(t);
    const progress = w.kind === 'staff' || (await this.settings.value<boolean>(t, 'homework.showClassProgress', false));
    return hw.rows.map((h) => {
      const all = subs.rows.filter((x) => x.homework_id === h.id);
      return {
        id: h.id, classId: h.class_id, subject: key(h.subject_id), title: h.title, description: h.description, assignedOn: h.assigned_on, dueOn: h.due_on, teacherId: h.created_by ?? '',
        maxMarks: h.max_marks, graded: h.graded, draft: h.status === 'draft',
        attachments: files(attached, h.id).map((f) => f.name), files: files(attached, h.id),
        classProgress: progress ? { handedIn: all.filter((x) => x.handed_at).length, total: all.length } : null,
        submissions: visible.filter((x) => x.homework_id === h.id).map((x) => ({
          studentId: x.student_id, status: x.score != null ? 'graded' : x.returned_at && (!x.handed_at || x.handed_at <= x.returned_at) ? 'returned' : x.handed_at ? 'submitted' : 'pending',
          ...(x.handed_at ? { submittedAt: x.handed_at.toISOString() } : {}), ...(x.returned_at ? { returnedAt: x.returned_at.toISOString(), returnNote: x.return_note } : {}),
          files: files(handed, `${h.id}:${x.student_id}`),
          ...(x.score != null ? { marks: x.score, grade: grading.grade(Math.round((x.score / h.max_marks) * 100)), feedback: x.feedback } : !h.graded && x.feedback ? { feedback: x.feedback } : {}),
        })),
      };
    });
  }

  async homework(t: TenantCtx, user: AuthedUser, classId: string) {
    const w = await this.who(t, user);
    await this.mayClass(t, w, classId);
    return this.homeworkRows(t, w, 'where class_id = $1', [classId]);
  }

  async homeworkOne(t: TenantCtx, user: AuthedUser, id: string) {
    const w = await this.who(t, user);
    const [h] = await this.homeworkRows(t, w, 'where id = $1', [id]);
    if (!h) throw notFound('That homework');
    await this.mayClass(t, w, h.classId);
    return h;
  }

  /** Who hands in from the app: the school chooses the student, a parent, or either (homework.handedInBy). */
  private async mayHandIn(t: TenantCtx, w: Who): Promise<void> {
    const by = await this.settings.value<string>(t, 'homework.handedInBy', 'either');
    if (by === 'student' && w.kind === 'guardian') throw forbidden('At your school students hand in homework themselves.');
    if (by === 'parent' && w.kind === 'student') throw forbidden('At your school a parent hands in homework.');
  }

  /** Hands in work (or hands it in again after a redo, or before it is graded). */
  async submitHomework(t: TenantCtx, user: AuthedUser, id: string, studentId: string, fileIds: string[] = []) {
    const w = await this.who(t, user);
    await this.mayStudent(w, studentId, t);
    await this.mayHandIn(t, w);
    const h = (await t.pool.query<{ due_on: string; status: string }>('select due_on::text, status from homework where id = $1', [id])).rows[0];
    if (!h || h.status !== 'set') throw notFound('That homework');
    const sub = (await t.pool.query<{ score: number | null }>('select score from homework_submissions where homework_id = $1 and student_id = $2', [id, studentId])).rows[0];
    if (sub?.score != null) throw new ApiError('conflict', 'This homework has been graded, so it cannot be handed in again.');
    // The handed-in work, uploaded first through /v1/files (kind homework_submission, owner "<homework>:<student>").
    for (const f of fileIds) await this.files.done(t, user.id, f);
    await t.pool.query(
      `insert into homework_submissions (homework_id, student_id, handed_at, on_time) values ($1,$2,now(),$3)
       on conflict (homework_id, student_id) do update set handed_at = now(), on_time = homework_submissions.on_time or excluded.on_time`, [id, studentId, schoolToday() <= h.due_on]);
    return { ok: true };
  }

  /** Takes back work handed in by mistake, before it is graded: its files go with it. */
  async withdrawHomework(t: TenantCtx, user: AuthedUser, id: string, studentId: string) {
    const w = await this.who(t, user);
    await this.mayStudent(w, studentId, t);
    const r = await t.pool.query('update homework_submissions set handed_at = null, on_time = false where homework_id = $1 and student_id = $2 and score is null and handed_at is not null', [id, studentId]);
    if (!r.rowCount) throw new ApiError('conflict', 'Only work handed in and not yet graded can be taken back.');
    await t.pool.query("update files set deleted_at = now() where kind = 'homework_submission' and owner_id = $1 and deleted_at is null", [`${id}:${studentId}`]);
    return { ok: true };
  }

  /** A grade (or a new one: a grade can be changed). The family is told. */
  async gradeHomework(t: TenantCtx, user: AuthedUser, id: string, b: { studentId: string; marks: number | null; feedback?: string }) {
    if (!user.permissions.includes('homework.write')) throw forbidden('You are not allowed to grade homework.');
    await this.learning.markHomework(t, user, id, { marks: [{ studentId: b.studentId, handed: true, score: b.marks, feedback: b.feedback ?? '' }] });
    const h = (await t.pool.query<{ title: string; subject: string; subject_id: string; yr: number | null; max_marks: number }>(
      'select h.title, s.name subject, h.subject_id, c.grade yr, h.max_marks from homework h join subjects s on s.id = h.subject_id left join classes c on c.id = h.class_id where h.id = $1', [id])).rows[0]!;
    const fam = (await t.pool.query<{ phone: string | null; name: string }>('select g.phone, st.name from students st join student_guardians sg on sg.student_id = st.id and sg.gets_messages join guardians g on g.id = sg.guardian_id where st.id = $1', [b.studentId])).rows;
    const grade = b.marks == null ? tx('checked') : (await this.settings.grading(t, { grade: h.yr, subject: h.subject_id })).grade(Math.round((b.marks / h.max_marks) * 100)) || `${b.marks}/${h.max_marks}`;
    await this.messenger.notify(t, 'homework.graded', fam.filter((f) => f.phone).map((f) => ({ to: f.phone!, vars: { student: f.name, subject: h.subject, title: h.title, grade } })));
    return { ok: true };
  }

  async returnHomework(t: TenantCtx, user: AuthedUser, id: string, studentId: string, note: string) {
    if (!user.permissions.includes('homework.write')) throw forbidden('You are not allowed to grade homework.');
    await this.learning.returnHomework(t, user, id, studentId, note);
    return { ok: true };
  }

  /** The teacher's own subject for a class, from the timetable (a teacher may teach several). */
  private async subjectFor(t: TenantCtx, teacherId: string, classId: string, wanted?: string): Promise<string> {
    const { rows } = await t.pool.query<{ subject_id: string }>('select distinct subject_id from timetable_slots where class_id = $1 and teacher_id = $2', [classId, teacherId]);
    if (wanted && (rows.some((r) => r.subject_id === wanted) || !rows.length)) return wanted;
    if (rows.length === 1) return rows[0]!.subject_id;
    if (wanted) throw new ApiError('validation', 'You do not teach that subject to this class.');
    throw new ApiError('validation', 'Choose the subject.', { fields: { subject: 'Choose the subject.' } });
  }

  async assignHomework(t: TenantCtx, user: AuthedUser, b: HomeworkInput) {
    if (!user.permissions.includes('homework.write')) throw forbidden('You are not allowed to set homework.');
    const subjectId = await this.subjectFor(t, user.id, b.classId, b.subject ? (b.subject.startsWith('sub_') ? b.subject : `sub_${b.subject}`) : undefined);
    const d = await this.learning.createHomework(t, user, { classId: b.classId, subjectId, title: b.title, description: b.description ?? '', dueOn: b.dueOn.slice(0, 10), maxMarks: b.maxMarks ?? 20, graded: b.graded ?? true, draft: b.draft ?? false, fileIds: b.fileIds ?? [] });
    return { id: d.id };
  }

  async editHomework(t: TenantCtx, user: AuthedUser, id: string, b: HomeworkInput) {
    if (!user.permissions.includes('homework.write')) throw forbidden('You are not allowed to set homework.');
    const own = (await t.pool.query<{ created_by: string | null }>('select created_by from homework where id = $1', [id])).rows[0];
    if (!own) throw notFound('That homework');
    if (own.created_by !== user.id && !user.permissions.includes('homework.read')) throw forbidden('You can change only the homework you set.');
    const subjectId = await this.subjectFor(t, user.id, b.classId, b.subject ? (b.subject.startsWith('sub_') ? b.subject : `sub_${b.subject}`) : undefined);
    await this.learning.updateHomework(t, user, id, { classId: b.classId, subjectId, title: b.title, description: b.description ?? '', dueOn: b.dueOn.slice(0, 10), maxMarks: b.maxMarks ?? 20, graded: b.graded ?? true, draft: b.draft ?? false, fileIds: b.fileIds ?? [] });
    return { id };
  }

  async deleteHomework(t: TenantCtx, user: AuthedUser, id: string) {
    const own = (await t.pool.query<{ created_by: string | null }>('select created_by from homework where id = $1', [id])).rows[0];
    if (!own) throw notFound('That homework');
    if (own.created_by !== user.id) throw forbidden('You can delete only the homework you set.');
    await this.learning.deleteHomework(t, user, id);
    return { ok: true };
  }

  // Exams and results

  async exams(t: TenantCtx, user: AuthedUser, classId: string) {
    await this.mayClass(t, await this.who(t, user), classId);
    const list = (await this.learning.exams(t, classId)).filter((e) => e.status !== 'marking' || user.permissions.includes('exams.write'));
    // Each paper's day, time and room make the exam timetable families see.
    return list.map((e) => ({
      id: e.id, name: e.name, classId: e.classId, startDate: e.startsOn, endDate: e.endsOn, status: e.status === 'published' ? 'completed' : 'upcoming', subjects: e.subjects.map((s) => key(s.subjectId)),
      papers: e.subjects.map((s) => ({ subject: key(s.subjectId), subjectName: s.name, date: s.onDate, startsAt: s.startsAt, endsAt: s.endsAt, room: s.room, maxMarks: s.maxMarks })),
    }));
  }

  private async resultOf(t: TenantCtx, examId: string, studentId: string) {
    const res = await this.learning.results(t, examId);
    if (res.exam.status !== 'published') throw notFound('That result');
    const row = res.rows.find((r) => r.studentId === studentId);
    if (!row) throw notFound('That result');
    const marks = await t.pool.query<{ subject_id: string; score: string | null; max_marks: number }>(
      'select m.subject_id, m.score, x.max_marks from exam_marks m join exam_subjects x on x.exam_id = m.exam_id and x.subject_id = m.subject_id where m.exam_id = $1 and m.student_id = $2', [examId, studentId]);
    const trend = await t.pool.query<{ exam: string; pct: number }>('select exam, pct from exam_results where student_id = $1 order by exam limit 6', [studentId]);
    const year = (await t.pool.query<{ grade: number }>('select c.grade from students s join classes c on c.id = s.class_id where s.id = $1', [studentId])).rows[0]?.grade ?? null;
    const grading = await this.settings.grading(t, { grade: year });
    // The class rank reaches families only when the console says so (results.showRank).
    const rank = (await this.settings.value<boolean>(t, 'results.showRank', false)) ? { rank: row.rank, totalStudents: res.rows.length } : { rank: 0, totalStudents: 0 };
    return {
      id: `res_${studentId}_${examId}`, examId, studentId, overallPercent: row.pct, grade: row.grade, gpa: row.gpa, ...rank,
      subjects: marks.rows.map((m) => ({ subject: key(m.subject_id), marks: Math.round(Number(m.score ?? 0)), maxMarks: m.max_marks, grade: grading.of(Math.round((Number(m.score ?? 0) / m.max_marks) * 100), m.subject_id).grade })),
      trend: trend.rows.map((x) => ({ label: x.exam, percent: x.pct })),
    };
  }

  async result(t: TenantCtx, user: AuthedUser, examId: string, studentId: string) {
    await this.mayStudent(await this.who(t, user), studentId, t);
    return this.resultOf(t, examId, studentId);
  }

  async resultsOf(t: TenantCtx, user: AuthedUser, studentId: string) {
    await this.mayStudent(await this.who(t, user), studentId, t);
    const ex = await t.pool.query<{ id: string }>("select e.id from exams e join students s on s.class_id = e.class_id where s.id = $1 and e.status = 'published' order by e.starts_on desc", [studentId]);
    const out = [];
    for (const e of ex.rows) { try { out.push(await this.resultOf(t, e.id, studentId)); } catch { /* the student has no marks in this exam */ } }
    return out;
  }

  private async openExam(t: TenantCtx, classId: string, subject: string) {
    return (await t.pool.query<{ id: string }>(
      `select e.id, x.max_marks from exams e join exam_subjects x on x.exam_id = e.id where e.class_id = $1 and x.subject_id = $2 and e.status in ('upcoming','marking') order by e.starts_on limit 1`, [classId, `sub_${subject}`])).rows[0] as { id: string; max_marks: number } | undefined;
  }

  async marksDraft(t: TenantCtx, user: AuthedUser, classId: string, subject: string) {
    if (!user.permissions.includes('exams.read')) throw forbidden('You are not allowed to see marks.');
    // The marks so far, and what the open exam marks this subject out of (the school's default before there is one).
    const e = await this.openExam(t, classId, subject);
    if (!e) return { marks: {}, maxMarks: await this.settings.value<number>(t, 'exams.defaultMaxMarks', 100) };
    const { rows } = await t.pool.query<{ student_id: string; score: string }>('select student_id, score from exam_marks where exam_id = $1 and subject_id = $2 and score is not null', [e.id, `sub_${subject}`]);
    return { marks: Object.fromEntries(rows.map((r) => [r.student_id, Math.round(Number(r.score))])), maxMarks: e.max_marks };
  }

  async saveMarks(t: TenantCtx, user: AuthedUser, classId: string, b: { subject: string; values: Record<string, number> }) {
    if (!user.permissions.includes('exams.write')) throw forbidden('You are not allowed to enter marks.');
    const e = await this.openExam(t, classId, b.subject);
    if (!e) throw new ApiError('conflict', 'No exam is open for marks in this subject. Add one under Exams in the admin.');
    const marks = Object.entries(b.values).map(([studentId, score]) => ({ studentId, subjectId: `sub_${b.subject}`, score, absent: false }));
    if (marks.length) await this.learning.putMarks(t, user, e.id, { marks });
    return { ok: true };
  }

  // Fees

  async feesOf(t: TenantCtx, user: AuthedUser, studentId: string) {
    const w = await this.who(t, user);
    if (w.kind === 'student') throw forbidden('Fees are for parents to see.');
    await this.mayStudent(w, studentId, t);
    const inv = await t.pool.query<{ id: string; title: string; amount: number; waived_amount: number; due_on: string; paid: string; last: string | null; method: string | null; reference: string | null }>(
      `select i.id, i.title, i.amount, i.waived_amount, i.due_on::text, coalesce((select sum(amount - refunded) from payments p where p.invoice_id = i.id), 0) paid,
         (select paid_on::text from payments p where p.invoice_id = i.id order by paid_on desc limit 1) last, (select method from payments p where p.invoice_id = i.id order by paid_on desc limit 1) method,
         (select coalesce(reference, receipt_no) from payments p where p.invoice_id = i.id order by paid_on desc limit 1) reference
       from fee_invoices i where i.student_id = $1 order by i.due_on, i.id`, [studentId]);
    const pay = await t.pool.query<{ id: string; invoice_id: string; title: string; amount: number; paid_on: string; method: string; reference: string; receipt_no: string }>(
      `select p.id, p.invoice_id, i.title, p.amount, p.paid_on::text, p.method, coalesce(p.reference, p.receipt_no) reference, p.receipt_no from payments p join fee_invoices i on i.id = p.invoice_id where i.student_id = $1 order by p.paid_on desc, p.id`, [studentId]);
    const year = (await t.pool.query<{ label: string }>('select label from academic_years where current limit 1')).rows[0]?.label ?? '';
    return {
      studentId, academicYear: year,
      installments: inv.rows.map((i) => { const due = i.amount - i.waived_amount; const paid = Number(i.paid) >= due; return { id: i.id, title: i.title, amount: due, dueDate: i.due_on, paid, ...(paid && i.last ? { paidOn: i.last, method: i.method, reference: i.reference } : {}) }; }),
      receipts: pay.rows.map((p) => ({ id: p.id, number: p.receipt_no, installmentId: p.invoice_id, title: p.title, amount: p.amount, paidOn: p.paid_on, method: p.method, reference: p.reference })),
    };
  }

  /** Older app builds paid here directly; payments now go through the provider's checkout (POST fees/:id/order). */
  async pay(t: TenantCtx, user: AuthedUser, _invoiceId: string, b: { studentId: string; method: string }): Promise<never> {
    await this.mayStudent(await this.who(t, user), b.studentId, t);
    throw new ApiError('conflict', 'Update the Tangent app to pay fees online.');
  }

  // Notices and events

  /** The notices this person reads: their own audience and their children's classes; pinned first; read and acknowledged marked. */
  async notices(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const classIds = w.children.length ? (await t.pool.query<{ class_id: string }>('select distinct class_id from students where id = any($1)', [w.children])).rows.map((r) => r.class_id) : [];
    const list = await this.noticesSvc.forReader(t, w.id, classIds, w.kind);
    return list.map((n) => ({
      id: n.id, title: n.title, body: n.body, category: n.category, audience: n.audience === 'staff' ? 'teachers' : n.audience, pinned: n.pinned,
      date: (n.publishedAt ?? n.createdAt).slice(0, 10), publishedAt: n.publishedAt, editedAt: n.editedAt, author: n.author,
      attachments: n.files.map((f) => f.name), files: n.files, needsAck: n.needsAck, read: n.read, acked: n.acked,
    }));
  }

  async readNotice(t: TenantCtx, user: AuthedUser, id: string, ack: boolean) {
    await this.noticesSvc.markRead(t, user.id, id, ack);
    return { ok: true };
  }

  /** A teacher's own notices (drafts, waiting for approval, scheduled, published), to edit or take down. */
  async myNotices(t: TenantCtx, user: AuthedUser) {
    if (!user.permissions.includes('notices.write')) throw forbidden('You are not allowed to post notices.');
    return this.noticesSvc.list(t, user);
  }

  async postNotice(t: TenantCtx, user: AuthedUser, b: NoticeCreate) {
    if (!user.permissions.includes('notices.write')) throw forbidden('You are not allowed to post notices.');
    const n = await this.noticesSvc.create(t, user, b);
    return { id: n.id, status: n.status };
  }

  async editNotice(t: TenantCtx, user: AuthedUser, id: string, b: NoticeCreate & { tellAgain?: boolean }) {
    const n = await this.noticesSvc.update(t, user, id, b);
    return { id: n.id, status: n.status };
  }

  async deleteNotice(t: TenantCtx, user: AuthedUser, id: string) {
    await this.noticesSvc.remove(t, user, id);
    return { ok: true };
  }

  /**
   * The school's calendar as the app shows it: times from start to end, the category, the place (with a map position when set),
   * and a reply asked only for events that ask for one. How many are going shows only when the school allows it.
   */
  async events(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const showGoing = await this.settings.value<boolean>(t, 'events.showGoing', false);
    const { rows } = await t.pool.query<{ id: string; title: string; starts_at: Date; ends_at: Date | null; kind: string; venue: string; note: string; audience: string; category: string; needs_rsvp: boolean; lat: number | null; lng: number | null; going: string; class_id: string | null }>(
      `select e.id, e.title, e.starts_at, e.ends_at, e.kind, e.venue, e.note, e.audience, e.category, e.needs_rsvp, e.lat, e.lng, e.class_id,
         (select count(*) from event_rsvps r where r.event_id = e.id and r.status = 'going') going
       from events e where e.kind not in ('routine','cover') order by e.starts_at limit 150`);
    // A class's own event reaches only the families (and students) of that class.
    const classes = w.children.length ? (await t.pool.query<{ class_id: string }>('select distinct class_id from students where id = any($1)', [w.children])).rows.map((r) => r.class_id) : [];
    const mine = w.children.length ? await t.pool.query<{ event_id: string; student_id: string; status: string; adults: number }>('select event_id, student_id, status, adults from event_rsvps where student_id = any($1)', [w.children]) : { rows: [] as { event_id: string; student_id: string; status: string; adults: number }[] };
    // The event's day and time on the school's clock.
    const ist = (d: Date) => schoolNow(d).toISOString();
    return rows.filter((e) => w.kind === 'staff' || (e.audience !== 'staff' && (e.audience !== 'class' || classes.includes(e.class_id ?? '')))).map((e) => {
      const replies = mine.rows.filter((m) => m.event_id === e.id);
      return {
        id: e.id, title: e.title, description: e.note, date: ist(e.starts_at).slice(0, 10), time: ist(e.starts_at).slice(11, 16), endTime: e.ends_at ? ist(e.ends_at).slice(11, 16) : null,
        endDate: e.ends_at ? ist(e.ends_at).slice(0, 10) : null, venue: e.venue, lat: e.lat, lng: e.lng, kind: e.kind, category: e.category || e.kind, imageUrl: '',
        needsRsvp: e.needs_rsvp && w.kind !== 'staff', going: showGoing ? Number(e.going) : null,
        rsvps: replies.map((r) => ({ userId: w.id, studentId: r.student_id, status: r.status, adults: r.adults })),
      };
    });
  }

  /** A family's reply for the children it says (all of them unless named), and how many grown-ups come along. */
  async rsvp(t: TenantCtx, user: AuthedUser, eventId: string, status: string, studentIds?: string[], adults = 0) {
    const w = await this.who(t, user);
    if (!['going', 'maybe', 'cant'].includes(status)) throw new ApiError('validation', 'Choose going, maybe or cannot come.');
    const e = (await t.pool.query<{ needs_rsvp: boolean }>('select needs_rsvp from events where id = $1', [eventId])).rows[0];
    if (!e) throw notFound('That event');
    if (!e.needs_rsvp) throw new ApiError('conflict', 'This event does not ask for a reply.');
    const who = studentIds?.length ? studentIds.filter((s) => w.children.includes(s)) : w.children;
    for (const s of who) await t.pool.query('insert into event_rsvps (event_id, student_id, status, adults) values ($1,$2,$3,$4) on conflict (event_id, student_id) do update set status = excluded.status, adults = excluded.adults', [eventId, s, status, status === 'going' ? adults : 0]);
    return { ok: true };
  }

  // Chat

  private async threadScope(w: Who): Promise<{ where: string; params: unknown[] }> {
    if (w.kind === 'staff') return { where: '(th.assigned_to = $1 or ($2 and th.assigned_to is null))', params: [w.id, w.perms.includes('messages.read')] };
    if (w.kind === 'student') return { where: 'th.student_user_id = $1 and $2::boolean', params: [w.id, true] };
    return { where: 'th.guardian_id = any($1) and th.student_user_id is null and $2::boolean', params: [w.guardianIds.length ? w.guardianIds : ['none'], true] };
  }

  private sender(w: Who): ChatSender {
    return { id: w.id, name: w.name, kind: w.kind };
  }

  async threads(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const sc = await this.threadScope(w);
    const { rows } = await t.pool.query<{ id: string; subject: string; assigned_to: string | null; staff: string | null; g_user: string | null; guardian: string | null; student_user_id: string | null; student: string | null; role: string | null }>(
      `select th.id, th.subject, th.assigned_to, u.name staff, g.user_id g_user, g.name guardian, th.student_user_id, su.name student,
         (select r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = th.assigned_to limit 1) role
       from threads th left join users u on u.id = th.assigned_to left join guardians g on g.id = th.guardian_id left join users su on su.id = th.student_user_id
       where ${sc.where} order by th.last_at desc limit 100`, sc.params);
    return rows.map((r) => ({
      id: r.id, title: w.kind === 'staff' ? r.student ?? r.guardian ?? 'A family' : r.staff ?? 'School office', subtitle: r.subject,
      // What the other side is, so the app colours them by role rather than guessing from the subject.
      role: w.kind === 'staff' ? (r.student_user_id ? 'student' : 'parent') : r.assigned_to ? (r.role ?? 'Teacher') : 'office',
      participantIds: [w.id, ...(w.kind === 'staff' ? [r.student_user_id ?? r.g_user ?? `guardian_${r.id}`] : [r.assigned_to ?? 'school_office'])], avatarUrl: '', online: false,
    }));
  }

  private msgJson(m: { id: string; thread_id: string; from_kind: string; sender_name: string; sender_id: string | null; body: string; file_ids: string[]; created_at: Date; read_at: Date | null; deleted_at: Date | null; g_user: string | null; staff_id: string | null }) {
    const senderId = m.sender_id ?? (m.from_kind === 'guardian' ? m.g_user ?? `guardian_${m.thread_id}` : m.staff_id ?? 'school_office');
    return { id: m.id, threadId: m.thread_id, senderId, senderName: m.sender_name, text: m.deleted_at ? '' : m.body, files: m.deleted_at ? [] : m.file_ids, deleted: !!m.deleted_at, sentAt: m.created_at.toISOString(), read: m.read_at != null };
  }

  private readonly msgSql = `select m.id, m.thread_id, m.from_kind, m.sender_name, m.sender_id, m.body, m.file_ids, m.created_at, m.read_at, m.deleted_at, g.user_id g_user,
      (select id from users where name = m.sender_name and kind = 'staff' limit 1) staff_id
    from thread_messages m join threads th on th.id = m.thread_id left join guardians g on g.id = th.guardian_id`;

  async messages(t: TenantCtx, user: AuthedUser, threadId: string) {
    const w = await this.who(t, user);
    const sc = await this.threadScope(w);
    const ok = await t.pool.query(`select 1 from threads th where th.id = $${sc.params.length + 1} and ${sc.where}`, [...sc.params, threadId]);
    if (!ok.rowCount) throw notFound('That conversation');
    const { rows } = await t.pool.query(`${this.msgSql} where m.thread_id = $1 order by m.created_at, m.id`, [threadId]);
    return rows.map((m) => this.msgJson(m));
  }

  async inbox(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const sc = await this.threadScope(w);
    const { rows } = await t.pool.query(`${this.msgSql} where ${sc.where} order by m.created_at, m.id limit 1000`, sc.params);
    return rows.map((m) => this.msgJson(m));
  }

  async send(t: TenantCtx, user: AuthedUser, threadId: string, text: string, fileIds: string[] = []) {
    const w = await this.who(t, user);
    await this.messages(t, user, threadId);
    if (w.kind === 'staff' && !user.permissions.includes('messages.write')) throw forbidden('You are not allowed to write to families.');
    const id = await this.chat.post(t, this.sender(w), threadId, text, fileIds);
    return { ok: true, id };
  }

  async typing(t: TenantCtx, user: AuthedUser, threadId: string) {
    const w = await this.who(t, user);
    await this.messages(t, user, threadId);
    await this.chat.typing(t, this.sender(w), threadId);
    return { ok: true };
  }

  async markRead(t: TenantCtx, user: AuthedUser, threadId: string) {
    const w = await this.who(t, user);
    await this.messages(t, user, threadId);
    await this.chat.read(t, this.sender(w), threadId);
    return { ok: true };
  }

  async deleteMessage(t: TenantCtx, user: AuthedUser, messageId: string) {
    await this.chat.remove(t, this.sender(await this.who(t, user)), messageId);
    return { ok: true };
  }

  async reportMessage(t: TenantCtx, user: AuthedUser, messageId: string, reason: string) {
    const w = await this.who(t, user);
    const m = (await t.pool.query<{ thread_id: string }>('select thread_id from thread_messages where id = $1', [messageId])).rows[0];
    if (!m) throw notFound('That message');
    await this.messages(t, user, m.thread_id);
    await this.chat.report(t, this.sender(w), messageId, reason);
    return { ok: true };
  }

  /**
   * Who a family (or a student) may write to: the teachers who teach their children (class teacher or a subject in the
   * timetable), and the office. Anyone else is refused, so families cannot message every member of staff.
   */
  async contacts(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    if (w.kind === 'staff') return [];
    const { rows } = await t.pool.query<{ id: string; name: string; subject: string | null; class_teacher: boolean }>(
      `select u.id, u.name, max(sub.name) subject, bool_or(c.class_teacher_id = u.id) class_teacher from students s join classes c on c.id = s.class_id
       join users u on u.kind = 'staff' and u.status = 'active' and (u.id = c.class_teacher_id or u.id in (select tt.teacher_id from timetable_slots tt where tt.class_id = c.id))
       left join timetable_slots tts on tts.class_id = c.id and tts.teacher_id = u.id left join subjects sub on sub.id = tts.subject_id
       where s.id = any($1) group by u.id, u.name order by bool_or(c.class_teacher_id = u.id) desc, u.name`, [w.children.length ? w.children : ['none']]);
    return rows.map((r) => ({ id: r.id, name: r.name, subject: r.subject ?? '', classTeacher: r.class_teacher }));
  }

  async startThread(t: TenantCtx, user: AuthedUser, teacherId: string) {
    const w = await this.who(t, user);
    if (w.kind === 'staff') throw forbidden('Staff start conversations from the admin.');
    const cfg = await this.settings.effective(t);
    if (w.kind === 'guardian' && !cfg.features.includes('chat.familyChat')) throw forbidden('Your school starts conversations itself. Reply to one when it does.');
    if (w.kind === 'student' && !cfg.features.includes('chat.studentChat')) throw forbidden('Your school does not let students message teachers from the app.');
    const teacher = (await this.contacts(t, user)).find((c) => c.id === teacherId);
    if (!teacher) throw forbidden('You can write to the teachers who teach your child, and to the office.');
    const found = w.kind === 'student'
      ? (await t.pool.query<{ id: string }>('select id from threads where student_user_id = $1 and assigned_to = $2 limit 1', [w.id, teacherId])).rows[0]
      : (await t.pool.query<{ id: string }>('select id from threads where guardian_id = any($1) and student_user_id is null and assigned_to = $2 limit 1', [w.guardianIds, teacherId])).rows[0];
    if (found) return { id: found.id };
    const id = newId('thr');
    await t.pool.query('insert into threads (id, guardian_id, student_id, subject, assigned_to, student_user_id) values ($1,$2,$3,$4,$5,$6)',
      [id, w.kind === 'guardian' ? w.guardianIds[0] : null, w.children[0] ?? null, `Message for ${teacher.name}`, teacherId, w.kind === 'student' ? w.id : null]);
    return { id };
  }

  // Library, transport, leave, gallery

  /** The catalogue as the app lists it, with the books a family's children have out (and loans brought in before the catalogue). */
  /**
   * The catalogue as the app lists it, with what this family's children (or this teacher) have out: due dates, renewals left, fines,
   * the history of past loans, reservations, and how many books one may have out.
   */
  async books(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const loans = w.kind === 'staff' ? await this.library.loans(t, undefined, w.id) : w.children.length ? await this.library.loans(t, w.children) : [];
    const open = loans.filter((l) => !l.returnedOn);
    const rules = await this.library.rules(t);
    const catalogue = (await this.library.books(t)).map((b) => {
      const mine = open.find((l) => l.bookId === b.id);
      return {
        id: b.id, title: b.title, author: b.author, category: b.category, isbn: b.isbn, available: b.copies - b.out > 0, waiting: b.waiting, coverUrl: '',
        ...(mine ? { borrowedBy: mine.studentId ?? w.id, dueDate: mine.dueOn, loanId: mine.id, fine: mine.fine, overdueDays: mine.overdueDays, renewalsLeft: Math.max(0, rules.maxRenewals - mine.renewals) } : {}),
      };
    });
    const legacy = open.filter((l) => !l.bookId).map((l) => ({ id: l.id, title: l.title, author: '', category: 'Library', isbn: '', available: false, waiting: 0, coverUrl: '', borrowedBy: l.studentId ?? w.id, dueDate: l.dueOn, loanId: l.id, fine: l.fine, overdueDays: l.overdueDays, renewalsLeft: Math.max(0, rules.maxRenewals - l.renewals) }));
    const reservations = w.children.length ? await this.library.reservations(t, w.children) : [];
    return {
      books: [...legacy, ...catalogue],
      history: loans.filter((l) => l.returnedOn).map((l) => ({ id: l.id, title: l.title, borrowedBy: l.studentId ?? w.id, issuedOn: l.issuedOn, returnedOn: l.returnedOn, fine: l.fine })),
      reservations: reservations.map((r) => ({ id: r.id, bookId: r.bookId, title: r.title, studentId: r.studentId, status: r.status })),
      rules: { maxLoans: w.kind === 'staff' ? rules.staffMaxLoans : rules.maxLoans, loanDays: rules.loanDays, finePerDay: rules.finePerDay, maxRenewals: rules.maxRenewals },
    };
  }

  /** Renews a loan of this book (or the loan itself, for loans brought in before the catalogue): a child's, or the teacher's own. */
  async renew(t: TenantCtx, user: AuthedUser, id: string) {
    const w = await this.who(t, user);
    const loan = (await t.pool.query<{ id: string }>('select id from library_loans where (book_id = $1 or id = $1) and (student_id = any($2) or staff_user_id = $3) and returned_on is null order by due_on limit 1', [id, w.children, w.id])).rows[0];
    if (!loan) throw notFound('That book');
    await this.library.renew(t, loan.id, w.children, w.kind === 'staff' ? w.id : undefined);
    return { ok: true };
  }

  async transport(t: TenantCtx, user: AuthedUser, studentId: string) {
    await this.mayStudent(await this.who(t, user), studentId, t);
    const r = await this.transportService.forStudent(t, studentId);
    if (!r) return null;
    const at = Math.round(r.progress * Math.max(0, r.stops.length - 1));
    return { ...r, stops: r.stops.map((s, i) => ({ name: s.name, time: s.time, reached: r.live && i < at })) };
  }

  /** Shared albums the family may see, with photo links valid for a few minutes and consent respected. */
  async gallery(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    const classes = w.kind === 'staff' ? undefined : (await t.pool.query<{ class_id: string }>('select distinct class_id from students where id = any($1)', [w.children])).rows.map((r) => r.class_id);
    const albums = (await this.gallerySvc.albums(t, classes)).filter((a) => a.published);
    const cfg = await this.settings.effective(t);
    // Each album under the school's own academic year (they start in any month).
    const years = (await t.pool.query<{ label: string; s: string; e: string }>('select label, starts_on::text s, ends_on::text e from academic_years')).rows;
    const out = [];
    for (const a of albums) {
      const photos = await this.gallerySvc.photos(t, a.id, w.kind !== 'staff');
      const shown = [];
      for (const p of photos) shown.push({ id: p.id, url: await this.files.url(t, user, p.id).catch(() => ''), caption: p.name.replace(/\.[^.]+$/, ''), tagged: p.students.map((s) => s.id) });
      const day = a.createdAt.slice(0, 10);
      out.push({ id: a.id, title: a.title, date: a.createdAt, blurb: a.className ?? tx('Whole school'), photos: shown.filter((p) => p.url), downloads: cfg.features.includes('gallery.downloads'),
        yearLabel: years.find((y) => y.s <= day && day <= y.e)?.label ?? '' });
    }
    return out.filter((a) => a.photos.length);
  }

  private async leaveReasons(t: TenantCtx): Promise<ListItem[]> {
    const read = SchoolSettingsSchema.shape['leave.reasons'].safeParse(await this.settings.value<unknown>(t, 'leave.reasons', undefined));
    return read.success ? read.data : DEFAULT_LEAVE_REASONS;
  }

  private leaveJson(r: { id: string; status: string; payload: Record<string, unknown>; created_at: Date; subject_ref: string | null }, reasons: ListItem[] = []) {
    const p = r.payload;
    return { id: r.id, studentId: String(p.studentId ?? r.subject_ref ?? ''), from: String(p.from ?? ''), to: String(p.to ?? ''), reason: listLabel(reasons, String(p.reason ?? ''), schoolContext.getStore()?.lang ?? 'en'), status: r.status, appliedOn: r.created_at.toISOString().slice(0, 10), ...(p.reviewer ? { reviewedBy: String(p.reviewer) } : {}), ...(p.reviewNote ? { reviewNote: String(p.reviewNote) } : {}) };
  }

  async leave(t: TenantCtx, user: AuthedUser, studentId: string) {
    await this.mayStudent(await this.who(t, user), studentId, t);
    const { rows } = await t.pool.query("select id, status, payload, created_at, subject_ref from approvals where kind = 'leave' and payload->>'studentLeave' = 'true' and payload->>'studentId' = $1 order by created_at desc", [studentId]);
    const reasons = await this.leaveReasons(t);
    return rows.map((r) => this.leaveJson(r, reasons));
  }

  /** A parent asks for leave for one child: whole days, or half of one day. It goes to the class teacher and the approvals queue. */
  async applyLeave(t: TenantCtx, user: AuthedUser, b: LeaveInput) {
    const w = await this.who(t, user);
    this.parentOnly(w);
    await this.mayStudent(w, b.studentId, t);
    const s = (await t.pool.query<{ name: string }>('select name from students where id = $1', [b.studentId])).rows[0];
    if (!s) throw notFound('That student');
    const leave = await this.checkLeave(t, b);
    await checkLeaveClash(t.pool, b.studentId, leave.from, leave.to, b.halfDay);
    const id = newId('apr');
    await t.pool.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'leave',$2,$3,$4,$5,$6,$7)",
      [id, `Leave for ${s.name}`, leave.subtitle, user.name, user.id, b.studentId, JSON.stringify({ studentLeave: true, studentId: b.studentId, from: leave.from, to: leave.to, halfDay: b.halfDay ?? null, reason: b.reason, note: b.note ?? '', fileIds: b.fileIds ?? [] })]);
    return { id };
  }

  /** The dates make sense, and the reason is one the school offers (console: Attendance → reasons). */
  private async checkLeave(t: TenantCtx, b: LeaveInput): Promise<{ from: string; to: string; subtitle: string }> {
    const from = b.from.slice(0, 10);
    const to = b.halfDay ? from : b.to.slice(0, 10);
    if (to < from) throw new ApiError('validation', 'The last day cannot be before the first day.');
    // A reason is one of the school's, by its key or its name in any language; it is kept by its key.
    const reasons = await this.leaveReasons(t);
    const key = listKey(listOptions(reasons), b.reason);
    if (reasons.length && !key) throw new ApiError('validation', tx('Choose one of the school’s reasons.'), { fields: { reason: tx('Choose one of the reasons.') } });
    if (key) b.reason = key;
    const when = b.halfDay ? `${from}, ${b.halfDay === 'am' ? 'morning' : 'afternoon'} only` : from === to ? from : `${from} to ${to}`;
    return { from, to, subtitle: `${when} · ${listLabel(reasons, b.reason).slice(0, 60)}` };
  }

  /** A request still waiting can be corrected or withdrawn by the parent who sent it; once answered it is the school's record. */
  private async ownPending(t: TenantCtx, user: AuthedUser, id: string): Promise<{ subject_ref: string }> {
    const row = (await t.pool.query<{ subject_ref: string; status: string; requested_by: string | null }>("select subject_ref, status, requested_by from approvals where id = $1 and kind = 'leave'", [id])).rows[0];
    if (!row || row.requested_by !== user.id) throw notFound('That leave request');
    if (row.status !== 'pending') throw new ApiError('conflict', 'The school has already answered this request.');
    return row;
  }

  async editLeave(t: TenantCtx, user: AuthedUser, id: string, b: LeaveInput) {
    const row = await this.ownPending(t, user, id);
    if (row.subject_ref !== b.studentId) throw new ApiError('validation', 'A request stays with the child it was made for.');
    const leave = await this.checkLeave(t, b);
    await t.pool.query("update approvals set subtitle = $2, payload = payload || $3 where id = $1",
      [id, leave.subtitle, JSON.stringify({ from: leave.from, to: leave.to, halfDay: b.halfDay ?? null, reason: b.reason, note: b.note ?? '', fileIds: b.fileIds ?? [] })]);
    return { id };
  }

  async withdrawLeave(t: TenantCtx, user: AuthedUser, id: string) {
    await this.ownPending(t, user, id);
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2 where id = $1", [id, user.id]);
    return { id, status: 'withdrawn' };
  }

  async reviewLeave(t: TenantCtx, user: AuthedUser, id: string, b: { status: string; note?: string }) {
    const row = (await t.pool.query<{ payload: Record<string, unknown>; subject_ref: string | null; status: string }>("select payload, subject_ref, status from approvals where id = $1 and kind = 'leave' and payload->>'studentLeave' = 'true'", [id])).rows[0];
    if (!row) throw notFound('That request');
    if (b.status !== 'approved' && b.status !== 'rejected') throw new ApiError('validation', 'Choose approved or rejected.');
    // The school's steps decide who takes it (ApprovalsService.takes: the class teacher may decide a child's leave by default).
    const r = await this.approvals.decide(t, user, id, { decision: b.status === 'approved' ? 'approve' : 'reject', note: b.note });
    if (r.status !== 'pending') await t.pool.query('update approvals set payload = payload || $2 where id = $1', [id, JSON.stringify({ reviewer: user.name, reviewNote: b.note ?? '' })]);
    return { ok: true };
  }

  // Notifications: the messages the school sent to this person's phone, as the app lists them.

  /**
   * The app's notification list: what was sent to this person, each with the screen it opens (from the message it was), and
   * nothing from a module the school no longer has. Read and dismissed are kept on the server, so they follow the person.
   */
  async notifications(t: TenantCtx, user: AuthedUser) {
    const w = await this.who(t, user);
    if (!w.phone) return [];
    const { rows } = await this.registry.pool.query<{ id: string; body: string; created_at: Date; channel: string; message_key: string | null; vars: Record<string, string> | null }>(
      `select distinct on (body, date_trunc('minute', created_at)) id, body, created_at, channel, message_key, vars from message_log where school_slug = $1 and to_addr = $2 and channel in ('push','sms')
         and status in ('sent','delivered','read') order by body, date_trunc('minute', created_at), (channel = 'push') desc limit 80`, [t.info.slug, w.phone]);
    const state = await t.pool.query<{ message_id: string; state: string }>('select message_id, state from notification_state where user_id = $1', [w.id]);
    const by = new Map(state.rows.map((s) => [s.message_id, s.state]));
    const cfg = await this.settings.effective(t);
    const has = (k: string) => cfg.modules.includes(k) || cfg.features.includes(k);
    return rows.filter((r) => by.get(r.id) !== 'dismissed').map((r) => ({ r, ev: MESSAGE_EVENTS.find((e) => e.key === r.message_key) }))
      .filter(({ ev }) => !ev || has(ev.needs))
      .sort((a, b) => b.r.created_at.getTime() - a.r.created_at.getTime()).map(({ r, ev }) => ({
        id: r.id, userId: w.id, title: ev?.label ?? r.body.split(/[.:]/)[0]!.slice(0, 60), body: r.body, type: r.message_key ?? 'general', module: ev?.needs ?? null,
        date: r.created_at.toISOString(), read: by.get(r.id) === 'read', route: (r.vars?.route as string | undefined) ?? ev?.opens ?? '/notifications',
      }));
  }

  /** Brings back a notification dismissed by mistake (the app's "Undo"). */
  async restoreNotification(t: TenantCtx, user: AuthedUser, id: string) {
    await t.pool.query("update notification_state set state = 'read', at = now() where user_id = $1 and message_id = $2", [user.id, id]);
    return { ok: true };
  }

  async notificationState(t: TenantCtx, user: AuthedUser, ids: string[], state: 'read' | 'dismissed') {
    for (const id of ids) await t.pool.query('insert into notification_state (user_id, message_id, state) values ($1,$2,$3) on conflict (user_id, message_id) do update set state = excluded.state, at = now()', [user.id, id, state]);
    return { ok: true };
  }

  async readAll(t: TenantCtx, user: AuthedUser) {
    const list = await this.notifications(t, user);
    return this.notificationState(t, user, list.filter((n) => !n.read).map((n) => n.id), 'read');
  }
}
