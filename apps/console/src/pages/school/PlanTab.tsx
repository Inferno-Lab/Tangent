import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { changeEntitlement, type EntitlementChange } from '@tangent/config-engine';
import type { SchoolDetail } from '@tangent/contracts';
import { DateField, Dialog, NumberField, SelectField, t, useUnsaved } from '@tangent/web-ui';
import type { CatalogDoc } from '@tangent/api-client';
import { Card } from '../../app/Page';
import { useApp } from '../../app/context';
import { ReviewDialog, docOf, sig } from '../modules/ModulesPage';
import { count } from '../../app/format';

type Say = (text: string, tone?: 'ok' | 'bad') => void;
type Mod = CatalogDoc['modules'][number];
const asText = (l: SchoolDetail['entitlement']['limits']) => ({ students: String(l.students), staff: l.staff == null ? '' : String(l.staff), storageGb: String(l.storageGb), smsPerMonth: String(l.smsPerMonth) });

/**
 * One school's plan and modules: the only place a school's modules are chosen. Edited here, reviewed, then sent; taking anything
 * away waits for a second person.
 */
export function PlanTab({ d, say }: { d: SchoolDetail; say: Say }) {
  const app = useApp();
  const cat = useQuery({ queryKey: ['catalog'], queryFn: app.api.catalog, staleTime: 10 * 60_000 });
  const plans = useQuery({ queryKey: ['plans'], queryFn: app.api.plans, staleTime: 10 * 60_000 });
  const e = d.entitlement;
  const cur = useMemo(() => docOf(e), [e]);
  const [plan, setPlan] = useState(e.plan);
  const [mods, setMods] = useState<Set<string>>(new Set(e.modules));
  const [features, setFeatures] = useState<Record<string, boolean>>(e.features);
  const [dates, setDates] = useState(e.dates);
  const [trial, setTrial] = useState(e.trialUntil ?? '');
  const [limits, setLimits] = useState(asText(e.limits));
  const [review, setReview] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const can = app.can('schools.write');
  const list = (cat.data?.modules ?? []) as Mod[];

  // A plan is the starting bundle: taking one resets the modules, features and limits to it, so it is said first.
  const takePlan = (k: string) => {
    const p = plans.data?.find((x) => x.key === k);
    setPlan(k);
    setAsking(null);
    if (!p) return;
    setMods(new Set(p.modules));
    setFeatures({ ...p.features });
    setLimits(asText(p.limits));
  };
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const change: EntitlementChange = {
    plan, modules: [...mods], features, trialUntil: trial || null,
    dates: Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, { ...(v.from ? { from: v.from } : {}), ...(v.until ? { until: v.until } : {}) }])),
    limits: { students: num(limits.students) ?? 0, ...(num(limits.staff) !== undefined ? { staff: num(limits.staff) } : {}), storageGb: num(limits.storageGb) ?? 0, smsPerMonth: num(limits.smsPerMonth) ?? 0 },
  };
  const preview = changeEntitlement(cur, change);
  const dirty = sig(preview.next) !== sig(cur);
  useUnsaved(dirty);
  const setDate = (k: string, field: 'from' | 'until', v: string) => setDates((x) => ({ ...x, [k]: { ...x[k], [field]: v || undefined } }));
  const next = asking ? plans.data?.find((p) => p.key === asking) : undefined;

  return (
    <section className="grid">
      {review && <ReviewDialog list={[{ schoolId: d.id, name: d.name, cur, change }]} onClose={() => setReview(false)} onDone={(m) => { setReview(false); say(m); }} />}
      {next && (
        <Dialog title={t('console.plan_tab.move_to', { name: next.name })} tag={{ text: t('console.plan_tab.resets_modules_and_limits'), tone: 'a' }} onClose={() => setAsking(null)} width={480}>
          <p style={{ marginTop: 0 }}>{t('console.plan_tab.the_modules_features_and_limits')}{' '}{next.name} {t('console.plan_tab.plan_s')}{' '}{next.modules.length} {t('console.plan_tab.modules_up_to')}{' '}{count(next.limits.students)} {t('console.plan_tab.students_you_can_change_them')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setAsking(null)}>{t('console.plan_tab.keep')}{' '}{plans.data?.find((p) => p.key === plan)?.name ?? t('console.plan_tab.this_plan')}</button>
            <button className="btn pri" onClick={() => takePlan(next.key)}>{t('console.plan_tab.use')}{' '}{next.name}</button>
          </div>
        </Dialog>
      )}
      <Card title={t('console.plan_tab.plan_and_limits')} span="s12" chip={<span className="chip">{t('console.plan_tab.version')}{' '}{e.version}</span>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <SelectField label={t('console.plan_tab.plan')} value={plan} onChange={(k) => (k !== plan ? setAsking(k) : undefined)} disabled={!can} options={(plans.data ?? []).map((p) => ({ value: p.key, label: p.name }))} />
          <NumberField label={t('console.plan_tab.students')} min={1} value={limits.students} onChange={(v) => setLimits({ ...limits, students: v })} disabled={!can} />
          <NumberField label={t('console.plan_tab.staff_accounts')} min={0} value={limits.staff} onChange={(v) => setLimits({ ...limits, staff: v })} disabled={!can} hint={t('console.plan_tab.empty_no_limit')} />
          <NumberField label={t('console.plan_tab.file_storage_gb')} min={1} value={limits.storageGb} onChange={(v) => setLimits({ ...limits, storageGb: v })} disabled={!can} />
          <NumberField label={t('console.plan_tab.texts_a_month')} min={0} step={100} value={limits.smsPerMonth} onChange={(v) => setLimits({ ...limits, smsPerMonth: v })} disabled={!can} />
          <DateField label={t('console.plan_tab.free_until_trial')} value={trial} onChange={setTrial} disabled={!can} hint={t('console.plan_tab.no_invoice_until_this_day')} />
        </div>
      </Card>
      <Card title={t('console.plan_tab.modules_and_features')} span="s12" chip={<span className="chip">{e.active.length} {t('console.plan_tab.on_today')}</span>}>
        <div className="help" style={{ marginTop: 0 }}>{t('console.plan_tab.a_module_outside_its_dates')}</div>
        {list.filter((m) => m.state !== 'planned').map((m) => {
          const on = m.core || mods.has(m.key);
          return (
            <div key={m.key} style={{ padding: '16px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className={`sw ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={m.name} disabled={!can || m.core}
                  onClick={() => { const n = new Set(mods); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); setMods(n); }} />
                <span style={{ flex: '1 1 200px', minWidth: 0 }}><b style={{ font: '700 14px var(--fb)' }}>{m.name}</b>{m.core && <span className="chip" style={{ marginInlineStart: 8 }}>{t('console.plan_tab.always_on')}</span>}<div className="help" style={{ margin: 0 }}>{m.blurb}</div></span>
                {on && !m.core && (
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ width: 180 }}><DateField label={t('console.plan_tab.from')} value={dates[m.key]?.from ?? ''} onChange={(v) => setDate(m.key, 'from', v)} disabled={!can} /></span>
                    <span style={{ width: 180 }}><DateField label={t('console.plan_tab.until')} value={dates[m.key]?.until ?? ''} onChange={(v) => setDate(m.key, 'until', v)} disabled={!can} /></span>
                  </span>
                )}
              </div>
              {on && m.features.length > 0 && (
                <div className="tgrow" style={{ marginTop: 10, paddingInlineStart: 56 }}>
                  {m.features.map((f) => f.state === 'planned'
                    ? <span key={f.key} className="chip" style={{ maxWidth: '100%' }} data-tip={t('console.plan_tab.planned_not_built_yet', { name: f.name })}><span style={{ overflowWrap: 'anywhere' }}>{f.name} {t('console.plan_tab.planned')}</span></span>
                    : (
                      <Fragment key={f.key}>
                        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', font: '600 13px var(--fb)' }}>
                          <button type="button" className={`sw ${features[f.key] !== false ? 'on' : ''}`} role="switch" aria-checked={features[f.key] !== false} aria-label={f.name} disabled={!can}
                            onClick={() => setFeatures({ ...features, [f.key]: features[f.key] === false })} />
                          {f.name}
                        </label>
                      </Fragment>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
      <Card title={t('console.plan_tab.send_to_the_school')} span="s12">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="help" style={{ flex: 1, minWidth: 220, margin: 0 }}>
            {preview.problems.length ? preview.problems.join(' ') : dirty ? t('console.plan_tab.to_give_to_take_away', { length: preview.added.length, length1: preview.removed.length }) : t('console.plan_tab.nothing_has_changed_yet')}
          </div>
          <button className="btn pri" disabled={!can || !dirty || preview.problems.length > 0} onClick={() => setReview(true)}>{t('console.plan_tab.review_changes')}</button>
        </div>
      </Card>
    </section>
  );
}
