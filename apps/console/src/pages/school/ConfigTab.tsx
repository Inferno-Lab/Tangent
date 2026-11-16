import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { APP_CATALOG, APP_ROLES, APP_ROLE_LABELS, MODULES } from '@tangent/config-engine';
import { tx, DEFAULT_BRAND, SETTING_GROUPS, SETTINGS_META, SchoolSettingsSchema, TIGHTEN, settingOwner, type SchoolConfig, type SettingKey, hueContrast, hueOf, hueTokens } from '@tangent/contracts';
import { Checkbox, Dialog, EmptyCard, ErrorLine, Field, SelectField, SettingRow, useShake, Icon, EmptyNote, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { ago } from '../../app/format';

type Say = (text: string, tone?: 'ok' | 'bad') => void;
const KEYS = Object.keys(SETTINGS_META) as SettingKey[];
const shape = SchoolSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { data?: unknown } }>;
const dflt = (k: string): unknown => shape[k]?.safeParse(undefined).data;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The groups a school's settings sit in: the six school-wide ones, then one per module it has. */
const groupLabel = (g: string) => (MODULES.find((m) => m.key === g) ? (g === 'school' ? tr('console.config_tab.academic_year') : MODULES.find((m) => m.key === g)!.name) : tx(g));

/**
 * Everything Tangent sets for one school, built from SETTINGS_META: a new setting appears here without a new screen. Groups sit
 * in a side list with their own address (?group=…), a search finds any setting, and changes in several groups go in one save.
 */
export function ConfigTab({ schoolId, say }: { schoolId: string; say: Say }) { const app = useApp();
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
  const setGroup = (g: string) => { setGroupState(g);
    setFind('');
    const u = new URL(window.location.href);
    u.searchParams.set('group', g);
    window.history.replaceState(window.history.state, '', u);
  };
  const value = (k: string): unknown => (k in edits ? edits[k] : cfg && k in cfg.values ? cfg.values[k] : dflt(k));
  const changed = cfg ? Object.keys(edits).filter((k) => !same(edits[k], k in cfg.values ? cfg.values[k] : dflt(k))) : [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ['config', schoolId] });
  const save = useMutation({ mutationFn: async () => { // The logo is a file: it goes up first, then the rest of the change, so both are one save with one note.
      if (logo) { const data = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error(tr('console.config_tab.that_file_could_not_be'))); r.readAsDataURL(logo); });
        await app.api.logo(schoolId, { name: logo.name, mime: logo.type as 'image/png', data });
      }
      if (!changed.length) return { saved: true } as const;
      return app.api.config.patch(schoolId, { expectedVersion: cfg!.version, changes: Object.fromEntries(changed.map((k) => [k, edits[k]])), note: note.trim() });
    },
    onSuccess: (r) => { setEdits({}); setLogo(null); setNote(''); setErr({}); refresh();
      say('pending' in r ? tr('console.config_tab.a_risky_setting_is_in') : tr('console.config_tab.saved_the_school_s_admin'));
    },
    onError: (e) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });
      if (e instanceof HttpError && e.code === 'conflict') refresh();
      shake.hit();
    } });

  if (q.isLoading) return <div className="skc" style={{ height: 420, borderRadius: 24 }} />;
  if (q.isError || !cfg) return <EmptyCard error title={tr('console.config_tab.configuration')} chip={{ text: tr('console.config_tab.couldn_t_load'), tone: 'c' }} icon="warning" heading={tr('console.config_tab.the_school_s_configuration_didn')} body={(q.error as Error)?.message ?? ''} actions={<button className="btn pri" onClick={() => void q.refetch()}>{tr('console.config_tab.try_again')}</button>} />;

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
          <h2>{tr('console.config_tab.configuration')}</h2><span className="chip">{tr('console.config_tab.version')}{' '}{cfg.version}</span><span className="grow"></span>
          <div className="srch" style={{ minWidth: 220, height: 38 }}><Icon name="search" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder={tr('console.config_tab.find_a_setting')} aria-label={tr('console.config_tab.find_a_setting')} style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} /></div>
        </div>
        <div className="help">{tr('console.config_tab.the_school_changes_its_own')}{off.length ? tr('console.config_tab.not_in_its_plan_so', { p0: off.map((m) => m.name).join(', ') }) : ''}</div>
        {dirtyGroups.length > 0 && (
          <div className="tgrow" style={{ marginTop: 10, alignItems: 'center' }}>
            <span className="chip a">{tr('console.config_tab.unsaved_changes', { n: dirtyGroups.length })}</span>
            {dirtyGroups.map((g) => <button key={g} className="btn sm" onClick={() => setGroup(g)}>{groupLabel(g)}</button>)}
          </div>
        )}
      </div>

      <nav className="card s3 rise" aria-label={tr('console.config_tab.setting_groups')} style={{ padding: 12, alignSelf: 'start' }}>
        {groups.map((g) => { const n = changed.filter((k) => SETTINGS_META[k as SettingKey]?.group === g).length;
          return (
            <button key={g} className={`rpb ${!needle && g === group ? 'on' : ''}`} aria-current={!needle && g === group} onClick={() => setGroup(g)} style={{ width: '100%' }}>
              <b>{groupLabel(g)}{n ? tr('console.config_tab.changed', { n }) : ''}</b><small>{KEYS.filter((k) => SETTINGS_META[k].group === g && shown(k)).length} {tr('console.config_tab.settings')}</small>
            </button>
          );
        })}
        {hiddenCount > 0 && <div style={{ padding: '10px 8px 0' }}><Checkbox checked={unused} onChange={setUnused} label={tr('console.config_tab.show_not_in_use_yet', { hiddenCount })} /></div>}
      </nav>

      <div className={`card s9 rise ${shake.cls}`}>
        <div className="ch"><h2>{needle ? tr('console.config_tab.settings_matching', { p0: find.trim() }) : groupLabel(group)}</h2></div>
        {keys.length === 0 && <div style={{ marginTop: 12 }}><EmptyNote icon={needle ? 'search' : 'setup'} title={needle ? tr('console.config_tab.no_setting_matches', { p0: find.trim() }) : tr('console.config_tab.no_settings_here')} body={needle ? tr('console.config_tab.search_by_what_the_setting') : tr('console.config_tab.this_group_has_nothing_to')} /></div>}
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
              <div style={{ flex: 1, minWidth: 220 }}><Field label={tr('console.config_tab.why_kept_in_the_history')} value={note} onChange={setNote} maxLength={200} placeholder={tr('console.config_tab.for_example_the_principal_asked')} /></div>
              <button className="btn" disabled={!total || save.isPending} onClick={() => { setEdits({}); setLogo(null); setErr({}); }}>{tr('console.config_tab.discard_all')}</button>
              <button className="btn pri" disabled={!total || save.isPending} onClick={() => save.mutate()}>{save.isPending ? tr('console.config_tab.saving') : total ? tr('console.config_tab.save', { total }) : tr('console.config_tab.save_2')}</button>
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

function History({ cfg, schoolId, can, say }: { cfg: SchoolConfig; schoolId: string; can: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [sure, setSure] = useState<string | null>(null);
  const back = useMutation({ mutationFn: (versionId: string) => app.api.config.rollback(schoolId, versionId),
    onSuccess: (r) => { setSure(null); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); say(tr('console.config_tab.rolled_back_the_configuration_is', { version: r.version })); },
    onError: (e) => say((e as Error).message, 'bad') });
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>{tr('console.config_tab.history')}</h2><span className="chip">{cfg.versions.length} {tr('console.config_tab.changes')}</span></div>
      {!cfg.versions.length && <div className="help">{tr('console.config_tab.every_change_made_here_is')}</div>}
      {cfg.versions.map((v) => (
        <div key={v.id} className="rw" style={{ height: 'auto', padding: '10px 0', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span className="chip v">v{v.version}</span>
          <span style={{ flex: 1, minWidth: 200 }}>
            <b style={{ font: '700 13px var(--fb)' }}>{v.changes.map((c) => SETTINGS_META[c.key as SettingKey]?.label ?? c.key).join(', ') || tr('console.config_tab.no_change')}</b>
            <small style={{ display: 'block', color: 'var(--ink3)' }}>{v.by} · {ago(v.at)}{v.note ? ` · ${v.note}` : ''}</small>
          </span>
          {can && v.id !== cfg.versions[0]?.id && (sure === v.id
            ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dng" disabled={back.isPending} onClick={() => back.mutate(v.id)}>{tr('console.config_tab.roll_back_to_v')}{v.version}</button><button className="btn sm" onClick={() => setSure(null)}>{tr('console.config_tab.keep')}</button></span>
            : <button className="btn sm" onClick={() => setSure(v.id)}>{tr('console.config_tab.roll_back')}</button>)}
        </div>
      ))}
    </div>
  );
}

function Templates({ schoolId, can, say }: { schoolId: string; can: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['config-templates'], queryFn: app.api.config.templates });
  const [name, setName] = useState('');
  const [applying, setApplying] = useState(false);
  const save = useMutation({ mutationFn: () => app.api.config.saveTemplate(schoolId, name.trim()),
    onSuccess: () => { setName(''); void qc.invalidateQueries({ queryKey: ['config-templates'] }); say(tr('console.config_tab.saved_as_a_template_its')); },
    onError: (e) => say((e as Error).message, 'bad') });
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>{tr('console.config_tab.templates')}</h2><span className="chip">{(list.data ?? []).length}</span></div>
      <div className="help">{tr('console.config_tab.a_template_carries_settings_and')}</div>
      {(list.data ?? []).map((t) => <div key={t.id} className="kv">{t.name}<b>{t.keys} {tr('console.config_tab.settings_2')}{' '}{t.roles} {tr('console.config_tab.roles')}{' '}{ago(t.createdAt)}</b></div>)}
      {can && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ flex: 1, minWidth: 200 }}><Field label={tr('console.config_tab.save_this_school_s_setup')} value={name} onChange={setName} maxLength={60} placeholder={tr('console.config_tab.for_example_cbse_day_school')} /></div>
          <button className="btn" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{tr('console.config_tab.save_template')}</button>
          <button className="btn pri" disabled={!(list.data ?? []).length} onClick={() => setApplying(true)}>{tr('console.config_tab.start_from_a_template')}</button>
        </div>
      )}
      {applying && <ApplyDialog only={schoolId} onClose={() => setApplying(false)} onDone={(n) => { setApplying(false); void qc.invalidateQueries({ queryKey: ['config'] }); say(tr('console.config_tab.applied_to', { n })); }} />}
    </div>
  );
}

/** Applies a saved setup: to this school only (its Configuration), or to the schools chosen (Blueprints → Setup templates). */
export function ApplyDialog({ only, onClose, onDone }: { only?: string; onClose: () => void; onDone: (n: number) => void }) { const app = useApp();
  const list = useQuery({ queryKey: ['config-templates'], queryFn: app.api.config.templates });
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const [tpl, setTpl] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set(only ? [only] : []));
  const [err, setErr] = useState('');
  const go = useMutation({ mutationFn: () => app.api.config.applyTemplate(tpl, [...picked]), onSuccess: (r) => onDone(r.applied), onError: (e) => setErr((e as Error).message) });
  const rows = (schools.data ?? []).filter((s) => s.status !== 'archived' && s.status !== 'onboarding');
  return (
    <Dialog title={tr('console.config_tab.apply_a_template')} onClose={onClose} width={560}>
      <SelectField label={tr('console.config_tab.template')} value={tpl} onChange={setTpl} options={[{ value: '', label: tr('console.config_tab.choose_a_template') }, ...(list.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
      {!only && <>
        <div className="lbl" style={{ margin: '12px 0 6px' }}>{tr('console.config_tab.schools')}</div>
        <div style={{ maxHeight: 260, overflow: 'auto' }}>
          {rows.map((s) => (
            <label key={s.id} className="hwc" style={{ display: 'flex', padding: '6px 0' }}>
              <Checkbox checked={picked.has(s.id)} onChange={(c) => { const n = new Set(picked); if (c) n.add(s.id); else n.delete(s.id); setPicked(n); }} />{s.name}
            </label>
          ))}
        </div>
      </>}
      {err && <ErrorLine>{err}</ErrorLine>}
      <div className="help" style={{ marginTop: 10 }}>{tr('console.config_tab.each_school_gets_a_new')}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={onClose}>{tr('console.config_tab.cancel')}</button>
        <button className="btn pri" disabled={!tpl || !picked.size || go.isPending} onClick={() => go.mutate()}>{tr('console.config_tab.apply_to', { n: picked.size })}</button>
      </div>
    </Dialog>
  );
}

/** The admin menu and the app's layout exactly as one role at this school sees them. */
function Preview({ cfg, schoolId }: { cfg: SchoolConfig; schoolId: string }) { const app = useApp();
  const [roleId, setRoleId] = useState(cfg.roles[0]?.id ?? '');
  const p = useQuery({ queryKey: ['config-preview', schoolId, roleId, cfg.version], queryFn: () => app.api.config.preview(schoolId, roleId), enabled: !!roleId });
  const label = useMemo(() => Object.fromEntries([...APP_CATALOG.dock, ...APP_CATALOG.home, ...APP_CATALOG.quick].map((c) => [c.key, c.label])), []);
  return (
    <div className="card s12 rise">
      <div className="ch"><h2>{tr('console.config_tab.preview')}</h2></div>
      <div className="help">{tr('console.config_tab.the_admin_menu_this_role')}</div>
      <div style={{ maxWidth: 320 }}><SelectField label={tr('console.config_tab.as_this_role_sees_it')} value={roleId} onChange={setRoleId} options={cfg.roles.map((r) => ({ value: r.id, label: r.name }))} /></div>
      {p.data && (
        <>
          {p.data.menu.map((g) => <div key={g.group} className="kv">{g.group}<b className="tgrow">{g.pages.map((n) => <span key={n.id} className="chip">{n.label}</span>)}</b></div>)}
          {APP_ROLES.map((r) => (
            <div key={r} className="kv">{tr('console.config_tab.app')}{' '}{APP_ROLE_LABELS[r]}<b className="tgrow">{p.data!.app.roles.includes(r)
              ? [...p.data!.app.layout[r].dock.map((k) => <span key={`d${k}`} className="chip v">{label[k] ?? k}</span>), ...p.data!.app.layout[r].home.map((k) => <span key={`h${k}`} className="chip">{label[k] ?? k}</span>)]
              : tr('console.config_tab.does_not_use_the_app')}</b></div>
          ))}
        </>
      )}
    </div>
  );
}

/** The seed colour card of the School board: what the brand colour's hue makes, each colour with the text it carries checked against AA. */
function HueSwatches({ colour }: { colour: string }) { const h = hueOf(/^#[0-9a-fA-F]{6}$/.test(colour) ? colour : DEFAULT_BRAND);
  const t = hueTokens(h, 'light');
  const ROWS: [string, string, string, string][] = [['deep', tr('console.config_tab.deep'), tr('console.config_tab.frame_menu_and_tab_bar'), 'on-deep'], ['bright', tr('console.config_tab.bright'), tr('console.config_tab.you_are_here_the_main'), 'on-bright'], ['brand', tr('console.config_tab.brand'), tr('console.config_tab.buttons_and_links'), 'on-brand'],
    ['brand-soft', tr('console.config_tab.soft'), tr('console.config_tab.selected_rows_quiet_buttons'), 'brand-ink'], ['hero', tr('console.config_tab.hero'), tr('console.config_tab.the_headline_card'), 'on-deep'], ['heat4', tr('console.config_tab.heat'), tr('console.config_tab.how_much_quiet_to_loud'), 'heat-hi-t']];
  return (
    <div className="hue-sw" style={{ marginTop: 12 }}>
      <div className="help" style={{ margin: '0 0 6px' }}>{tr('console.config_tab.hue')}{' '}{h}{tr('console.config_tab.one_hue_makes_every_colour')}</div>
      {ROWS.map(([k, name, what, on]) => (
        <div key={k} className="kv" style={{ alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <i style={{ background: t[k] }} aria-hidden="true" />
            <span><b style={{ display: 'block', color: 'var(--ink)', fontWeight: 600 }}>{name}</b><small>{what}</small></span>
          </span>
          <span className="chip g" data-tip={tr('console.config_tab.text_on_it_to_1', { p0: hueContrast(t[on]!, t[k]!).toFixed(1) })}>{tr('console.config_tab.aa')}</span>
        </div>
      ))}
      <div className="help" style={{ marginTop: 8 }}>{tr('console.config_tab.every_text_pair_is_checked')}</div>
    </div>
  );
}

/**
 * Whose setting it is, and Tangent's lock for this school: a locked setting keeps Tangent's value whatever the school chooses
 * (on a security or privacy setting the value is a floor the school may tighten). The reason is shown to the school.
 */
function LockLine({ k, cfg, schoolId, can, current, say }: { k: SettingKey; cfg: SchoolConfig; schoolId: string; can: boolean; current: unknown; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const lock = cfg.locks.find((l) => l.key === k);
  const floor = !!TIGHTEN[k];
  const go = useMutation({ mutationFn: (locked: boolean) => app.api.config.lock(schoolId, { key: k, locked, value: current, note: note.trim() }),
    onSuccess: (_r, locked) => { setAsking(false); setNote(''); void qc.invalidateQueries({ queryKey: ['config', schoolId] }); say(locked ? (floor ? tr('console.config_tab.set_as_the_school_s') : tr('console.config_tab.locked_for_this_school')) : tr('console.config_tab.unlocked_the_school_can_change')); },
    onError: (e) => say((e as Error).message, 'bad') });
  const owner = settingOwner(k);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
      <span className={`chip ${owner === 'tangent' ? 'v' : ''}`}>{owner === 'tangent' ? tr('console.config_tab.tangent_s') : tr('console.config_tab.the_school_s')}</span>
      {lock && <span className="chip a" data-tip={lock.note || undefined}>{floor ? tr('console.config_tab.minimum_set_by_tangent') : tr('console.config_tab.locked_by_tangent')}</span>}
      {can && owner === 'school' && (lock
        ? <button className="btn sm ghost" disabled={go.isPending} onClick={() => go.mutate(false)}>{tr('console.config_tab.unlock')}</button>
        : <button className="btn sm ghost" onClick={() => setAsking(true)}>{floor ? tr('console.config_tab.set_as_minimum') : tr('console.config_tab.lock_for_this_school')}</button>)}
      {asking && (
        <Dialog title={floor ? tr('console.config_tab.set_as_the_school_s_2') : tr('console.config_tab.lock_this_setting')} tag={{ text: SETTINGS_META[k].label, tone: 'v' }} onClose={() => setAsking(false)} width={480}>
          <div className="help" style={{ marginTop: 0 }}>{floor ? tr('console.config_tab.the_school_can_make_it') : tr('console.config_tab.the_school_sees_it_read')} {tr('console.config_tab.the_value_is_the_one')}</div>
          <Field label={tr('console.config_tab.why_the_school_sees_this')} value={note} onChange={setNote} maxLength={200} placeholder={tr('console.config_tab.for_example_the_group_sets')} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button className="btn" onClick={() => setAsking(false)}>{tr('console.config_tab.cancel')}</button>
            <button className="btn pri" disabled={go.isPending} onClick={() => go.mutate(true)}>{floor ? tr('console.config_tab.set_minimum') : tr('console.config_tab.lock')}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
