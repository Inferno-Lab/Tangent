import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Query, type OnModuleInit } from '@nestjs/common';
import { activeFeatures, activeModules, moduleByKey, resolveConfig, validateSettingsChanges } from '@tangent/config-engine';
import {
  ConfigPatch, PERMISSIONS, PackApply, RoleDefSave, SETTINGS_META, SettingLockPut, packSettings, type PackPart,
  type ChangeRequestRow, type ConfigTemplateRow, type ConfigVersionRow, type EffectiveConfig, type EntitlementDoc, type RoleDef, type SchoolConfig } from '@tangent/contracts';
import { RoleError, StaleSettings, deleteRole, newId, readSettings, recordSettingsVersion, saveRole, writeSettings, type pg } from '@tangent/db';
import { ApiError, ZodPipe, notFound } from '@tangent/nest-kit';
import { z } from 'zod';
import { Actions } from './actions.js';
import { Db, Me, Needs, type ConsoleUser } from './core.js';
import { ENV, type Env } from './env.js';
import { withSchoolDb } from './school-db.js';
import { REGISTRY } from './tokens.js';
import type { Registry } from '@tangent/tenancy';

/** What a template never carries from one school to another: who the school is. */
const OWN_KEYS = ['school.name', 'school.shortName', 'school.tagline', 'school.place', 'school.phone', 'school.email', 'school.address', 'brand.logoText',
  'privacy.officerName', 'privacy.officerEmail', 'privacy.officerPhone', 'dashboard.rollClasses', 'people.houses'];
const KNOWN = new Set<string>(PERMISSIONS);

type Q = pg.Pool | pg.PoolClient;

/** A role rule broken (packages/db roles.ts), as the API's error. */
async function roleCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof RoleError) throw e.code === 'not_found' ? notFound('That role') : new ApiError(e.code, e.message, e.fields ? { fields: e.fields } : undefined); throw e; }
}

/**
 * A school's configuration, as only Tangent changes it: settings, roles and who holds them. Every change becomes a version
 * (who, what, why) that can be rolled back; a whole setup can be saved as a template and applied to other schools.
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  constructor(private readonly db: Db, @Inject(ENV) private readonly env: Env, private readonly actions: Actions, @Inject(REGISTRY) private readonly registry: Registry) {}

  /** Risky changes wait in Approvals; when a second person says yes, this applies them. */
  onModuleInit(): void {
    this.actions.handle('config.apply', async (schoolId, params, by) => {
      const r = await this.apply(schoolId, by, { changes: params.changes as Record<string, unknown>, note: String(params.note ?? ''), expectedVersion: params.expectedVersion as number | undefined });
      return `Applied. The configuration is now version ${r.version}.`;
    });
    // Worked out again when approved, so it applies what differs then, not what differed when asked.
    this.actions.handle('pack.apply', async (schoolId, params, by) => {
      const p = PackApply.parse(params);
      const parts = (await this.packParts(schoolId, p.country, p.curriculum)).filter((x) => p.groups.includes(x.group));
      const changes = Object.fromEntries(parts.flatMap((x) => x.changes.map((c) => [c.key, c.after])));
      if (!Object.keys(changes).length) return 'Nothing to change: the school already has those values.';
      const r = await this.apply(schoolId, by, { changes, note: p.note || `Re-applied ${p.groups.join(', ')} from the ${p.country}${p.curriculum ? ` ${p.curriculum}` : ''} pack` });
      return `Re-applied ${Object.keys(changes).length} settings. The configuration is now version ${r.version}.`;
    });
  }

  /** A pack's values for this school, by part (each setting's group), only where the school has something else. */
  async packParts(schoolId: string, country: string, curriculum: string): Promise<PackPart[]> {
    const now = (await this.get(schoolId)).values;
    const by = new Map<string, PackPart>();
    for (const [key, after] of Object.entries(packSettings(country, curriculum))) {
      const meta = SETTINGS_META[key as keyof typeof SETTINGS_META];
      if (!meta || JSON.stringify(now[key] ?? null) === JSON.stringify(after)) continue;
      const part = by.get(meta.group) ?? { group: meta.group, label: moduleByKey(meta.group)?.name ?? meta.group, changes: [] };
      part.changes.push({ key, label: meta.label, before: now[key] ?? null, after });
      by.set(meta.group, part);
    }
    return [...by.values()];
  }

  private school<T>(schoolId: string, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
    return withSchoolDb(this.db, this.env.SECRETS_KEY, schoolId, fn);
  }

  private async entitlement(schoolId: string): Promise<EntitlementDoc> {
    const r = (await this.db.pool.query<{ entitlement: EntitlementDoc; plan: string }>('select entitlement, plan from schools where id = $1 and deleted_at is null', [schoolId])).rows[0];
    if (!r) throw notFound('That school');
    return { ...r.entitlement, plan: r.plan, overrides: r.entitlement.overrides ?? {}, locks: r.entitlement.locks ?? [], lockNotes: r.entitlement.lockNotes ?? {} };
  }

  private values(q: Q): Promise<{ version: number; values: Record<string, unknown> }> {
    return readSettings(q);
  }

  private async roles(q: Q): Promise<RoleDef[]> {
    const { rows } = await q.query<{ id: string; key: string; name: string; description: string; permissions: string[]; locked: boolean; people: string }>(
      'select r.id, r.key, r.name, r.description, r.permissions, r.locked, (select count(*) from user_roles ur where ur.role_id = r.id) people from roles r order by r.locked desc, r.name');
    return rows.map((r) => ({ ...r, permissions: r.permissions.filter((p) => KNOWN.has(p)), people: Number(r.people) }));
  }

  async get(schoolId: string): Promise<SchoolConfig> {
    const ent = await this.entitlement(schoolId);
    const versions = await this.db.pool.query<{ id: string; version: number; changes: ConfigVersionRow['changes']; note: string; by: string; at: Date }>(
      'select id, version, changes, note, by, at from config_versions where school_id = $1 order by at desc limit 30', [schoolId]);
    return this.school(schoolId, async (p) => {
      const [cur, roles, classes, heads, staff, subjects] = await Promise.all([
        this.values(p), this.roles(p),
        p.query<{ id: string; name: string }>('select id, name from classes order by grade, section'),
        p.query<{ key: string; name: string }>('select key, name from fee_heads order by sort, name'),
        p.query<{ id: string; name: string; designation: string; role_id: string | null }>(
          "select u.id, u.name, s.designation, (select ur.role_id from user_roles ur where ur.user_id = u.id limit 1) role_id from users u join staff s on s.user_id = u.id where u.status = 'active' order by u.name"),
        p.query<{ id: string; name: string }>('select id, name from subjects order by name'),
      ]);
      return {
        ...cur, entitled: activeModules(ent), features: activeFeatures(ent, activeModules(ent)), roles, classes: classes.rows, feeHeads: heads.rows, subjects: subjects.rows,
        staff: staff.rows.map((s) => ({ id: s.id, name: s.name, designation: s.designation, roleId: s.role_id })),
        locks: ent.locks.map((key) => ({ key, value: ent.overrides[key] ?? null, note: ent.lockNotes?.[key] ?? '' })),
        versions: versions.rows.map((v) => ({ id: v.id, version: v.version, changes: v.changes, note: v.note, by: v.by, at: v.at.toISOString() })),
      };
    });
  }

  /** Applies a change in one transaction, refuses a stale version, and records it as a version that can be rolled back. */
  async apply(schoolId: string, by: string, patch: { expectedVersion?: number; changes: Record<string, unknown>; note?: string }): Promise<SchoolConfig> {
    const sets = Object.fromEntries(Object.entries(patch.changes).filter(([, v]) => v !== null));
    const resets = Object.keys(patch.changes).filter((k) => patch.changes[k] === null);
    const checked = validateSettingsChanges(sets, []);
    if (!checked.ok) throw new ApiError('validation', checked.problems[0]!.message, { fields: Object.fromEntries(checked.problems.map((p) => [p.key, p.message])) });
    const unknown = resets.find((k) => !(k in SETTINGS_META));
    if (unknown) throw new ApiError('validation', 'That setting does not exist.', { fields: { [unknown]: 'That setting does not exist.' } });
    const after = await this.school(schoolId, (p) => writeSettings(p, { changes: { ...checked.values, ...Object.fromEntries(resets.map((k) => [k, null])) }, expectedVersion: patch.expectedVersion, note: patch.note, actorId: null, actorName: `Tangent · ${by}` }))
      .catch((e) => { throw e instanceof StaleSettings ? new ApiError('conflict', 'Someone else changed this school’s configuration a moment ago. Reload to see their change.') : e; });
    if (after.changes.length) {
      await recordSettingsVersion(this.db.pool, schoolId, after, patch.note ?? '', by);
      await this.db.audit(by, 'config.changed', 'school', schoolId, { keys: after.changes.map((c) => c.key).join(', ') });
    }
    return this.get(schoolId);
  }

  /**
   * Fixes one setting for one school at a value, or lifts the fix. The school then sees it read-only with the reason; on a
   * setting it may only tighten (security, privacy), the value is a floor and the school may still be stricter.
   */
  async lock(schoolId: string, by: string, body: SettingLockPut): Promise<SchoolConfig> {
    if (!(body.key in SETTINGS_META)) throw new ApiError('validation', 'That setting does not exist.');
    const ent = await this.entitlement(schoolId);
    const locks = ent.locks.filter((k) => k !== body.key);
    const overrides = { ...ent.overrides };
    const notes = { ...(ent.lockNotes ?? {}) };
    delete overrides[body.key];
    delete notes[body.key];
    if (body.locked) {
      const checked = validateSettingsChanges({ [body.key]: body.value }, []);
      if (!checked.ok) throw new ApiError('validation', checked.problems[0]!.message, { fields: { [body.key]: checked.problems[0]!.message } });
      locks.push(body.key);
      overrides[body.key] = checked.values[body.key];
      if (body.note) notes[body.key] = body.note;
    }
    const { plan: _plan, ...doc } = { ...ent, locks, overrides, lockNotes: notes, version: ent.version + 1 };
    await this.db.pool.query('update schools set entitlement = $2, config_version = config_version + 1 where id = $1', [schoolId, JSON.stringify(doc)]);
    const slug = (await this.db.pool.query<{ slug: string }>('select slug from schools where id = $1', [schoolId])).rows[0]?.slug;
    if (slug) this.registry.invalidate(slug);
    await this.db.audit(by, body.locked ? 'setting.locked' : 'setting.unlocked', 'school', schoolId, { key: body.key, note: body.note });
    return this.get(schoolId);
  }

  /** Puts every setting back to how it was in a version: keys added since go back to the platform default. */
  async rollback(schoolId: string, versionId: string, by: string): Promise<SchoolConfig> {
    const v = (await this.db.pool.query<{ version: number; values: Record<string, unknown> }>('select version, values from config_versions where id = $1 and school_id = $2', [versionId, schoolId])).rows[0];
    if (!v) throw notFound('That version');
    const now = await this.school(schoolId, (p) => this.values(p));
    const changes: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(now.values), ...Object.keys(v.values)])) {
      if (JSON.stringify(now.values[k]) !== JSON.stringify(v.values[k])) changes[k] = k in v.values ? v.values[k] : null;
    }
    return this.apply(schoolId, by, { changes, note: `Rolled back to version ${v.version}` });
  }

  // Roles: only Tangent makes and changes them.

  async saveRole(schoolId: string, by: string, id: string | null, body: RoleDefSave): Promise<RoleDef[]> {
    return this.school(schoolId, async (p) => {
      await roleCall(() => saveRole(p, { id: null, name: `Tangent · ${by}` }, id, body));
      await this.db.audit(by, 'role.saved', 'school', schoolId, { role: body.name });
      return this.roles(p);
    });
  }

  async deleteRole(schoolId: string, by: string, id: string): Promise<RoleDef[]> {
    return this.school(schoolId, async (p) => {
      await roleCall(() => deleteRole(p, { id: null, name: `Tangent · ${by}` }, id));
      await this.db.audit(by, 'role.removed', 'school', schoolId, { roleId: id });
      return this.roles(p);
    });
  }

  async setStaffRole(schoolId: string, by: string, userId: string, roleId: string): Promise<void> {
    await this.school(schoolId, async (p) => {
      if (!(await p.query('select 1 from roles where id = $1', [roleId])).rowCount) throw new ApiError('validation', 'Choose a role from the list.');
      if (!(await p.query('select 1 from staff where user_id = $1', [userId])).rowCount) throw notFound('That person');
      await p.query('delete from user_roles where user_id = $1', [userId]);
      await p.query('insert into user_roles (user_id, role_id) values ($1,$2)', [userId, roleId]);
      await p.query('update users set token_version = token_version + 1 where id = $1', [userId]);
    });
    await this.db.audit(by, 'staff.role_set', 'school', schoolId, { userId, roleId });
  }

  /** A school's staff member lost their phone and no one at the school can reset it (the only principal): they add a new one at their next sign-in. */
  async resetStaffAuthenticator(schoolId: string, by: string, userId: string): Promise<void> {
    await this.school(schoolId, async (p) => {
      const r = await p.query("update users set totp_secret = null, totp_last = null, token_version = token_version + 1 where id = $1 and kind = 'staff'", [userId]);
      if (!r.rowCount) throw notFound('That person');
      await p.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [userId]);
    });
    await this.db.audit(by, 'staff.authenticator_reset', 'school', schoolId, { userId });
  }

  // Templates: one school's setup, applied to others.

  async templates(): Promise<ConfigTemplateRow[]> {
    const { rows } = await this.db.pool.query<{ id: string; name: string; values: Record<string, unknown>; roles: unknown[]; created_by: string; created_at: Date }>('select * from config_templates order by created_at desc');
    return rows.map((r) => ({ id: r.id, name: r.name, keys: Object.keys(r.values).length, roles: r.roles.length, createdBy: r.created_by, createdAt: r.created_at.toISOString() }));
  }

  async saveTemplate(schoolId: string, name: string, by: string): Promise<ConfigTemplateRow[]> {
    const { values, roles } = await this.school(schoolId, async (p) => ({ values: (await this.values(p)).values, roles: await this.roles(p) }));
    const kept = Object.fromEntries(Object.entries(values).filter(([k]) => !OWN_KEYS.includes(k)));
    await this.db.pool.query('insert into config_templates (id, name, values, roles, created_by) values ($1,$2,$3,$4,$5)', [newId('cft'), name, JSON.stringify(kept),
      JSON.stringify(roles.filter((r) => !r.locked).map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: r.permissions }))), by]);
    return this.templates();
  }

  /** Copies a template's settings and roles into each school (never who the school is), each as a new version. */
  async applyTemplate(templateId: string, schoolIds: string[], by: string): Promise<{ applied: number }> {
    const t = (await this.db.pool.query<{ name: string; values: Record<string, unknown>; roles: { key: string; name: string; description: string; permissions: string[] }[] }>(
      'select name, values, roles from config_templates where id = $1', [templateId])).rows[0];
    if (!t) throw notFound('That template');
    for (const schoolId of schoolIds) {
      const values = Object.fromEntries(Object.entries(t.values).filter(([k]) => k in SETTINGS_META));
      await this.apply(schoolId, by, { changes: values, note: `Template “${t.name}”` });
      await this.school(schoolId, async (p) => {
        for (const r of t.roles) {
          await p.query(
            `insert into roles (id, key, name, description, permissions, locked) values ($1,$2,$3,$4,$5,false)
             on conflict (key) do update set name = excluded.name, description = excluded.description, permissions = excluded.permissions where roles.locked = false`,
            [`role_${r.key}`, r.key, r.name, r.description, JSON.stringify(r.permissions.filter((x) => KNOWN.has(x)))]);
        }
        await p.query('update users set token_version = token_version + 1 where id in (select user_id from user_roles)');
      });
    }
    return { applied: schoolIds.length };
  }

  /** What one role sees: the admin menu, and the app's tabs, cards and buttons, as the school's apps would resolve them. */
  async preview(schoolId: string, roleId: string): Promise<Pick<EffectiveConfig, 'menu' | 'app' | 'modules' | 'school'>> {
    const ent = await this.entitlement(schoolId);
    const { cur, role } = await this.school(schoolId, async (p) => ({ cur: await this.values(p), role: (await this.roles(p)).find((r) => r.id === roleId) }));
    if (!role) throw notFound('That role');
    const live = (await this.db.pool.query<{ status: string }>('select status from schools where id = $1', [schoolId])).rows[0]?.status === 'live';
    const c = resolveConfig({ settings: { version: cur.version, values: cur.values, locked: [], updatedAt: null }, entitlement: ent, audience: { permissions: role.permissions }, live });
    return { menu: c.menu, app: c.app, modules: c.modules, school: c.school };
  }

  // What schools ask for.

  async requests(status: string): Promise<ChangeRequestRow[]> {
    const { rows } = await this.db.pool.query<{ id: string; school_id: string; school_slug: string; school_name: string; area: string; message: string; requested_by: string; status: ChangeRequestRow['status']; answer: string; answered_by: string | null; created_at: Date; closed_at: Date | null }>(
      "select * from change_requests where ($1 = 'all' or status = $1) order by created_at desc limit 200", [status]);
    return rows.map((r) => ({
      id: r.id, schoolId: r.school_id, schoolSlug: r.school_slug, schoolName: r.school_name, area: r.area, message: r.message, requestedBy: r.requested_by,
      status: r.status, answer: r.answer, answeredBy: r.answered_by, createdAt: r.created_at.toISOString(), closedAt: r.closed_at?.toISOString() ?? null,
    }));
  }

  async answer(id: string, by: string, status: 'done' | 'declined', answer: string): Promise<void> {
    const r = await this.db.pool.query("update change_requests set status = $2, answer = $3, answered_by = $4, closed_at = now() where id = $1 and status = 'open'", [id, status, answer, by]);
    if (!r.rowCount) throw new ApiError('conflict', 'That request is already closed.');
    await this.db.audit(by, `request.${status}`, 'request', id, { answer });
  }
}

const Answer = z.object({ status: z.enum(['done', 'declined']), answer: z.string().trim().min(2, 'Write a short answer for the school').max(600) });

@Controller('console/v1')
export class ConfigController {
  constructor(private readonly config: ConfigService, private readonly actions: Actions) {}

  @Get('schools/:id/config') @Needs('schools.read')
  get(@Param('id') id: string): Promise<SchoolConfig> {
    return this.config.get(id);
  }

  /** What re-applying a country's (and curriculum's) starter pack would change, part by part. */
  @Get('schools/:id/packs/preview') @Needs('schools.read')
  packPreview(@Param('id') id: string, @Query(new ZodPipe(PackApply.pick({ country: true, curriculum: true }))) q: { country: string; curriculum: string }): Promise<PackPart[]> {
    return this.config.packParts(id, q.country, q.curriculum);
  }

  /** Asks to re-apply some parts: a second person approves, then what differs then is applied. */
  @Post('schools/:id/packs/apply') @HttpCode(200) @Needs('schools.configure')
  async packApply(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(PackApply)) body: PackApply): Promise<{ actionId: string; status: string }> {
    const a = await this.actions.request(me, { action: 'pack.apply', schoolId: id, params: body, dryRun: false });
    return { actionId: a.id, status: a.status };
  }

  /** Risky settings (marked in SETTINGS_META) wait for a second person; the rest apply at once. */
  @Patch('schools/:id/config') @Needs('schools.configure')
  async patch(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(ConfigPatch)) body: ConfigPatch): Promise<SchoolConfig | { pending: true; actionId: string }> {
    const risky = Object.keys(body.changes).filter((k) => SETTINGS_META[k as keyof typeof SETTINGS_META]?.risky);
    if (risky.length) {
      // The approver sees each setting as it is now and as it would become.
      const now = (await this.config.get(id)).values;
      const diff = Object.entries(body.changes).map(([key, after]) => ({ key, before: now[key] ?? null, after }));
      const a = await this.actions.request(me, { action: 'config.apply', schoolId: id, params: { changes: body.changes, note: body.note, expectedVersion: body.expectedVersion, diff }, dryRun: false });
      if (a.status === 'pending_approval') return { pending: true, actionId: a.id };
      return this.config.get(id);
    }
    return this.config.apply(id, me.email, body);
  }

  @Put('schools/:id/config/locks') @Needs('schools.configure')
  lock(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(SettingLockPut)) body: SettingLockPut): Promise<SchoolConfig> {
    return this.config.lock(id, me.email, body);
  }

  @Post('schools/:id/config/rollback') @HttpCode(200) @Needs('schools.configure')
  rollback(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ versionId: z.string().min(1) }))) body: { versionId: string }): Promise<SchoolConfig> {
    return this.config.rollback(id, body.versionId, me.email);
  }

  @Get('schools/:id/config/preview') @Needs('schools.read')
  preview(@Param('id') id: string, @Query('roleId') roleId: string): ReturnType<ConfigService['preview']> {
    return this.config.preview(id, roleId);
  }

  @Post('schools/:id/roles') @Needs('schools.configure')
  createRole(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(RoleDefSave)) body: RoleDefSave): Promise<RoleDef[]> {
    return this.config.saveRole(id, me.email, null, body);
  }

  @Put('schools/:id/roles/:roleId') @Needs('schools.configure')
  saveRole(@Me() me: ConsoleUser, @Param('id') id: string, @Param('roleId') roleId: string, @Body(new ZodPipe(RoleDefSave)) body: RoleDefSave): Promise<RoleDef[]> {
    return this.config.saveRole(id, me.email, roleId, body);
  }

  @Delete('schools/:id/roles/:roleId') @Needs('schools.configure')
  deleteRole(@Me() me: ConsoleUser, @Param('id') id: string, @Param('roleId') roleId: string): Promise<RoleDef[]> {
    return this.config.deleteRole(id, me.email, roleId);
  }

  @Put('schools/:id/staff/:userId/role') @HttpCode(204) @Needs('schools.configure')
  async setStaffRole(@Me() me: ConsoleUser, @Param('id') id: string, @Param('userId') userId: string, @Body(new ZodPipe(z.object({ roleId: z.string().min(1) }))) body: { roleId: string }): Promise<void> {
    await this.config.setStaffRole(id, me.email, userId, body.roleId);
  }

  @Post('schools/:id/staff/:userId/authenticator/reset') @HttpCode(204) @Needs('schools.configure')
  async resetStaffAuthenticator(@Me() me: ConsoleUser, @Param('id') id: string, @Param('userId') userId: string): Promise<void> {
    await this.config.resetStaffAuthenticator(id, me.email, userId);
  }

  @Get('config-templates') @Needs('schools.read')
  templates(): Promise<ConfigTemplateRow[]> {
    return this.config.templates();
  }

  @Post('config-templates') @Needs('schools.configure')
  saveTemplate(@Me() me: ConsoleUser, @Body(new ZodPipe(z.object({ schoolId: z.string().min(1), name: z.string().trim().min(2).max(60) }))) body: { schoolId: string; name: string }): Promise<ConfigTemplateRow[]> {
    return this.config.saveTemplate(body.schoolId, body.name, me.email);
  }

  @Post('config-templates/:id/apply') @HttpCode(200) @Needs('schools.configure')
  applyTemplate(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ schoolIds: z.array(z.string()).min(1).max(200) }))) body: { schoolIds: string[] }): Promise<{ applied: number }> {
    return this.config.applyTemplate(id, body.schoolIds, me.email);
  }

  @Get('change-requests') @Needs('schools.read')
  requests(@Query('status') status?: string): Promise<ChangeRequestRow[]> {
    return this.config.requests(['open', 'done', 'declined', 'all'].includes(status ?? '') ? status! : 'open');
  }

  @Post('change-requests/:id/answer') @HttpCode(204) @Needs('schools.configure')
  async answer(@Me() me: ConsoleUser, @Param('id') id: string, @Body(new ZodPipe(Answer)) body: z.infer<typeof Answer>): Promise<void> {
    await this.config.answer(id, me.email, body.status, body.answer);
  }
}
