import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogueName, changeEntitlement, type EntitlementChange } from '@tangent/config-engine';
import { PlanSave, type EntitlementDoc, type EntitlementRow, type PlanRow } from '@tangent/contracts';
import { HttpError } from '@tangent/api-client';
import { Checkbox, DateField, Dialog, EmptyCard, ErrorLine, Field, IC, Icon, NumberField, Select, SelectField, useShake, type PageIcon, EmptyNote, EmptyState, t, busyFor, Skeleton } from '@tangent/web-ui';
import type { CatalogDoc } from '@tangent/api-client';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { url } from '../../app/base';
import { usePageTabs } from '../../app/tabs';
import { count, price } from '../../app/format';

type Say = (text: string, tone?: 'ok' | 'bad') => void;
type Mod = CatalogDoc['modules'][number];
interface Push { schoolId: string; name: string; cur: EntitlementDoc; change: EntitlementChange }

export const docOf = (r: Pick<EntitlementRow, 'plan' | 'modules' | 'features' | 'dates' | 'trialUntil' | 'limits' | 'locks'>): EntitlementDoc => ({ plan: r.plan, modules: r.modules, features: r.features, dates: r.dates, ...(r.trialUntil ? { trialUntil: r.trialUntil } : {}), limits: r.limits, locks: r.locks, overrides: {}, version: 0 });

/** What a push would change, in a form that ignores key order. */
export const sig = (x: EntitlementDoc) => JSON.stringify([x.plan, [...x.modules].sort(), Object.entries(x.features ?? {}).sort(), Object.entries(x.dates ?? {}).sort().map(([k, v]) => [k, v.from ?? '', v.until ?? '']), x.trialUntil ?? '', x.limits]);

/** Sends each push, one school at a time. Anything taken away waits in Approvals for a second person. */
function usePush(onDone: (m: string) => void, onFail: (m: string) => void) { const app = useApp();
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (list: Push[]) => { let done = 0;
      let waiting = 0;
      for (const p of list) { const r = await app.api.actions.request({ action: 'entitlements.push', schoolId: p.schoolId, params: p.change as Record<string, unknown> });
        if (r.status === 'pending_approval') waiting++; else if (r.status === 'done') done++; else throw new Error(`${p.name}: ${r.summary}`);
      }
      return { done, waiting };
    },
    onSuccess: ({ done, waiting }) => { void qc.invalidateQueries({ queryKey: ['entitlements'] });
      void qc.invalidateQueries({ queryKey: ['school'] });
      void qc.invalidateQueries({ queryKey: ['actions'] });
      onDone([done ? t('console.modules_page.updated_it_applies_within_15', { done }) : '', waiting ? t('console.modules_page.waiting_for_a_second_person', { waiting }) : ''].filter(Boolean).join(' '));
    },
    onError: (e) => onFail((e as Error).message) });
}

/** What each push gives and takes, before anything is sent. */
export function ReviewDialog({ list, onClose, onDone }: { list: Push[]; onClose: () => void; onDone: (m: string) => void }) { const [err, setErr] = useState('');
  const push = usePush(onDone, setErr);
  const rows = list.map((p) => ({ p, r: changeEntitlement(p.cur, p.change) }));
  const problems = rows.flatMap(({ p, r }) => r.problems.map((m) => `${p.name}: ${m}`));
  const takes = rows.some(({ r }) => r.removed.length);
  return (
    <Dialog title={t('console.modules_page.review_the_change')} tag={{ text: t('console.modules_page.n_schools', { n: list.length }), tone: takes ? 'a' : 'v' }} onClose={onClose} width={560}>
      <div className="stack" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        {rows.map(({ p, r }) => (
          <div key={p.schoolId} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
            <b style={{ font: '700 14px var(--fb)' }}>{p.name}</b>
            <div className="tgrow" style={{ marginTop: 6 }}>
              {r.added.map((k) => <span key={k} className="chip g">+ {catalogueName(k)}</span>)}
              {r.removed.map((k) => <span key={k} className="chip c">− {catalogueName(k)}</span>)}
              {!r.added.length && !r.removed.length && <span className="chip">{t('console.modules_page.limits_dates_or_plan_only')}</span>}
            </div>
          </div>
        ))}
      </div>
      {takes && <p className="help">{t('console.modules_page.taking_something_away_needs_a')}</p>}
      {problems.length > 0 && <ErrorLine>{problems.join(' ')}</ErrorLine>}
      {err && <ErrorLine>{err}</ErrorLine>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{t('console.modules_page.keep_editing')}</button>
        <button className="btn pri" disabled={push.isPending || problems.length > 0} onClick={() => push.mutate(list)}>{push.isPending ? t('console.modules_page.sending') : t('console.modules_page.push')}</button>
      </div>
    </Dialog>
  );
}

// A school's module or feature as the Modules board's tile (design/hue/src/Modules.html): on, on for a while, paused, or off.
const dot = (on: boolean, until?: string, paused?: boolean) => { const say = paused ? t('console.modules_page.paused_by_tangent') : on ? (until ? t('console.modules_page.on_until', { until }) : t('console.modules_page.on')) : t('console.modules_page.off');
  return (
    <span className={`mx ${paused ? 'bad' : on ? (until ? 'wait' : 'on') : ''}`} role="img" aria-label={say} data-tip={say}>
      {(on || paused) && <Icon name={paused ? 'pause' : until ? 'waiting' : 'check'} size={16} className="i" />}
    </span>
  );
};
// A module's own icon from the icon map, so the column reads like the menu.
const modIcon = (key: string): PageIcon => (key in IC ? key : key === 'chat' ? 'messages' : key === 'exams_results' ? 'exams' : 'modules') as PageIcon;

/** Plans and modules: which school has what, the plans schools start from, and what is planned. */
export function ModulesPage() { const { tab, tabs } = usePageTabs('/modules');
  const { toast, say } = useToast();
  return (
    <Page title={t('console.modules_page.plans_and_modules')} sub={tab === 'plans' ? t('console.modules_page.what_a_school_starts_from') : tab === 'planned' ? t('console.modules_page.modules_on_the_way') : t('console.modules_page.which_school_has_which_module')} toast={toast} tabs={tabs}>
      {tab === 'plans' ? <Plans say={say} /> : tab === 'planned' ? <Planned /> : <Schools say={say} />}
    </Page>
  );
}

/** Every school against every module (or one module's features): give or take for many schools at once, reviewed first; pause a module. */
function Schools({ say }: { say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const cat = useQuery({ queryKey: ['catalog'], queryFn: app.api.catalog, staleTime: 10 * 60_000 });
  const q = useQuery({ queryKey: ['entitlements'], queryFn: app.api.entitlements });
  const flags = useQuery({ queryKey: ['flags'], queryFn: app.api.flags.list });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [until, setUntil] = useState('');
  const [review, setReview] = useState<Push[] | null>(null);
  const [find, setFind] = useState('');
  const [plan, setPlan] = useState('');
  const [focus, setFocus] = useState('');
  const [pausing, setPausing] = useState<Pick<Mod, 'key' | 'name'> | null>(null);
  const can = app.can('schools.write');
  const mods = (cat.data?.modules ?? []).filter((m) => m.state !== 'planned' && !m.core);
  const focused = mods.find((m) => m.key === focus);
  // A module's column opens its features; the matrix then shows those.
  const cols = focused ? focused.features.filter((f) => f.state !== 'planned').map((f) => ({ key: f.key, name: f.name, feature: true })) : mods.map((m) => ({ key: m.key, name: m.name, feature: false }));
  const options = (cat.data?.modules ?? []).filter((m) => m.state !== 'planned').flatMap((m) => [
    ...(m.core ? [] : [{ value: m.key, label: m.name }]),
    ...m.features.filter((f) => f.state !== 'planned').map((f) => ({ value: f.key, label: `${m.name}: ${f.name}` })),
  ]);
  const paused = (k: string, school?: string) => (flags.data ?? []).some((f) => f.key === `kill.${k}` && f.enabled && (f.scope === 'fleet' || f.schoolId === school));
  const all = q.data ?? [];
  const rows = all.filter((r) => (!find.trim() || r.name.toLowerCase().includes(find.trim().toLowerCase())) && (!plan || r.plan === plan));
  const every = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const has = (r: EntitlementRow, k: string, feature: boolean) => (feature ? r.active.includes(k.split('.')[0]!) && r.features[k] !== false : r.active.includes(k));

  const planOf = (give: boolean): Push[] => all.filter((r) => picked.has(r.id)).map((r) => { const cur = docOf(r);
    const isFeature = target.includes('.');
    const change: EntitlementChange = isFeature
      ? { features: { [target]: give } }
      : give ? { modules: [...r.modules, target], ...(until ? { dates: { [target]: { until } } } : {}) } : { modules: r.modules.filter((k) => k !== target) };
    return { schoolId: r.id, name: r.name, cur, change };
  }).filter((p) => { const c = changeEntitlement(p.cur, p.change); return c.added.length || c.removed.length || c.problems.length || (give && until); });

  const open = (give: boolean) => { if (!target) { say(t('console.modules_page.choose_a_module_or_feature'), 'bad'); return; }
    const list = planOf(give);
    if (!list.length) { say(give ? t('console.modules_page.the_chosen_schools_already_have') : t('console.modules_page.none_of_the_chosen_schools'), 'bad'); return; }
    setReview(list);
  };
  const lift = useMutation({ mutationFn: async (k: string) => { for (const f of (flags.data ?? []).filter((x) => x.key === `kill.${k}` && x.enabled)) await app.api.flags.remove(f.key, f.schoolId); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['flags'] }); say(t('console.modules_page.lifted_it_comes_back_within')); },
    onError: (e) => say((e as Error).message, 'bad') });

  if (q.isLoading || cat.isLoading) return <Skeleton kind="rows" rows={6} />;
  if (q.isError) return <div><EmptyCard error title={t('console.modules_page.schools')} chip={{ text: t('console.modules_page.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('console.modules_page.that_didn_t_load')} body={(q.error as Error).message} actions={<button className="btn pri" onClick={() => void q.refetch()}>{t('console.modules_page.try_again')}</button>} /></div>;
  if (!all.length) return <div><EmptyCard title={t('console.modules_page.plans_and_modules')} chip={{ text: t('console.modules_page.0_schools'), tone: 'v' }} icon="homework" heading={t('console.modules_page.no_schools_yet')} body={t('console.modules_page.once_a_school_is_onboarded')} /></div>;
  return (
    <>
      {review && <ReviewDialog list={review} onClose={() => setReview(null)} onDone={(m) => { setReview(null); setPicked(new Set()); say(m); }} />}
      {pausing && <PauseDialog mod={pausing} onClose={() => setPausing(null)} onDone={(m) => { setPausing(null); void qc.invalidateQueries({ queryKey: ['flags'] }); say(m); }} />}
      {can && (
        <Card title={t('console.modules_page.change_many_schools')} chip={<span className="chip">{picked.size} {t('console.modules_page.chosen')}</span>}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2 1 240px' }}><SelectField label={t('console.modules_page.module_or_feature')} value={target} onChange={setTarget} options={[{ value: '', label: t('console.modules_page.choose') }, ...options]} /></div>
            <div style={{ flex: '1 1 160px' }}><DateField label={t('console.modules_page.until_optional_a_trial')} value={until} onChange={setUntil} disabled={target.includes('.')} /></div>
            <div style={{ display: 'flex', gap: 10, paddingBottom: 2 }}>
              <button className="btn pri" disabled={!picked.size} onClick={() => open(true)}>{t('console.modules_page.give')}</button>
              <button className="btn dng" disabled={!picked.size} onClick={() => open(false)}>{t('console.modules_page.take_away')}</button>
            </div>
          </div>
        </Card>
      )}
      <Card style={{ padding: 0 }}>
        <div className="ch" style={{ padding: '20px 20px 4px', flexWrap: 'wrap', gap: 10 }}>
          <div className="srch" style={{ minWidth: 200, height: 38, flex: '1 1 200px', maxWidth: 320 }}>
            <Icon name="search" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('console.modules_page.find_a_school')} aria-label={t('console.modules_page.find_a_school')} style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} />
          </div>
          <Select compact aria-label={t('console.modules_page.plan')} value={plan} onChange={setPlan} options={[{ value: '', label: t('console.modules_page.every_plan') }, ...[...new Set(all.map((r) => r.plan))].map((p) => ({ value: p, label: p }))]} />
          <span className="grow"></span>
          {focused && (
            <>
              <b style={{ font: '700 14px var(--fb)' }}>{focused.name}{t('console.modules_page.features')}</b>
              {app.can('flags.write') && (paused(focused.key) ? <button className="btn sm" disabled={lift.isPending} onClick={() => lift.mutate(focused.key)}>{t('console.modules_page.lift_the_pause')}</button> : <button className="btn sm dng" onClick={() => setPausing(focused)}>{t('console.modules_page.pause')}</button>)}
              <button className="btn sm" onClick={() => setFocus('')}>{t('console.modules_page.back_to_every_module')}</button>
            </>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div className="hb" role="table" aria-label={focused ? t('console.modules_page.features_by_school', { name: focused.name }) : t('console.modules_page.modules_by_school')} style={{ display: 'grid', gridTemplateColumns: `40px minmax(190px,1.6fr) repeat(${Math.max(1, cols.length)}, minmax(84px,1fr))`, minWidth: 260 + Math.max(1, cols.length) * 84, alignItems: 'stretch' }}>
            <div role="row" style={{ display: 'contents' }}>
              <span role="columnheader" style={{ padding: '16px 0 16px 20px', display: 'flex', alignItems: 'center' }}>
                {can && <Checkbox aria-label={t('console.modules_page.choose_every_school_shown')} checked={every} onChange={() => setPicked(every ? new Set() : new Set(rows.map((r) => r.id)))} />}
              </span>
              <span role="columnheader" className="help" style={{ margin: 0, padding: '16px 8px', fontWeight: 700, display: 'flex', alignItems: 'center' }}>{t('console.modules_page.school')}{' '}{rows.length}</span>
              {cols.length === 0 && <span role="columnheader" style={{ padding: 16 }}><EmptyNote icon="modules" title={t('console.modules_page.no_features_to_choose')} /></span>}
              {cols.map((c) => (
                <span key={c.key} role="columnheader" style={{ padding: '10px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.feature ? <span className="vc" style={{ alignItems: 'center', gap: 4 }}>
                      <span className="help" style={{ margin: 0, fontWeight: 700, textAlign: 'center', lineHeight: 1.25, color: paused(c.key) ? 'var(--bad-i)' : undefined }}>{c.name}{paused(c.key) ? t('console.modules_page.paused') : ''}</span>
                      {app.can('flags.write') && (paused(c.key) ? <button className="btn sm" aria-label={`${c.name}: ${t('console.modules_page.lift_the_pause')}`} disabled={busyFor(lift, c.key)} onClick={() => lift.mutate(c.key)}>{t('console.modules_page.lift_the_pause')}</button> : <button className="btn sm dng" aria-label={`${c.name}: ${t('console.modules_page.pause')}`} onClick={() => setPausing({ key: c.key, name: c.name })}>{t('console.modules_page.pause')}</button>)}
                    </span>
                    : <button className="vc" style={{ alignItems: 'center', gap: 6, font: '600 12px/16px var(--fb)', color: paused(c.key) ? 'var(--bad-i)' : 'var(--ink2)', textAlign: 'center' }} data-tip={paused(c.key) ? t('console.modules_page.paused_for_every_school_open') : t('console.modules_page.open_its_features')} onClick={() => setFocus(c.key)}><Icon name={modIcon(c.key)} className="i" />{c.name}{paused(c.key) ? t('console.modules_page.paused') : ''}</button>}
                </span>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.id} role="row" style={{ display: 'contents' }}>
                <span role="cell" style={{ padding: '12px 0 12px 20px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                  {can && <Checkbox aria-label={t('console.modules_page.choose_2', { name: r.name })} checked={picked.has(r.id)} onChange={() => { const n = new Set(picked); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); setPicked(n); }} />}
                </span>
                <span role="cell" style={{ padding: '12px 8px', borderTop: '1px solid var(--line)', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <a href={url(`/schools/${r.id}/plan`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${r.id}/plan`); }} style={{ font: '700 14px var(--fb)', color: 'inherit', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</a>
                  <small style={{ color: 'var(--ink3)' }}>{r.plan}{r.trialUntil ? t('console.modules_page.trial_until', { trialUntil: r.trialUntil }) : ''}</small>
                </span>
                {cols.map((c) => <span key={c.key} role="cell" style={{ padding: '12px 4px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{dot(has(r, c.key, c.feature), c.feature ? undefined : r.dates[c.key]?.until, paused(c.key, r.id))}</span>)}
              </div>
            ))}
          </div>
        </div>
        {!rows.length && <div style={{ padding: '4px 20px 20px' }}><EmptyNote icon="search" title={find.trim() ? t('console.modules_page.no_school_matches', { p0: find.trim() }) : t('console.modules_page.no_school_on_this_plan')} body={find.trim() ? t('console.modules_page.search_by_the_school_s') : t('console.modules_page.choose_another_plan_or_every')} /></div>}
      </Card>
    </>
  );
}

/** A pause takes a module away from the apps and refuses its requests within seconds, for every school or one; the data is kept. */
function PauseDialog({ mod, onClose, onDone }: { mod: Pick<Mod, 'key' | 'name'>; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const [school, setSchool] = useState('');
  const go = useMutation({ mutationFn: () => app.api.flags.set(`kill.${mod.key}`, { enabled: true, schoolId: school || null, label: t('console.modules_page.paused_2', { name: mod.name }) }),
    onSuccess: () => onDone(t('console.modules_page.is_paused_it_takes_effect', { name: mod.name, p1: school ? t('console.modules_page.at', { p0: schools.data?.find((s) => s.id === school)?.name ?? 'that school' }) : t('console.modules_page.for_every_school') })) });
  return (
    <Dialog title={t('console.modules_page.pause_2', { name: mod.name })} tag={{ text: t('console.modules_page.takes_effect_at_once'), tone: 'a' }} onClose={onClose} width={480}>
      <p style={{ marginTop: 0 }}>{t('console.modules_page.for_a_fault_that_cannot')}{' '}{mod.name} {t('console.modules_page.leaves_the_apps_and_the')}</p>
      <SelectField label={t('console.modules_page.for')} value={school} onChange={setSchool} options={[{ value: '', label: t('console.modules_page.every_school') }, ...(schools.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      {go.isError && <ErrorLine>{(go.error as Error).message}</ErrorLine>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.modules_page.cancel')}</button>
        <button className="btn dngf" disabled={go.isPending} onClick={() => go.mutate()}>{t('console.modules_page.pause_it')}</button>
      </div>
    </Dialog>
  );
}

/** The plans a school can start from: the price per student a year, the modules it brings, the features it leaves out, its limits. */
function Plans({ say }: { say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ['plans'], queryFn: app.api.plans });
  const [editing, setEditing] = useState<PlanRow | 'new' | null>(null);
  const can = app.can('billing.write');
  const remove = useMutation({ mutationFn: (key: string) => app.api.plan.remove(key),
    onSuccess: (list) => { qc.setQueryData(['plans'], list); say(t('console.modules_page.plan_removed')); },
    onError: (e) => say((e as Error).message, 'bad') });
  if (plans.isLoading) return <Skeleton kind="rows" rows={5} />;
  return (
    <>
      {editing && <PlanDialog plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(list, m) => { qc.setQueryData(['plans'], list); setEditing(null); say(m); }} />}
      <Card title={t('console.modules_page.plans')} chip={can ? <button className="btn sm pri" onClick={() => setEditing('new')}>{t('console.modules_page.new_plan')}</button> : undefined}>
        <div className="help" style={{ marginTop: 0 }}>{t('console.modules_page.a_new_school_starts_from')}</div>
        {(plans.data ?? []).map((p) => (
          <div key={p.key} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 260px', minWidth: 0 }}>
              <b style={{ font: '700 15px var(--fb)' }}>{p.name}</b> <span className="chip">{t('console.modules_page.n_schools', { n: p.schools ?? 0 })}</span>
              <small style={{ display: 'block', color: 'var(--ink3)' }}>{price(p.perStudentYear)} {t('console.modules_page.a_student_a_year')}{' '}{p.modules.length} {t('console.modules_page.modules_up_to')}{' '}{count(p.limits.students)} {t('console.modules_page.students')}{' '}{count(p.limits.storageGb)} {t('console.modules_page.gb')}{' '}{count(p.limits.smsPerMonth)} {t('console.modules_page.texts_a_month')}</small>
            </span>
            {can && <span className="tgrow"><button className="btn sm" onClick={() => setEditing(p)}>{t('console.modules_page.change')}</button><button className="btn sm dng" disabled={!!p.schools || busyFor(remove, p.key)} data-tip={p.schools ? t('console.modules_page.move_its_schools_to_another') : undefined} onClick={() => remove.mutate(p.key)}>{t('console.modules_page.remove')}</button></span>}
          </div>
        ))}
      </Card>
    </>
  );
}

function PlanDialog({ plan, onClose, onDone }: { plan: PlanRow | null; onClose: () => void; onDone: (list: PlanRow[], m: string) => void }) { const app = useApp();
  const cat = useQuery({ queryKey: ['catalog'], queryFn: app.api.catalog, staleTime: 10 * 60_000 });
  const shake = useShake();
  const [f, setF] = useState({ key: plan?.key ?? '', name: plan?.name ?? '', price: String(plan?.perStudentYear ?? ''), students: String(plan?.limits.students ?? 500), staff: plan?.limits.staff == null ? '' : String(plan.limits.staff), storage: String(plan?.limits.storageGb ?? 5), sms: String(plan?.limits.smsPerMonth ?? 1000) });
  const [mods, setMods] = useState<Set<string>>(new Set(plan?.modules ?? []));
  const [off, setOff] = useState<Record<string, boolean>>(plan?.features ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const list = (cat.data?.modules ?? []).filter((m) => m.state !== 'planned' && !m.core);
  const save = useMutation({ mutationFn: () => { const body = PlanSave.parse({ key: f.key.trim(), name: f.name.trim(), perStudentYear: Number(f.price || 0), modules: [...mods], features: Object.fromEntries(Object.entries(off).filter(([, v]) => v === false)),
        limits: { students: Number(f.students), ...(f.staff.trim() ? { staff: Number(f.staff) } : {}), storageGb: Number(f.storage), smsPerMonth: Number(f.sms) } });
      return plan ? app.api.plan.save(plan.key, body) : app.api.plan.add(body);
    },
    onSuccess: (l) => onDone(l, plan ? t('console.modules_page.saved_new_invoices_use_the', { p0: f.name.trim() }) : t('console.modules_page.added', { p0: f.name.trim() })),
    onError: (e) => { const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      setErr(issues ? Object.fromEntries(issues.map((i) => [String(i.path.at(-1) === 'perStudentYear' ? 'price' : i.path.at(-1)), i.message])) : e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });
      shake.hit();
    } });
  return (
    <Dialog title={plan ? t('console.modules_page.change_2', { name: plan.name }) : t('console.modules_page.new_plan')} tag={plan?.schools ? { text: t('console.modules_page.on_it', { schools: plan.schools }), tone: 'a' } : undefined} onClose={onClose} width={620} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <Field label={t('console.modules_page.name')} value={f.name} onChange={set('name')} error={err.name} maxLength={40} placeholder={t('console.modules_page.standard')} />
          <Field label={t('console.modules_page.key')} value={f.key} onChange={set('key')} error={err.key} disabled={!!plan} hint={plan ? t('console.modules_page.schools_are_on_it_by') : t('console.modules_page.lowercase_used_in_addresses_and')} placeholder="standard" />
        </div>
        <div className="two">
          <NumberField label={t('console.modules_page.price_per_student_a_year')} min={0} step={10} value={f.price} onChange={set('price')} error={err.price} />
          <NumberField label={t('console.modules_page.students_2')} min={1} step={50} value={f.students} onChange={set('students')} error={err.students} />
        </div>
        <div className="two">
          <NumberField label={t('console.modules_page.staff_accounts')} min={0} value={f.staff} onChange={set('staff')} hint={t('console.modules_page.empty_no_limit')} />
          <NumberField label={t('console.modules_page.file_storage_gb')} min={1} value={f.storage} onChange={set('storage')} error={err.storageGb} />
        </div>
        <NumberField label={t('console.modules_page.texts_a_month_2')} min={0} step={500} value={f.sms} onChange={set('sms')} error={err.smsPerMonth} />
        <div className="fld">
          <label>{t('console.modules_page.modules_it_brings')}</label>
          {err.modules && <ErrorLine>{err.modules}</ErrorLine>}
          {list.map((m) => { const on = mods.has(m.key);
            return (
              <div key={m.key} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', font: '700 14px var(--fb)' }}>
                  <button type="button" className={`sw ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={m.name} onClick={() => { const n = new Set(mods); if (on) n.delete(m.key); else n.add(m.key); setMods(n); setErr((x) => ({ ...x, modules: '' })); }} />{m.name}
                </label>
                {on && m.features.some((x) => x.state !== 'planned') && (
                  <div className="tgrow" style={{ marginTop: 6, paddingInlineStart: 56 }}>
                    {m.features.filter((x) => x.state !== 'planned').map((x) => { const has = off[x.key] !== false;
                      return <button key={x.key} type="button" className={`fp ${has ? 'on' : ''}`} aria-pressed={has} onClick={() => setOff({ ...off, [x.key]: !has ? true : false })}>{x.name}</button>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {err._ && <ErrorLine>{err._}</ErrorLine>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.modules_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('console.modules_page.saving') : plan ? t('console.modules_page.save_plan') : t('console.modules_page.add_plan')}</button>
      </div>
    </Dialog>
  );
}

/** Modules on the way, from the module definition: plans can name them, and their switches turn on once each is built. */
function Planned() { const app = useApp();
  const cat = useQuery({ queryKey: ['catalog'], queryFn: app.api.catalog, staleTime: 10 * 60_000 });
  const planned = (cat.data?.modules ?? []).filter((m) => m.state === 'planned');
  const features = (cat.data?.modules ?? []).filter((m) => m.state !== 'planned').flatMap((m) => m.features.filter((f) => f.state === 'planned').map((f) => ({ ...f, module: m.name })));
  if (cat.isLoading) return <Skeleton kind="rows" rows={4} />;
  return (
    <>
      <Card title={t('console.modules_page.planned_modules')} chip={<span className="chip">{planned.length}</span>}>
        {planned.length === 0 && <EmptyState scene="planned" onAction={() => app.go('/modules')} />}
        {planned.map((m) => <div key={m.key} className="kv" style={{ alignItems: 'flex-start' }}><span><b style={{ color: 'var(--ink)' }}>{m.name}</b><br /><small style={{ color: 'var(--ink3)' }}>{m.blurb}</small></span></div>)}
      </Card>
      {features.length > 0 && (
        <Card title={t('console.modules_page.planned_features')} chip={<span className="chip">{features.length}</span>}>
          {features.map((f) => <div key={f.key} className="kv"><span>{f.name}</span><b>{f.module}</b></div>)}
        </Card>
      )}
    </>
  );
}
