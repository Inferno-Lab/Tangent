import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyCard, Select, EmptyState, EmptyNote, t } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { url } from '../../app/base';
import { when } from '../../app/format';

const TONE = { requested: 'a', active: 'g', ended: 'n', expired: 'n' } as const;
const WORDS = { requested: t('console.support_page.asked_for'), active: t('console.support_page.open_now'), ended: t('console.support_page.ended'), expired: t('console.support_page.timed_out') } as const;

/** Every read-only look inside a school: who, why and how long. A session is started from the school's own page. */
export function SupportPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const sessions = useQuery({ queryKey: ['support'], queryFn: app.api.support.list, enabled: app.can('support.access'), refetchInterval: 15_000 });
  const [school, setSchool] = useState('');
  const [who, setWho] = useState('');
  const end = useMutation({ mutationFn: (id: string) => app.api.support.end(id), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['support'] }); say(t('console.support_page.session_ended')); } });
  if (!app.can('support.access')) {
    return (
      <Page title={t('console.support_page.support_sessions')} sub={t('console.support_page.looks_inside_schools_to_help')}>
        <div><EmptyCard title={t('console.support_page.support_sessions')} chip={{ text: t('console.support_page.not_for_your_role'), tone: 'a' }} icon="lock" heading={t('console.support_page.support_sessions_are_for_the')} body={t('console.support_page.ask_a_super_admin_to')} /></div>
      </Page>
    );
  }
  const all = sessions.data ?? [];
  const rows = all.filter((r) => (!school || r.schoolId === school) && (!who || r.startedBy === who));
  const schools = [...new Map(all.map((r) => [r.schoolId, r.schoolName])).entries()];
  const people = [...new Set(all.map((r) => r.startedBy))];
  return (
    <Page title={t('console.support_page.support_sessions')} sub={t('console.support_page.read_only_looks_inside_schools')} toast={toast}
      loading={sessions.isLoading} error={sessions.isError ? { message: (sessions.error as Error).message, retry: () => void sessions.refetch() } : null}>
      <Card title={t('console.support_page.sessions')} chip={<span className="chip">{rows.length}</span>}>
        {all.length > 0 && (
          <div className="tgrow" style={{ marginBottom: 8 }}>
            <Select compact aria-label={t('console.support_page.school')} value={school} onChange={setSchool} options={[{ value: '', label: t('console.support_page.every_school') }, ...schools.map(([value, label]) => ({ value, label }))]} />
            <Select compact aria-label={t('console.support_page.who')} value={who} onChange={setWho} options={[{ value: '', label: t('console.support_page.everyone') }, ...people.map((p) => ({ value: p, label: p }))]} />
          </div>
        )}
        {all.length === 0 && <EmptyState scene="support" onAction={() => app.go('/')} />}
        {all.length > 0 && rows.length === 0 && <EmptyNote icon="search" title={t('console.support_page.no_session_matches')} body={t('console.support_page.try_another_school_or_person')} />}
        {rows.map((r) => (
          <div key={r.id} className="kv" style={{ alignItems: 'flex-start' }}>
            <span><a href={url(`/schools/${r.schoolId}`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${r.schoolId}`); }} style={{ color: 'inherit', fontWeight: 700 }}>{r.schoolName}</a><br /><small style={{ color: 'var(--ink3)' }}>{r.reason} · {r.startedBy}{r.expiresAt ? t('console.support_page.until', { when: when(r.expiresAt) }) : ''}</small></span>
            <b className="tgrow"><span className={`st ${TONE[r.status]}`}><i></i>{WORDS[r.status]}</span>{r.status === 'active' && <button className="btn sm" onClick={() => end.mutate(r.id)}>{t('console.support_page.end')}</button>}</b>
          </div>
        ))}
      </Card>
    </Page>
  );
}
