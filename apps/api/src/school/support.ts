import { Inject, Injectable } from '@nestjs/common';
import { StaleSettings, newId, recordSettingsVersion, writeSettings } from '@tangent/db';
import { checkSchoolChanges, resolveConfig, validateSettingsChanges } from '@tangent/config-engine';
import { ApiError } from '@tangent/nest-kit';
import type { Registry } from '@tangent/tenancy';
import { tx, checkCustom, roundToCurrency, type CustomEntity, type CustomFieldsSetting, type CustomValues, rawOf, toE164, phoneProblem, MESSAGE_EVENTS, SETTINGS_META, schoolMinutes, type AuditRow, type EffectiveConfig, type GradingScale, type GradingScheme, gradeIn, schemeFor, type SchoolSettingsPatch, type SchoolSettingsView, type SettingsDoc } from '@tangent/contracts';
import { REGISTRY, type TenantCtx } from '../tenancy/tenant.js';
import { HubService } from './hub.service.js';
import { serverCatalogue } from '@tangent/tenancy';

@Injectable()
export class AuditService {
  async record(t: TenantCtx, e: { actorId?: string | null; actorName?: string; action: string; entity: string; entityId?: string; detail?: Record<string, unknown> }): Promise<void> {
    await t.pool.query(
      'insert into audit_log (id, actor_id, actor_name, action, entity, entity_id, detail) values ($1,$2,$3,$4,$5,$6,$7)',
      [newId('aud'), e.actorId ?? null, e.actorName ?? 'System', e.action, e.entity, e.entityId ?? null, JSON.stringify(e.detail ?? {})],
    );
  }

  async list(t: TenantCtx, limit = 50): Promise<AuditRow[]> {
    const { rows } = await t.pool.query<{ id: string; at: Date; actor_name: string; action: string; entity: string; detail: Record<string, unknown> }>(
      'select id, at, actor_name, action, entity, detail from audit_log order by at desc limit $1', [limit]);
    return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), actor: r.actor_name, action: r.action, entity: r.entity, detail: Object.entries(r.detail).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') }));
  }
}

@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { at: number; doc: SettingsDoc }>();

  constructor(@Inject(REGISTRY) private readonly registry: Registry) {}

  /** What the school's admin edits: every setting in force, Tangent's locks and the lists the editors pick from. */
  async view(t: TenantCtx): Promise<SchoolSettingsView> {
    const [cfg, doc, classes, heads, roles, staff, subjects] = await Promise.all([
      this.effective(t), this.doc(t),
      t.pool.query<{ id: string; name: string }>('select id, name from classes order by grade, section'),
      t.pool.query<{ key: string; name: string }>('select key, name from fee_heads order by sort, name'),
      t.pool.query<{ key: string; name: string }>('select key, name from roles order by name'),
      t.pool.query<{ id: string; name: string }>("select u.id, u.name from users u join staff s on s.user_id = u.id where u.status = 'active' order by u.name"),
      t.pool.query<{ id: string; name: string }>('select id, name from subjects order by name'),
    ]);
    const ent = t.info.entitlement;
    return {
      version: doc.version, values: cfg.settings, entitled: cfg.modules, features: cfg.features, classes: classes.rows, feeHeads: heads.rows, roles: roles.rows, staff: staff.rows, subjects: subjects.rows,
      locks: (ent.locks ?? []).map((key) => ({ key, value: ent.overrides?.[key] ?? null, note: ent.lockNotes?.[key] ?? '' })),
    };
  }

  /**
   * A change the school makes to its own settings: checked against who owns each one, Tangent's locks and floors, the person's
   * permissions and the schema. A risky one becomes a request for a second person; the rest apply at once.
   */
  async change(t: TenantCtx, user: { id: string; name: string; permissions: readonly string[] }, patch: SchoolSettingsPatch): Promise<{ pending: true; approvalId: string } | { version: number }> {
    if (user.id.startsWith('support:')) throw new ApiError('forbidden', 'A support session cannot change the school’s settings.');
    const ent = t.info.entitlement;
    const own = checkSchoolChanges(patch.changes, { locks: ent.locks ?? [], overrides: ent.overrides ?? {} }, user.permissions);
    if (own.length) throw new ApiError('validation', own[0]!.message, { fields: Object.fromEntries(own.map((p) => [p.key, p.message])) });
    const sets = Object.fromEntries(Object.entries(patch.changes).filter(([, v]) => v !== null));
    const checked = validateSettingsChanges(sets, []);
    if (!checked.ok) throw new ApiError('validation', checked.problems[0]!.message, { fields: Object.fromEntries(checked.problems.map((p) => [p.key, p.message])) });
    const changes = { ...checked.values, ...Object.fromEntries(Object.keys(patch.changes).filter((k) => patch.changes[k] === null).map((k) => [k, null])) };
    const risky = Object.keys(changes).filter((k) => SETTINGS_META[k as keyof typeof SETTINGS_META]?.risky);
    if (risky.length) {
      const id = newId('apr');
      const labels = risky.map((k) => SETTINGS_META[k as keyof typeof SETTINGS_META].label).join(', ');
      await t.pool.query(
        "insert into approvals (id, kind, title, subtitle, requester_name, requested_by, payload, status) values ($1,'settings',$2,$3,$4,$5,$6,'pending')",
        [id, `Change a setting: ${labels}`, patch.note || 'A second person confirms this change before it applies.', user.name, user.id, JSON.stringify({ changes, note: patch.note, expectedVersion: patch.expectedVersion })]);
      return { pending: true, approvalId: id };
    }
    return { version: (await this.apply(t, { id: user.id, name: user.name }, changes, patch.note, patch.expectedVersion)).version };
  }

  /** Writes checked changes (the school's, or an approved request): the school's audit log, the console's history, the apps told. */
  async apply(t: TenantCtx, actor: { id: string; name: string }, changes: Record<string, unknown>, note: string, expectedVersion?: number): Promise<{ version: number }> {
    const after = await writeSettings(t.pool, { changes, note, expectedVersion, actorId: actor.id, actorName: actor.name })
      .catch((e) => { throw e instanceof StaleSettings ? new ApiError('conflict', e.message) : e; });
    this.cache.delete(t.info.slug);
    this.resolved.delete(t.info.slug);
    await recordSettingsVersion(this.registry.pool, t.info.id, after, note, `${actor.name} (school)`);
    this.registry.invalidate(t.info.slug);
    return { version: after.version };
  }

  async doc(t: TenantCtx): Promise<SettingsDoc> {
    const hit = this.cache.get(t.info.slug);
    if (hit && Date.now() - hit.at < 5000) return hit.doc;
    const [rows, meta] = await Promise.all([
      t.pool.query<{ key: string; value: unknown; updated_at: Date }>('select key, value, updated_at from settings'),
      t.pool.query<{ value: number }>("select value from meta where key = 'settings.version'"),
    ]);
    const values: Record<string, unknown> = {};
    let updated: Date | null = null;
    for (const r of rows.rows) {
      values[r.key] = r.value;
      if (!updated || r.updated_at > updated) updated = r.updated_at;
    }
    const doc: SettingsDoc = { version: meta.rows[0]?.value ?? 1, values, locked: t.info.entitlement.locks, updatedAt: updated?.toISOString() ?? null };
    this.cache.set(t.info.slug, { at: Date.now(), doc });
    return doc;
  }

  /** The weekdays (0 is Sunday) the school is closed every week (console: Academic year → Closed every week on). */
  async offDays(t: TenantCtx): Promise<number[]> {
    const names = await this.value<string[]>(t, 'calendar.weeklyOff', ['sun']);
    return names.map((n) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(n)).filter((i) => i >= 0);
  }

  /** The school's grading scale and pass mark (console: Exams and results), with the function that turns a percentage into a grade. */
  /**
   * How a mark is graded (§3.6.6): the scheme for a subject and year group (`at`), else the school's scale. `grade` gives the
   * grade; `of` the grade, points, descriptor and pass for a subject of its own.
   */
  async grading(t: TenantCtx, at: { grade?: number | null; subject?: string | null } = {}): Promise<{
    pass: number; scheme: GradingScheme; grade: (pct: number) => string; of: (pct: number, subject?: string | null) => ReturnType<typeof gradeIn>;
  }> {
    const v = await this.settingsOf(t);
    const scale = v['grading.scale'] as GradingScale;
    const fallback: GradingScheme = { key: 'school', name: 'Grades', kind: 'bands', passPct: v['grading.passPct'] as number, bands: scale };
    const schemes = v['grading.schemes'] as GradingScheme[] | undefined;
    const scheme = schemeFor(schemes, fallback, at);
    return {
      pass: scheme.passPct, scheme, grade: (pct) => gradeIn(scheme, pct).grade,
      of: (pct, subject) => gradeIn(subject ? schemeFor(schemes, fallback, { ...at, subject }) : scheme, pct),
    };
  }

  private readonly resolved = new Map<string, { at: string; values: Record<string, unknown> }>();

  /** Every setting as it applies: the platform default, the school's choice and Tangent's lock together (resolveConfig). */
  async settingsOf(t: TenantCtx): Promise<Record<string, unknown>> {
    const doc = await this.doc(t);
    const at = `${doc.version}|${t.info.entitlement.version}|${JSON.stringify(t.info.entitlement.locks ?? [])}`;
    const hit = this.resolved.get(t.info.slug);
    if (hit?.at === at) return hit.values;
    const values = resolveConfig({ settings: doc, entitlement: t.info.entitlement }).settings;
    this.resolved.set(t.info.slug, { at, values });
    return values;
  }

  /**
   * A phone number as the school keeps every one: international form (E.164), a local number taking the school's country.
   * Throws the field's problem when it cannot be a number there.
   */
  phone(t: TenantCtx, raw: string, field = 'phone'): string {
    const e164 = toE164(raw, t.info.country);
    if (!e164) throw new ApiError('validation', phoneProblem(raw, t.info.country)!, { fields: { [field]: phoneProblem(raw, t.info.country)! } });
    return e164;
  }

  /** What a fee is billed at: with the tax added when the school's fees do not include it and the head carries tax (§3.4.2). */
  async billed(t: TenantCtx, head: string, amount: number): Promise<number> {
    const cfg = await this.effective(t);
    const v = cfg.settings;
    if (!cfg.features.includes('fees.taxReceipts') || v['tax.inclusive'] !== false || !v['tax.number'] || !((v['tax.heads'] as string[] | undefined) ?? []).includes(head)) return amount;
    return amount + roundToCurrency((amount * Number(v['tax.ratePct'] ?? 0)) / 100);
  }

  /** A record's custom-field values checked against the school's fields (§3.6.3); `whole` for a new record (required ones needed). */
  async custom(t: TenantCtx, entity: CustomEntity, input: Record<string, unknown>, whole: boolean): Promise<CustomValues> {
    const defs = (await this.value<CustomFieldsSetting>(t, 'fields.custom', {}))[entity] ?? [];
    const { values, errors } = checkCustom(defs, input, whole);
    if (Object.keys(errors).length) {
      throw new ApiError('validation', 'Check the school’s own fields.', { fields: Object.fromEntries(Object.entries(errors).map(([k, m]) => [`custom.${k}`, m])) });
    }
    return values;
  }

  /** One setting as it applies (a lock wins); the fallback only when the setting does not exist at all. */
  async value<T>(t: TenantCtx, key: string, fallback: T): Promise<T> {
    const v = (await this.settingsOf(t))[key];
    return (v === undefined ? fallback : v) as T;
  }

  async effective(t: TenantCtx, permissions?: string[]): Promise<EffectiveConfig> {
    return resolveConfig({ settings: await this.doc(t), entitlement: t.info.entitlement, audience: permissions ? { permissions } : undefined, flags: t.info.flags, live: t.info.wentLive });
  }
}

type Channel = 'sms' | 'email' | 'whatsapp' | 'push';
export interface OutMsg { channel: Channel; to: string; subject?: string; body: string; key?: string; vars?: Record<string, string>; sendAfter?: Date | null; now?: boolean }

// Where a notification opens in the app: each message says so (MESSAGE_EVENTS).
const OPENS: Record<string, string> = Object.fromEntries(MESSAGE_EVENTS.filter((e) => e.opens).map((e) => [e.key, e.opens!]));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One email layout for every school: its name across the top in its brand colour, the message, and who sent it. */
/**
 * Refuses leave that overlaps leave already asked for or given (a family asking twice, the office recording what a parent
 * already sent). Half days of the same date only clash when they are the same half.
 */
export async function checkLeaveClash(q: { query: TenantCtx['pool']['query'] }, studentId: string, from: string, to: string, halfDay: string | null | undefined): Promise<void> {
  const r = await q.query(
    `select 1 from approvals where kind = 'leave' and status in ('pending','approved') and payload->>'studentId' = $1
       and (payload->>'from')::date <= $3::date and (payload->>'to')::date >= $2::date
       and not ($4::text is not null and payload->>'halfDay' is not null and payload->>'halfDay' <> $4)`, [studentId, from, to, halfDay ?? null]);
  if (r.rowCount) throw new ApiError('conflict', tx('There is already leave for some of these days.'), { fields: { from: tx('Overlaps other leave.') } });
}

export function emailHtml(school: string, color: string, body: string): string {
  // An email is not a page: mail clients need literal colours, so the school's brand colour is written in.
  const c = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#3D5AFE';
  return `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${c};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:600">${esc(school)}</td></tr>
<tr><td style="padding:24px;color:#1d1d22;font-size:15px;line-height:1.55">${esc(body).replace(/\n/g, '<br>')}</td></tr>
<tr><td style="padding:0 24px 20px;color:#6b6b76;font-size:12px">Sent by ${esc(school)} with Tangent.</td></tr>
</table></td></tr></table></body></html>`;
}

/**
 * Sends messages through the Integrations Hub: every message is a row in message_log, routed to the school's connection (or the
 * Test inbox on the test track), held in quiet hours, retried when a provider fails, and refused past the plan's SMS limit.
 */
@Injectable()
export class Messenger {
  constructor(
    private readonly hubs: HubService,
    private readonly settings: SettingsService,
  ) {}

  async send(t: TenantCtx, m: OutMsg): Promise<void> {
    await this.sendMany(t, [m]);
  }

  /** Texts (parts) sent by one school since the start of this month, for the plan card. */
  smsThisMonth(slug: string): Promise<number> {
    return this.hubs.hub.smsThisMonth(slug);
  }

  /** Many messages at once (a notice to every family): the plan's text limit counted across them, then recorded in bulk. */
  async sendMany(t: TenantCtx, list: OutMsg[]): Promise<void> {
    if (!list.length) return;
    const limit = t.info.entitlement.limits.smsPerMonth;
    // Sign-in codes are never refused: a family locked out of the app is worse than a text over the plan.
    const counted = (m: OutMsg) => m.channel === 'sms' && limit > 0 && !m.key?.startsWith('auth.');
    let used = list.some(counted) ? await this.hubs.hub.smsThisMonth(t.info.slug) : 0;
    const doc = list.some((m) => m.channel === 'email') ? (await this.settings.doc(t)).values : {};
    const out = list.map((m) => {
      const refuse = counted(m) && used++ >= limit ? `This month's ${limit} texts are used up. Tangent can raise the limit in the console.` : undefined;
      const html = m.channel === 'email' ? emailHtml(String(doc['school.name'] ?? t.info.name), String(doc['brand.color'] ?? ''), m.body) : undefined;
      return {
        schoolId: t.info.id, schoolSlug: t.info.slug, channel: m.channel, to: m.to, body: m.body, subject: m.subject, html, messageKey: m.key,
        vars: { ...(m.vars ?? {}), ...(m.key && OPENS[m.key] ? { route: OPENS[m.key]! } : {}) }, sendAfter: m.sendAfter, now: m.now, refuse,
      };
    });
    // A sign-in code goes alone and at once, and its failure reaches the person waiting for it.
    if (out.length === 1 && out[0]!.now) await this.hubs.hub.send(out[0]!);
    else await this.hubs.hub.sendMany(out);
  }

  /**
   * Sends one of the school's own messages: the wording comes from Message templates, the channels from Notifications, and outside
   * quiet hours only: in quiet hours a message is held until they end, then the dispatcher sends it.
   * Returns how many recipients were reached on at least one channel.
   */
  async notify(t: TenantCtx, key: string, who: { to: string; email?: string | null; vars: Record<string, string | number> }[]): Promise<number> {
    const ev = MESSAGE_EVENTS.find((e) => e.key === key);
    if (!ev) throw new Error(`Unknown message ${key}`);
    // A school without the module or feature a message belongs to never gets it (fee reminders without Fees, and so on).
    if (ev.needs) {
      const cfg = await this.settings.effective(t);
      if (!cfg.modules.includes(ev.needs) && !cfg.features.includes(ev.needs)) return 0;
    }
    const doc = (await this.settings.doc(t)).values;
    const rule: { push: boolean; sms: boolean; email: boolean; whatsapp?: boolean } = ((doc['notify.rules'] as Record<string, { push: boolean; sms: boolean; email: boolean; whatsapp?: boolean }> | undefined) ?? {})[key] ?? ev.defaults;
    // Each person reads the message in their own language: the school's wording in it, else the usual wording translated, else
    // the school's wording as written, else English.
    const custom = ((doc['templates.messages'] as Record<string, string | Record<string, string>> | undefined) ?? {})[key];
    const schoolLang = String(doc['school.language'] ?? 'en');
    const english = rawOf(ev);
    const textIn = (lang: string) => {
      const own = typeof custom === 'string' ? (lang === schoolLang ? custom : '') : custom?.[lang] ?? '';
      const anyOwn = typeof custom === 'string' ? custom : custom?.[schoolLang] ?? '';
      return own.trim() || (lang !== 'en' && serverCatalogue(lang)[english.text]) || anyOwn.trim() || english.text;
    };
    const [qf, qt] = [String(doc['notify.quietFrom'] ?? '21:00'), String(doc['notify.quietTo'] ?? '07:00')];
    const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const now = schoolMinutes();
    const quiet = !ev.urgent && (mins(qf) > mins(qt) ? now >= mins(qf) || now < mins(qt) : now >= mins(qf) && now < mins(qt));
    const school = String(doc['school.shortName'] ?? t.info.shortName);
    const sendAfter = quiet ? new Date(Date.now() + (((mins(qt) - now + 1440) % 1440) || 1440) * 60_000) : null;
    // A person who turned this message off in the app (Settings → Notifications) does not get it; urgent ones cannot be turned off.
    const off = ev.urgent || !who.length ? new Set<string>() : new Set((await t.pool.query<{ phone: string }>(
      `select u.phone from users u join user_prefs p on p.user_id = u.id and p.key = 'notify.off'
       where p.value ? $1 and u.phone is not null`, [key])).rows.map((r) => r.phone));
    // Phones are kept in international form, so the same number compares equal however it reached here.
    const digits = (s: string) => toE164(s, t.info.country) ?? s;
    const langs = !who.length ? new Map<string, string>() : new Map((await t.pool.query<{ phone: string; lang: string }>(
      // The family's own choice in the app first, else what the office set on the guardian's record.
      `select g.phone, coalesce(p.value #>> '{}', g.language) lang from guardians g left join user_prefs p on p.user_id = g.user_id and p.key = 'language'
        where g.phone = any($1) and coalesce(p.value #>> '{}', g.language) is not null
       union all select u.phone, p.value #>> '{}' from users u join user_prefs p on p.user_id = u.id and p.key = 'language' where u.phone = any($1)`,
      [who.map((w) => digits(w.to))])).rows.map((r) => [r.phone, r.lang]));
    // Channels a guardian asked the office not to use (urgent messages go on every channel the school chose).
    const offChannels = ev.urgent || !who.length ? new Map<string, string[]>() : new Map((await t.pool.query<{ phone: string; off: string[] }>(
      "select phone, channels_off off from guardians where phone = any($1) and jsonb_array_length(channels_off) > 0", [who.map((w) => digits(w.to))])).rows.map((r) => [r.phone, r.off]));
    let reached = 0;
    const out: OutMsg[] = [];
    for (const w of who.filter((x) => !off.has(digits(x.to)))) {
      const lang = langs.get(digits(w.to)) ?? schoolLang;
      const vars = Object.fromEntries(Object.entries({ ...w.vars, school: w.vars.school ?? school }).map(([k, v]) => [k, String(v)]));
      const body = textIn(lang).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
      const m = { key, vars, body, sendAfter };
      const before = out.length;
      // What the school sends on, less what this person turned off; never nothing: then the school's first channel stays.
      const school4 = (['push', 'sms', 'whatsapp', 'email'] as const).filter((c) => rule[c] && (c !== 'email' || !!w.email));
      const off = offChannels.get(digits(w.to)) ?? [];
      const use = school4.filter((c) => !off.includes(c));
      const send = new Set(use.length ? use : school4.slice(0, 1));
      if (send.has('push')) out.push({ ...m, channel: 'push', to: w.to, subject: school });
      if (send.has('sms')) out.push({ ...m, channel: 'sms', to: w.to });
      if (send.has('whatsapp')) out.push({ ...m, channel: 'whatsapp', to: w.to });
      if (send.has('email') && w.email) out.push({ ...m, channel: 'email', to: w.email, subject: (lang !== 'en' && serverCatalogue(lang)[english.label]) || english.label });
      if (out.length > before) reached++;
    }
    await this.sendMany(t, out);
    return reached;
  }
}
