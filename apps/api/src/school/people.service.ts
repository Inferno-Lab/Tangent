import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RoleError, commitImport, deleteRole, exportRows, newId, previewImport, saveRole, toCsv } from '@tangent/db';
import {
  PERMISSIONS, initials, permissionAvailable, type ImportResult, type RoleDefSave,
  type EnquiryCreate, type EnquiryEnrol, type EnquiryPatch, type EnquiryRow, type EnquiryStage, type EnquiryApply, type ApplyInfo, type AdmissionStage, AdmissionStages, DEFAULT_ADMISSION_STAGES, gradeChoices, fmtDate, schoolToday, type RoleRow, type StaffCreate, type StaffPatch, type StaffRow, type StudentDetail, tx } from '@tangent/contracts';
import { hashPassword, randomToken } from '@tangent/security';
import { ApiError, forbidden, notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { AuthService } from '../auth/auth.service.js';
import { StudentsService } from './students.service.js';
import { AuditService, Messenger, SettingsService } from './support.js';

/** A first password a person can read out and type: they choose their own after signing in. */
export const tempPassword = () => `${randomToken(6).replace(/[^a-zA-Z0-9]/g, 'k').slice(0, 8)}-${Math.floor(1000 + Math.random() * 9000)}`;

type User = { id: string; name: string };

interface StaffSql {
  id: string; name: string; email: string | null; phone: string | null; status: string; designation: string; department: string | null; joined_on: string | null; max_periods: number; periods: string;
  invited: boolean; signed_in: boolean; custom: StaffRow['custom'] | null; manager_id: string | null; manager_name: string | null;
}

/** Staff, the admissions pipeline and the roles that decide what each person may do. */
/** A role rule broken (packages/db roles.ts), as the API's error. */
async function roleCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof RoleError) throw e.code === 'not_found' ? notFound('That role') : new ApiError(e.code, e.message, e.fields ? { fields: e.fields } : undefined); throw e; }
}

@Injectable()
export class PeopleService {
  constructor(
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly students: StudentsService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  /** The school puts its staff into roles, unless Tangent holds its roles (roles.schoolEdits off): then Tangent does both. */
  private async schoolAssignsRoles(t: TenantCtx): Promise<boolean> {
    return (await this.settings.value<boolean>(t, 'roles.schoolEdits', true)) !== false;
  }

  // Staff

  /** A line manager is another member of staff, and the chain never comes back round to the person (A → B → A). */
  private async checkManager(t: TenantCtx, id: string | null, managerId: string | null | undefined): Promise<void> {
    if (!managerId) return;
    if (managerId === id) throw new ApiError('validation', tx('Someone cannot be their own line manager.'), { fields: { managerId: tx('Choose someone else.') } });
    if (!(await t.pool.query('select 1 from staff s join users u on u.id = s.user_id where s.user_id = $1', [managerId])).rowCount) throw new ApiError('validation', tx('Choose a line manager from the staff list.'), { fields: { managerId: tx('Choose from the list.') } });
    if (!id) return;
    const loop = await t.pool.query(
      `with recursive up(uid, depth) as (select manager_id, 1 from staff where user_id = $1
         union all select s.manager_id, up.depth + 1 from staff s join up on s.user_id = up.uid where up.depth < 50)
       select 1 from up where uid = $2 limit 1`, [managerId, id]);
    if (loop.rowCount) throw new ApiError('validation', tx('That would make them each other’s line manager.'), { fields: { managerId: tx('Choose someone else.') } });
  }

  async staff(t: TenantCtx, q: { query?: string; id?: string } = {}): Promise<StaffRow[]> {
    const { rows } = await t.pool.query<StaffSql>(
      `select u.id, u.name, u.email, u.phone, u.status, s.designation, s.department, s.joined_on::text, s.max_periods_per_week max_periods, s.custom,
         u.invited_at is not null or u.password_hash is not null invited, u.last_login_at is not null signed_in, s.manager_id, m.name manager_name,
         (select count(*) from timetable_slots ts where ts.teacher_id = u.id) periods
       from users u join staff s on s.user_id = u.id left join users m on m.id = s.manager_id
       where ($1::text is null or u.id = $1) and ($2::text is null or u.name ilike '%' || $2 || '%' or s.designation ilike '%' || $2 || '%' or s.department ilike '%' || $2 || '%')
       order by (s.designation = 'Principal') desc, u.name limit 300`, [q.id ?? null, q.query?.replace(/[\\%_]/g, (c) => `\\${c}`) ?? null]);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [subs, roles] = await Promise.all([
      t.pool.query<{ user_id: string; id: string; name: string }>('select ss.user_id, s.id, s.name from staff_subjects ss join subjects s on s.id = ss.subject_id where ss.user_id = any($1) order by s.name', [ids]),
      t.pool.query<{ user_id: string; id: string; name: string }>('select ur.user_id, r.id, r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = any($1) order by r.name', [ids]),
    ]);
    return rows.map((r) => ({
      id: r.id, name: r.name, initials: initials(r.name), email: r.email, phone: r.phone, designation: r.designation, department: r.department,
      subjects: subs.rows.filter((s) => s.user_id === r.id).map((s) => ({ id: s.id, name: s.name })),
      roles: roles.rows.filter((x) => x.user_id === r.id).map((x) => ({ id: x.id, name: x.name })),
      periodsPerWeek: Number(r.periods), maxPeriods: r.max_periods, status: r.status === 'active' ? 'active' : 'inactive', joinedOn: r.joined_on,
      access: r.signed_in ? 'signed_in' : r.invited ? 'invited' : 'none', custom: r.custom ?? {}, managerId: r.manager_id, managerName: r.manager_name,
    }));
  }

  async createStaff(t: TenantCtx, user: User, body: StaffCreate): Promise<StaffRow> {
    // When only Tangent assigns roles, a new person starts with none (and sees nothing) until Tangent gives them one.
    const assigns = await this.schoolAssignsRoles(t);
    const role = assigns ? (await t.pool.query<{ id: string; name: string }>('select id, name from roles where id = $1', [body.roleId])).rows[0] : { id: '', name: 'none yet' };
    if (!role) throw new ApiError('validation', 'Choose a role from the list.', { fields: { roleId: 'Choose a role from the list.' } });
    const staffLimit = t.info.entitlement.limits.staff;
    if (staffLimit && Number((await t.pool.query<{ n: string }>("select count(*) n from users where kind = 'staff' and status = 'active'")).rows[0]!.n) >= staffLimit) {
      throw new ApiError('locked', tx('Your plan allows {staffLimit} staff accounts. Ask Tangent to raise the limit.', { staffLimit }));
    }
    const dup = await t.pool.query('select 1 from users where lower(email) = $1', [body.email]);
    if (dup.rowCount) throw new ApiError('validation', 'Someone already uses that email.', { fields: { email: 'Someone already uses that email.' } });
    const custom = await this.settings.custom(t, 'staff', body.custom ?? {}, true);
    await this.checkManager(t, null, body.managerId);
    const id = newId('usr');
    const temp = tempPassword();
    const known = body.subjectIds.length ? (await t.pool.query<{ id: string }>('select id from subjects where id = any($1)', [body.subjectIds])).rows.map((s) => s.id) : [];
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query("insert into users (id, kind, name, email, phone, password_hash, invited_at) values ($1,'staff',$2,$3,$4,$5,now())", [id, body.name, body.email, this.settings.phone(t, body.phone), await hashPassword(temp)]);
      await client.query('insert into staff (user_id, designation, department, joined_on, custom, manager_id) values ($1,$2,$3,current_date,$4,$5)', [id, body.designation, body.department ?? null, JSON.stringify(custom), body.managerId ?? null]);
      for (const s of known) await client.query('insert into staff_subjects (user_id, subject_id) values ($1,$2)', [id, s]);
      if (role.id) await client.query('insert into user_roles (user_id, role_id) values ($1,$2)', [id, role.id]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') throw new ApiError('validation', 'Someone already uses that email or phone number.', { fields: { email: 'Someone already uses that email or phone number.' } });
      throw err;
    } finally {
      client.release();
    }
    await this.messenger.notify(t, 'staff.invite', [{ to: body.phone, email: body.email, vars: { name: body.name.split(' ')[0]!, password: temp } }]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'staff.added', entity: 'staff', entityId: id, detail: { name: body.name, role: role.name } });
    return (await this.staff(t, { id }))[0]!;
  }

  async patchStaff(t: TenantCtx, user: User, id: string, body: StaffPatch): Promise<StaffRow> {
    const me = id === user.id;
    if (me && (body.roleId || body.status === 'inactive')) throw forbidden('You cannot change your own role or switch yourself off. Ask another administrator.');
    const cur = (await t.pool.query<{ designation: string }>('select designation from staff where user_id = $1', [id])).rows[0];
    if (!cur) throw notFound('That person');
    if (body.roleId && !(await this.schoolAssignsRoles(t))) throw forbidden('Tangent assigns roles at your school. Ask Tangent to change this person’s role.');
    const custom = body.custom ? await this.settings.custom(t, 'staff', body.custom, false) : null;
    await this.checkManager(t, id, body.managerId);
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      if (body.managerId !== undefined) await client.query('update staff set manager_id = $2 where user_id = $1', [id, body.managerId]);
      if (body.name || body.email || body.phone) {
        // A changed email is how they sign in from now on.
        await client.query('update users set name = coalesce($2, name), email = coalesce($3, email), phone = coalesce($4, phone) where id = $1', [id, body.name ?? null, body.email ?? null, body.phone ? this.settings.phone(t, body.phone) : null]);
      }
      if (body.designation !== undefined || body.department !== undefined) {
        await client.query('update staff set designation = coalesce($2, designation), department = case when $3 then $4 else department end where user_id = $1',
          [id, body.designation ?? null, body.department !== undefined, body.department ?? null]);
      }
      if (custom) await client.query('update staff set custom = custom || $2::jsonb where user_id = $1', [id, JSON.stringify(custom)]);
      if (body.status) {
        await client.query('update users set status = $2 where id = $1', [id, body.status]);
        if (body.status === 'inactive') await client.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
      }
      if (body.subjectIds) {
        await client.query('delete from staff_subjects where user_id = $1', [id]);
        for (const s of body.subjectIds) await client.query('insert into staff_subjects (user_id, subject_id) select $1, id from subjects where id = $2', [id, s]);
      }
      if (body.roleId) {
        const r = await client.query('select 1 from roles where id = $1', [body.roleId]);
        if (!r.rowCount) throw new ApiError('validation', 'Choose a role from the list.');
        await client.query('delete from user_roles where user_id = $1', [id]);
        await client.query('insert into user_roles (user_id, role_id) values ($1,$2)', [id, body.roleId]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      if ((err as { code?: string }).code === '23505') throw new ApiError('validation', 'Someone already uses that email or phone number.', { fields: { email: 'Someone already uses that email or phone number.' } });
      throw err;
    } finally {
      client.release();
    }
    if (body.roleId || body.status === 'inactive') await this.auth.bumpVersion(t, id);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'staff.changed', entity: 'staff', entityId: id, detail: Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])) });
    return (await this.staff(t, { id }))[0]!;
  }

  /** A new first password for someone who has not signed in yet (lost the email, or was brought in by an import). */
  async inviteOne(t: TenantCtx, user: User, id: string): Promise<{ to: string }> {
    const p = (await t.pool.query<{ name: string; email: string | null; phone: string | null; status: string; last_login_at: string | null }>(
      "select name, email, phone, status, last_login_at from users where id = $1 and kind = 'staff'", [id])).rows[0];
    if (!p) throw notFound('That person');
    if (p.status !== 'active') throw new ApiError('validation', 'Switch them on first.');
    if (p.last_login_at) throw new ApiError('validation', tx('{name} has signed in already. If they forgot their password, they reset it from the sign-in page.', { name: p.name }));
    if (!p.email && !p.phone) throw new ApiError('validation', 'Add their email or phone first: there is nowhere to send the invite.');
    const temp = tempPassword();
    await t.pool.query('update users set password_hash = $2, invited_at = now() where id = $1', [id, await hashPassword(temp)]);
    await this.messenger.notify(t, 'staff.invite', [{ to: p.phone ?? p.email ?? '', email: p.email, vars: { name: p.name.split(' ')[0]!, password: temp } }]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'staff.invited', entity: 'staff', entityId: id, detail: { name: p.name } });
    return { to: p.email ?? p.phone ?? '' };
  }

  /** Staff from a sheet, through the one import engine; they are invited from the Staff page once they are in. */
  async importStaff(t: TenantCtx, csv: string, user: User): Promise<ImportResult> {
    const input = { kind: 'staff', csv, fileName: 'Staff page' };
    const p = await previewImport(t.pool, input);
    if (p.missing.length) throw new ApiError('validation', tx('The first row must name the columns. Nothing is matched to {p0}.', { p0: p.missing.join(', ') }));
    const limit = t.info.entitlement.limits.staff;
    const count = Number((await t.pool.query<{ n: string }>("select count(*) n from users where kind = 'staff' and status = 'active'")).rows[0]!.n);
    if (limit && count + p.counts.create > limit) throw new ApiError('locked', tx('Your plan allows {limit} staff accounts and this sheet would make {p1}. Ask Tangent to raise the limit.', { limit, p1: count + p.counts.create }));
    const errors = p.rows.filter((r) => r.errors.length).map((r) => ({ line: r.line, message: r.errors.join(' ') }));
    if (p.counts.create + p.counts.update === 0) return { created: 0, updated: 0, skipped: errors.length, errors };
    const batch = await commitImport(t.pool, input, user.name);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'staff.imported', entity: 'staff', detail: { created: batch.created, updated: batch.updated, skipped: batch.skipped } });
    return { created: batch.created, updated: batch.updated, skipped: errors.length, errors };
  }

  /** Everyone on staff, in the import sheet's columns, so it can go back in after editing. */
  async exportStaff(t: TenantCtx): Promise<string> {
    const rows = await exportRows(t.pool, 'staff');
    const cols = rows[0] ? Object.keys(rows[0]) : [];
    return toCsv([cols, ...rows.map((r) => cols.map((c) => r[c] ?? ''))]);
  }

  // Admissions

  private enquiryRow(r: { id: string; child_name: string; grade_sought: number; guardian_name: string; phone: string; email: string | null; source: string; stage: EnquiryStage; test_on: string | null; note: string; student_id: string | null; created_at: Date; scores: Record<string, string> | null; docs: Record<string, string> | null; dob: string | null }): EnquiryRow {
    return {
      id: r.id, childName: r.child_name, initials: initials(r.child_name), gradeSought: r.grade_sought, guardianName: r.guardian_name, phone: r.phone, email: r.email, source: r.source,
      stage: r.stage, stageOn: r.test_on, scores: r.scores ?? {}, docs: r.docs ?? {}, dob: r.dob, note: r.note, studentId: r.student_id, createdAt: r.created_at.toISOString(),
    };
  }

  private readonly enquirySql = 'select id, child_name, grade_sought, guardian_name, phone, email, source, stage, test_on::text, note, student_id, created_at, scores, docs, dob::text from enquiries';

  /** The school's stages, read through the same rules as its settings (a list saved before stages were its own reads as the old three). */
  private async stagesOf(t: TenantCtx): Promise<AdmissionStage[]> {
    const parsed = AdmissionStages.safeParse(await this.settings.value<unknown>(t, 'admissions.stages', DEFAULT_ADMISSION_STAGES));
    return parsed.success ? parsed.data : DEFAULT_ADMISSION_STAGES;
  }

  async enquiries(t: TenantCtx): Promise<EnquiryRow[]> {
    const { rows } = await t.pool.query(`${this.enquirySql} order by created_at desc, id limit 300`);
    return rows.map((r) => this.enquiryRow(r));
  }

  private async enquiry(t: TenantCtx, id: string): Promise<EnquiryRow> {
    const { rows } = await t.pool.query(`${this.enquirySql} where id = $1`, [id]);
    if (!rows[0]) throw notFound('That application');
    return this.enquiryRow(rows[0]);
  }

  async createEnquiry(t: TenantCtx, user: User, body: EnquiryCreate): Promise<EnquiryRow> {
    const id = newId('enq');
    await t.pool.query('insert into enquiries (id, child_name, grade_sought, guardian_name, phone, email, source, note) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, body.childName, body.gradeSought, body.guardianName, this.settings.phone(t, body.phone), body.email || null, body.source, body.note]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'admission.enquiry', entity: 'enquiry', entityId: id, detail: { child: body.childName } });
    return this.enquiry(t, id);
  }

  /**
   * Changes an application: its details, the stage it is in (with that stage's day when it happens on one), the score at a
   * scored stage, and which documents came in. Entering a stage the family hears about tells them.
   */
  async patchEnquiry(t: TenantCtx, user: User, id: string, body: EnquiryPatch): Promise<EnquiryRow> {
    const cur = await this.enquiry(t, id);
    if (cur.stage === 'enrolled') throw new ApiError('conflict', tx('This child is already enrolled. Change them from the Students page.'));
    if (body.stage === 'enrolled') throw new ApiError('validation', tx('Use “Enrol” to turn an application into a student.'));
    const stages = await this.stagesOf(t);
    const moving = body.stage !== undefined && body.stage !== cur.stage;
    // A stage the school has since removed keeps the cards still in it, but nobody moves a card into it.
    if (moving && !['enquiry', 'declined', ...stages.map((s) => s.key)].includes(body.stage!)) throw new ApiError('validation', tx('Your school does not use that stage.'));
    const stage = body.stage ?? cur.stage;
    const def = stages.find((s) => s.key === stage);
    // The day belongs to the stage: moving on clears the last one's, and a stage that happens on a day needs one.
    let stageOn = moving ? body.stageOn ?? null : body.stageOn === undefined ? cur.stageOn : body.stageOn;
    if (def?.needsDate && !stageOn) throw new ApiError('validation', tx('Pick the day of “{stage}”.', { stage: def.name }), { fields: { stageOn: tx('Pick the day.') } });
    if (!def?.needsDate) stageOn = null;
    const scores = { ...cur.scores };
    if (body.score !== undefined) {
      if (!def?.scored) throw new ApiError('validation', tx('This stage has no score.'), { fields: { score: tx('No score here.') } });
      if (body.score) scores[stage] = body.score; else delete scores[stage];
    }
    // Documents are the ones the school's stages ask for; one that is no longer asked for can still be unticked.
    const docs = { ...cur.docs };
    const asked = new Set(stages.flatMap((s) => s.documents));
    for (const [name, got] of Object.entries(body.docs ?? {})) {
      if (got && !asked.has(name)) throw new ApiError('validation', tx('“{name}” is not one of the documents your school asks for.', { name }));
      if (got) docs[name] = docs[name] ?? schoolToday(); else delete docs[name];
    }
    await t.pool.query(
      `update enquiries set stage = $2, test_on = $3, note = $4, child_name = coalesce($5, child_name), grade_sought = coalesce($6, grade_sought), guardian_name = coalesce($7, guardian_name),
         phone = coalesce($8, phone), email = case when $9::text is null then email else nullif($9, '') end, source = coalesce($10, source), scores = $11, docs = $12, updated_at = now() where id = $1`,
      [id, stage, stageOn, body.note ?? cur.note, body.childName ?? null, body.gradeSought ?? null, body.guardianName ?? null, body.phone ? this.settings.phone(t, body.phone) : null, body.email ?? null, body.source ?? null,
        JSON.stringify(scores), JSON.stringify(docs)]);
    if (moving && def?.tellFamily && (cur.phone || cur.email)) {
      const school = (await this.settings.effective(t)).school.name;
      await this.messenger.notify(t, stage === 'offer' ? 'admissions.offer' : 'admissions.stage',
        [{ to: cur.phone, email: cur.email, vars: { child: cur.childName, stage: def.name, date: stageOn ? fmtDate(stageOn, 'day') : '', school } }]);
    }
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: moving ? 'admission.moved' : 'admission.changed', entity: 'enquiry', entityId: id, detail: { child: cur.childName, to: stage } });
    return this.enquiry(t, id);
  }

  async enrol(t: TenantCtx, user: User, id: string, body: EnquiryEnrol): Promise<StudentDetail> {
    const e = await this.enquiry(t, id);
    if (e.stage === 'enrolled') throw new ApiError('conflict', tx('This child is already enrolled.'));
    if (e.stage === 'declined') throw new ApiError('conflict', tx('This application was declined. Move it back to a stage first.'));
    if (e.phone.trim().length < 8) throw new ApiError('validation', tx('Add the guardian’s phone number to the application first.'));
    const student = await this.students.create(t, { name: e.childName, classId: body.classId, dob: body.dob, guardianName: e.guardianName, guardianPhone: e.phone }, user);
    await t.pool.query("update enquiries set stage = 'enrolled', student_id = $2, updated_at = now() where id = $1", [id, student.id]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'admission.enrolled', entity: 'enquiry', entityId: id, detail: { child: e.childName, admissionNo: student.admissionNo } });
    return student;
  }

  // The online application (admissions.onlineForm)

  private async applyOpen(t: TenantCtx): Promise<boolean> {
    const cfg = await this.settings.effective(t);
    return cfg.features.includes('people.admissions') && (await this.settings.value<boolean>(t, 'admissions.onlineForm', false)) === true;
  }

  async applyInfo(t: TenantCtx): Promise<ApplyInfo> {
    const classes = (await t.pool.query<{ grade: number; name: string; section: string }>('select grade, name, section from classes c join academic_years y on y.id = c.year_id and y.current')).rows;
    return { open: await this.applyOpen(t), school: (await this.settings.effective(t)).school.name, country: t.info.country ?? '', grades: gradeChoices(classes).map((g) => ({ value: g.value, label: g.name })) };
  }

  /**
   * A family applies from the school's page: it lands in the first stage, found through the school's "Website" source. A form
   * filled by a robot (the hidden field) looks accepted and is dropped; one address sends at most five an hour; the same child
   * and phone within a month is the same application.
   */
  async apply(t: TenantCtx, body: EnquiryApply, from: string): Promise<{ ok: true }> {
    if (!(await this.applyOpen(t))) throw forbidden(tx('The school is not taking applications online. Please call the office.'));
    if (body.website) return { ok: true };
    const info = await this.applyInfo(t);
    if (!info.grades.some((g) => g.value === body.gradeSought)) throw new ApiError('validation', tx('Choose one of the school’s grades.'), { fields: { gradeSought: tx('Choose from the list.') } });
    const phone = this.settings.phone(t, body.phone, 'phone');
    const hash = createHash('sha256').update(`${t.info.id}|${from}`).digest('hex');
    const recent = Number((await t.pool.query<{ n: string }>("select count(*) n from enquiries where from_hash = $1 and created_at > now() - interval '1 hour'", [hash])).rows[0]!.n);
    if (recent >= 5) throw new ApiError('rate_limited', tx('Too many applications from here. Try again in an hour.'), { retryAfter: 3600 });
    if ((await t.pool.query("select 1 from enquiries where phone = $1 and lower(child_name) = lower($2) and created_at > now() - interval '30 days'", [phone, body.childName])).rowCount) {
      throw new ApiError('conflict', tx('We already have an application for {child} from this phone number. The school will be in touch.', { child: body.childName }));
    }
    const stages = await this.stagesOf(t);
    const sources = await this.settings.value<string[]>(t, 'admissions.sources', []);
    const source = sources.find((x) => x.toLowerCase() === 'website') ?? 'Website';
    const id = newId('enq');
    await t.pool.query('insert into enquiries (id, child_name, grade_sought, guardian_name, phone, email, source, note, stage, dob, from_hash) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, body.childName, body.gradeSought, body.guardianName, phone, body.email || null, source, body.note, stages[0]?.key ?? 'enquiry', body.dob ?? null, hash]);
    await this.audit.record(t, { actorId: null, actorName: body.guardianName, action: 'admission.applied', entity: 'enquiry', entityId: id, detail: { child: body.childName, online: true } });
    await this.messenger.notify(t, 'admissions.received', [{ to: phone, email: body.email || null, vars: { child: body.childName, school: info.school } }]);
    return { ok: true };
  }

  // Roles

  private async mayEditRoles(t: TenantCtx): Promise<void> {
    if ((await this.settings.value<boolean>(t, 'roles.schoolEdits', true)) === false) throw forbidden('Tangent holds the school’s roles. Ask Tangent to change them.');
  }

  /** A role the school makes or changes: only permissions its plan includes (a module or feature it has). */
  async saveRole(t: TenantCtx, user: User, id: string | null, body: RoleDefSave): Promise<RoleRow[]> {
    await this.mayEditRoles(t);
    const cfg = await this.settings.effective(t);
    await roleCall(() => saveRole(t.pool, { id: user.id, name: user.name }, id, body, (p) => permissionAvailable(p, cfg)));
    return this.roles(t);
  }

  async deleteRole(t: TenantCtx, user: User, id: string): Promise<RoleRow[]> {
    await this.mayEditRoles(t);
    await roleCall(() => deleteRole(t.pool, { id: user.id, name: user.name }, id));
    return this.roles(t);
  }

  async roles(t: TenantCtx): Promise<RoleRow[]> {
    const { rows } = await t.pool.query<{ id: string; key: string; name: string; description: string; permissions: string[]; locked: boolean; people: string }>(
      'select r.id, r.key, r.name, r.description, r.permissions, r.locked, (select count(*) from user_roles ur where ur.role_id = r.id) people from roles r order by r.locked desc, r.name');
    const known = new Set<string>(PERMISSIONS);
    return rows.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions.filter((p) => known.has(p)) as RoleRow['permissions'], locked: r.locked, people: Number(r.people) }));
  }
}
