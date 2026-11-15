import { useState, type ReactNode } from 'react';
import { APP_CATALOG, APP_ROLES, APP_ROLE_LABELS, hasKey, type AppRole } from '@tangent/config-engine';
import { CATEGORY_TONES, CATEGORY_TONE_LABELS, DEFAULT_BRAND, MESSAGE_EVENTS, type AppLayout, type Category, type SettingMeta } from '@tangent/contracts';
import { Checkbox, DateField, FilePick, NumberField, TimeField } from './fields';
import { ColourField } from './ColourPicker';
import { ErrorLine, Field, SelectField } from './forms';
import { Select } from './Select';

/** What a setting's editor picks from: the school's classes and fee heads, and what it has, so the app's choices fit its modules. */
export interface SettingCtx {
  classes: { id: string; name: string }[];
  feeHeads: { key: string; name: string }[];
  entitled: readonly string[];
  features: readonly string[];
}

/** The channels a message can go through, as the Hub sends them. */
const CHANNELS = [['push', 'App'], ['sms', 'SMS'], ['whatsapp', 'WhatsApp'], ['email', 'Email']] as const;
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
  const label = <>{meta.label}{meta.risky && <span className="chip a" style={{ marginLeft: 8 }}>Needs a second person</span>}</>;
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
    })}{max && <span className="help">{list.length} of {max}</span>}</div>,
  );
  switch (meta.kind) {
    case 'bool':
      return box(<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button type="button" className={`sw ${value === true ? 'on' : ''}`} role="switch" aria-checked={value === true} aria-label={meta.label} disabled={disabled} onClick={() => onChange(value !== true)} /><span className="help" style={{ margin: 0 }}>{value === true ? 'On' : 'Off'}</span></div>);
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
      return box(<ListEditor items={list} max={meta.max ?? 12} disabled={disabled} placeholder="Add one" onChange={onChange} />);
    case 'houses':
      return box(<HousesEditor value={(Array.isArray(value) ? value : []) as { key: string; name: string; color: string }[]} max={meta.max ?? 12} disabled={disabled} onChange={onChange} />);
    case 'categories':
      return box(<CategoriesEditor value={(Array.isArray(value) ? value : []) as Category[]} max={meta.max ?? 16} disabled={disabled} onChange={onChange} />);
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
          <div key={e.key} className="kv" style={{ flexWrap: 'wrap', gap: 8 }}>{e.label}{e.urgent ? ' · sent in quiet hours' : ''}
            <b style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{CHANNELS.map(([ch, label]) => (
              <Checkbox key={ch} checked={!!(r as Record<string, boolean | undefined>)[ch]} disabled={disabled} onChange={(c) => set(e.key, ch, c)} label={label} />
            ))}</b>
          </div>
        );
      })}</div>);
    }
    case 'templates': {
      const words = (value ?? {}) as Record<string, string>;
      return box(<div>{MESSAGE_EVENTS.map((e) => (
        <div key={e.key} style={{ marginTop: 10 }}>
          <div className="help" style={{ margin: '0 0 4px' }}><b>{e.label}</b> · placeholders: {e.vars.map((v) => `{${v}}`).join(' ')}</div>
          <div className="inp" style={{ height: 'auto' }}><textarea value={words[e.key] ?? ''} placeholder={e.text} maxLength={320} disabled={disabled} aria-label={`Wording: ${e.label}`} style={{ ...ta, minHeight: 56 }}
            onChange={(x) => { const next = { ...words, [e.key]: x.target.value }; if (!x.target.value.trim()) delete next[e.key]; onChange(next); }} /></div>
        </div>
      ))}</div>);
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
        <span className={`chip ${picked ? 'a' : has ? 'g' : ''}`}>{picked ? `${picked.name}: not saved yet` : has ? 'Logo set' : 'Letters only'}</span>
        <FilePick accept="image/png,image/jpeg" disabled={disabled} className="btn sm" onPick={(f) => {
          if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr('Choose a PNG or JPEG image.');
          if (f.size > 2 * 1024 * 1024) return setErr('The logo must be 2 MB or smaller.');
          setErr(''); onPick(f);
        }}>{has || picked ? 'Choose another' : 'Choose a logo'}</FilePick>
        {picked && <button className="btn sm" onClick={() => onPick(null)}>Keep the old one</button>}
      </div>
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  );
}

/** For each app role: its bottom tabs, Home cards and quick buttons, in order, from what the school's modules offer that role. */
function AppLayoutEditor({ value, has, disabled, onChange }: { value: Record<AppRole, AppLayout>; has: { modules: readonly string[]; features: readonly string[] }; disabled: boolean; onChange: (v: unknown) => void }) {
  const [role, setRole] = useState<AppRole>('parent');
  const cur = value[role] ?? { dock: [], home: [], quick: [] };
  const slots = [['dock', 'Bottom tabs', 4], ['home', 'Home cards', 12], ['quick', 'Quick buttons', 6]] as const;
  const set = (slot: keyof AppLayout, key: string, max: number) => {
    const list = cur[slot];
    const next = list.includes(key) ? list.filter((x) => x !== key) : list.length >= max ? list : [...list, key];
    onChange({ ...value, [role]: { ...cur, [slot]: next } });
  };
  return (
    <div>
      <div style={{ maxWidth: 260 }}><Select value={role} onChange={(r) => setRole(r as AppRole)} aria-label="Role" options={APP_ROLES.map((r) => ({ value: r, label: APP_ROLE_LABELS[r] }))} /></div>
      {slots.map(([slot, title, max]) => {
        const offered = APP_CATALOG[slot].filter((c) => c.roles.includes(role) && has.modules.includes(c.module) && hasKey(has, c.feature));
        return (
          <div key={slot} style={{ marginTop: 10 }}>
            <div className="help" style={{ margin: '0 0 4px' }}><b>{title}</b> · {cur[slot].length} of {max}{slot === 'dock' ? ' · Profile is always last' : ''}</div>
            <div className="tgrow">{offered.length ? offered.map((o) => {
              const at = cur[slot].indexOf(o.key);
              return <button key={o.key} type="button" className={`chip ${at >= 0 ? 'v' : ''}`} aria-pressed={at >= 0} disabled={disabled} onClick={() => set(slot, o.key, max)}>{at >= 0 ? `${at + 1}. ` : ''}{o.label}</button>;
            }) : <span className="help" style={{ margin: 0 }}>The school’s modules offer nothing here for this role.</span>}</div>
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
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <div style={{ flex: 1 }}><Field label={`Item ${i + 1}`} value={it} maxLength={40} disabled={disabled} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} /></div>
          <button type="button" className="btn sm" disabled={disabled || items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {items.length < max && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ flex: 1 }}><Field label="New" value={draft} maxLength={40} disabled={disabled} placeholder={placeholder} onChange={setDraft} /></div>
          <button type="button" className="btn sm" disabled={disabled || !draft.trim()} onClick={add}>Add</button>
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
      {!value.length && <div className="help" style={{ margin: 0 }}>No houses: profiles and the roll-call grid show none.</div>}
      {value.map((h, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}><Field label="House" value={h.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <ColourField label="Colour" value={h.color} disabled={disabled} onChange={(c) => put(i, { color: c })} />
          <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `house-${value.length + 1}`, name: `House ${value.length + 1}`, color: DEFAULT_BRAND }])}>Add a house</button>}
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
          <div style={{ flex: 1, minWidth: 160 }}><Field label="Category" value={c.name} maxLength={24} disabled={disabled} onChange={(v) => put(i, { name: v })} /></div>
          <div style={{ width: 160 }}><SelectField label="Colour" value={c.tone} disabled={disabled} onChange={(t) => put(i, { tone: t as Category['tone'] })} options={CATEGORY_TONES.map((t) => ({ value: t, label: CATEGORY_TONE_LABELS[t] }))} /></div>
          <span className={`chip ${c.tone}`} style={{ marginBottom: 10 }}>{c.name || 'Category'}</span>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {value.length < max && <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={disabled} onClick={() => onChange([...value, { key: `cat-${Date.now().toString(36).slice(-6)}`, name: 'New category', tone: 'v' }])}>Add a category</button>}
      <div className="help">A category’s key stays when it is renamed, so notices and events already written keep it.</div>
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
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
          <div style={{ width: 120 }}><Field label="Grade" value={g.grade} maxLength={4} disabled={disabled} onChange={(v) => put(i, { grade: v })} /></div>
          <div style={{ width: 160 }}><NumberField label="From (%)" min={0} max={100} value={String(g.minPct)} disabled={disabled} onChange={(v) => put(i, { minPct: v === '' ? 0 : Number(v) })} /></div>
          <button type="button" className="btn sm" disabled={disabled || value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {value.length < max && <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...value, { grade: '?', minPct: 0 }])}>Add a grade</button>}
        <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange(sorted(value))}>Put in order</button>
      </div>
      {lowest > 0 && <div className="help">No grade starts at 0%, so marks below {lowest}% would get no grade. Add one that starts at 0.</div>}
    </div>
  );
}

