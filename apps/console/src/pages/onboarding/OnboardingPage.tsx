import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WIZARD_STEPS, type WizardDraftRow } from '@tangent/contracts';
import { Dialog, tintFor, Icon, EmptyState, t as tr } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { url } from '../../app/base';
import { ago, initials, statusOf } from '../../app/format';

export function OnboardingPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools(), refetchInterval: 8000 });
  const drafts = useQuery({ queryKey: ['drafts'], queryFn: app.api.wizard.drafts, enabled: app.can('schools.write') });
  const [deleting, setDeleting] = useState<WizardDraftRow | null>(null);
  const del = useMutation({ mutationFn: (id: string) => app.api.wizard.deleteDraft(id), onSuccess: () => { setDeleting(null); void qc.invalidateQueries({ queryKey: ['drafts'] }); say(tr('console.onboarding_page.draft_deleted')); }, onError: (e) => say((e as Error).message, 'bad') });
  const setting = (schools.data ?? []).filter((s) => s.status === 'onboarding');
  // Running but not yet live: still moving in (imports, invites, the go-live checklist on its Overview).
  const moving = (schools.data ?? []).filter((s) => s.status === 'live' && !s.wentLiveAt);
  const recent = (schools.data ?? []).filter((s) => s.wentLiveAt).sort((a, b) => b.wentLiveAt!.localeCompare(a.wentLiveAt!)).slice(0, 5);
  const list = drafts.data ?? [];
  const none = !setting.length && !list.length;
  return (
    <Page title={tr('console.onboarding_page.onboarding')} sub={tr('console.onboarding_page.set_a_new_school_up')} toast={toast} loading={schools.isLoading} error={schools.isError ? { message: (schools.error as Error).message, retry: () => void schools.refetch() } : null}
      overlays={deleting && (
        <Dialog title={tr('console.onboarding_page.delete_the_draft_for', { p0: deleting.name || 'an untitled school' })} tag={{ text: tr('console.onboarding_page.cannot_be_undone'), tone: 'a' }} onClose={() => setDeleting(null)} width={440}>
          <p style={{ marginTop: 0 }}>{tr('console.onboarding_page.what_was_typed_into_the')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setDeleting(null)}>{tr('console.onboarding_page.keep_it')}</button>
            <button className="btn dngf" disabled={del.isPending} onClick={() => del.mutate(deleting.id)}>{tr('console.onboarding_page.delete')}</button>
          </div>
        </Dialog>
      )}
      actions={app.can('schools.write') ? <button className="btn pri" onClick={() => app.go('/onboarding/new')}><Icon name="plus" />{tr('console.onboarding_page.onboard_a_school')}</button> : undefined}>
      {none && (
        <div>
          <EmptyState scene="onboarding" onAction={app.can('schools.write') ? () => app.go('/onboarding/new') : undefined} />
        </div>
      )}
      <section className="grid">
        {setting.length > 0 && (
          <Card title={tr('console.onboarding_page.being_set_up')} chip={<span className="chip v">{setting.length}</span>} span="s12">
            {setting.map((s) => {
              const t = tintFor(s.name);
              return (
                <a key={s.id} className="kv" href={url(`/schools/${s.id}`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${s.id}`); }} style={{ color: 'inherit', textDecoration: 'none', alignItems: 'center' }}>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    <span className="av" style={{ width: 34, height: 34, fontSize: 11, background: t.bg, color: t.fg, boxShadow: 'none' }}>{initials(s.name)}</span>
                    <span style={{ minWidth: 0 }}><b style={{ display: 'block', textAlign: 'left' }}>{s.name}</b><small style={{ color: 'var(--ink3)' }}>{s.slug} {tr('console.onboarding_page.cell')}{' '}{s.cell} {tr('console.onboarding_page.started')}{' '}{ago(s.createdAt)}</small></span>
                  </span>
                  <span style={{ width: 150, flex: 'none' }}><span className="us"><span className="r"><span>{s.onboarding.done} {tr('console.onboarding_page.of')}{' '}{s.onboarding.total} {tr('console.onboarding_page.steps')}</span></span><span className="bar"><i style={{ width: `${s.onboarding.total ? (s.onboarding.done / s.onboarding.total) * 100 : 0}%` }}></i></span></span></span>
                </a>
              );
            })}
          </Card>
        )}
        {list.length > 0 && (
          <Card title={tr('console.onboarding_page.saved_drafts')} chip={<span className="chip">{list.length}</span>} span="s12">
            {list.map((d) => (
              <div key={d.id} className="kv" style={{ alignItems: 'center' }}>
                <span>{d.name || tr('console.onboarding_page.untitled_school')}<br /><small style={{ color: 'var(--ink3)' }}>{tr('console.onboarding_page.step')}{' '}{d.step + 1} {tr('console.onboarding_page.of')}{' '}{WIZARD_STEPS.length + 1} · {ago(d.updatedAt)} · {d.updatedBy}</small></span>
                <b className="tgrow"><button className="btn sm pri" onClick={() => app.go(`/onboarding/new/${d.id}`)}>{tr('console.onboarding_page.continue')}</button><button className="btn sm" aria-label={tr('console.onboarding_page.delete_draft', { name: d.name })} onClick={() => setDeleting(d)}>{tr('console.onboarding_page.delete')}</button></b>
              </div>
            ))}
          </Card>
        )}
        {moving.length > 0 && (
          <Card title={tr('console.onboarding_page.moving_in')} chip={<span className="chip v">{moving.length}</span>} span="s12">
            <div className="help" style={{ marginTop: 0 }}>{tr('console.onboarding_page.running_with_imports_and_invites')}</div>
            {moving.map((s) => <a key={s.id} className="kv" href={url(`/schools/${s.id}`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${s.id}`); }} style={{ color: 'inherit', textDecoration: 'none' }}>{s.name}<b>{tr('console.onboarding_page.set_up')}{' '}{ago(s.createdAt)}</b></a>)}
          </Card>
        )}
        {recent.length > 0 && (
          <Card title={tr('console.onboarding_page.went_live_recently')} span="s12">
            {recent.map((s) => { const st = statusOf(s); return <a key={s.id} className="kv" href={url(`/schools/${s.id}`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${s.id}`); }} style={{ color: 'inherit', textDecoration: 'none' }}>{s.name}<b><span className={`st ${st.tone}`}><i></i>{st.text}</span></b></a>; })}
          </Card>
        )}
      </section>
    </Page>
  );
}
