import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, Query, Res, type OnModuleInit } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { randomInt } from 'node:crypto';
import {
  DEFAULT_ATTENDANCE_MARKS, DEFAULT_ID_TYPES, DEFAULT_STAFF_MARKS, DEFAULT_VISITOR_PURPOSES, GatePassInput, LateInput, PickupCheck, PickupInput, PickupRecord, VisitorInput, addDays, fmtDate,
  listLabel, listOptions, schoolToday, tx, type AttendanceMarkDef, type GatePassRow, type ListItem, type PickupPerson, type RollCall, type VisitorRow,
} from '@tangent/contracts';
import { newId, nextNumber } from '@tangent/db';
import { ApiError, ZodPipe, forbidden, notFound } from '@tangent/nest-kit';
import { CurrentUser, Require, RequireModule } from '../auth/guards.js';
import { Tenant, type AuthedUser, type TenantCtx } from '../tenancy/tenant.js';
import { ApprovalsService } from './approvals.service.js';
import { DocumentsService } from './documents.service.js';
import { FamilyService } from './family.service.js';
import { FilesService } from './files.service.js';
import { pdf, sendPdf, type PdfLine } from './pdf.js';
import { AuditService, Messenger, SettingsService } from './support.js';

type User = { id: string; name: string; perms?: readonly string[] };
type VRaw = { id: string; name: string; phone: string; purpose: string; host_id: string | null; host_name: string | null; id_type: string; id_number: string; photo_file_id: string | null;
  vehicle: string; note: string; custom: Record<string, unknown>; badge_no: string | null; code: string | null; state: VisitorRow['state']; expected_on: string | null; in_at: Date | null;
  out_at: Date | null; created_by_name: string };
type GRaw = { id: string; number: string | null; student_id: string; student_name: string; class_name: string; leave_at: Date; reason: string; collector: string; pickup_id: string | null;
  returns: boolean; state: GatePassRow['state']; requested_by_name: string; out_at: Date | null; created_at: Date; approval_id: string | null };
const VSEL = 'select v.*, v.expected_on::text expected_on, h.name host_name from visitors v left join users h on h.id = v.host_id';
const GSEL = 'select g.*, s.name student_name, c.name class_name from gate_passes g join students s on s.id = g.student_id join classes c on c.id = s.class_id';
const STAFF = "select id, name from users where kind = 'staff' and status = 'active'";
const FAMILY_OF = `select distinct g.phone, g.email from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = $1 and sg.gets_messages`;
const code = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/**
 * Visitors, gate passes and pick-up (one-shot plan 6.23). Leaving early always goes through the school's steps (`gate_pass`):
 * the family asks, or the school asks and the family agrees first. At the gate, a child goes only with an approved pass, or
 * with someone the family named or who has the family's code for the day.
 */
@Injectable()
export class VisitorsService implements OnModuleInit {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly approvals: ApprovalsService,
    private readonly documents: DocumentsService,
    private readonly files: FilesService,
  ) {}

  onModuleInit(): void {
    this.approvals.effect('gate_pass', {
      done: tx('Gate pass answered'),
      apply: async (client, r, decision, _by, t) => {
        const id = String(r.payload.passId ?? '');
        if (decision === 'approve') {
          const pattern = await this.settings.value<string>(t, 'visitors.gatePassNumber', 'GP-{yyyy}-{seq:4}');
          const number = await nextNumber(client as never, { pattern, start: 1, day: schoolToday(), table: 'gate_passes', column: 'number' });
          await client.query("update gate_passes set state = 'approved', number = coalesce(number, $2) where id = $1 and state = 'pending'", [id, number]);
        } else if (decision === 'reject') await client.query("update gate_passes set state = 'rejected' where id = $1 and state = 'pending'", [id]);
        else await client.query("update gate_passes set state = 'pending' where id = $1 and state in ('approved','rejected')", [id]);
      },
      tell: async (t, r, status) => {
        const g = await this.pass(t, String(r.payload.passId ?? '')).catch(() => null);
        if (!g) return;
        const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(FAMILY_OF, [g.studentId])).rows;
        await this.messenger.notify(t, 'gatepass.decided', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { student: g.studentName, time: fmtDate(g.leaveAt, 'time'), status: tx(status) } })));
      },
    });
    this.approvals.effect('visitor', {
      done: tx('Visitor answered'),
      apply: async (client, r, decision) => {
        const next = decision === 'approve' ? 'invited' : decision === 'reject' ? 'declined' : 'pending';
        await client.query("update visitors set state = $2 where id = $1 and state in ('pending','invited','declined')", [r.subject_ref, next]);
      },
      tell: async (t, r, status) => { if (status === 'approved' && r.subject_ref) await this.sendPass(t, r.subject_ref); },
    });
  }

  private list(t: TenantCtx, key: string, fallback: ListItem[]): Promise<ListItem[]> {
    return this.settings.value<ListItem[]>(t, key, fallback);
  }

  // ── Visitors ────────────────────────────────────────────────────────────────

  private async vrow(t: TenantCtx, r: VRaw): Promise<VisitorRow> {
    const purposes = await this.list(t, 'visitors.purposes', DEFAULT_VISITOR_PURPOSES);
    return {
      id: r.id, name: r.name, phone: r.phone, purpose: r.purpose, purposeName: listLabel(purposes, r.purpose), hostId: r.host_id, hostName: r.host_name, idType: r.id_type, idNumber: r.id_number,
      photoFileId: r.photo_file_id, vehicle: r.vehicle, note: r.note, custom: r.custom, badgeNo: r.badge_no, code: r.code, state: r.state, expectedOn: r.expected_on,
      inAt: r.in_at?.toISOString() ?? null, outAt: r.out_at?.toISOString() ?? null, createdBy: r.created_by_name,
    };
  }

  private async visitor(t: TenantCtx, id: string): Promise<VRaw> {
    const r = (await t.pool.query<VRaw>(`${VSEL} where v.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That visitor'));
    return r;
  }

  async visitors(t: TenantCtx, view: string, q = ''): Promise<VisitorRow[]> {
    const today = schoolToday();
    const where = view === 'expected' ? "v.state in ('invited','pending') and (v.expected_on is null or v.expected_on >= $1)"
      : view === 'history' ? "v.state in ('out','cancelled','declined') or (v.state in ('invited','pending') and v.expected_on < $1)"
        : "(v.state = 'in' or (v.state = 'out' and (v.out_at at time zone 'UTC')::date >= ($1::date - 1)))";
    const { rows } = await t.pool.query<VRaw>(`${VSEL} where (${where}) and ($2 = '' or v.name ilike '%' || $2 || '%' or v.phone like '%' || $2 || '%' or v.badge_no ilike '%' || $2 || '%')
      order by coalesce(v.in_at, v.created_at) desc limit 300`, [today, q.trim().slice(0, 60)]);
    return Promise.all(rows.map((r) => this.vrow(t, r)));
  }

  private async checkVisitor(t: TenantCtx, b: VisitorInput): Promise<VisitorInput & { phone: string }> {
    if (!listOptions(await this.list(t, 'visitors.purposes', DEFAULT_VISITOR_PURPOSES)).some((p) => p.key === b.purpose)) {
      throw new ApiError('validation', tx('Choose why they came.'), { fields: { purpose: tx('Choose one of the reasons.') } });
    }
    if (b.idType && !listOptions(await this.list(t, 'visitors.idTypes', DEFAULT_ID_TYPES)).some((p) => p.key === b.idType)) {
      throw new ApiError('validation', tx('Choose one of the documents the desk accepts.'), { fields: { idType: tx('Choose a document.') } });
    }
    if (b.hostId && !(await t.pool.query(`${STAFF} and id = $1`, [b.hostId])).rowCount) throw new ApiError('validation', tx('Choose a member of staff to see.'), { fields: { hostId: tx('Choose someone.') } });
    if (b.photoFileId && !(await t.pool.query("select 1 from files where id = $1 and kind = 'visitor_photo' and deleted_at is null", [b.photoFileId])).rowCount) {
      throw new ApiError('validation', tx('The photo is missing. Take it again.'), { fields: { photoFileId: tx('Take the photo again.') } });
    }
    if (b.expectedOn && (b.expectedOn < schoolToday() || b.expectedOn > addDays(schoolToday(), 90))) throw new ApiError('validation', tx('Invite them for a day in the next three months.'), { fields: { expectedOn: tx('Pick a nearer day.') } });
    const custom = await this.settings.custom(t, 'visitor', b.custom, true);
    return { ...b, custom, phone: b.phone ? this.settings.phone(t, b.phone) : '' };
  }

  private async badge(t: TenantCtx, q: { query: TenantCtx['pool']['query'] }): Promise<string> {
    const pattern = await this.settings.value<string>(t, 'visitors.badgeNumber', 'VIS-{yyyy}-{seq:4}');
    return nextNumber(q as never, { pattern, start: 1, day: schoolToday(), table: 'visitors', column: 'badge_no' });
  }

  /** Signs someone in now at the desk (with a badge number, and their host told), or invites them for a day (a pass code). */
  async add(t: TenantCtx, by: User, b: VisitorInput, from: 'desk' | 'staff'): Promise<VisitorRow> {
    const v = await this.checkVisitor(t, from === 'staff' ? { ...b, hostId: by.id } : b);
    if (from === 'staff' && !v.expectedOn) throw new ApiError('validation', tx('Pick the day they come.'), { fields: { expectedOn: tx('Pick a day.') } });
    const id = newId('vis');
    const desk = from === 'desk' && !v.expectedOn;
    const approve = !desk && (await this.settings.value<boolean>(t, 'visitors.invitesNeedApproval', false)) && !by.perms?.includes('visitors.manage');
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      const badge = desk ? await this.badge(t, client) : null;
      // A pass code is unique among visitors; the rare clash takes another.
      let pass: string | null = null;
      if (!desk) for (let i = 0; i < 5 && !pass; i++) { const c = code(); if (!(await client.query('select 1 from visitors where code = $1', [c])).rowCount) pass = c; }
      await client.query(
        `insert into visitors (id, name, phone, purpose, host_id, id_type, id_number, photo_file_id, vehicle, note, custom, badge_no, code, state, expected_on, in_at, created_by, created_by_name)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [id, v.name, v.phone, v.purpose, v.hostId, v.idType, v.idNumber, v.photoFileId, v.vehicle, v.note, JSON.stringify(v.custom), badge, pass, desk ? 'in' : approve ? 'pending' : 'invited',
          v.expectedOn, desk ? new Date() : null, by.id, by.name]);
      if (approve) {
        await client.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'visitor',$2,$3,$4,$5,$6,$7)",
          [newId('apr'), tx('Visitor: {name}', { name: v.name }), `${fmtDate(v.expectedOn!)} · ${tx('invited by {name}', { name: by.name })}`, by.name, by.id, id, JSON.stringify({ expectedOn: v.expectedOn })]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: desk ? 'visitor.in' : 'visitor.invited', entity: 'visitor', entityId: id, detail: { name: v.name } });
    if (desk) await this.tellHost(t, id);
    else if (!approve) await this.sendPass(t, id);
    return this.vrow(t, await this.visitor(t, id));
  }

  async save(t: TenantCtx, by: User, id: string, b: VisitorInput): Promise<VisitorRow> {
    const was = await this.visitor(t, id);
    if (was.state === 'out' || was.state === 'cancelled' || was.state === 'declined') throw new ApiError('conflict', tx('This visit is over: it stays as it was.'));
    const v = await this.checkVisitor(t, { ...b, expectedOn: was.state === 'in' ? null : b.expectedOn });
    await t.pool.query('update visitors set name=$2, phone=$3, purpose=$4, host_id=$5, id_type=$6, id_number=$7, photo_file_id=$8, vehicle=$9, note=$10, custom=$11, expected_on=coalesce($12, expected_on) where id=$1',
      [id, v.name, v.phone, v.purpose, v.hostId, v.idType, v.idNumber, v.photoFileId, v.vehicle, v.note, JSON.stringify(v.custom), v.expectedOn]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'visitor.changed', entity: 'visitor', entityId: id, detail: { name: v.name } });
    return this.vrow(t, await this.visitor(t, id));
  }

  /** An invited visitor arrives: their code (typed or scanned) finds them. */
  async byCode(t: TenantCtx, c: string): Promise<VisitorRow> {
    const r = (await t.pool.query<VRaw>(`${VSEL} where v.code = $1`, [c.trim()])).rows[0];
    if (!r) throw notFound(tx('No visitor has this code'));
    return this.vrow(t, r);
  }

  async signIn(t: TenantCtx, by: User, id: string): Promise<VisitorRow> {
    const v = await this.visitor(t, id);
    if (v.state === 'in') return this.vrow(t, v);
    if (v.state === 'pending') throw new ApiError('conflict', tx('This visit is still waiting for approval.'));
    if (v.state !== 'invited') throw new ApiError('conflict', tx('This invitation is no longer valid.'));
    if (v.expected_on && v.expected_on > schoolToday()) throw new ApiError('conflict', tx('They are expected on {day}.', { day: fmtDate(v.expected_on) }));
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      const badge = v.badge_no ?? await this.badge(t, client);
      await client.query("update visitors set state = 'in', in_at = now(), badge_no = $2 where id = $1 and state = 'invited'", [id, badge]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'visitor.in', entity: 'visitor', entityId: id, detail: { name: v.name } });
    await this.tellHost(t, id);
    return this.vrow(t, await this.visitor(t, id));
  }

  async signOut(t: TenantCtx, by: User, id: string): Promise<VisitorRow> {
    const v = await this.visitor(t, id);
    if (v.state !== 'in') throw new ApiError('conflict', tx('Only someone signed in can sign out.'));
    await t.pool.query("update visitors set state = 'out', out_at = now() where id = $1 and state = 'in'", [id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'visitor.out', entity: 'visitor', entityId: id, detail: { name: v.name } });
    return this.vrow(t, await this.visitor(t, id));
  }

  /** An invitation is called off by the desk or by whoever made it. */
  async cancelVisit(t: TenantCtx, by: User, id: string, desk: boolean): Promise<VisitorRow> {
    const v = await this.visitor(t, id);
    if (!desk && v.host_id !== by.id) throw notFound(tx('That visitor'));
    if (v.state !== 'invited' && v.state !== 'pending') throw new ApiError('conflict', tx('Only a visit still to come can be cancelled.'));
    await t.pool.query("update visitors set state = 'cancelled' where id = $1", [id]);
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2 where kind = 'visitor' and subject_ref = $1 and status = 'pending'", [id, by.id]);
    return this.vrow(t, await this.visitor(t, id));
  }

  async invitedBy(t: TenantCtx, userId: string): Promise<VisitorRow[]> {
    const { rows } = await t.pool.query<VRaw>(`${VSEL} where v.host_id = $1 and (v.expected_on is null or v.expected_on >= $2) and v.state <> 'out' order by v.expected_on, v.created_at desc limit 100`,
      [userId, addDays(schoolToday(), -7)]);
    return Promise.all(rows.map((r) => this.vrow(t, r)));
  }

  private async tellHost(t: TenantCtx, id: string): Promise<void> {
    const v = await this.vrow(t, await this.visitor(t, id));
    const h = v.hostId ? (await t.pool.query<{ phone: string | null; email: string | null }>('select phone, email from users where id = $1', [v.hostId])).rows[0] : null;
    if (h && (h.phone || h.email)) await this.messenger.notify(t, 'visitor.arrived', [{ to: h.phone ?? '', email: h.email, vars: { visitor: v.name, purpose: v.purposeName } }]);
  }

  private async sendPass(t: TenantCtx, id: string): Promise<void> {
    const v = await this.visitor(t, id);
    if (!v.phone || !v.code) return;
    await this.messenger.notify(t, 'visitor.pass', [{ to: v.phone, vars: { visitor: v.name.split(' ')[0]!, date: fmtDate(v.expected_on ?? schoolToday(), 'weekday'), code: v.code, school: t.info.name } }]);
  }

  async badgePdf(t: TenantCtx, id: string): Promise<{ name: string; data: Buffer }> {
    const v = await this.vrow(t, await this.visitor(t, id));
    if (!v.badgeNo) throw new ApiError('conflict', tx('A badge is printed once they are signed in.'));
    const fill = { school: t.info.name, name: v.name, purpose: v.purposeName, host: v.hostName ?? '', number: v.badgeNo, date: fmtDate(v.inAt ?? new Date().toISOString()), time: v.inAt ? fmtDate(v.inAt, 'time') : '' };
    return { name: `${v.badgeNo}.pdf`, ...(await this.documents.render(t, 'visitorBadge', fill, [], undefined, { photo: await this.files.bytes(t, v.photoFileId) })) };
  }

  // ── Gate passes ─────────────────────────────────────────────────────────────

  private grow(r: GRaw): GatePassRow {
    return {
      id: r.id, number: r.number, studentId: r.student_id, studentName: r.student_name, className: r.class_name, leaveAt: r.leave_at.toISOString(), reason: r.reason, collector: r.collector,
      pickupId: r.pickup_id, returns: r.returns, state: r.state, requestedBy: r.requested_by_name, outAt: r.out_at?.toISOString() ?? null, createdAt: r.created_at.toISOString(),
    };
  }

  async pass(t: TenantCtx, id: string): Promise<GatePassRow> {
    const r = (await t.pool.query<GRaw>(`${GSEL} where g.id = $1`, [id])).rows[0];
    if (!r) throw notFound(tx('That gate pass'));
    return this.grow(r);
  }

  async passes(t: TenantCtx, f: { day?: string; studentIds?: string[] }): Promise<GatePassRow[]> {
    const day = f.day ?? null;
    const { rows } = await t.pool.query<GRaw>(`${GSEL} where ($1::date is null or (g.leave_at at time zone 'UTC')::date between ($1::date - 1) and ($1::date + 1)) and ($2::text[] is null or g.student_id = any($2))
      order by g.leave_at desc limit 300`, [day, f.studentIds ?? null]);
    return rows.map((r) => this.grow(r)).filter((g) => !f.day || schoolToday(new Date(g.leaveAt)) === f.day);
  }

  private async checkPass(t: TenantCtx, b: GatePassInput): Promise<{ collector: string }> {
    const leave = new Date(b.leaveAt);
    if (leave.getTime() < Date.now() - 10 * 60_000) throw new ApiError('validation', tx('That time has passed.'), { fields: { leaveAt: tx('Pick a later time.') } });
    if (leave.getTime() > Date.now() + 30 * 86_400_000) throw new ApiError('validation', tx('Ask within a month of the day.'), { fields: { leaveAt: tx('Pick a nearer day.') } });
    if (!(await t.pool.query("select 1 from students where id = $1 and status = 'active'", [b.studentId])).rowCount) throw notFound(tx('That student'));
    const clash = await t.pool.query("select 1 from gate_passes where student_id = $1 and state in ('consent','pending','approved') and abs(extract(epoch from leave_at - $2::timestamptz)) < 43200", [b.studentId, leave]);
    if (clash.rowCount) throw new ApiError('conflict', tx('There is already a gate pass for this child that day.'));
    if (b.pickupId) {
      const p = (await t.pool.query<{ name: string }>('select name from pickup_people where id = $1 and student_id = $2 and active', [b.pickupId, b.studentId])).rows[0];
      if (!p) throw new ApiError('validation', tx('Choose one of the people the family named.'), { fields: { pickupId: tx('Choose again.') } });
      return { collector: p.name };
    }
    if (!b.collector) throw new ApiError('validation', tx('Say who collects them.'), { fields: { collector: tx('Write a name.') } });
    return { collector: b.collector };
  }

  private async toApproval(q: { query: TenantCtx['pool']['query'] }, passId: string, b: { studentId: string; leaveAt: string; reason: string }, studentName: string, by: User): Promise<void> {
    const aid = newId('apr');
    await q.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'gate_pass',$2,$3,$4,$5,$6,$7)",
      [aid, tx('{name} leaves early', { name: studentName }), `${fmtDate(b.leaveAt, 'stamp')} · ${b.reason.slice(0, 80)}`, by.name, by.id, b.studentId, JSON.stringify({ passId, leaveAt: b.leaveAt })]);
    await q.query("update gate_passes set state = 'pending', approval_id = $2 where id = $1", [passId, aid]);
  }

  /**
   * A gate pass asked for by a parent (it goes for approval), or by the school (it waits for the family's OK first, where the
   * school asks for it).
   */
  async askPass(t: TenantCtx, by: User, b: GatePassInput, from: 'family' | 'school'): Promise<GatePassRow> {
    const { collector } = await this.checkPass(t, b);
    const s = (await t.pool.query<{ name: string }>('select name from students where id = $1', [b.studentId])).rows[0]!;
    const consent = from === 'school' && (await this.settings.value<boolean>(t, 'visitors.passConsent', true));
    const id = newId('gtp');
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into gate_passes (id, student_id, leave_at, reason, pickup_id, collector, returns, state, requested_by, requested_by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [id, b.studentId, b.leaveAt, b.reason, b.pickupId, collector, b.returns, consent ? 'consent' : 'pending', by.id, by.name]);
      if (!consent) await this.toApproval(client, id, b, s.name, by);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'gatePass.asked', entity: 'gate_pass', entityId: id, detail: { student: s.name, from } });
    if (consent) {
      const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(FAMILY_OF, [b.studentId])).rows;
      await this.messenger.notify(t, 'gatepass.consent', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { student: s.name, time: fmtDate(b.leaveAt, 'time'), reason: b.reason } })));
    }
    return this.pass(t, id);
  }

  /** The family answers the school's request: yes sends it for approval (as theirs), no calls it off. */
  async consent(t: TenantCtx, who: { id: string; name: string; kind: string; children: string[] }, id: string, yes: boolean): Promise<GatePassRow> {
    if (who.kind !== 'guardian') throw forbidden(tx('A parent answers from their own account.'));
    const g = await this.pass(t, id);
    if (!who.children.includes(g.studentId)) throw notFound(tx('That gate pass'));
    if (g.state !== 'consent') throw new ApiError('conflict', tx('This was already answered.'));
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      if (yes) await this.toApproval(client, id, { studentId: g.studentId, leaveAt: g.leaveAt, reason: g.reason }, g.studentName, who);
      else await client.query("update gate_passes set state = 'cancelled' where id = $1", [id]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: who.id, actorName: who.name, action: yes ? 'gatePass.agreed' : 'gatePass.refused', entity: 'gate_pass', entityId: id, detail: { student: g.studentName } });
    return this.pass(t, id);
  }

  /** Called off before the child leaves: by the family for their child, or by the desk. */
  async cancelPass(t: TenantCtx, by: User, id: string, children: string[] | null): Promise<GatePassRow> {
    const g = await this.pass(t, id);
    if (children && !children.includes(g.studentId)) throw notFound(tx('That gate pass'));
    if (!['consent', 'pending', 'approved'].includes(g.state)) throw new ApiError('conflict', tx('This gate pass cannot be cancelled now.'));
    await t.pool.query("update gate_passes set state = 'cancelled' where id = $1", [id]);
    await t.pool.query("update approvals set status = 'withdrawn', decided_at = now(), decided_by = $2 where kind = 'gate_pass' and payload->>'passId' = $1 and status = 'pending'", [id, by.id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'gatePass.cancelled', entity: 'gate_pass', entityId: id, detail: { student: g.studentName } });
    return this.pass(t, id);
  }

  /** The child leaves through the gate: only on an approved pass. */
  async out(t: TenantCtx, by: User, id: string): Promise<GatePassRow> {
    const g = await this.pass(t, id);
    if (g.state === 'left') return g;
    if (g.state !== 'approved') throw new ApiError('conflict', g.state === 'pending' || g.state === 'consent' ? tx('This gate pass is not approved yet.') : tx('This gate pass is not valid.'));
    await t.pool.query("update gate_passes set state = 'left', out_at = now(), out_by = $2 where id = $1 and state = 'approved'", [id, by.id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'gatePass.out', entity: 'gate_pass', entityId: id, detail: { student: g.studentName, collector: g.collector } });
    const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(FAMILY_OF, [g.studentId])).rows;
    await this.messenger.notify(t, 'pickup.done', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { student: g.studentName, name: g.collector, time: fmtDate(new Date(), 'time') } })));
    return this.pass(t, id);
  }

  async passPdf(t: TenantCtx, id: string): Promise<{ name: string; data: Buffer }> {
    const g = await this.pass(t, id);
    if (!g.number || !['approved', 'left'].includes(g.state)) throw new ApiError('conflict', tx('A gate pass is printed once it is approved.'));
    const by = (await t.pool.query<{ name: string | null }>("select (select name from users u where u.id = a.decided_by) name from approvals a where a.kind = 'gate_pass' and a.payload->>'passId' = $1 order by a.created_at desc limit 1", [id])).rows[0]?.name ?? '';
    const fill = { school: t.info.name, student: g.studentName, class: g.className, number: g.number, time: fmtDate(g.leaveAt, 'stamp'), reason: g.reason, collector: g.collector, approvedBy: by };
    return { name: `${g.number}.pdf`, ...(await this.documents.render(t, 'gatePass', fill, [])) };
  }

  // ── Pick-up ────────────────────────────────────────────────────────────────

  async people(t: TenantCtx, studentIds: string[]): Promise<PickupPerson[]> {
    const { rows } = await t.pool.query<{ id: string; student_id: string; name: string; relation: string; phone: string; photo_file_id: string | null; active: boolean }>(
      'select * from pickup_people where student_id = any($1) and active order by name', [studentIds]);
    return rows.map((r) => ({ id: r.id, studentId: r.student_id, name: r.name, relation: r.relation, phone: r.phone, photoFileId: r.photo_file_id, active: r.active }));
  }

  async addPerson(t: TenantCtx, by: User, b: PickupInput, children: string[] | null): Promise<PickupPerson[]> {
    if (children && b.studentIds.some((s) => !children.includes(s))) throw notFound(tx('That student'));
    const n = Number((await t.pool.query<{ n: string }>("select count(*) n from students where id = any($1) and status = 'active'", [b.studentIds])).rows[0]!.n);
    if (n !== new Set(b.studentIds).size) throw notFound(tx('That student'));
    if (b.photoFileId && !(await t.pool.query("select 1 from files where id = $1 and kind = 'pickup_photo' and deleted_at is null", [b.photoFileId])).rowCount) {
      throw new ApiError('validation', tx('The photo is missing. Add it again.'), { fields: { photoFileId: tx('Add the photo again.') } });
    }
    const phone = b.phone ? this.settings.phone(t, b.phone) : '';
    for (const s of new Set(b.studentIds)) {
      if (Number((await t.pool.query<{ n: string }>('select count(*) n from pickup_people where student_id = $1 and active', [s])).rows[0]!.n) >= 10) {
        throw new ApiError('conflict', tx('A child can have at most ten people named to collect them.'));
      }
      await t.pool.query('insert into pickup_people (id, student_id, name, relation, phone, photo_file_id, added_by) values ($1,$2,$3,$4,$5,$6,$7)', [newId('pkp'), s, b.name, b.relation, phone, b.photoFileId, by.id]);
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'pickup.named', entity: 'student', entityId: b.studentIds[0], detail: { name: b.name, students: b.studentIds.length } });
    return this.people(t, b.studentIds);
  }

  async removePerson(t: TenantCtx, by: User, id: string, children: string[] | null): Promise<void> {
    const p = (await t.pool.query<{ student_id: string; name: string }>('select student_id, name from pickup_people where id = $1 and active', [id])).rows[0];
    if (!p || (children && !children.includes(p.student_id))) throw notFound(tx('That person'));
    await t.pool.query('update pickup_people set active = false where id = $1', [id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'pickup.removed', entity: 'student', entityId: p.student_id, detail: { name: p.name } });
  }

  /** Today's code for a parent: one for all their children, made the first time it is asked for. */
  async codeFor(t: TenantCtx, userId: string): Promise<string> {
    const today = schoolToday();
    for (let i = 0; i < 6; i++) {
      const had = (await t.pool.query<{ code: string }>('select code from pickup_codes where user_id = $1 and day = $2', [userId, today])).rows[0];
      if (had) return had.code;
      await t.pool.query('insert into pickup_codes (user_id, day, code) values ($1,$2,$3) on conflict do nothing', [userId, today, code()]).catch(() => undefined);
    }
    throw new ApiError('school_unavailable', tx('Could not make a code. Try again.'));
  }

  /** The gate checks a code (typed, or read from the app's QR): whose children it is for, with who may collect them. */
  async check(t: TenantCtx, raw: string) {
    const c = raw.trim().replace(/^TP:/, '');
    const owner = (await t.pool.query<{ user_id: string; name: string }>('select p.user_id, u.name from pickup_codes p join users u on u.id = p.user_id where p.day = $1 and p.code = $2', [schoolToday(), c])).rows[0];
    if (!owner) throw notFound(tx('This code is not valid today'));
    const kids = (await t.pool.query<{ id: string; name: string; class_name: string }>(
      `select distinct s.id, s.name, c.name class_name from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id and s.status = 'active'
       join classes c on c.id = s.class_id where g.user_id = $1 order by s.name`, [owner.user_id])).rows;
    return { parent: owner.name, students: kids.map((k) => ({ id: k.id, name: k.name, className: k.class_name })), people: await this.people(t, kids.map((k) => k.id)) };
  }

  /** A child collected at the end of the day: by someone the family named, or by whoever shows the family's code. */
  async recordPickup(t: TenantCtx, by: User, b: PickupRecord): Promise<{ ok: true }> {
    const s = (await t.pool.query<{ name: string }>("select name from students where id = $1 and status = 'active'", [b.studentId])).rows[0];
    if (!s) throw notFound(tx('That student'));
    let byCode = false;
    if (b.code) {
      const ok = await t.pool.query(
        `select 1 from pickup_codes p join guardians g on g.user_id = p.user_id join student_guardians sg on sg.guardian_id = g.id where p.day = $1 and p.code = $2 and sg.student_id = $3`,
        [schoolToday(), b.code.trim().replace(/^TP:/, ''), b.studentId]);
      if (!ok.rowCount) throw new ApiError('validation', tx('This code is not this child’s family’s code today.'), { fields: { code: tx('Check the code.') } });
      byCode = true;
    }
    if (b.pickupId && !(await t.pool.query('select 1 from pickup_people where id = $1 and student_id = $2 and active', [b.pickupId, b.studentId])).rowCount) {
      throw new ApiError('validation', tx('Choose one of the people the family named.'), { fields: { pickupId: tx('Choose again.') } });
    }
    if (!byCode && !b.pickupId && (await this.settings.value<boolean>(t, 'visitors.pickupCode', true))) {
      throw new ApiError('validation', tx('Ask for the family’s code, or choose one of the people they named.'), { fields: { code: tx('Ask for the code.') } });
    }
    await t.pool.query('insert into pickups (id, student_id, pickup_id, name, by_code, recorded_by) values ($1,$2,$3,$4,$5,$6)', [newId('pku'), b.studentId, b.pickupId, b.name, byCode, by.id]);
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'pickup.recorded', entity: 'student', entityId: b.studentId, detail: { name: b.name, byCode } });
    const fam = (await t.pool.query<{ phone: string | null; email: string | null }>(FAMILY_OF, [b.studentId])).rows;
    await this.messenger.notify(t, 'pickup.done', fam.filter((f) => f.phone || f.email).map((f) => ({ to: f.phone ?? '', email: f.email, vars: { student: s.name, name: b.name, time: fmtDate(new Date(), 'time') } })));
    return { ok: true };
  }

  async pickups(t: TenantCtx, day: string) {
    const { rows } = await t.pool.query<{ id: string; student_id: string; student: string; class_name: string; name: string; by_code: boolean; at: Date }>(
      `select p.id, p.student_id, s.name student, c.name class_name, p.name, p.by_code, p.at from pickups p join students s on s.id = p.student_id join classes c on c.id = s.class_id
       where p.at >= $1::date - 1 and p.at < $1::date + 2 order by p.at desc limit 500`, [day]);
    return rows.filter((r) => schoolToday(r.at) === day).map((r) => ({ id: r.id, studentId: r.student_id, studentName: r.student, className: r.class_name, name: r.name, byCode: r.by_code, at: r.at.toISOString() }));
  }

  // ── Late arrivals ───────────────────────────────────────────────────────────

  /** A student who came late is written down; a roll call that marked them absent today says late instead. */
  async late(t: TenantCtx, by: User, b: LateInput): Promise<{ ok: true }> {
    const at = b.at ? new Date(b.at) : new Date();
    if (schoolToday(at) !== schoolToday() || at.getTime() > Date.now() + 5 * 60_000) throw new ApiError('validation', tx('Write down a late arrival on the day, as it happens.'), { fields: { at: tx('Pick a time today.') } });
    const s = (await t.pool.query<{ class_id: string; name: string }>("select class_id, name from students where id = $1 and status = 'active'", [b.studentId])).rows[0];
    if (!s) throw notFound(tx('That student'));
    const already = (await t.pool.query<{ at: Date }>('select at from late_arrivals where student_id = $1 order by at desc limit 1', [b.studentId])).rows[0];
    if (already && schoolToday(already.at) === schoolToday()) throw new ApiError('conflict', tx('{name} is already written down as late today.', { name: s.name }));
    await t.pool.query('insert into late_arrivals (id, student_id, at, reason, recorded_by) values ($1,$2,$3,$4,$5)', [newId('lat'), b.studentId, at, b.reason, by.id]);
    const cfg = await this.settings.effective(t);
    if (cfg.modules.includes('attendance')) {
      const marks = await this.settings.value<AttendanceMarkDef[]>(t, 'attendance.statuses', DEFAULT_ATTENDANCE_MARKS);
      const late = marks.find((m) => m.meaning === 'late')?.key;
      const absent = marks.filter((m) => m.meaning === 'absent').map((m) => m.key);
      if (late) {
        await t.pool.query('update attendance_marks m set status = $3 from attendance_sessions x where x.id = m.session_id and x.date = $2 and x.class_id = $4 and m.student_id = $1 and m.status = any($5)',
          [b.studentId, schoolToday(), late, s.class_id, absent]);
      }
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'student.late', entity: 'student', entityId: b.studentId, detail: { name: s.name, reason: b.reason } });
    return { ok: true };
  }

  async lateList(t: TenantCtx, day: string) {
    const { rows } = await t.pool.query<{ id: string; student_id: string; name: string; class_name: string; at: Date; reason: string }>(
      `select l.id, l.student_id, s.name, c.name class_name, l.at, l.reason from late_arrivals l join students s on s.id = l.student_id join classes c on c.id = s.class_id
       where l.at >= $1::date - 1 and l.at < $1::date + 2 order by l.at desc limit 500`, [day]);
    return rows.filter((r) => schoolToday(r.at) === day).map((r) => ({ id: r.id, studentId: r.student_id, studentName: r.name, className: r.class_name, at: r.at.toISOString(), reason: r.reason }));
  }

  // ── Emergency roll call ─────────────────────────────────────────────────────

  /**
   * Everyone on site now. Students: those marked in today (or, before a class is marked, all its students), less those who
   * left on a gate pass or were collected. Staff: those checked in and not out (or all, where staff attendance is not kept).
   */
  async rollCall(t: TenantCtx): Promise<RollCall> {
    const today = schoolToday();
    const cfg = await this.settings.effective(t);
    const marks = await this.settings.value<AttendanceMarkDef[]>(t, 'attendance.statuses', DEFAULT_ATTENDANCE_MARKS);
    const here = marks.filter((m) => ['present', 'late', 'half_day'].includes(m.meaning)).map((m) => m.key);
    const { rows: students } = await t.pool.query<{ id: string; name: string; class_name: string; marked: boolean; status: string | null }>(
      `select s.id, s.name, c.name class_name, exists (select 1 from attendance_sessions x where x.class_id = s.class_id and x.date = $1) marked,
         (select m.status from attendance_marks m join attendance_sessions x on x.id = m.session_id where m.student_id = s.id and x.date = $1 order by x.submitted_at desc nulls last limit 1) status
       from students s join classes c on c.id = s.class_id join academic_years y on y.id = c.year_id and y.current where s.status = 'active' order by c.grade, c.name, s.name`, [today]);
    const gone = new Set([
      ...(await t.pool.query<{ student_id: string; out_at: Date }>("select student_id, out_at from gate_passes where state = 'left' and not returns and out_at >= now() - interval '1 day'")).rows
        .filter((r) => schoolToday(r.out_at) === today).map((r) => r.student_id),
      ...(await this.pickups(t, today)).map((p) => p.studentId),
    ]);
    const marked = cfg.modules.includes('attendance') && students.some((s) => s.marked);
    const inStudents = students.filter((s) => !gone.has(s.id) && (!marked || !s.marked || (s.status !== null && here.includes(s.status))));
    let staff: { id: string; name: string }[];
    let staffMarked = false;
    if (cfg.modules.includes('staffAttendance')) {
      const sm = await this.settings.value<AttendanceMarkDef[]>(t, 'staffAttendance.marks', DEFAULT_STAFF_MARKS);
      const present = sm.filter((m) => ['present', 'late', 'half_day'].includes(m.meaning)).map((m) => m.key);
      const rows = (await t.pool.query<{ id: string; name: string; status: string | null; check_in: Date | null; check_out: Date | null }>(
        `select u.id, u.name, a.status, a.check_in, a.check_out from users u join staff st on st.user_id = u.id left join staff_attendance a on a.user_id = u.id and a.date = $1
         where u.kind = 'staff' and u.status = 'active' order by u.name`, [today])).rows;
      staffMarked = rows.some((r) => r.status || r.check_in);
      staff = staffMarked ? rows.filter((r) => !r.check_out && (r.check_in || (r.status && present.includes(r.status)))) : rows;
    } else staff = (await t.pool.query<{ id: string; name: string }>(`${STAFF} order by name`)).rows;
    const visitors = (await t.pool.query<{ id: string; name: string; host_name: string | null; in_at: Date }>(
      "select v.id, v.name, h.name host_name, v.in_at from visitors v left join users h on h.id = v.host_id where v.state = 'in' order by v.in_at")).rows;
    return {
      at: new Date().toISOString(), students: inStudents.map((s) => ({ id: s.id, name: s.name, className: s.class_name })), staff: staff.map((s) => ({ id: s.id, name: s.name })),
      visitors: visitors.map((v) => ({ id: v.id, name: v.name, hostName: v.host_name, inAt: v.in_at.toISOString() })), marked: { students: marked, staff: staffMarked },
    };
  }

  async rollCallPdf(t: TenantCtx): Promise<{ name: string; data: Buffer }> {
    const r = await this.rollCall(t);
    const lines: PdfLine[] = [
      { text: t.info.name, size: 16, bold: true }, { text: tx('Roll call, {time}', { time: fmtDate(r.at, 'stamp') }), size: 12 }, { text: '', rule: true },
      { text: tx('Students ({n})', { n: r.students.length }), bold: true, gap: 22 }, ...r.students.map((s) => ({ text: `☐ ${s.name}`, right: s.className, size: 10 })),
      { text: tx('Staff ({n})', { n: r.staff.length }), bold: true, gap: 22 }, ...r.staff.map((s) => ({ text: `☐ ${s.name}`, size: 10 })),
      { text: tx('Visitors ({n})', { n: r.visitors.length }), bold: true, gap: 22 }, ...r.visitors.map((v) => ({ text: `☐ ${v.name}`, right: v.hostName ?? '', size: 10 })),
    ];
    return { name: `roll-call-${schoolToday()}.pdf`, data: await pdf(lines) };
  }
}

@Controller('v1')
@RequireModule('visitors')
export class VisitorsController {
  constructor(private readonly v: VisitorsService) {}

  @Get('visitors') @Require('visitors.read')
  list(@Tenant() t: TenantCtx, @Query('view') view = 'today', @Query('q') q = '') { return this.v.visitors(t, view, q); }

  @Post('visitors') @HttpCode(200) @Require('visitors.manage')
  add(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(VisitorInput)) b: VisitorInput) { return this.v.add(t, { ...u, perms: u.permissions }, b, 'desk'); }

  @Put('visitors/:id') @Require('visitors.manage')
  save(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body(new ZodPipe(VisitorInput)) b: VisitorInput) { return this.v.save(t, u, id, b); }

  @Post('visitors/code') @HttpCode(200) @Require('visitors.manage')
  byCode(@Tenant() t: TenantCtx, @Body(new ZodPipe(PickupCheck)) b: { code: string }) { return this.v.byCode(t, b.code); }

  @Post('visitors/:id/in') @HttpCode(200) @Require('visitors.manage')
  signIn(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.signIn(t, u, id); }

  @Post('visitors/:id/out') @HttpCode(200) @Require('visitors.manage')
  signOut(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.signOut(t, u, id); }

  @Post('visitors/:id/cancel') @HttpCode(200) @Require('visitors.manage')
  cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.cancelVisit(t, u, id, true); }

  @Get('visitors/:id/badge.pdf') @Require('visitors.read')
  async badge(@Tenant() t: TenantCtx, @Param('id') id: string, @Res() reply: FastifyReply) { sendPdf(reply, await this.v.badgePdf(t, id)); }

  @Get('visitors/roll-call') @Require('visitors.read')
  roll(@Tenant() t: TenantCtx) { return this.v.rollCall(t); }

  @Get('visitors/roll-call.pdf') @Require('visitors.read')
  async rollPdf(@Tenant() t: TenantCtx, @Res() reply: FastifyReply) { sendPdf(reply, await this.v.rollCallPdf(t)); }

  @Get('gate-passes') @Require('visitors.read')
  passes(@Tenant() t: TenantCtx, @Query('day') day?: string) { return this.v.passes(t, { day: /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day : undefined }); }

  @Post('gate-passes') @HttpCode(200) @Require('visitors.manage')
  askPass(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(GatePassInput)) b: GatePassInput) { return this.v.askPass(t, u, b, 'school'); }

  @Post('gate-passes/:id/out') @HttpCode(200) @Require('visitors.manage')
  out(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.out(t, u, id); }

  @Post('gate-passes/:id/cancel') @HttpCode(200) @Require('visitors.manage')
  cancelPass(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.cancelPass(t, u, id, null); }

  @Get('gate-passes/:id/pass.pdf') @Require('visitors.read')
  async passPdf(@Tenant() t: TenantCtx, @Param('id') id: string, @Res() reply: FastifyReply) { sendPdf(reply, await this.v.passPdf(t, id)); }

  @Get('pickup/people') @Require('visitors.read')
  people(@Tenant() t: TenantCtx, @Query('studentId') studentId: string) { return this.v.people(t, [String(studentId ?? '')]); }

  @Post('pickup/people') @HttpCode(200) @Require('visitors.manage')
  addPerson(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(PickupInput)) b: PickupInput) { return this.v.addPerson(t, u, b, null); }

  @Delete('pickup/people/:id') @HttpCode(204) @Require('visitors.manage')
  removePerson(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.removePerson(t, u, id, null); }

  @Post('pickup/check') @HttpCode(200) @Require('visitors.manage')
  check(@Tenant() t: TenantCtx, @Body(new ZodPipe(PickupCheck)) b: { code: string }) { return this.v.check(t, b.code); }

  @Post('pickup') @HttpCode(200) @Require('visitors.manage')
  record(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(PickupRecord)) b: PickupRecord) { return this.v.recordPickup(t, u, b); }

  @Get('pickup') @Require('visitors.read')
  pickups(@Tenant() t: TenantCtx, @Query('day') day?: string) { return this.v.pickups(t, /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : schoolToday()); }

  @Post('late-arrivals') @HttpCode(200) @Require('visitors.manage')
  late(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(LateInput)) b: LateInput) { return this.v.late(t, u, b); }

  @Get('late-arrivals') @Require('visitors.read')
  lateList(@Tenant() t: TenantCtx, @Query('day') day?: string) { return this.v.lateList(t, /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : schoolToday()); }
}

/** The app: families ask for early leave, answer the school, name who collects and show the day's code; staff invite visitors. */
@Controller('v1/f')
@RequireModule('visitors')
export class FamilyVisitorsController {
  constructor(private readonly v: VisitorsService, private readonly f: FamilyService) {}

  private async parent(t: TenantCtx, u: AuthedUser) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'guardian') throw forbidden(tx('A parent does this from their own account.'));
    return w;
  }

  @Get('gate-pass')
  async mine(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) {
    const w = await this.parent(t, u);
    const passes = (await this.v.passes(t, { studentIds: w.children })).filter((p) => p.leaveAt >= new Date(Date.now() - 30 * 86_400_000).toISOString());
    return { code: w.children.length ? await this.v.codeFor(t, w.id) : null, passes, people: await this.v.people(t, w.children) };
  }

  @Post('gate-pass') @HttpCode(200)
  async ask(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(GatePassInput)) b: GatePassInput) {
    const w = await this.parent(t, u);
    if (!w.children.includes(b.studentId)) throw notFound(tx('That student'));
    return this.v.askPass(t, w, b, 'family');
  }

  @Post('gate-pass/:id/consent') @HttpCode(200)
  async consent(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string, @Body() b: { yes?: boolean }) { return this.v.consent(t, await this.parent(t, u), id, b?.yes === true); }

  @Post('gate-pass/:id/cancel') @HttpCode(200)
  async cancel(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { const w = await this.parent(t, u); return this.v.cancelPass(t, w, id, w.children); }

  @Post('pickup-people') @HttpCode(200)
  async addPerson(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(PickupInput)) b: PickupInput) { const w = await this.parent(t, u); return this.v.addPerson(t, w, b, w.children); }

  @Delete('pickup-people/:id') @HttpCode(204)
  async removePerson(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { const w = await this.parent(t, u); return this.v.removePerson(t, w, id, w.children); }

  @Get('visitors')
  async invited(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return this.v.invitedBy(t, w.id);
  }

  @Post('visitors') @HttpCode(200)
  async invite(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Body(new ZodPipe(VisitorInput)) b: VisitorInput) {
    const w = await this.f.who(t, u);
    if (w.kind !== 'staff') throw forbidden(tx('This is for members of staff.'));
    return this.v.add(t, w, b, 'staff');
  }

  @Post('visitors/:id/cancel') @HttpCode(200)
  async cancelVisit(@Tenant() t: TenantCtx, @CurrentUser() u: AuthedUser, @Param('id') id: string) { return this.v.cancelVisit(t, await this.f.who(t, u), id, false); }
}
