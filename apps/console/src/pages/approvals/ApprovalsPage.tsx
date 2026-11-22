import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { ACTION_LABELS, SETTINGS_META, type ActionRow } from '@tangent/contracts';
import { AreaField, Dialog, Select, useShake, EmptyState, t, EmptyNote, busyFor } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { ago, when } from '../../app/format';

const TONE: Record<ActionRow['status'], string> = { pending_approval: 'a', running: 'v', done: 'g', failed: 'c', rejected: 'n' };
const LABEL: Record<ActionRow['status'], string> = { pending_approval: t('console.approvals_page.waiting_for_approval'), running: t('console.approvals_page.running'), done: t('console.approvals_page.done'), failed: t('console.approvals_page.failed'), rejected: t('console.approvals_page.rejected') };
const name = (r: ActionRow) => `${ACTION_LABELS[r.action] ?? r.action}${r.schoolName ? ` · ${r.schoolName}` : ''}`;
/** A setting's value in words: on and off, a list joined, nothing as a dash. */
const shown = (v: unknown) => (v == null || v === '' ? '–' : typeof v === 'boolean' ? (v ? t('console.approvals_page.on') : t('console.approvals_page.off')) : Array.isArray(v) ? v.join(', ') || '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** The console team's own queue: risky changes wait here for a second person, who sees exactly what would change. */
export function ApprovalsPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [rejecting, setRejecting] = useState<ActionRow | null>(null);
  const [show, setShow] = useState<'all' | ActionRow['status']>('all');
  const list = useQuery({ queryKey: ['actions'], queryFn: app.api.actions.list, refetchInterval: 8000 });
  const done = () => void qc.invalidateQueries({ predicate: (q) => ['actions', 'schools', 'fleet', 'school'].includes(String(q.queryKey[0])) });
  const approve = useMutation({
    mutationFn: (id: string) => app.api.actions.approve(id),
    onSuccess: (r) => { done(); say(r.status === 'failed' ? t('console.approvals_page.it_did_not_work', { summary: r.summary }) : t('console.approvals_page.approved_and_carried_out'), r.status === 'failed' ? 'bad' : 'ok'); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const rows = list.data ?? [];
  const waiting = rows.filter((r) => r.status === 'pending_approval');
  const past = rows.filter((r) => r.status !== 'pending_approval' && (show === 'all' || r.status === show));
  const mayDecide = app.can('schools.danger');
  return (
    <Page title={t('console.approvals_page.approvals')} sub={waiting.length ? t('console.approvals_page.waiting_for_a_second_person', { length: waiting.length }) : t('console.approvals_page.risky_changes_need_a_second')} toast={toast} loading={list.isLoading} error={list.isError ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      overlays={rejecting && <Reject row={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); done(); say(t('console.approvals_page.rejected_nothing_was_changed_and')); }} />}>
      <section className="grid">
        <Card title={t('console.approvals_page.waiting')} chip={<span className={`chip ${waiting.length ? 'a' : 'g'}`}>{waiting.length}</span>} span="s12">
          {waiting.length === 0 && (
            <EmptyState scene="approvals" label={t('console.approvals_page.back_to_the_fleet')} onAction={() => app.go('/')} />
          )}
          {waiting.map((r) => {
            const own = r.requestedBy === app.user.email;
            return (
              <div key={r.id} style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <b style={{ display: 'block', font: '700 15px var(--fb)' }}>{name(r)}</b>
                    <span style={{ display: 'block', font: '600 14px var(--fb)', color: 'var(--ink2)', marginTop: 4 }}>{r.asked}</span>
                    <small style={{ color: 'var(--ink3)' }}>{t('console.approvals_page.asked_by')}{' '}{r.requestedBy} · {ago(r.createdAt)}{r.note ? ` · “${r.note}”` : ''}</small>
                  </span>
                  <span className="tgrow">
                    <button className="btn sm" disabled={!mayDecide} onClick={() => setRejecting(r)}>{t('console.approvals_page.reject')}</button>
                    <button className="btn pri sm" disabled={!mayDecide || own || busyFor(approve, r.id)} data-tip={own ? t('console.approvals_page.a_second_person_has_to') : undefined} onClick={() => approve.mutate(r.id)}>{t('console.approvals_page.approve')}</button>
                  </span>
                </div>
                {r.changes.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {r.changes.map((c) => (
                      <div key={c.key} className="kv" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <span>{SETTINGS_META[c.key as keyof typeof SETTINGS_META]?.label ?? c.key}</span>
                        <b style={{ textAlign: 'end' }}><span style={{ color: 'var(--ink3)', textDecoration: 'line-through' }}>{shown(c.before)}</span> → {shown(c.after)}</b>
                      </div>
                    ))}
                  </div>
                )}
                {own && <div className="help">{t('console.approvals_page.you_asked_for_this_so')}</div>}
              </div>
            );
          })}
        </Card>
        <Card title={t('console.approvals_page.decided')} span="s12" chip={<Select compact aria-label={t('console.approvals_page.show')} value={show} onChange={(v) => setShow(v as typeof show)} options={[{ value: 'all', label: t('console.approvals_page.everything') }, { value: 'done', label: t('console.approvals_page.done') }, { value: 'failed', label: t('console.approvals_page.failed') }, { value: 'rejected', label: t('console.approvals_page.rejected') }, { value: 'running', label: t('console.approvals_page.running') }]} />}>
          {past.length === 0 && <EmptyNote icon="approvals" title={t('console.approvals_page.nothing_decided_yet')} body={t('console.approvals_page.finished_requests_show_up_here')} />}
          {past.map((r) => (
            <div key={r.id} className="kv" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 260px', minWidth: 0 }}>
                {name(r)}
                <small style={{ display: 'block', color: 'var(--ink3)' }}>
                  {r.dryRun ? t('console.approvals_page.rehearsal') : ''}{t('console.approvals_page.asked_by')}{' '}{r.requestedBy}{r.approvedBy ? t('console.approvals_page.by', { status: r.status === 'rejected' ? 'rejected' : 'approved', approvedBy: r.approvedBy }) : ''} · {when(r.finishedAt ?? r.createdAt)}
                </small>
                {(r.status === 'rejected' ? r.decisionNote : r.summary !== r.asked ? r.summary : '') && <small style={{ display: 'block', color: r.status === 'failed' ? 'var(--bad)' : 'var(--ink2)' }}>{r.status === 'rejected' ? t('console.approvals_page.why', { decisionNote: r.decisionNote }) : r.summary}</small>}
              </span>
              <b><span className={`st ${TONE[r.status]}`}><i></i>{LABEL[r.status]}</span></b>
            </div>
          ))}
        </Card>
      </section>
    </Page>
  );
}

function Reject({ row, onClose, onDone }: { row: ActionRow; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const shake = useShake();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const go = useMutation({
    mutationFn: () => app.api.actions.reject(row.id, note.trim()),
    onSuccess: onDone,
    onError: (e) => { setErr(e instanceof HttpError ? (e.fields.note ?? e.message) : (e as Error).message); shake.hit(); },
  });
  return (
    <Dialog title={t('console.approvals_page.reject_this_request')} tag={{ text: ACTION_LABELS[row.action] ?? row.action, tone: 'a' }} onClose={onClose} width={480} shake={shake.cls}>
      <p style={{ marginTop: 0 }}>{row.asked}</p>
      <AreaField label={t('console.approvals_page.why_2')} value={note} onChange={(v) => { setNote(v); setErr(''); }} error={err} rows={3} maxLength={500} placeholder={t('console.approvals_page.for_example_wait_until_the')} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.approvals_page.cancel')}</button>
        <button className="btn dngf" disabled={go.isPending} onClick={() => { if (note.trim().length < 5) { setErr(t('console.approvals_page.say_why_so_the_person')); shake.hit(); } else go.mutate(); }}>{t('console.approvals_page.reject')}</button>
      </div>
    </Dialog>
  );
}
