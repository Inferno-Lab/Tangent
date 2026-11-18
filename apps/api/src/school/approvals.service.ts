import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Job } from '@tangent/db';
import { roundToCurrency, fmtNumber, initials, stepsFor, tx, WORKFLOW_PROCESSES, type ApprovalDecision, type ApprovalKind, type ApprovalRow, type Permission, type StepDef, type StepDone, type WorkflowsSetting } from '@tangent/contracts';
import { schoolContext } from '@tangent/tenancy';
import { ApiError, forbidden, notFound } from '@tangent/nest-kit';
import { TenantService, type TenantCtx } from '../tenancy/tenant.js';
import { HubService } from './hub.service.js';
import { AttendanceService } from './attendance.service.js';
import { NoticesService } from './notices.service.js';
import { AuditService, Messenger, SettingsService } from './support.js';

interface Row {
  id: string; kind: ApprovalKind; title: string; subtitle: string; requester_name: string; requested_by: string | null; subject_ref: string | null;
  payload: Record<string, unknown>; status: ApprovalRow['status']; created_at: Date; decided_at: Date | null; decision_note?: string; decided_by_name?: string | null;
  step: number; step_at: Date; steps_done: StepDone[]; escalated: boolean;
}
type Person = { id: string; name: string; permissions: readonly string[] };
/** Stands for the time limit when a step waiting too long is approved by itself. */
const SYSTEM = 'system';

const TONE: Record<ApprovalKind, ApprovalRow['tone']> = {
  leave: 'blue', fee_waiver: 'mint', attendance: 'amber', notice: 'violet', admission: 'coral', photo: 'violet', receipt_cancel: 'coral', settings: 'amber',
  staff_leave: 'blue', gate_pass: 'amber', certificate: 'mint', visitor: 'violet',
};
const ACTION: Record<ApprovalKind, string> = {
  leave: 'Review', fee_waiver: 'Approve', attendance: 'Remind', notice: 'Publish', admission: 'Approve', photo: 'Use photo', receipt_cancel: 'Cancel receipt', settings: 'Apply',
  staff_leave: 'Review', gate_pass: 'Review', certificate: 'Issue', visitor: 'Review',
};
/** The module each kind belongs to (a school without it has none of them); null: every school. */
const KIND_NEEDS: Record<ApprovalKind, string | null> = {
  leave: null, fee_waiver: 'fees', notice: 'notices', admission: 'people.admissions', attendance: 'attendance', photo: null, receipt_cancel: 'fees', settings: null,
  staff_leave: 'staffAttendance', gate_pass: 'visitors', certificate: 'certificates', visitor: 'visitors',
};
/** What a person needs to be allowed to decide each kind. */
const NEEDS: Record<ApprovalKind, Permission[]> = {
  leave: ['approvals.decide'], fee_waiver: ['approvals.decide', 'fees.waive'], notice: ['approvals.decide', 'notices.publish'], admission: ['approvals.decide'], attendance: ['attendance.read'],
  photo: ['approvals.decide', 'students.write'], receipt_cancel: ['approvals.decide', 'fees.refund'], settings: ['approvals.decide', 'settings.manage'],
  staff_leave: ['approvals.decide'], gate_pass: ['approvals.decide'], certificate: ['approvals.decide', 'certificates.issue'], visitor: ['approvals.decide'],
};
type Client = { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
/**
 * What a module does when one of its requests is decided: `check` before anything is saved (it may refuse, like a certificate
 * while fees are owed), `apply` inside the decision's transaction, `tell` after it (messages), and `done` the line shown.
 */
export interface ApprovalEffect {
  check?: (t: TenantCtx, r: { id: string; subject_ref: string | null; payload: Record<string, unknown> }, decision: ApprovalDecision['decision']) => Promise<void>;
  apply?: (client: Client, r: { id: string; subject_ref: string | null; payload: Record<string, unknown> }, decision: ApprovalDecision['decision'], by: { id: string; name: string }, t: TenantCtx) => Promise<void>;
  tell?: (t: TenantCtx, r: { id: string; subject_ref: string | null; payload: Record<string, unknown> }, status: string) => Promise<void>;
  done: string;
}

@Injectable()
export class ApprovalsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly settings: SettingsService,
    private readonly attendance: AttendanceService,
    private readonly notices: NoticesService,
    private readonly hubs: HubService,
    private readonly tenants: TenantService,
  ) {}

  private readonly effects = new Map<ApprovalKind, ApprovalEffect>();
  /** A module says what its kind of request does when decided (each module's service registers its own). */
  effect(kind: ApprovalKind, e: ApprovalEffect): void {
    this.effects.set(kind, e);
  }

  onModuleInit(): void {
    this.hubs.handle('approvals.timeLimits', async (job: Job) => {
      const s = await this.hubs.schoolPool(job.schoolId ?? '');
      return s ? this.timeLimits(await this.tenants.resolve(s.slug)) : 'School not found.';
    });
  }

  private toRow(r: Row, doneText: string, steps: StepDef[]): ApprovalRow {
    const lang = schoolContext.getStore()?.lang ?? 'en';
    const cur = steps[Math.min(r.step, steps.length - 1)]!;
    return {
      step: { name: cur.names?.[lang] || tx(cur.name), at: Math.min(r.step, steps.length - 1) + 1, of: steps.length, done: r.steps_done ?? [] },
      id: r.id, kind: r.kind, title: r.title, subtitle: r.subtitle, initials: initials(r.requester_name), tone: TONE[r.kind], action: ACTION[r.kind], doneText,
      status: r.status, createdAt: r.created_at.toISOString(), decidedAt: r.decided_at?.toISOString() ?? null,
      requesterName: r.requester_name, decidedByName: r.decided_by_name ?? null, decisionNote: r.decision_note ?? '',
    };
  }

  private async doneText(t: TenantCtx, r: Row): Promise<string> {
    if (r.kind === 'leave') return 'Leave request reviewed';
    if (r.kind === 'fee_waiver') return (r.payload as { cancel?: boolean }).cancel ? 'Invoice cancelled' : 'Waiver approved';
    if (r.kind === 'receipt_cancel') return 'Receipt cancelled';
    if (r.kind === 'admission') return 'Admission approved';
    if (r.kind === 'photo') return 'New photo in use';
    if (r.kind === 'settings') return 'Setting changed';
    const own = this.effects.get(r.kind);
    if (own) return own.done;
    const noticeId = (r.payload as { noticeId?: string }).noticeId;
    const n = noticeId ? await t.pool.query<{ n: string }>(
      `select count(distinct sg.guardian_id) n from notices x left join students s on x.class_id is null or s.class_id = x.class_id
       join student_guardians sg on sg.student_id = s.id where x.id = $1`, [noticeId]) : null;
    return `Notice sent to ${fmtNumber(Number(n?.rows[0]?.n ?? 0))} families`;
  }

  private flow(t: TenantCtx): Promise<WorkflowsSetting> {
    return this.settings.value<WorkflowsSetting>(t, 'workflows.steps', {});
  }

  /** A request's steps: the school's for its kind (the ones its amount calls for), else the one every school starts with. */
  private stepsOf(flow: WorkflowsSetting, r: Row): StepDef[] {
    const amount = (r.payload as { amount?: unknown }).amount;
    return stepsFor(flow, r.kind, typeof amount === 'number' ? amount : undefined);
  }

  /** Whether this person takes the request's step now: whoever the step names, or (once it waited past its days) anyone allowed. */
  private async takes(t: TenantCtx, user: Person, r: Row, flow: WorkflowsSetting, roles: () => Promise<string[]>): Promise<boolean> {
    const steps = this.stepsOf(flow, r);
    const s = steps[Math.min(r.step, steps.length - 1)]!;
    const allowed = NEEDS[r.kind].every((p) => user.permissions.includes(p));
    if (r.escalated && allowed) return true;
    if (s.who === 'role') return (await roles()).includes(s.ref ?? '');
    if (s.who === 'person') return user.id === s.ref;
    // A child's class teacher decides their leave where the school keeps the one step every school starts with.
    if (s.who === 'permission' && ((r.kind === 'leave' && (r.payload as { studentLeave?: boolean }).studentLeave) || r.kind === 'gate_pass') && r.subject_ref
      && (await t.pool.query('select 1 from students s join classes c on c.id = s.class_id where s.id = $1 and c.class_teacher_id = $2', [r.subject_ref, user.id])).rowCount) return true;
    if (s.who === 'classTeacher') {
      return !!r.subject_ref && !!(await t.pool.query('select 1 from students s join classes c on c.id = s.class_id where s.id = $1 and c.class_teacher_id = $2', [r.subject_ref, user.id])).rowCount;
    }
    // The line manager of whoever asked; someone with no manager goes to anyone allowed to decide it.
    if (s.who === 'lineManager') {
      const manager = await this.managerOf(t, r);
      return manager ? manager === user.id : allowed;
    }
    return allowed;
  }

  private async managerOf(t: TenantCtx, r: Row): Promise<string | null> {
    // Who asked; a member of staff's own leave from before requests named their asker is about them.
    const asker = r.requested_by || (r.kind === 'staff_leave' ? r.subject_ref : null);
    if (!asker) return null;
    return (await t.pool.query<{ manager_id: string | null }>("select s.manager_id from staff s join users u on u.id = s.manager_id and u.status = 'active' where s.user_id = $1", [asker])).rows[0]?.manager_id ?? null;
  }

  private rolesOf(t: TenantCtx, userId: string): () => Promise<string[]> {
    let got: Promise<string[]> | null = null;
    return () => (got ??= t.pool.query<{ key: string }>('select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1', [userId]).then((x) => x.rows.map((y) => y.key)));
  }

  /** The open requests whose step this person takes now (of the kinds the school has). */
  private async waitingFor(t: TenantCtx, user: Person, extra = ''): Promise<Row[]> {
    const [flow, kinds] = await Promise.all([this.flow(t), this.kinds(t)]);
    const { rows } = await t.pool.query<Row>(`select a.*, (select name from users u where u.id = a.decided_by) decided_by_name from approvals a where a.status = 'pending' and a.kind = any($1) ${extra} order by a.created_at, a.id limit 500`, [kinds]);
    const roles = this.rolesOf(t, user.id);
    const out: Row[] = [];
    for (const r of rows) if (r.kind !== 'attendance' && (await this.takes(t, user, r, flow, roles))) out.push(r);
    return out;
  }

  /** The queue behind "Needs you": open requests, plus one line for classes that have not marked attendance. */
/** Request kinds the school has: a fee waiver needs Fees, a notice Notices, an admission the Admissions feature. Leave is always there. */
  async kinds(t: TenantCtx): Promise<ApprovalKind[]> {
    const cfg = await this.settings.effective(t);
    const has = (k: string) => cfg.modules.includes(k) || cfg.features.includes(k);
    return (Object.entries(KIND_NEEDS) as [ApprovalKind, string | null][]).filter(([, need]) => !need || has(need)).map(([k]) => k);
  }

  /** The kinds this person may act on: a module the school has, and the permissions to decide it (a teacher sees no fee waivers). */
  private async mine(t: TenantCtx, perms: readonly string[]): Promise<ApprovalKind[]> {
    return (await this.kinds(t)).filter((k) => NEEDS[k].every((p) => perms.includes(p)));
  }

  async needsYou(t: TenantCtx, user: Person): Promise<ApprovalRow[]> {
    const kinds = await this.mine(t, user.permissions);
    const order = { leave: 1, fee_waiver: 2, notice: 3 } as Record<string, number>;
    const rows = (await this.waitingFor(t, user, "and a.kind in ('leave','fee_waiver','notice')")).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9)).slice(0, 8);
    const flow = await this.flow(t);
    const items = await Promise.all(rows.map(async (r) => this.toRow(r, await this.doneText(t, r), this.stepsOf(flow, r))));
    const unmarked = kinds.includes('attendance') ? await this.attendance.unmarked(t) : [];
    if (unmarked.length) {
      items.splice(2, 0, {
        id: 'att_reminder', kind: 'attendance', title: `${unmarked.length} ${unmarked.length === 1 ? 'class has' : 'classes have'} not marked`, subtitle: unmarked.map((c) => c.name).join(' · '),
        initials: 'AT', tone: 'amber', action: 'Remind', doneText: `Reminder sent to ${unmarked.length} teachers`, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null,
      });
    }
    return items;
  }

  /**
   * The Approvals page: what waits for this person (kinds they may decide), what they sent (a teacher's notice, an office
   * waiver), and what has been decided, with who decided and why.
   */
  async list(t: TenantCtx, user: Person, view: 'waiting' | 'sent' | 'decided' = 'waiting', kind?: ApprovalKind): Promise<ApprovalRow[]> {
    const flow = await this.flow(t);
    if (view === 'waiting') {
      const rows = (await this.waitingFor(t, user)).filter((r) => !kind || r.kind === kind).reverse().slice(0, 200);
      return Promise.all(rows.map(async (r) => this.toRow(r, await this.doneText(t, r), this.stepsOf(flow, r))));
    }
    const mine = await this.mine(t, user.permissions);
    const where = view === 'sent' ? 'a.requested_by = $4' : "a.status <> 'pending' and a.kind = any($3)";
    const { rows } = await t.pool.query<Row>(
      `select a.*, (select name from users u where u.id = a.decided_by) decided_by_name from approvals a
       where ${where} and ($2::text is null or a.kind = $2) and a.kind = any($1) and $3::text[] is not null and $4::text is not null order by coalesce(a.decided_at, a.created_at) desc, a.id limit 200`,
      [await this.kinds(t), kind ?? null, mine, user.id]);
    return Promise.all(rows.map(async (r) => this.toRow(r, await this.doneText(t, r), this.stepsOf(flow, r))));
  }

  async counts(t: TenantCtx, user: Person): Promise<{ admissions: number; approvals: number; messages: number }> {
    const perms = user.permissions;
    const [cfg, kinds] = await Promise.all([this.settings.effective(t), this.mine(t, perms)]);
    const { rows } = await t.pool.query<{ admissions: string; approvals: string; messages: string }>(
      "select (select count(*) from enquiries where stage in ('applied','test','offer')) admissions, (select count(*) from approvals where status = 'pending' and kind = any($1)) approvals, (select count(distinct m.thread_id) from thread_messages m join threads x on x.id = m.thread_id where x.status = 'open' and m.from_kind = 'guardian' and m.read_at is null) messages", [kinds]);
    // A badge for a module the school does not have would point at a page it cannot open.
    return {
      admissions: cfg.features.includes('people.admissions') && perms.includes('admissions.read') ? Number(rows[0]!.admissions) : 0,
      approvals: (await this.waitingFor(t, user)).length,
      messages: cfg.modules.includes('chat') && perms.includes('messages.read') ? Number(rows[0]!.messages) : 0,
    };
  }

  async decide(t: TenantCtx, user: Person, id: string, body: ApprovalDecision): Promise<ApprovalRow> {
    const { rows } = await t.pool.query<Row>('select * from approvals where id = $1', [id]);
    const r = rows[0];
    if (!r) throw notFound('That request');
    const flow = await this.flow(t);
    const steps = this.stepsOf(flow, r);
    const step = steps[Math.min(r.step, steps.length - 1)]!;
    const system = user.id === SYSTEM;
    // Undo is for whoever may decide the kind; a step for whoever the school's steps name.
    const may = system || (body.decision === 'undo' ? NEEDS[r.kind].every((p) => user.permissions.includes(p)) : await this.takes(t, user, r, flow, this.rolesOf(t, user.id)));
    if (!may) throw forbidden(r.status === 'pending' && steps.length > 1 ? tx('This step is for someone else: {step}.', { step: step.name }) : 'You are not allowed to decide this kind of request.');
    // A second person decides: never the one who asked, and each step someone who has not taken one before.
    if (r.requested_by === user.id && r.kind !== 'attendance') throw forbidden('Someone else decides a request you made.');
    if (body.decision === 'undo' ? r.status === 'pending' : r.status !== 'pending') throw new ApiError('conflict', body.decision === 'undo' ? 'That request is still open.' : 'Someone has already decided this request.');
    if (body.decision !== 'undo' && (r.steps_done ?? []).some((d) => (d as StepDone & { byId?: string }).byId === user.id)) throw forbidden('You took an earlier step: someone else takes this one.');
    const done = [...(r.steps_done ?? []), { key: step.key, name: step.name, by: user.name, byId: user.id, at: new Date().toISOString(), note: body.note ?? '', decision: body.decision }];
    // An approval with steps still to come moves to the next step; only the last one acts.
    if (body.decision === 'approve' && r.step + 1 < steps.length) {
      const moved = await t.pool.query("update approvals set step = step + 1, step_at = now(), escalated = false, steps_done = $2 where id = $1 and status = 'pending' and step = $3", [id, JSON.stringify(done), r.step]);
      if (!moved.rowCount) throw new ApiError('conflict', 'Someone has already decided this request.');
      await this.audit.record(t, { actorId: system ? null : user.id, actorName: user.name, action: 'approval.step', entity: r.kind, entityId: id, detail: { title: r.title, step: step.name } });
      const after = (await t.pool.query<Row>('select * from approvals where id = $1', [id])).rows[0]!;
      return this.toRow(after, await this.doneText(t, after), steps);
    }
    const next = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'pending';
    if (r.kind === 'settings' && body.decision === 'undo') throw new ApiError('conflict', 'A setting that was changed is changed back from Settings.');
    // A settings change applies first: if the settings moved on since it was asked for, nothing is marked decided.
    if (r.kind === 'settings' && body.decision === 'approve') {
      const p = r.payload as { changes: Record<string, unknown>; note?: string; expectedVersion?: number };
      await this.settings.apply(t, { id: r.requested_by ?? user.id, name: `${r.requester_name}, approved by ${user.name}` }, p.changes, p.note ?? '', p.expectedVersion);
    }
    const effect = this.effects.get(r.kind);
    if (effect?.check) await effect.check(t, r, body.decision);
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      let payload = r.payload;
      if (effect?.apply) await effect.apply(client as unknown as Client, r, body.decision, { id: system ? '' : user.id, name: user.name }, t);
      if (r.kind === 'fee_waiver') payload = await this.applyWaiver(client, r, body.decision, payload);
      if (r.kind === 'notice') await this.applyNotice(client, r, body.decision, user.id);
      if (r.kind === 'photo') await this.applyPhoto(client, r, body.decision);
      if (r.kind === 'receipt_cancel') await this.applyReceiptCancel(client, r, body.decision);
      await client.query('update approvals set status = $2, decided_by = $3, decided_at = $4, payload = $5, decision_note = $6, step = $7, steps_done = $8, escalated = false, step_at = now() where id = $1',
        [id, next, body.decision === 'undo' || system ? null : user.id, body.decision === 'undo' ? null : new Date(), JSON.stringify(payload), body.decision === 'undo' ? '' : body.note ?? '',
          body.decision === 'undo' ? 0 : r.step, JSON.stringify(body.decision === 'undo' ? [] : done)]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: system ? null : user.id, actorName: user.name, action: `approval.${body.decision}`, entity: r.kind, entityId: id, detail: { title: r.title } });
    if (body.decision !== 'undo' && r.kind === 'leave') await this.tellLeave(t, r, next);
    if (body.decision === 'approve' && r.kind === 'notice') await this.notices.approved(t, String((r.payload as { noticeId?: string }).noticeId ?? ''));
    if (body.decision !== 'undo' && effect?.tell) await effect.tell(t, r, next).catch(() => undefined);
    const after = await t.pool.query<Row>('select * from approvals where id = $1', [id]);
    return this.toRow(after.rows[0]!, await this.doneText(t, after.rows[0]!), steps);
  }

  /**
   * Steps that waited past their days (run each morning per school): remind whoever takes them, let anyone allowed take them,
   * or approve them, as the school's steps say. A reminder goes once a day until someone acts.
   */
  async timeLimits(t: TenantCtx): Promise<string> {
    const flow = await this.flow(t);
    const { rows } = await t.pool.query<Row>("select * from approvals where status = 'pending' and kind = any($1)", [[...WORKFLOW_PROCESSES]]);
    let reminded = 0, escalated = 0, approved = 0;
    for (const r of rows) {
      const steps = this.stepsOf(flow, r);
      const s = steps[Math.min(r.step, steps.length - 1)]!;
      if (!s.days || Date.now() - r.step_at.getTime() < s.days * 86_400_000) continue;
      if (s.then === 'approve') {
        await this.decide(t, { id: SYSTEM, name: tx('Time limit'), permissions: [] }, r.id, { decision: 'approve', note: tx('Approved after {days} days without an answer.', { days: s.days }) });
        approved++;
        continue;
      }
      if (s.then === 'escalate' && !r.escalated) {
        await t.pool.query('update approvals set escalated = true where id = $1', [r.id]);
        escalated++;
      }
      const to = await this.takers(t, r, s, r.escalated || s.then === 'escalate');
      await this.messenger.notify(t, 'approval.waiting', to.map((p) => ({ to: p.phone ?? '', email: p.email, vars: { name: p.name.split(' ')[0]!, title: r.title, days: String(s.days) } })));
      reminded += to.length;
    }
    return `${reminded} reminded, ${escalated} escalated, ${approved} approved`;
  }

  /** The people who take a step (or, escalated, everyone allowed to decide the kind). */
  private async takers(t: TenantCtx, r: Row, s: StepDef, anyAllowed: boolean): Promise<{ name: string; phone: string | null; email: string | null }[]> {
    const base = "select distinct u.name, u.phone, u.email from users u where u.status = 'active' and u.kind = 'staff'";
    const manager = s.who === 'lineManager' && !anyAllowed ? await this.managerOf(t, r) : null;
    if (manager) return (await t.pool.query(`${base} and u.id = $1`, [manager])).rows;
    if (anyAllowed || s.who === 'permission' || s.who === 'lineManager') {
      return (await t.pool.query(`${base} and exists (select 1 from user_roles ur join roles ro on ro.id = ur.role_id where ur.user_id = u.id and ro.permissions @> $1::jsonb)`, [JSON.stringify(NEEDS[r.kind])])).rows;
    }
    if (s.who === 'role') return (await t.pool.query(`${base} and exists (select 1 from user_roles ur join roles ro on ro.id = ur.role_id where ur.user_id = u.id and ro.key = $1)`, [s.ref])).rows;
    if (s.who === 'person') return (await t.pool.query(`${base} and u.id = $1`, [s.ref])).rows;
    return (await t.pool.query(`${base} and u.id = (select c.class_teacher_id from students st join classes c on c.id = st.class_id where st.id = $1)`, [r.subject_ref])).rows;
  }

  /** A concession takes a percentage off the student's first unpaid invoice of a head that takes concessions (tuition by default); undo puts it back. */
  private async applyWaiver(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, r: Row, decision: ApprovalDecision['decision'], payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    // A request from an invoice names it and the amount; older ones (from before) take a percentage off the first unpaid fee.
    if (decision === 'approve' && payload.invoiceId && payload.amount) {
      const inv = (await client.query('select amount, waived_amount from fee_invoices where id = $1', [payload.invoiceId])).rows[0] as { amount: number; waived_amount: number } | undefined;
      if (!inv) throw new ApiError('conflict', 'That invoice no longer exists.');
      const paid = Number(((await client.query('select coalesce(sum(amount - refunded),0) p from payments where invoice_id = $1', [payload.invoiceId])).rows[0] as { p: string }).p);
      const waived = Math.min(inv.amount - paid, inv.waived_amount + Number(payload.amount));
      if (waived <= inv.waived_amount) throw new ApiError('conflict', 'Nothing is left to waive on this invoice.');
      await client.query('update fee_invoices set waived_amount = $2 where id = $1', [payload.invoiceId, waived]);
      return { ...payload, before: inv.waived_amount, waived };
    }
    if (decision === 'undo' && payload.invoiceId && payload.before !== undefined) {
      await client.query('update fee_invoices set waived_amount = $2 where id = $1', [payload.invoiceId, payload.before]);
      const { before: _b, waived: _w, ...rest } = payload;
      return rest;
    }
    if (decision === 'approve') {
      const pct = Number(payload.percent ?? 0);
      const inv = await client.query(
        `select i.id, i.amount from fee_invoices i where i.student_id = $1 and i.head in (select key from fee_heads where concession) and i.amount > coalesce((select sum(amount - refunded) from payments where invoice_id = i.id),0) order by i.due_on limit 1`, [r.subject_ref]);
      const target = inv.rows[0] as { id: string; amount: number } | undefined;
      if (!target) throw new ApiError('conflict', 'This student has no unpaid fee that takes concessions to reduce.');
      const waived = roundToCurrency((target.amount * pct) / 100);
      await client.query('update fee_invoices set waived_amount = $2 where id = $1', [target.id, waived]);
      return { ...payload, invoiceId: target.id, waived };
    }
    if (decision === 'undo' || decision === 'reject') {
      if (payload.invoiceId) await client.query('update fee_invoices set waived_amount = 0 where id = $1', [payload.invoiceId]);
      const { invoiceId: _i, waived: _w, ...rest } = payload;
      return rest;
    }
    return payload;
  }

  /** Cancels a desk receipt: its money leaves the totals (as refunded), and the receipt stays, marked cancelled with why. */
  private async applyReceiptCancel(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, r: Row, decision: ApprovalDecision['decision']): Promise<void> {
    const p = r.payload as { paymentId?: string; reason?: string };
    if (decision === 'approve') await client.query("update payments set refunded = amount, cancelled_at = now(), cancel_reason = $2 where id = $1 and cancelled_at is null", [p.paymentId, p.reason ?? '']);
    if (decision === 'undo') await client.query("update payments set refunded = 0, cancelled_at = null, cancel_reason = '' where id = $1", [p.paymentId]);
  }

  private async applyNotice(client: { query: (q: string, p?: unknown[]) => Promise<unknown> }, r: Row, decision: ApprovalDecision['decision'], userId: string): Promise<void> {
    const noticeId = (r.payload as { noticeId?: string }).noticeId;
    if (!noticeId) return;
    // Approval publishes after the decision is saved (now, or at its scheduled time); a decline sends it back to its author as a draft.
    if (decision !== 'approve') await client.query("update notices set status = $2, published_at = null where id = $1", [noticeId, decision === 'undo' ? 'pending' : 'draft']);
    else await client.query("update notices set status = 'draft' where id = $1 and status = 'pending'", [noticeId]);
    void userId;
  }

  /** A family's new photo of their child becomes the child's photo (the old one goes); declined, it is deleted. */
  private async applyPhoto(client: { query: (q: string, p?: unknown[]) => Promise<unknown> }, r: Row, decision: ApprovalDecision['decision']): Promise<void> {
    const p = r.payload as { fileId?: string; studentId?: string };
    if (!p.fileId || !p.studentId) return;
    if (decision === 'approve') {
      await client.query("update files set deleted_at = now() where kind = 'student_photo' and owner_id = $1 and id <> $2 and deleted_at is null", [p.studentId, p.fileId]);
      await client.query('update files set owner_id = $1 where id = $2', [p.studentId, p.fileId]);
    } else if (decision === 'reject') await client.query('update files set deleted_at = now() where id = $1', [p.fileId]);
  }

  /** Tells whoever asked: the family for a child's leave, the staff member for their own. */
  async tellLeave(t: TenantCtx, r: { subject_ref: string | null; payload: Record<string, unknown> }, status: string): Promise<void> {
    if (!r.subject_ref) return;
    const p = r.payload as { studentLeave?: boolean; from?: string; to?: string };
    const who = p.studentLeave
      ? await t.pool.query<{ phone: string | null; email: string | null; name: string }>(
        'select g.phone, g.email, s.name from students s join student_guardians sg on sg.student_id = s.id and sg.gets_messages join guardians g on g.id = sg.guardian_id where s.id = $1', [r.subject_ref])
      : await t.pool.query<{ phone: string | null; email: string | null; name: string }>("select phone, email, 'you' as name from users where id = $1", [r.subject_ref]);
    await this.messenger.notify(t, 'leave.decided', who.rows.filter((w) => w.phone || w.email).map((w) => ({
      to: w.phone ?? '', email: w.email, vars: { who: w.name, from: p.from ?? '', to: p.to ?? '', status },
    })));
  }

}
