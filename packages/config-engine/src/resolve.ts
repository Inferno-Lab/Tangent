import {
  SETTINGS_META,
  SchoolSettingsSchema,
  TIGHTEN,
  formatMessage,
  wordsFor,
  settingOwner,
  type AppLayout,
  type EffectiveConfig,
  type EntitlementDoc,
  type SettingsDoc,
  type Vocabulary,
} from '@tangent/contracts';
import { APP_CATALOG, APP_ROLES, activeFeatures, activeModules, adminMenu, hasKey, type AppRole } from './modules.js';

/** Layer 1: platform defaults, taken from the schema so there is one source. */
export function platformDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SchoolSettingsSchema.shape)) {
    const parsed = (field as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(undefined);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export interface ResolveInput {
  /** Layer 4, as saved by the school. */
  settings: SettingsDoc;
  /** Layers 2 and 3. */
  entitlement: EntitlementDoc;
  /** Layer 5: who is asking. Leave out for the unfiltered document. */
  audience?: { permissions: readonly string[] };
  /** Console flags for this school: a school's own value already wins over a fleet-wide one. */
  flags?: Record<string, boolean>;
  /** Whether the school has gone live (Moving in leaves the menu then). */
  live?: boolean;
}

/** Layers 1 to 5 in order. A higher layer changes a value only where the lower layer allows it (locks). */
export function resolveConfig({ settings, entitlement, audience, flags, live = true }: ResolveInput): EffectiveConfig {
  const merged: Record<string, unknown> = { ...platformDefaults() };
  for (const [k, v] of Object.entries(settings.values)) if (!entitlement.locks.includes(k) || TIGHTEN[k as keyof typeof TIGHTEN]) merged[k] = v;
  // A lock fixes the value; on a setting the school may only tighten, Tangent's value is the floor and the stricter one wins.
  for (const [k, v] of Object.entries(entitlement.overrides)) merged[k] = stricter(k, merged[k], v);
  // Every value read through its own schema, so one saved in an older shape reads as today's (payment methods as plain keys).
  const shape = SchoolSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
  for (const k of Object.keys(merged)) {
    const p = shape[k]?.safeParse(merged[k]);
    if (p?.success) merged[k] = p.data;
  }

  const entitled = activeModules(entitlement);
  // A console kill switch (`kill.<module>` or `kill.<feature>`) takes it away from every app until it is lifted.
  const enabled = entitled.filter((k) => flags?.[`kill.${k}`] !== true);
  const features = activeFeatures(entitlement, enabled).filter((k) => flags?.[`kill.${k}`] !== true);
  const has = { modules: enabled, features };
  const str = (k: string, fallback = '') => (typeof merged[k] === 'string' ? (merged[k] as string) : fallback);
  const lang = str('school.language', 'en');
  const words = vocabulary(merged);

  const menu: EffectiveConfig['menu'] = adminMenu(has, audience ? audience.permissions : null, live).map((g) => ({
    group: g.group,
    pages: g.pages.map((p) => ({
      id: p.id, module: p.module, icon: p.icon, keys: p.keys, href: p.path,
      label: p.id === 'stu' ? formatMessage('{@Students}', {}, lang, words) : p.label,
      tabs: (p.tabs ?? []).map((t) => ({ key: t.key, label: t.key === 'classes' ? formatMessage('{@Classes}', {}, lang, words) : t.label, href: `${p.path === '/' ? '' : p.path}/${t.key}` })),
      settings: p.settings ?? [],
    })),
  }));

  const roles = (Array.isArray(merged['app.roles']) ? (merged['app.roles'] as AppRole[]) : []).filter((r) => APP_ROLES.includes(r));
  const saved = (merged['app.layout'] ?? {}) as Partial<Record<AppRole, AppLayout>>;
  const layout = Object.fromEntries(APP_ROLES.map((role) => {
    const pick = (slot: 'dock' | 'home' | 'quick') => {
      const allowed = new Set(APP_CATALOG[slot].filter((c) => c.roles.includes(role) && enabled.includes(c.module) && hasKey(has, c.feature)).map((c) => c.key));
      return (saved[role]?.[slot] ?? []).filter((k) => allowed.has(k));
    };
    return [role, { dock: pick('dock'), home: pick('home'), quick: pick('quick') }];
  })) as Record<AppRole, AppLayout>;

  return {
    version: settings.version * 1000 + entitlement.version,
    school: {
      name: str('school.name'),
      shortName: str('school.shortName'),
      color: str('brand.color', '#6A4CF5'),
      logoText: str('brand.logoText') || str('school.shortName').slice(0, 1).toUpperCase(),
      language: str('school.language', 'en'),
      tagline: str('school.tagline'),
      place: str('school.place'),
      address: str('school.address'),
      phone: str('school.phone'),
      email: str('school.email'),
    },
    modules: enabled,
    features,
    menu,
    settings: merged,
    vocabulary: words,
    vocab: (merged['vocab.words'] ?? {}) as Vocabulary,
    limits: entitlement.limits,
    app: { roles, layout },
    privacy: { notice: str('privacy.notice'), officerName: str('privacy.officerName'), officerEmail: str('privacy.officerEmail'), officerPhone: str('privacy.officerPhone') },
    flags: flags ?? {},
  };
}

/** For a setting the school may only tighten, the stricter of the school's value and Tangent's floor; otherwise Tangent's. */
export function stricter(key: string, school: unknown, floor: unknown): unknown {
  const how = TIGHTEN[key as keyof typeof TIGHTEN];
  if (!how || school === undefined) return floor;
  if (how === 'on') return floor === true || school === true;
  if (typeof school !== 'number' || typeof floor !== 'number') return floor;
  return how === 'min' ? Math.max(school, floor) : Math.min(school, floor);
}

/** The permission a person needs, besides `settings.manage`, to change a module's settings: the one that changes its data. */
const WRITE_PERMISSION: Record<string, string> = {
  school: 'setup.write', people: 'students.write', attendance: 'attendance.mark', timetable: 'timetable.edit', homework: 'homework.write',
  exams: 'exams.write', fees: 'fees.collect', notices: 'notices.publish', events: 'events.write', library: 'library.write', transport: 'transport.write',
};

/** The permissions a person needs to change one setting from the school's admin. */
export function settingPermissions(key: string): string[] {
  const extra = WRITE_PERMISSION[SETTINGS_META[key as keyof typeof SETTINGS_META]?.group ?? ''];
  return extra ? ['settings.manage', extra] : ['settings.manage'];
}

/**
 * Checks a change the school makes itself: only its own settings, none Tangent has locked, a tightened setting no looser than
 * Tangent's floor, and the person allowed. Returns the problems by key (empty when the change may go ahead).
 */
export function checkSchoolChanges(changes: Record<string, unknown>, entitlement: Pick<EntitlementDoc, 'locks' | 'overrides'>, permissions: readonly string[]): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in SETTINGS_META)) problems.push({ key, message: 'That setting does not exist.' });
    else if (settingOwner(key) === 'tangent') problems.push({ key, message: 'Tangent sets this for your school. Ask Tangent to change it.' });
    else if (!settingPermissions(key).every((p) => permissions.includes(p))) problems.push({ key, message: 'You are not allowed to change this setting.' });
    else if (entitlement.locks.includes(key)) {
      const floor = entitlement.overrides[key];
      if (!TIGHTEN[key as keyof typeof TIGHTEN]) problems.push({ key, message: 'Tangent has fixed this setting for your school.' });
      else if (value !== null && JSON.stringify(stricter(key, value, floor)) !== JSON.stringify(value)) problems.push({ key, message: TIGHTEN[key as keyof typeof TIGHTEN] === 'on' ? 'Tangent requires this to stay on.' : `Tangent requires at ${TIGHTEN[key as keyof typeof TIGHTEN] === 'min' ? 'least' : 'most'} ${String(floor)} here.` });
    }
  }
  return problems;
}

/** What the school calls a student, a class… in its default language, one and many. */
export function vocabulary(values: Record<string, unknown>): Record<string, string> {
  return wordsFor(String(values['school.language'] ?? 'en'), values['vocab.words'] as Vocabulary | undefined);
}

export interface SettingsProblem {
  key: string;
  message: string;
}

/** Checks a patch against the schema and the locks. Returns the clean values or the problems, never a half-applied change. */
export function validateSettingsChanges(
  changes: Record<string, unknown>,
  locked: readonly string[],
): { ok: true; values: Record<string, unknown> } | { ok: false; problems: SettingsProblem[] } {
  const problems: SettingsProblem[] = [];
  const values: Record<string, unknown> = {};
  const shape = SchoolSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } }>;
  for (const [key, raw] of Object.entries(changes)) {
    const field = shape[key];
    if (!field) {
      problems.push({ key, message: 'That setting does not exist.' });
      continue;
    }
    if (locked.includes(key)) {
      problems.push({ key, message: 'Tangent has fixed this setting for your school.' });
      continue;
    }
    const res = field.safeParse(raw);
    if (!res.success) problems.push({ key, message: res.error?.issues[0]?.message ?? 'That value is not allowed.' });
    else values[key] = res.data;
  }
  return problems.length ? { ok: false, problems } : { ok: true, values };
}

