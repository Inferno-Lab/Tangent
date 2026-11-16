import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { CAPABILITIES, CAPABILITY_LABELS, INTEGRATION_PROVIDERS, providerDef, type SchoolDetail } from '@tangent/contracts';
import { Dialog, EmptyCard, Presence, useShake, EmptyNote, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { ago } from '../../app/format';
import { url } from '../../app/base';

/** A phone number or address with only its end showing, until someone asks to see it. */
export const mask = (to: string) => (to.includes('@') ? to.replace(/^(.).*?(@.*)$/, '$1•••$2') : to.replace(/\d(?=(?:\D*\d){4})/g, '•'));

/** One school's view of the Hub: what serves each capability (its own route or the default), its own connections, its volume and failures. */
export function IntegrationsTab({ d }: { d: SchoolDetail }) {
  const app = useApp();
  const [shown, setShown] = useState<Set<string>>(new Set());
  const view = useQuery({ queryKey: ['integrations'], queryFn: app.api.integrations.view, enabled: app.can('integrations.read') });
  const fails = useQuery({ queryKey: ['activity', d.slug, '', 'failed'], queryFn: () => app.api.integrations.activity({ school: d.slug, status: 'failed', limit: 10 }), enabled: app.can('integrations.read') });
  if (!app.can('integrations.read')) return <EmptyCard title={t('console.integrations_tab.messaging')} chip={{ text: t('console.integrations_tab.not_for_your_role'), tone: 'a' }} icon="lock" heading={t('console.integrations_tab.integrations_are_for_implementation_and')} body={t('console.integrations_tab.ask_a_super_admin_if')} />;
  if (view.isLoading) return <div className="skc" style={{ height: 240, borderRadius: 24 }} />;
  const v = view.data;
  if (!v) return <EmptyCard error title={t('console.integrations_tab.integrations')} chip={{ text: t('console.integrations_tab.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('console.integrations_tab.that_didn_t_load')} body={(view.error as Error)?.message ?? ''} actions={<button className="btn pri" onClick={() => void view.refetch()}>{t('console.integrations_tab.try_again')}</button>} />;
  const name = (id: string | null) => (id ? v.connections.find((c) => c.id === id)?.name ?? t('console.integrations_tab.deleted') : '');
  const caps = CAPABILITIES.filter((k) => INTEGRATION_PROVIDERS.some((p) => p.key !== 'sandbox' && p.capabilities.includes(k)));
  const own = v.connections.filter((c) => c.schoolId === d.id);
  return (
    <>
      <section className="grid" data-even="">
        <div className="card s7 rise">
          <div className="ch"><h2>{t('console.integrations_tab.what_reaches_this_school_s')}</h2><span className={`chip ${v.mode === 'live' ? 'g' : 'a'}`}>{v.mode === 'live' ? t('console.integrations_tab.live_mode') : t('console.integrations_tab.sandbox_mode')}</span></div>
          <div style={{ marginTop: 8 }}>
            {caps.map((k) => {
              const mine = v.routes.find((r) => r.capability === k && r.schoolId === d.id);
              const def = v.routes.find((r) => r.capability === k && !r.schoolId);
              const r = mine ?? def;
              return (
                <div key={k} className="kv" style={{ alignItems: 'center' }}>
                  <span>{CAPABILITY_LABELS[k]}</span>
                  <b style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {r ? <><span className={`chip ${mine ? 'v' : ''}`}>{mine ? t('console.integrations_tab.its_own') : t('console.integrations_tab.tangent_default')}</span><span style={{ minWidth: 0 }}>{name(r.connectionId)}{r.fallbackId ? ` → ${name(r.fallbackId)}` : ''}</span></>
                      : <span style={{ color: 'var(--ink3)' }}>{v.mode === 'live' ? t('console.integrations_tab.not_set_up_fails') : t('console.integrations_tab.test_inbox')}</span>}
                  </b>
                </div>
              );
            })}
          </div>
          <div className="help" style={{ marginTop: 10 }}>{t('console.integrations_tab.change_routes_on')}{' '}<a href={url('/integrations/routing')} onClick={(e) => { e.preventDefault(); app.go('/integrations/routing'); }}>{t('console.integrations_tab.integrations_routing')}</a>{t('console.integrations_tab.texts_used_this_month_are')}</div>
        </div>
        <div className="card s5 rise">
          <div className="ch"><h2>{t('console.integrations_tab.its_own_connections')}</h2><span className="chip">{own.length}</span></div>
          {!own.length ? <EmptyNote icon="integrations" title={t('console.integrations_tab.none_of_its_own')} body={t('console.integrations_tab.this_school_sends_through_tangent')} /> : own.map((c) => (
            <div key={c.id} className="kv" style={{ alignItems: 'center' }}><span style={{ minWidth: 0 }}>{c.name}</span><b style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="chip">{providerDef(c.provider)?.name}</span><span className={`chip ${c.state === 'live' ? 'g' : c.state === 'paused' ? 'c' : 'a'}`}>{c.state}</span></b></div>
          ))}
        </div>
      </section>
      <section className="card rise">
        <div className="ch"><h2>{t('console.integrations_tab.recent_failures')}</h2><span className="chip">{fails.data?.rows.length ?? 0}</span></div>
        <div style={{ marginTop: 8 }}>
          {!(fails.data?.rows ?? []).length ? <EmptyNote icon="checkCircle" title={t('console.integrations_tab.nothing_has_failed_lately')} body={t('console.integrations_tab.a_message_to_this_school')} /> : fails.data!.rows.map((m) => (
            <div key={m.id} className="kv" style={{ alignItems: 'center' }}>
              <span style={{ minWidth: 0 }}><b className="num">{shown.has(m.id) ? m.to : mask(m.to)}</b>{!shown.has(m.id) && <button className="btn sm" style={{ marginInlineStart: 8 }} onClick={() => setShown(new Set(shown).add(m.id))}>{t('console.integrations_tab.show')}</button>} · {CAPABILITY_LABELS[m.channel as keyof typeof CAPABILITY_LABELS] ?? m.channel}<br /><small style={{ color: 'var(--bad-i)', overflowWrap: 'anywhere' }}>{m.error}</small></span>
              <b style={{ whiteSpace: 'nowrap' }}>{ago(m.createdAt)}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** Records of students who left, past the school's retention period: erased only after a second person approves. */
export function RecordsTab({ d, say }: { d: SchoolDetail; say: (m: string, tone?: 'ok' | 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['retention', d.id], queryFn: () => app.api.retention(d.id), enabled: d.status !== 'onboarding' });
  const [open, setOpen] = useState(false);
  if (q.isLoading) return <div className="skc" style={{ height: 200, borderRadius: 24 }} />;
  const r = q.data;
  return (
    <section className="card s12 rise">
      <div className="ch"><h2>{t('console.integrations_tab.students_who_left')}</h2><span className={`chip ${r?.due ? 'a' : 'g'}`}>{r ? t('console.integrations_tab.past_months', { due: r.due, months: r.months }) : t('console.integrations_tab.unknown')}</span></div>
      <p className="help" style={{ margin: '8px 0 0' }}>
        {q.isError ? (q.error as Error).message
          : r?.due ? t('console.integrations_tab.left_more_than_months_ago', { due: r.due, p1: r.due === 1 ? 'student' : 'students', months: r.months })
            : t('console.integrations_tab.nobody_is_past_the_month', { p0: r?.months ?? 36 })}
      </p>
      {app.can('schools.write') && !!r?.due && <div style={{ marginTop: 16 }}><button className="btn" onClick={() => setOpen(true)}>{t('console.integrations_tab.request_erasure')}</button></div>}
      <Presence>{open && r && <EraseLeavers d={d} due={r.due} onClose={() => setOpen(false)} onSent={(m) => { setOpen(false); void qc.invalidateQueries({ predicate: (x) => ['retention', 'actions'].includes(String(x.queryKey[0])) }); say(m); }} />}</Presence>
    </section>
  );
}

function EraseLeavers({ d, due, onClose, onSent }: { d: SchoolDetail; due: number; onClose: () => void; onSent: (m: string) => void }) {
  const app = useApp();
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState('');
  const shake = useShake();
  const send = useMutation({
    mutationFn: () => app.api.actions.request({ action: 'retention.erase', schoolId: d.id, confirmCode: typed.trim() }),
    onSuccess: (a) => onSent(a.status === 'pending_approval' ? t('console.integrations_tab.asked_for_approval_a_second') : a.summary),
    onError: (e) => { setBad(e instanceof HttpError ? (e.fields.confirmCode ?? e.message) : (e as Error).message); shake.hit(); },
  });
  return (
    <Dialog dark title={t('console.integrations_tab.erase_leavers_records', { due })} tag={{ text: t('console.integrations_tab.permanent_needs_a_second_approver'), tone: 'c' }} onClose={onClose} shake={shake.cls} width={480}>
      <p>{t('console.integrations_tab.names_photos_documents_and_guardians')}{' '}{d.name} {t('console.integrations_tab.past_its_retention_period_are')}</p>
      <div>
        <label htmlFor="ret-in">{t('console.integrations_tab.type')}{' '}<b style={{ color: 'var(--on-deep)' }}>{d.slug}</b> {t('console.integrations_tab.to_continue')}</label>
        <input id="ret-in" className={`shake ${bad ? 'err' : ''}`} value={typed} onChange={(e) => { setTyped(e.target.value); setBad(''); }} autoComplete="off" aria-invalid={!!bad} />
      </div>
      {bad && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{bad}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" style={{ background: 'transparent', color: 'var(--on-deep)', borderColor: 'color-mix(in srgb,var(--on-deep) 18%,transparent)' }} onClick={onClose}>{t('console.integrations_tab.cancel')}</button>
        <button className="btn dngf" onClick={() => (typed.trim() === d.slug ? send.mutate() : (setBad(t('console.integrations_tab.that_isn_t_the_school')), shake.hit()))} disabled={send.isPending}>{t('console.integrations_tab.request_erasure')}</button>
      </div>
    </Dialog>
  );
}
