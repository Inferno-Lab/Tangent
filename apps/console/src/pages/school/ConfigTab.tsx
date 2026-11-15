import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { APP_CATALOG, APP_ROLES, APP_ROLE_LABELS, MODULES } from '@tangent/config-engine';
import { DEFAULT_BRAND, SETTING_GROUPS, SETTINGS_META, SchoolSettingsSchema, TIGHTEN, settingOwner, type SchoolConfig, type SettingKey, hueContrast, hueOf, hueTokens } from '@tangent/contracts';
import { Checkbox, Dialog, EmptyCard, ErrorLine, Field, SelectField, SettingRow, useShake, Icon, EmptyNote } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { ago } from '../../app/format';

type Say = (text: string, tone?: 'ok' | 'bad') => void;
const KEYS = Object.keys(SETTINGS_META) as SettingKey[];
const shape = SchoolSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { data?: unknown } }>;
const dflt = (k: string): unknown => shape[k]?.safeParse(undefined).data;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The groups a school's settings sit in: the six school-wide ones, then one per module it has. */
const groupLabel = (g: string) => (MODULES.find((m) => m.key === g) ? (g === 'school' ? 'Academic year' : MODULES.find((m) => m.key === g)!.name) : g);

/**
 * Everything Tangent sets for one school, built from SETTINGS_META: a new setting appears here without a new screen. Groups sit
 * in a side list with their own address (?group=…), a search finds any setting, and changes in several groups go in one save.
 */
export function ConfigTab({ schoolId, say }: { schoolId: string; say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['config', schoolId], queryFn: () => app.api.config.get(schoolId) });
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [logo, setLogo] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [group, setGroupState] = useState<string>(() => new URLSearchParams(window.location.search).get('group') ?? SETTING_GROUPS[0]);
  const [find, setFind] = useState('');
  const [unused, setUnused] = useState(false);
  const shake = useShake();
  const can = app.can('schools.configure');
  const cfg = q.data;
  const setGroup = (g: string) => {
    setGroupState(g);
    setFind('');
    const u = new URL(window.location.href);
    u.searchParams.set('group', g);
    window.history.replaceState(window.history.state, '', u);
  };
  const value = (k: string): unknown => (k in edits ? edits[k] : cfg && k in cfg.values ? cfg.values[k] : dflt(k));
  const changed = cfg ? Object.keys(edits).filter((k) => !same(edits[k], k in cfg.values ? cfg.values[k] : dflt(k))) : [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['config', schoolId] });
  const save = useMutation({
    mutationFn: async () => {
      // The logo is a file: it goes up first, then the rest of the change, so both are one save with one note.
      if (logo) {
        const data = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('That file could not be read.')); r.readAsDataURL(logo); });
        await app.api.logo(schoolId, { name: logo.name, mime: logo.type as 'image/png', data });
      }
      if (!changed.length) return { saved: true } as const;
      return app.api.config.patch(schoolId, { expectedVersion: cfg!.version, changes: Object.fromEntries(changed.map((k) => [k, edits[k]])), note: note.trim() });
    },
    onSuccess: (r) => {
      setEdits({}); setLogo(null); setNote(''); setErr({}); refresh();
      say('pending' in r ? 'A risky setting is in there, so the change waits for a second person under Approvals.' : 'Saved. The school’s admin and app follow within a minute.');
    },
    onError: (e) => {
      setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });
      if (e instanceof HttpError && e.code === 'conflict') refresh();
      shake.hit();
    },
  });

  if (q.isLoading) return <div className="skc" style={{ height: 420, borderRadius: 24 }} />;
  if (q.isError || !cfg) return <EmptyCard error title="Configuration" chip={{ text: 'Couldn’t load', tone: 'c' }} icon="warning" heading="The school’s configuration didn’t load" body={(q.error as Error)?.message ?? ''} actions={<button className="btn pri" onClick={() => void q.refetch()}>Try again</button>} />;

  const shown = (k: SettingKey) => unused || !SETTINGS_META[k].notUsedYet;
  const groups = [...SETTING_GROUPS as readonly string[], ...MODULES.filter((m) => m.settings.length && cfg.entitled.includes(m.key)).map((m) => m.key)];
  // A module the school does not have keeps its settings out of sight (P9), named in one line.
  const off = MODULES.filter((m) => m.settings.length && !m.core && !cfg.entitled.includes(m.key));
  const needle = find.trim().toLowerCase();
  const keys = needle
    ? KEYS.filter((k) => shown(k) && groups.includes(SETTINGS_META[k].group) && `${SETTINGS_META[k].label} ${SETTINGS_META[k].help ?? ''} ${k}`.toLowerCase().includes(needle))
    : KEYS.filter((k) => SETTINGS_META[k].group === group && shown(k));
  const dirtyGroups = [...new Set(changed.map((k) => SETTINGS_META[k as SettingKey]?.group).filter(Boolean))] as string[];
  const hiddenCount = KEYS.filter((k) => SETTINGS_META[k].notUsedYet).length;
  const total = changed.length + (logo ? 1 : 0);
  return (
    <section className="grid">
      <div className="card s12 rise">
        <div className="ch" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2>Configuration</h2><span className="chip">Version {cfg.version}</span><span className="grow"></span>
          <div className="srch" style={{ minWidth: 220, height: 38 }}><Icon name="search" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} /></div>
        </div>
        <div className="help">The school changes its own settings in its admin; Tangent’s are the app’s look and the area locks. Tangent can change any of them here, and lock one for this school.{off.length ? ` Not in its plan, so not shown: ${off.map((m) => m.name).join(', ')}.` : ''}</div>
        {dirtyGroups.length > 0 && (
          <div className="tgrow" style={{ marginTop: 10, alignItems: 'center' }}>
            <span className="chip a">{dirtyGroups.length === 1 ? '1 group has' : `${dirtyGroups.length} groups have`} unsaved changes</span>
            {dirtyGroups.map((g) => <button key={g} className="btn sm" onClick={() => setGroup(g)}>{groupLabel(g)}</button>)}
          </div>
        )}
      </div>

      <nav className="card s3 rise" aria-label="Setting groups" style={{ padding: 12, alignSelf: 'start' }}>
        {groups.map((g) => {
          const n = changed.filter((k) => SETTINGS_META[k as SettingKey]?.group === g).length;
          return (
            <button key={g} className={`rpb ${!needle && g === group ? 'on' : ''}`} aria-current={!needle && g === group} onClick={() => setGroup(g)} style={{ width: '100%' }}>
              <b>{groupLabel(g)}{n ? ` · ${n} changed` : ''}</b><small>{KEYS.filter((k) => SETTINGS_META[k].group === g && shown(k)).length} settings</small>
            </button>
          );
        })}
        {hiddenCount > 0 && <div style={{ padding: '10px 8px 0' }}><Checkbox checked={unused} onChange={setUnused} label={`Show ${hiddenCount} not in use yet`} /></div>}
      </nav>

      <div className={`card s9 rise ${shake.cls}`}>
        <div className="ch"><h2>{needle ? `Settings matching “${find.trim()}”` : groupLabel(group)}</h2></div>
        {keys.length === 0 && <div style={{ marginTop: 12 }}><EmptyNote icon={needle ? 'search' : 'setup'} title={needle ? `No setting matches “${find.trim()}”` : 'No settings here'} body={needle ? 'Search by what the setting does, like “late fee” or “holidays”.' : 'This group has nothing to set for this school.'} /></div>}
        {keys.map((k) => (
          <div key={k}>
            {needle && <div className="lbl" style={{ marginTop: 12 }}>{groupLabel(SETTINGS_META[k].group)}</div>}
            <LockLine k={k} cfg={cfg} schoolId={schoolId} can={can} current={value(k)} say={say} />
            <SettingRow meta={SETTINGS_META[k]} value={value(k)} error={err[k]} disabled={!can} ctx={cfg} logo={logo} onLogo={setLogo} after={k === 'brand.color' ? <HueSwatches colour={String(value(k) || DEFAULT_BRAND)} /> : undefined}
              onChange={(v) => { setEdits((x) => ({ ...x, [k]: v })); setErr({}); }} />
          </div>
        ))}
        {can && (
          <div style={{ marginTop: 16 }}>
            {err._ && <ErrorLine>{err._}</ErrorLine>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}><Field label="Why (kept in the history)" value={note} onChange={setNote} maxLength={200} placeholder="For example: the principal asked for Fees in the tabs" /></div>
              <button className="btn" disabled={!total || save.isPending} onClick={() => { setEdits({}); setLogo(null); setErr({}); }}>Discard all</button>
              <button className="btn pri" disabled={!total || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : total ? `Save ${total} ${total === 1 ? 'change' : 'changes'}` : 'Save'}</button>
            </div>
          </div>
        )}
      </div>

      <History cfg={cfg} schoolId={schoolId} can={can} say={say} />
      <Templates schoolId={schoolId} can={can} say={say} />
      <Preview cfg={cfg} schoolId={schoolId} />
    </section>
  );
}

function History({ cfg, schoolId, can, say }: { cfg: SchoolConfig; schoolId: string; can: boolean; say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const [sure, setSure] = useState<string | null>(null);
  const back = useMutation({
    mutationFn: (versionId: string) => app.api.config.rollback(schoolId, versionId),
    onSuccess: (r) => { setSure(null); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); say(`Rolled back. The configuration is now version ${r.version}.`); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>History</h2><span className="chip">{cfg.versions.length} changes</span></div>
      {!cfg.versions.length && <div className="help">Every change made here is listed with who made it and why, and can be rolled back.</div>}
      {cfg.versions.map((v) => (
        <div key={v.id} className="rw" style={{ height: 'auto', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span className="chip v">v{v.version}</span>
          <span style={{ flex: 1, minWidth: 200 }}>
            <b style={{ font: '700 13px var(--fb)' }}>{v.changes.map((c) => SETTINGS_META[c.key as SettingKey]?.label ?? c.key).join(', ') || 'No change'}</b>
            <small style={{ display: 'block', color: 'var(--ink3)' }}>{v.by} · {ago(v.at)}{v.note ? ` · ${v.note}` : ''}</small>
          </span>
          {can && v.id !== cfg.versions[0]?.id && (sure === v.id
            ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dng" disabled={back.isPending} onClick={() => back.mutate(v.id)}>Roll back to v{v.version}</button><button className="btn sm" onClick={() => setSure(null)}>Keep</button></span>
            : <button className="btn sm" onClick={() => setSure(v.id)}>Roll back…</button>)}
        </div>
      ))}
    </div>
  );
}

function Templates({ schoolId, can, say }: { schoolId: string; can: boolean; say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['config-templates'], queryFn: app.api.config.templates });
  const [name, setName] = useState('');
  const [applying, setApplying] = useState(false);
  const save = useMutation({
    mutationFn: () => app.api.config.saveTemplate(schoolId, name.trim()),
    onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: ['config-templates'] }); say('Saved as a template. Its settings and roles can now be applied to other schools.'); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>Templates</h2><span className="chip">{(list.data ?? []).length}</span></div>
      <div className="help">A template carries settings and roles, never who the school is (name, contacts, logo letters). Applying one to many schools at once is on Blueprints.</div>
      {(list.data ?? []).map((t) => <div key={t.id} className="kv">{t.name}<b>{t.keys} settings · {t.roles} roles · {ago(t.createdAt)}</b></div>)}
      {can && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}><Field label="Save this school’s setup as" value={name} onChange={setName} maxLength={60} placeholder="For example: CBSE day school" /></div>
          <button className="btn" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Save template</button>
          <button className="btn pri" disabled={!(list.data ?? []).length} onClick={() => setApplying(true)}>Start from a template…</button>
        </div>
      )}
      {applying && <ApplyDialog only={schoolId} onClose={() => setApplying(false)} onDone={(n) => { setApplying(false); void qc.invalidateQueries({ queryKey: ['config'] }); say(`Applied to ${n} ${n === 1 ? 'school' : 'schools'}.`); }} />}
    </div>
  );
}

/** Applies a saved setup: to this school only (its Configuration), or to the schools chosen (Blueprints → Setup templates). */
export function ApplyDialog({ only, onClose, onDone }: { only?: string; onClose: () => void; onDone: (n: number) => void }) {
  const app = useApp();
  const list = useQuery({ queryKey: ['config-templates'], queryFn: app.api.config.templates });
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const [tpl, setTpl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(only ? [only] : []));
  const [err, setErr] = useState('');
  const go = useMutation({ mutationFn: () => app.api.config.applyTemplate(tpl, [...picked]), onSuccess: (r) => onDone(r.applied), onError: (e) => setErr((e as Error).message) });
  const rows = (schools.data ?? []).filter((s) => s.status !== 'archived' && s.status !== 'onboarding');
  return (
    <Dialog title="Apply a template" onClose={onClose} width={560}>
      <SelectField label="Template" value={tpl} onChange={setTpl} options={[{ value: '', label: 'Choose a template' }, ...(list.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
      {!only && <>
        <div className="lbl" style={{ margin: '12px 0 6px' }}>Schools</div>
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {rows.map((s) => (
            <label key={s.id} className="hwc" style={{ display: 'flex', padding: '6px 0' }}>
              <Checkbox checked={picked.has(s.id)} onChange={(c) => { const n = new Set(picked); if (c) n.add(s.id); else n.delete(s.id); setPicked(n); }} />{s.name}
            </label>
          ))}
        </div>
      </>}
      {err && <ErrorLine>{err}</ErrorLine>}
      <div className="help" style={{ marginTop: 10 }}>Each school gets a new configuration version, which can be rolled back. Modules outside a school’s plan are left off.</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn pri" disabled={!tpl || !picked.size || go.isPending} onClick={() => go.mutate()}>Apply to {picked.size} {picked.size === 1 ? 'school' : 'schools'}</button>
      </div>
    </Dialog>
  );
}

/** The admin menu and the app's layout exactly as one role at this school sees them. */
function Preview({ cfg, schoolId }: { cfg: SchoolConfig; schoolId: string }) {
  const app = useApp();
  const [roleId, setRoleId] = useState(cfg.roles[0]?.id ?? '');
  const p = useQuery({ queryKey: ['config-preview', schoolId, roleId, cfg.version], queryFn: () => app.api.config.preview(schoolId, roleId), enabled: !!roleId });
  const label = useMemo(() => Object.fromEntries([...APP_CATALOG.dock, ...APP_CATALOG.home, ...APP_CATALOG.quick].map((c) => [c.key, c.label])), []);
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>Preview</h2></div>
      <div className="help">The admin menu this role gets, and what each role sees in the app (bottom tabs in colour, then Home cards).</div>
      <div style={{ maxWidth: 320 }}><SelectField label="As this role sees it" value={roleId} onChange={setRoleId} options={cfg.roles.map((r) => ({ value: r.id, label: r.name }))} /></div>
      {p.data && (
        <>
          {p.data.menu.map((g) => <div key={g.group} className="kv">{g.group}<b className="tgrow">{g.pages.map((n) => <span key={n.id} className="chip">{n.label}</span>)}</b></div>)}
          {APP_ROLES.map((r) => (
            <div key={r} className="kv">App · {APP_ROLE_LABELS[r]}<b className="tgrow">{p.data!.app.roles.includes(r)
              ? [...p.data!.app.layout[r].dock.map((k) => <span key={`d${k}`} className="chip v">{label[k] ?? k}</span>), ...p.data!.app.layout[r].home.map((k) => <span key={`h${k}`} className="chip">{label[k] ?? k}</span>)]
              : 'Does not use the app'}</b></div>
          ))}
        </>
      )}
    </div>
  );
}

/** The seed colour card of the School board: what the brand colour's hue makes, each colour with the text it carries checked against AA. */
function HueSwatches({ colour }: { colour: string }) {
  const h = hueOf(/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : DEFAULT_BRAND);
  const t = hueTokens(h, 'light');
  const ROWS: [string, string, string, string][] = [['deep', 'Deep', 'Frame, menu and tab bar', 'on-deep'], ['bright', 'Bright', 'You are here, the main number', 'on-bright'], ['brand', 'Brand', 'Buttons and links', 'on-brand'],
    ['brand-soft', 'Soft', 'Selected rows, quiet buttons', 'brand-ink'], ['hero', 'Hero', 'The headline card', 'on-deep'], ['heat4', 'Heat', 'How much, quiet to loud', 'heat-hi-t']];
  return (
    <div className="hue-sw" style={{ marginTop: 12 }}>
      <div className="help" style={{ margin: '0 0 6px' }}>Hue {h}° · one hue makes every colour, in light, dark and AMOLED</div>
      {ROWS.map(([k, name, what, on]) => (
        <div key={k} className="kv" style={{ alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <i style={{ background: t[k] }} aria-hidden="true" />
            <span><b style={{ display: 'block', color: 'var(--ink)', fontWeight: 600 }}>{name}</b><small>{what}</small></span>
          </span>
          <span className="chip g" data-tip={`Text on it: ${hueContrast(t[on]!, t[k]!).toFixed(1)} to 1`}>AA</span>
        </div>
      ))}
      <div className="help" style={{ marginTop: 8 }}>Every text pair is checked against WCAG AA for every hue, so any colour can be published.</div>
    </div>
  );
}

/**
 * Whose setting it is, and Tangent's lock for this school: a locked setting keeps Tangent's value whatever the school chooses
 * (on a security or privacy setting the value is a floor the school may tighten). The reason is shown to the school.
 */
function LockLine({ k, cfg, schoolId, can, current, say }: { k: SettingKey; cfg: SchoolConfig; schoolId: string; can: boolean; current: unknown; say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const lock = cfg.locks.find((l) => l.key === k);
  const floor = !!TIGHTEN[k];
  const go = useMutation({
    mutationFn: (locked: boolean) => app.api.config.lock(schoolId, { key: k, locked, value: current, note: note.trim() }),
    onSuccess: (_r, locked) => { setAsking(false); setNote(''); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); say(locked ? (floor ? 'Set as the school’s minimum.' : 'Locked for this school.') : 'Unlocked. The school can change it again.'); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const owner = settingOwner(k);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
      <span className={`chip ${owner === 'tangent' ? 'v' : ''}`}>{owner === 'tangent' ? 'Tangent’s' : 'The school’s'}</span>
      {lock && <span className="chip a" data-tip={lock.note || undefined}>{floor ? 'Minimum set by Tangent' : 'Locked by Tangent'}</span>}
      {can && owner === 'school' && (lock
        ? <button className="btn sm ghost" disabled={go.isPending} onClick={() => go.mutate(false)}>Unlock</button>
        : <button className="btn sm ghost" onClick={() => setAsking(true)}>{floor ? 'Set as minimum…' : 'Lock for this school…'}</button>)}
      {asking && (
        <Dialog title={floor ? 'Set as the school’s minimum' : 'Lock this setting'} tag={{ text: SETTINGS_META[k].label, tone: 'v' }} onClose={() => setAsking(false)} width={480}>
          <div className="help" style={{ marginTop: 0 }}>{floor ? 'The school can make it stricter, never looser.' : 'The school sees it read-only, with your reason, until it is unlocked.'} The value is the one shown above, unsaved edits included.</div>
          <Field label="Why (the school sees this)" value={note} onChange={setNote} maxLength={200} placeholder="For example: the group sets library rules for all its schools" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="btn" onClick={() => setAsking(false)}>Cancel</button>
            <button className="btn pri" disabled={go.isPending} onClick={() => go.mutate(true)}>{floor ? 'Set minimum' : 'Lock'}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
