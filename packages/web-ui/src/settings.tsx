import { useState, type ReactNode } from 'react';
import { APP_CATALOG, APP_ROLES, APP_ROLE_LABELS, hasKey, type AppRole } from '@tangent/config-engine';
import { rawOf, tx, VOCAB_CONCEPTS, languageLabel, wordsFor, type VocabConcept, type Vocabulary, type Word, ATTENDANCE_MARKS, CATEGORY_TONES, CATEGORY_TONE_LABELS, DEFAULT_BRAND, MARK_MEANING_LABELS, MESSAGE_EVENTS, PAYMENT_KINDS, PAYMENT_KIND_LABELS, type AppLayout, type AttendanceMarkDef, type Category, type ListItem, CUSTOM_ENTITIES, FIELD_KINDS, DEFAULT_STEP, PROCESS_LABELS, STEP_ACTORS, STEP_ACTOR_LABELS, STEP_TIMEOUTS, STEP_TIMEOUT_LABELS, WORKFLOW_PROCESSES, type StepDef, type WorkflowProcess, type WorkflowsSetting, type CustomEntity, type CustomFieldsSetting, type FieldDef, type FieldKind, type PaymentMethod, type SettingMeta } from '@tangent/contracts';
import { Checkbox, DateField, FilePick, NumberField, TimeField } from './fields';
import { ColourField } from './ColourPicker';
import { ErrorLine, Field, SelectField } from './forms';
import { Select } from './Select';
import { Icon } from './Icon';
import { t as tr } from './i18n';

/** What a setting's editor picks from: the school's classes and fee heads, and what it has, so the app's choices fit its modules. */
export interface SettingCtx {
  classes: { id: string; name: string }[];
  feeHeads: { key: string; name: string }[];
  entitled: readonly string[];
  features: readonly string[];
  /** The settings as they apply now: the words editor offers the school's languages. */
  values?: Record<string, unknown>;
  /** Who a request's step can name: the school's roles (by key) and its staff. */
  roles?: { key: string; name: string }[];
  staff?: { id: string; name: string }[];
}

/** The channels a message can go through, as the Hub sends them. */
const CHANNELS = [['push', tr('ui.settings.app')], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', tr('ui.settings.email')]] as const;
const ta = { width: '100%', minHeight: 90, resize: 'vertical', border: 0, outline: 0, background: 'none', font: '400 14px/1.5 var(--fb)', color: 'var(--ink)', padding: '10px 0' } as const;

/**
 * One setting's editor, built from its SETTINGS_META entry: the console (Tangent) and the school's admin draw every setting
 * with this, so a new setting needs no new screen in either.
 */
export function SettingRow({ meta, value, error, disabled, ctx, logo, onLogo, onChange, note, after }: {
  meta: SettingMeta; value: unknown; error?: string; disabled: boolean; ctx: SettingCtx; logo?: File | null; onLogo?: (f: File | null) => void; onChange: (v: unknown) => void;
  /** Why it is read-only (a Tangent lock), or anything else to say under it. */
  note?: ReactNode;
  /** Shown under the control (the console's colour card under the brand colour). */
  after?: ReactNode;
}) {
  const label = <>{meta.label}{meta.risky && <span className="chip a" style={{ marginInlineStart: 8 }}>{tr('ui.settings.needs_a_second_person')}</span>}</>;
  const help = note ?? meta.help;
  const str = typeof value === 'string' ? value : '';
  const list = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (key: string, max?: number) => onChange(list.includes(key) ? list.filter((x) => x !== key) : max && list.length >= max ? list : [...list, key]);
  const box = (body: React.ReactNode) => (
    <div className="fld" style={{ marginTop: 12 }}>
      <label>{label}</label>
      {body}
      {error ? <ErrorLine>{error}</ErrorLine> : help ? <div className="help">{help}</div> : null}
    </div>
  );
  const pick = (options: { key: string; label: string }[], max?: number) => box(
    <div className="tgrow">{options.map((o) => {
      const at = list.indexOf(o.key);
      return <button key={o.key} type="button" className={`chip ${at >= 0 ? 'v' : ''}`} aria-pressed={at >= 0} disabled={disabled} onClick={() => toggle(o.key, max)} style={{ cursor: disabled ? 'default' : 'pointer' }}>{at >= 0 && meta.kind !== 'classes' && meta.kind !== 'multi' && meta.kind !== 'appRoles' ? `${at + 1}. ` : ''}{o.label}</button>;
    })}{max && <span className="help">{list.length} {tr('ui.settings.of')}{' '}{max}</span>}</div>,
  );
  switch (meta.kind) {
    case 'bool':
      return box(<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button type="button" className={`sw ${value === true ? 'on' : ''}`} role="switch" aria-checked={value === true} aria-label={meta.label} disabled={disabled} onClick={() => onChange(value !== true)} /><span className="help" style={{ margin: 0 }}>{value === true ? tr('ui.settings.on') : tr('ui.settings.off')}</span></div>);
    case 'enum': case 'language':
      return box(<Select value={str} onChange={onChange} disabled={disabled} aria-label={meta.label} options={(meta.options ?? []).map(([v, l]) => ({ value: v, label: l }))} />);
    case 'number':
      return <div style={{ marginTop: 12 }}><NumberField label={meta.label} min={meta.min} max={meta.max} value={value == null ? '' : String(value)} onChange={(v) => onChange(v === '' ? null : Number(v))} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /></div>;
    case 'color':
      return box(<><ColourField label={meta.label} value={str || DEFAULT_BRAND} onChange={onChange} disabled={disabled} />{after}</>);
    case 'time': case 'date':
      return <div style={{ marginTop: 12 }}>{meta.kind === 'date' ? <DateField label={meta.label} value={str} onChange={(v) => onChange(v || null)} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /> : <TimeField label={meta.label} value={str} onChange={(v) => onChange(v || null)} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} />}</div>;
    case 'textarea':
      return box(<div className={`inp ${error ? 'err' : ''}`} style={{ height: 'auto' }}><textarea value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={meta.label} style={ta} /></div>);
    case 'logo':
      return box(<LogoPick has={!!str} picked={logo ?? null} disabled={disabled || !onLogo} onPick={(f) => onLogo?.(f)} />);
    case 'multi':
      // `fees.gstHeads` names the school's own fee heads; every other list names its options.
      return pick(meta.options ? meta.options.map(([key, l]) => ({ key, label: l })) : ctx.feeHeads.map((h) => ({ key: h.key, label: h.name })));
    case 'appRoles': return pick(APP_ROLES.map((r) => ({ key: r, label: APP_ROLE_LABELS[r] })));
    case 'appLayout':
      return box(<AppLayoutEditor value={(value ?? {}) as Record<AppRole, AppLayout>} has={{ modules: ctx.entitled, features: ctx.features }} disabled={disabled} onChange={onChange} />);
    case 'classes': return pick(ctx.classes.map((c) => ({ key: c.id, label: c.name })), meta.max);
    case 'strings':
      return box(<ListEditor items={list} max={meta.max ?? 12} disabled={disabled} placeholder={tr('ui.settings.add_one')} onChange={onChange} />);
    case 'houses':
      return box(<HousesEditor value={(Array.isArray(value) ? value : []) as { key: string; name: string; color: string }[]} max={meta.max ?? 12} disabled={disabled} onChange={onChange} />);
    case 'categories':
      return box(<CategoriesEditor value={(Array.isArray(value) ? value : []) as Category[]} max={meta.max ?? 16} disabled={disabled} onChange={onChange} />);
    case 'attendanceMarks':
      return box(<AttendanceMarksEditor value={(Array.isArray(value) ? value : []) as AttendanceMarkDef[]} max={meta.max ?? 20} disabled={disabled} onChange={onChange} />);
    case 'paymentMethods':
      return box(<PaymentMethodsEditor value={(Array.isArray(value) ? value : []) as PaymentMethod[]} max={meta.max ?? 16} disabled={disabled} onChange={onChange} />);
    case 'vocabulary': {
      const v = ctx.values ?? {};
      const langs = [...new Set([String(v['school.language'] ?? 'en'), ...(Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : [])])];
      return box(<VocabularyEditor value={(value ?? {}) as Vocabulary} languages={langs} disabled={disabled} onChange={onChange} />);
    }
    case 'list': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<ListItemsEditor value={(Array.isArray(value) ? value : []) as ListItem[]} languages={others} max={meta.max ?? 40} disabled={disabled} onChange={onChange} />);
    }
    case 'customFields': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<CustomFieldsEditor value={(value ?? {}) as CustomFieldsSetting} languages={others} disabled={disabled} onChange={onChange} />);
    }
    case 'workflows': {
      const v = ctx.values ?? {};
      const others = (Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : []).filter((l) => l !== String(v['school.language'] ?? 'en'));
      return box(<WorkflowsEditor value={(value ?? {}) as WorkflowsSetting} languages={others} roles={ctx.roles ?? []} staff={ctx.staff ?? []} disabled={disabled} onChange={onChange} />);
    }
    case 'gradingScale':
      return box(<GradingEditor value={(Array.isArray(value) ? value : []) as { grade: string; minPct: number }[]} max={meta.max ?? 12} disabled={disabled} onChange={onChange} />);
    case 'notifyRules': {
      const rules = (value ?? {}) as Record<string, { push: boolean; sms: boolean; email: boolean; whatsapp?: boolean }>;
      const set = (ev: string, ch: (typeof CHANNELS)[number][0], on: boolean) => {
        const base = rules[ev] ?? MESSAGE_EVENTS.find((e) => e.key === ev)!.defaults;
        onChange({ ...rules, [ev]: { ...base, [ch]: on } });
      };
      return box(<div>{MESSAGE_EVENTS.map((e) => {
        const r = rules[e.key] ?? e.defaults;
        return (
          <div key={e.key} className="kv" style={{ flexWrap: 'wrap', gap: 8 }}>{e.label}{e.urgent ? tr('ui.settings.sent_in_quiet_hours') : ''}
            <b style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{CHANNELS.map(([ch, label]) => (
              <Checkbox key={ch} checked={!!(r as Record<string, boolean | undefined>)[ch]} disabled={disabled} onChange={(c) => set(e.key, ch, c)} label={label} />
            ))}</b>
          </div>
        );
      })}</div>);
    }
    case 'templates': {
      const v = ctx.values ?? {};
      const school = String(v['school.language'] ?? 'en');
      const langs = [...new Set([school, ...(Array.isArray(v['app.languages']) ? (v['app.languages'] as string[]) : [])])];
      return box(<TemplatesEditor value={(value ?? {}) as Record<string, string | Record<string, string>>} school={school} languages={langs} disabled={disabled} onChange={onChange} />);
    }
    default:
      return <div style={{ marginTop: 12 }}><Field label={meta.label} value={str} onChange={onChange} disabled={disabled} error={error} hint={typeof help === 'string' ? help || undefined : undefined} /></div>;
  }
}

/** The logo is a file: picked here, sent with the rest of the change when it is saved. */
function LogoPick({ has, picked, disabled, onPick }: { has: boolean; picked: File | null; disabled: boolean; onPick: (f: File | null) => void }) {
  const [err, setErr] = useState('');
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`chip ${picked ? 'a' : has ? 'g' : ''}`}>{picked ? tr('ui.settings.not_saved_yet', { name: picked.name }) : has ? tr('ui.settings.logo_set') : tr('ui.settings.letters_only')}</span>
        <FilePick accept="image/png,image/jpeg" disabled={disabled} className="btn sm" onPick={(f) => {
          if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr(tr('ui.settings.choose_a_png_or_jpeg'));
          if (f.size > 2 * 1024 * 1024) return setErr(tr('ui.settings.the_logo_must_be_2'));
          setErr(''); onPick(f);
        }}>{has || picked ? tr('ui.settings.choose_another') : tr('ui.settings.choose_a_logo')}</FilePick>
        {picked && <button className="btn sm" onClick={() => onPick(null)}>{tr('ui.settings.keep_the_old_one')}</button>}
      </div>
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  );
}

/** For each app role: its bottom tabs, Home cards and quick buttons, in order, from what the school's modules offer that role. */
function AppLayoutEditor({ value, has, disabled, onChange }: { value: Record<AppRole, AppLayout>; has: { modules: readonly string[]; features: readonly string[] }; disabled: boolean; onChange: (v: unknown) => void }) {
  const [role, setRole] = useState<AppRole>('parent');
  const cur = value[role] ?? { dock: [], home: [], quick: [] };
  const slots = [['dock', tr('ui.settings.bottom_tabs'), 4], ['home', tr('ui.settings.home_cards'), 12], ['quick', tr('ui.settings.quick_buttons'), 6]] as const;
  const set = (slot: keyof AppLayout, key: string, max: number) => {
    const list = cur[slot];
    const next = list.includes(key) ? list.filter((x) => x !== key) : list.length >= max ? list : [...list, key];
    onChange({ ...value, [role]: { ...cur, [slot]: next } });
  };
  return (
    <div>
      <div style={{ maxWidth: 260 }}><Select value={role} onChange={(r) => setRole(r as AppRole)} aria-label={tr('ui.settings.role')} options={APP_ROLES.map((r) => ({ value: r, label: APP_ROLE_LABELS[r] }))} /></div>
      {slots.map(([slot, title, max]) => {
        const offered = APP_CATALOG[slot].filter((c) => c.roles.includes(role) && has.modules.includes(c.module) && hasKey(has, c.feature));
        return (
          <div key={slot} style={{ marginTop: 10 }}>
            <div className="help" style={{ margin: '0 0 4px' }}><b>{title}</b> · {cur[slot].length} {tr('ui.settings.of')}{' '}{max}{slot === 'dock' ? tr('ui.settings.profile_is_always_last') : ''}</div>
            <div className="tgrow">{offered.length ? offered.map((o) => {
              const at = cur[slot].indexOf(o.key);
              return <button key={o.key} type="button" className={`chip ${at >= 0 ? 'v' : ''}`} aria-pressed={at >= 0} disabled={disabled} onClick={() => set(slot, o.key, max)}>{at >= 0 ? `${at + 1}. ` : ''}{o.label}</button>;
            }) : <span className="help" style={{ margin: 0 }}>{tr('ui.settings.the_school_s_modules_offer')}</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A short list of words (leave reasons): add, rename in place, remove. */
function ListEditor({ items, max, disabled, placeholder, onChange }: { items: string[]; max: number; disabled: boolean; placeholder: string; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (v && !items.includes(v) && items.length < max) { onChange([...items, v]); setDraft(''); } };
  return (
    <div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Field label={tr('ui.settings.item', { p0: i + 1 })} value={it} maxLength={40} disabled={disabled} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} /></div>
          <button type="button" className="btn sm" disabled={disabled || items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {items.length < max && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><Field label={tr('ui.settings.new')} value={draft} maxLength={40} disabled={disabled} placeholder={placeholder} onChange={setDraft} /></div>
          <button type="button" className="btn sm" disabled={disabled || !draft.trim()} onClick={add}>{tr('ui.settings.add')}</button>
        </div>
      )}
    </div>
  );
}

const keyOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';

/** The school's houses and their colours. */
function HousesEditor({ value, max, disabled, onChange }: { value: { key: string; name: string; color: string }[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<{ name: string; color: string }>) => onChange(value.map((h, j) => (j === i ? { ...h, ...patch, ...(patch.name !== undefined ? { key: keyOf(patch.name) } : {}) } : h)));
  return (
    <div>
      {!value.length && <div className="help" style={{ margin: 0 }}>{tr('ui.settings.no_houses_profiles_and_the')}</div>}
      {value.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.house')} value={h.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <ColourField label={tr('ui.settings.colour')} value={h.color} disabled={disabled} onChange={(c) => put(i, { color: c })} />
          <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `house-${value.length + 1}`, name: tr('ui.settings.house_2', { p0: value.length + 1 }), color: DEFAULT_BRAND }])}>{tr('ui.settings.add_a_house')}</button>}
    </div>
  );
}

/** Categories of notices or events: a name and the colour pair they are drawn in. */
function CategoriesEditor({ value, max, disabled, onChange }: { value: Category[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<Category>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      {value.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.category')} value={c.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 160 }}><SelectField label={tr('ui.settings.colour')} value={c.tone} disabled={disabled} onChange={(t) => put(i, { tone: t as Category['tone'] })} options={CATEGORY_TONES.map((t) => ({ value: t, label: CATEGORY_TONE_LABELS[t] }))} /></div>
          <span className={`chip ${c.tone}`} style={{ marginBottom: 10 }}>{c.name || tr('ui.settings.category')}</span>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `cat-${Date.now().toString(36).slice(-6)}`, name: tr('ui.settings.new_category'), tone: 'v' }])}>{tr('ui.settings.add_a_category')}</button>}
      <div className="help">{tr('ui.settings.a_category_s_key_stays')}</div>
    </div>
  );
}

/** Grades from the lowest percentage that earns each, highest first. */
function GradingEditor({ value, max, disabled, onChange }: { value: { grade: string; minPct: number }[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const sorted = (rows: { grade: string; minPct: number }[]) => [...rows].sort((a, b) => b.minPct - a.minPct);
  const put = (i: number, patch: Partial<{ grade: string; minPct: number }>) => onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const lowest = value.length ? Math.min(...value.map((g) => g.minPct)) : 0;
  return (
    <div>
      {value.map((g, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ width: 120 }}><Field label={tr('ui.settings.grade')} value={g.grade} maxLength={4} disabled={disabled} onChange={(v) => put(i, { grade: v })} /></div>
          <div style={{ width: 160 }}><NumberField label={tr('ui.settings.from')} min={0} max={100} value={String(g.minPct)} disabled={disabled} onChange={(v) => put(i, { minPct: v === '' ? 0 : Number(v) })} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {value.length < max && <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...value, { grade: '?', minPct: 0 }])}>{tr('ui.settings.add_a_grade')}</button>}
        <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(sorted(value))}>{tr('ui.settings.put_in_order')}</button>
      </div>
      {lowest > 0 && <div className="help">{tr('ui.settings.no_grade_starts_at_0')}{' '}{lowest}{tr('ui.settings.would_get_no_grade_add')}</div>}
    </div>
  );
}


/** The ways the school takes money: the name the office uses, and what kind of money it is (reports group by the kind). */
/** A school list (§3.6.5): rename, add, retire or bring back an item, and name it in the school's other languages. */
function ListItemsEditor({ value, languages, max, disabled, onChange }: { value: ListItem[]; languages: string[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<ListItem>) => onChange(value.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      {value.map((it, i) => {
        const off = it.active === false;
        return (
          <div key={it.key} style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', opacity: off ? 0.6 : 1 }}>
              <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.item', { p0: i + 1 })} value={it.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
              <div style={{ width: 100 }}><Field label={tr('ui.settings.code')} value={it.code ?? ''} maxLength={8} disabled={disabled} onChange={(v) => put(i, { code: v || undefined })} /></div>
              {languages.length > 0 && <button type="button" className="btn sm" aria-expanded={open === i} disabled={disabled} onClick={() => setOpen(open === i ? null : i)}>{tr('ui.settings.other_languages')}</button>}
              <button type="button" className="btn sm" disabled={disabled || (!off && value.filter((x) => x.active !== false).length <= 1)} onClick={() => put(i, { active: off ? undefined : false })}>{off ? tr('ui.settings.bring_back') : tr('ui.settings.retire')}</button>
            </div>
            {open === i && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
              <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={it.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
                const names = { ...it.names, [l]: v };
                if (!v) delete names[l];
                put(i, { names: Object.keys(names).length ? names : undefined });
              }} /></div>
            ))}</div>}
          </div>
        );
      })}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        let n = value.length + 1;
        while (value.some((x) => x.key === `item-${n}`)) n++;
        onChange([...value, { key: `item-${n}`, name: tr('ui.settings.new_item') }]);
      }}>{tr('ui.settings.add_an_item')}</button>}
      <div className="help">{tr('ui.settings.an_item_keeps_its_key')}</div>
    </div>
  );
}

const ENTITY_LABEL: Record<CustomEntity, string> = { student: tr('ui.settings.student_records'), staff: tr('ui.settings.staff_records') };
const KIND_LABEL: Record<FieldKind, string> = {
  text: tr('ui.settings.kind_text'), longText: tr('ui.settings.kind_long_text'), number: tr('ui.settings.kind_number'), date: tr('ui.settings.kind_date'), choice: tr('ui.settings.kind_choice'),
  multi: tr('ui.settings.kind_multi'), yesno: tr('ui.settings.kind_yesno'), phone: tr('ui.settings.kind_phone'), email: tr('ui.settings.kind_email'),
};

/** The school's own fields (§3.6.3), per kind of record: name, kind, choices, whether it is needed and whether families see it. */
function CustomFieldsEditor({ value, languages, disabled, onChange }: { value: CustomFieldsSetting; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [entity, setEntity] = useState<CustomEntity>('student');
  const list = value[entity] ?? [];
  const setList = (next: FieldDef[]) => onChange({ ...value, [entity]: next });
  const put = (i: number, patch: Partial<FieldDef>) => setList(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const add = () => {
    let n = list.length + 1;
    while (list.some((f) => f.key === `field_${n}`)) n++;
    setList([...list, { key: `field_${n}`, label: tr('ui.settings.new_field'), kind: 'text' }]);
  };
  return (
    <div>
      <div style={{ maxWidth: 260 }}><Select value={entity} onChange={(e) => setEntity(e as CustomEntity)} aria-label={tr('ui.settings.records')} options={CUSTOM_ENTITIES.map((e) => ({ value: e, label: ENTITY_LABEL[e] }))} /></div>
      {!list.length && <div className="help">{tr('ui.settings.no_fields_yet')}</div>}
      {list.map((f, i) => (
        <div key={f.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.field_name')} value={f.label} maxLength={40} disabled={disabled} onChange={(v) => put(i, { label: v })} /></div>
            <div style={{ width: 180 }}><SelectField label={tr('ui.settings.field_kind')} value={f.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as FieldKind, options: k === 'choice' || k === 'multi' ? f.options ?? [{ key: 'one', name: tr('ui.settings.first_choice') }] : undefined })} options={FIELD_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></div>
            <button type="button" className="btn sm" disabled={disabled} onClick={() => setList(list.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          <div className="tgrow" style={{ marginTop: 8 }}>
            <Checkbox checked={!!f.required} disabled={disabled} label={tr('ui.settings.needed')} onChange={(on) => put(i, { required: on || undefined })} />
            <Checkbox checked={!!f.app} disabled={disabled} label={tr('ui.settings.shown_in_the_app')} onChange={(on) => put(i, { app: on || undefined })} />
          </div>
          <div style={{ marginTop: 6 }}><Field label={tr('ui.settings.field_hint')} value={f.hint ?? ''} maxLength={120} disabled={disabled} onChange={(v) => put(i, { hint: v || undefined })} /></div>
          {languages.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
            <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={f.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
              const names = { ...f.names, [l]: v };
              if (!v) delete names[l];
              put(i, { names: Object.keys(names).length ? names : undefined });
            }} /></div>
          ))}</div>}
          {(f.kind === 'choice' || f.kind === 'multi') && <div style={{ marginTop: 8 }}><div className="help" style={{ margin: 0 }}><b>{tr('ui.settings.choices')}</b></div><ListItemsEditor value={f.options ?? []} languages={languages} max={40} disabled={disabled} onChange={(o) => put(i, { options: o as ListItem[] })} /></div>}
        </div>
      ))}
      {list.length < 30 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={add}>{tr('ui.settings.add_a_field')}</button>}
      <div className="help">{tr('ui.settings.removing_a_field_keeps')}</div>
    </div>
  );
}

/** The school's steps for each kind of request (§3.6.1): in order, who takes each, above which amount, and what a long wait does. */
function WorkflowsEditor({ value, languages, roles, staff, disabled, onChange }: {
  value: WorkflowsSetting; languages: string[]; roles: { key: string; name: string }[]; staff: { id: string; name: string }[]; disabled: boolean; onChange: (v: unknown) => void;
}) {
  const [kind, setKind] = useState<WorkflowProcess>('leave');
  const own = value[kind];
  const steps = own?.length ? own : [DEFAULT_STEP];
  const setSteps = (next: StepDef[]) => onChange({ ...value, [kind]: next.length === 1 && next[0]!.who === 'permission' && next[0]!.above === undefined && !next[0]!.days && next[0]!.key === 'decide' ? undefined : next });
  const put = (i: number, patch: Partial<StepDef>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const next = [...steps]; [next[i], next[i + d]] = [next[i + d]!, next[i]!]; setSteps(next); };
  const add = () => {
    let n = steps.length + 1;
    while (steps.some((s) => s.key === `step-${n}`)) n++;
    setSteps([...steps, { key: `step-${n}`, name: tr('ui.settings.new_step'), who: 'permission' }]);
  };
  return (
    <div>
      <div style={{ maxWidth: 320 }}><Select value={kind} onChange={(k) => setKind(k as WorkflowProcess)} aria-label={tr('ui.settings.kind_of_request')} options={WORKFLOW_PROCESSES.map((p) => ({ value: p, label: PROCESS_LABELS[p] }))} /></div>
      {steps.map((s, i) => (
        <div key={s.key} className="card" style={{ padding: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <span className="chip" style={{ marginBottom: 10 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.step')} value={s.name} maxLength={40} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
            <div style={{ width: 230 }}><SelectField label={tr('ui.settings.who_takes_it')} value={s.who} disabled={disabled} onChange={(w) => put(i, { who: w as StepDef['who'], ref: undefined })} options={STEP_ACTORS.map((a) => ({ value: a, label: STEP_ACTOR_LABELS[a] }))} /></div>
            {s.who === 'role' && <div style={{ width: 200 }}><SelectField label={tr('ui.settings.role')} value={s.ref ?? ''} disabled={disabled} onChange={(r) => put(i, { ref: r })} options={[{ value: '', label: tr('ui.settings.choose') }, ...roles.map((r) => ({ value: r.key, label: r.name }))]} /></div>}
            {s.who === 'person' && <div style={{ width: 200 }}><SelectField label={tr('ui.settings.person')} value={s.ref ?? ''} disabled={disabled} onChange={(r) => put(i, { ref: r })} options={[{ value: '', label: tr('ui.settings.choose') }, ...staff.map((p) => ({ value: p.id, label: p.name }))]} /></div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 }}>
            {(kind === 'fee_waiver' || kind === 'receipt_cancel') && <div style={{ width: 200 }}><NumberField label={tr('ui.settings.only_above_amount')} min={0} value={s.above === undefined ? '' : String(s.above)} disabled={disabled} onChange={(v) => put(i, { above: v === '' ? undefined : Math.round(Number(v)) })} /></div>}
            <div style={{ width: 160 }}><NumberField label={tr('ui.settings.days_to_answer')} min={1} max={60} value={s.days === undefined ? '' : String(s.days)} disabled={disabled} onChange={(v) => put(i, { days: v === '' ? undefined : Number(v), then: v === '' ? undefined : s.then ?? 'remind' })} /></div>
            {s.days !== undefined && <div style={{ width: 260 }}><SelectField label={tr('ui.settings.then')} value={s.then ?? 'remind'} disabled={disabled} onChange={(v) => put(i, { then: v as StepDef['then'] })} options={STEP_TIMEOUTS.map((x) => ({ value: x, label: STEP_TIMEOUT_LABELS[x] }))} /></div>}
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_up')} disabled={disabled || i === 0} onClick={() => move(i, -1)}><Icon name="caretUp" /></button>
            <button type="button" className="btn sm" aria-label={tr('ui.settings.move_down')} disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)}><Icon name="caretDown" /></button>
            <button type="button" className="btn sm" disabled={disabled || steps.length <= 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
          </div>
          {languages.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{languages.map((l) => (
            <div key={l} style={{ flex: 1, minWidth: 160 }}><Field label={languageLabel(l)} value={s.names?.[l] ?? ''} maxLength={40} disabled={disabled} onChange={(v) => {
              const names = { ...s.names, [l]: v };
              if (!v) delete names[l];
              put(i, { names: Object.keys(names).length ? names : undefined });
            }} /></div>
          ))}</div>}
        </div>
      ))}
      {steps.length < 6 && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={add}>{tr('ui.settings.add_a_step')}</button>}
      <div className="help">{tr('ui.settings.steps_help')}</div>
    </div>
  );
}

function PaymentMethodsEditor({ value, max, disabled, onChange }: { value: PaymentMethod[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<PaymentMethod>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const keyOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'method';
  return (
    <div>
      {value.map((m, i) => (
        <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label={tr('ui.settings.method')} value={m.name} maxLength={30} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 180 }}><SelectField label={tr('ui.settings.kind_of_money')} value={m.kind} disabled={disabled} onChange={(k) => put(i, { kind: k as PaymentMethod['kind'] })} options={PAYMENT_KINDS.map((k) => ({ value: k, label: PAYMENT_KIND_LABELS[k] }))} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        const name = tr('ui.settings.new_method');
        let key = keyOf(name);
        for (let n = 2; value.some((m) => m.key === key); n++) key = `${keyOf(name)}-${n}`;
        onChange([...value, { key, name, kind: 'other' }]);
      }}>{tr('ui.settings.add_a_method')}</button>}
      <div className="help">{tr('ui.settings.a_method_keeps_its_key')}</div>
    </div>
  );
}

/** The school's wording of each message, per language it offers; empty keeps the usual wording (translated for each reader). */
function TemplatesEditor({ value, school, languages, disabled, onChange }: { value: Record<string, string | Record<string, string>>; school: string; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [lang, setLang] = useState(school);
  const textOf = (k: string) => { const c = value[k]; return typeof c === 'string' ? (lang === school ? c : '') : c?.[lang] ?? ''; };
  const put = (k: string, text: string) => {
    const c = value[k];
    const own = { ...(typeof c === 'string' ? (c.trim() ? { [school]: c } : {}) : c ?? {}), [lang]: text };
    if (!text.trim()) delete own[lang];
    const next = { ...value, [k]: own };
    if (!Object.keys(own).length) delete next[k];
    onChange(next);
  };
  return (
    <div>
      {languages.length > 1 && <div style={{ maxWidth: 260 }}><SelectField label={tr('ui.settings.language')} value={lang} onChange={setLang} options={languages.map((l) => ({ value: l, label: languageLabel(l) }))} /></div>}
      {MESSAGE_EVENTS.map((e) => (
        <div key={e.key} style={{ marginTop: 10 }}>
          <div className="help" style={{ margin: '0 0 4px' }}><b>{e.label}</b> {tr('ui.settings.placeholders')}{' '}{e.vars.map((x) => `{${x}}`).join(' ')}</div>
          <div className="inp" style={{ height: 'auto' }}><textarea value={textOf(e.key)} placeholder={tx(rawOf(e).text)} maxLength={320} disabled={disabled} aria-label={tr('ui.settings.wording', { label: e.label })} style={{ ...ta, minHeight: 56 }}
            onChange={(x) => put(e.key, x.target.value)} /></div>
        </div>
      ))}
    </div>
  );
}

/** The school's words, per language it uses: one and many, the usual word showing until it is changed. */
function VocabularyEditor({ value, languages, disabled, onChange }: { value: Vocabulary; languages: string[]; disabled: boolean; onChange: (v: unknown) => void }) {
  const [lang, setLang] = useState(languages[0] ?? 'en');
  const own = value[lang] ?? {};
  const usual = wordsFor(lang, undefined);
  const put = (concept: VocabConcept, part: 'one' | 'many', text: string) => {
    const word = { ...own[concept], [part]: text } as Word;
    const words = { ...own, [concept]: word };
    if (!word.one?.trim() && !word.many?.trim()) delete words[concept];
    const next = { ...value, [lang]: words };
    if (!Object.keys(words).length) delete next[lang];
    onChange(next);
  };
  return (
    <div>
      {languages.length > 1 && <div style={{ maxWidth: 260 }}><SelectField label={tr('ui.settings.language')} value={lang} onChange={setLang} options={languages.map((l) => ({ value: l, label: languageLabel(l) }))} /></div>}
      {VOCAB_CONCEPTS.map((c) => (
        <div key={c.key} style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.for', { p0: usual[c.key] })} value={own[c.key]?.one ?? ''} placeholder={usual[c.key]} maxLength={30} disabled={disabled} onChange={(x) => put(c.key, 'one', x)} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.more_than_one')} value={own[c.key]?.many ?? ''} placeholder={own[c.key]?.one ? '' : usual[c.many]} maxLength={30} disabled={disabled} onChange={(x) => put(c.key, 'many', x)} /></div>
        </div>
      ))}
    </div>
  );
}

/** The marks a register uses: what it is called, the letter written for it, and what it means for attendance figures. */
function AttendanceMarksEditor({ value, max, disabled, onChange }: { value: AttendanceMarkDef[]; max: number; disabled: boolean; onChange: (v: unknown) => void }) {
  const put = (i: number, patch: Partial<AttendanceMarkDef>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div>
      {value.map((m, i) => (
        <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}><Field label={tr('ui.settings.mark')} value={m.name} maxLength={30} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 90 }}><Field label={tr('ui.settings.letter')} value={m.code} maxLength={3} disabled={disabled} onChange={(v) => put(i, { code: v })} /></div>
          <div style={{ width: 200 }}><SelectField label={tr('ui.settings.means')} value={m.meaning} disabled={disabled} onChange={(k) => put(i, { meaning: k as AttendanceMarkDef['meaning'] })} options={ATTENDANCE_MARKS.map((k) => ({ value: k, label: MARK_MEANING_LABELS[k] }))} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 2} onClick={() => onChange(value.filter((_, j) => j !== i))}>{tr('ui.settings.remove')}</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => {
        let n = value.length + 1;
        while (value.some((m) => m.key === `mark-${n}`)) n++;
        onChange([...value, { key: `mark-${n}`, name: tr('ui.settings.new_mark'), meaning: 'leave', code: '' }]);
      }}>{tr('ui.settings.add_a_mark')}</button>}
      <div className="help">{tr('ui.settings.a_mark_keeps_its_key')}</div>
    </div>
  );
}
