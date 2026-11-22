import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIONS, ACTION_LABELS, CONSOLE_ROLES, CONSOLE_ROLE_INFO, type ConsoleRole, type PolicyDoc } from '@tangent/contracts';
import { AreaField, Dialog, useShake, t, useUnsaved } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { usePageTabs } from '../../app/tabs';

type Say = (text: string, tone?: 'ok' | 'bad') => void;

/** What configures the console itself: which changes need a second person (and the freeze). Its colours are Tangent Hue's cobalt. */
export function SettingsPage() {
  const { tabs } = usePageTabs('/settings');
  const { toast, say } = useToast();
  return (
    <Page title={t('console.settings_page.console_settings')} sub={t('console.settings_page.which_changes_need_a_second')} toast={toast} tabs={tabs}>
      <Rules say={say} />
    </Page>
  );
}

/** Which actions wait for a second person and which roles may approve them, from the one action list; and the freeze. */
function Rules({ say }: { say: Say }) {
  const app = useApp();
  const qc = useQueryClient();
  const policy = useQuery({ queryKey: ['policy'], queryFn: app.api.policy.get });
  const [pol, setPol] = useState<PolicyDoc | null>(null);
  const [freezing, setFreezing] = useState(false);
  useEffect(() => { if (policy.data) setPol(policy.data); }, [policy.data]);
  const can = app.can('policy.write');
  const save = useMutation({
    mutationFn: (p: PolicyDoc) => app.api.policy.set(p),
    onSuccess: (p) => { qc.setQueryData(['policy'], p); setPol(p); setFreezing(false); say(p.freeze ? t('console.settings_page.changes_are_frozen_every_page') : t('console.settings_page.rules_saved')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  useUnsaved(!!pol && JSON.stringify(pol) !== JSON.stringify(policy.data));
  if (!pol) return <div className="skc" style={{ height: 320, borderRadius: 28 }} />;
  const dirty = JSON.stringify(pol) !== JSON.stringify(policy.data);
  const rule = (a: string) => pol.approvals[a] ?? { needed: false, roles: ['super_admin'] as ConsoleRole[] };
  const setRule = (a: string, r: PolicyDoc['approvals'][string]) => setPol({ ...pol, approvals: { ...pol.approvals, [a]: r } });
  return (
    <>
      <Card title={t('console.settings_page.freeze_changes')} chip={<span className={`chip ${pol.freeze ? 'c' : 'g'}`}>{pol.freeze ? t('console.settings_page.frozen') : t('console.settings_page.off')}</span>}>
        <div className="help" style={{ marginTop: 0 }}>{pol.freeze ? t('console.settings_page.frozen_nothing_changes_in_any', { p0: pol.freezeReason || t('console.settings_page.no_reason_given') }) : t('console.settings_page.stops_every_change_across_the')}</div>
        {can && <button className={`btn ${pol.freeze ? '' : 'dng'}`} style={{ marginTop: 12 }} disabled={save.isPending} onClick={() => (pol.freeze ? save.mutate({ ...policy.data!, freeze: false, freezeReason: '' }) : setFreezing(true))}>{pol.freeze ? t('console.settings_page.lift_the_freeze') : t('console.settings_page.freeze_changes_2')}</button>}
      </Card>
      <Card title={t('console.settings_page.needs_a_second_person')}>
        <div className="help" style={{ marginTop: 0 }}>{t('console.settings_page.a_request_for_one_of')}</div>
        {ACTIONS.map((a) => {
          const r = rule(a);
          return (
            <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 220px', font: '600 14px var(--fb)' }}>{ACTION_LABELS[a]}</span>
              {r.needed && (
                <span className="tgrow" style={{ gap: 6 }} role="group" aria-label={t('console.settings_page.who_may_approve', { p0: ACTION_LABELS[a] })}>
                  {CONSOLE_ROLES.filter((x) => x !== 'auditor').map((x) => {
                    const on = r.roles.includes(x);
                    return <button key={x} type="button" className={`fp ${on ? 'on' : ''}`} aria-pressed={on} disabled={!can || (on && r.roles.length === 1)} onClick={() => setRule(a, { ...r, roles: on ? r.roles.filter((y) => y !== x) : [...r.roles, x] })}>{CONSOLE_ROLE_INFO[x].label}</button>;
                  })}
                </span>
              )}
              <button className={`sw ${r.needed ? 'on' : ''}`} role="switch" aria-checked={r.needed} aria-label={ACTION_LABELS[a]} disabled={!can} onClick={() => setRule(a, { ...r, needed: !r.needed })}></button>
            </div>
          );
        })}
        {can && <div className="tgrow" style={{ marginTop: 12 }}><button className="btn pri" disabled={!dirty || save.isPending} onClick={() => save.mutate(pol)}>{t('console.settings_page.save_rules')}</button><button className="btn" disabled={!dirty} onClick={() => setPol(policy.data!)}>{t('console.settings_page.discard')}</button></div>}
      </Card>
      {freezing && <FreezeDialog busy={save.isPending} onClose={() => setFreezing(false)} onFreeze={(reason) => save.mutate({ ...policy.data!, freeze: true, freezeReason: reason })} />}
    </>
  );
}

function FreezeDialog({ busy, onClose, onFreeze }: { busy: boolean; onClose: () => void; onFreeze: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  return (
    <Dialog title={t('console.settings_page.freeze_every_change')} tag={{ text: t('console.settings_page.whole_fleet'), tone: 'a' }} onClose={onClose} width={480} shake={shake.cls}>
      <p style={{ marginTop: 0 }}>{t('console.settings_page.nobody_can_change_a_school')}</p>
      <AreaField label={t('console.settings_page.why')} value={reason} onChange={(v) => { setReason(v); setErr(''); }} error={err} rows={2} maxLength={200} placeholder={t('console.settings_page.for_example_incident_on_cell')} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.settings_page.cancel')}</button>
        <button className="btn dngf" disabled={busy} onClick={() => { if (reason.trim().length < 5) { setErr(t('console.settings_page.say_why_in_a_few')); shake.hit(); } else onFreeze(reason.trim()); }}>{t('console.settings_page.freeze')}</button>
      </div>
    </Dialog>
  );
}
