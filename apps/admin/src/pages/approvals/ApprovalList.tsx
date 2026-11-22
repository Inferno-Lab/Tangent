import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalKind, ApprovalRow } from '@tangent/contracts';
import { Dialog, EmptyCard, useShake, EmptyState, t, busyFor } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AreaField, Avatar, problem } from '../../app/kit';
import { fmtDate } from '@tangent/contracts';

export type ApprovalView = 'waiting' | 'sent' | 'decided';

const STATUS: Record<ApprovalRow['status'], { text: string; tone: string }> = {
  pending: { text: t('admin.approval_list.waiting'), tone: 'a' }, approved: { text: t('admin.approval_list.approved'), tone: 'g' }, rejected: { text: t('admin.approval_list.declined'), tone: 'c' }, withdrawn: { text: t('admin.approval_list.withdrawn'), tone: '' },
};
const when = (iso: string) => fmtDate(iso, 'stamp');

/**
 * Requests for one view (waiting for me, sent by me, decided), optionally of one kind; approve, or decline saying why. Returns the
 * list and its dialog, which the page puts in its overlays.
 */
export function useApprovalList(view: ApprovalView, kind: ApprovalKind | undefined, say: (text: string, tone?: 'bad') => void, enabled = true): { list: React.ReactNode; overlay: React.ReactNode } {
  const app = useApp();
  const qc = useQueryClient();
  const may = app.user.permissions.includes('approvals.decide');
  const list = useQuery({ queryKey: ['approvals', view, kind ?? ''], queryFn: () => app.api.approvals.list(view, kind), enabled });
  const [declining, setDeclining] = useState<ApprovalRow | null>(null);
  const decide = useMutation({
    mutationFn: (a: { row: ApprovalRow; decision: 'approve' | 'reject' | 'undo'; note?: string }) => app.api.approvals.decide(a.row.id, { decision: a.decision, note: a.note }),
    onSuccess: (r, a) => {
      setDeclining(null);
      void qc.invalidateQueries({ predicate: (q) => ['approvals', 'dashboard', 'shell', 'attendance-day'].includes(String(q.queryKey[0])) });
      say(a.decision === 'undo' ? t('admin.approval_list.back_to_waiting') : r.doneText || (a.decision === 'approve' ? t('admin.approval_list.approved_2') : t('admin.approval_list.declined_they_are_told_why')));
    },
    onError: (e) => say(Object.values(problem(e))[0] ?? t('admin.approval_list.that_did_not_go_through'), 'bad'),
  });

  const overlay = declining && <Decline row={declining} busy={decide.isPending} onClose={() => setDeclining(null)} onDecline={(note) => decide.mutate({ row: declining, decision: 'reject', note })} />;
  if (list.isLoading) return { list: <div className="skc" style={{ height: 240, borderRadius: 16 }} />, overlay };
  if (list.isError) return { overlay, list: <EmptyCard error title={t('admin.approval_list.approvals')} chip={{ text: t('admin.approval_list.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('admin.approval_list.that_didn_t_load')} body={(list.error as Error).message} actions={<button className="btn pri" onClick={() => void list.refetch()}>{t('admin.approval_list.try_again')}</button>} /> };
  const rows = list.data ?? [];
  // Each view has its own scene: nothing waiting, nothing sent, nothing decided, no leave asked for.
  if (!rows.length && view === 'waiting') return { overlay, list: kind === 'leave'
    ? <EmptyState scene="leave" onAction={() => app.go('/attendance')} />
    : <EmptyState scene="approvals" onAction={() => app.go('/approvals/decided')} /> };
  if (!rows.length) return { overlay, list: view === 'sent'
    ? <EmptyState scene="sent" onAction={() => app.go('/fees')} />
    : <EmptyState scene="decided" onAction={() => app.go(kind === 'leave' ? '/attendance/leave' : '/approvals')} /> };
  return { overlay, list: (
    <div className="card" style={{ padding: 0 }}>
      {rows.map((r) => (
        <div key={r.id} className="exr" style={{ alignItems: 'flex-start', padding: '16px 20px' }}>
          <Avatar name={r.requesterName || r.title} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ font: '700 15px var(--fb)', display: 'block', overflowWrap: 'anywhere' }}>{r.title}</b>
            <small style={{ display: 'block' }}>{r.subtitle}</small>
            <small style={{ display: 'block' }}>{r.requesterName ? t('admin.approval_list.asked_by', { requesterName: r.requesterName }) : ''}{when(r.createdAt)}</small>
            {r.step && r.step.of > 1 && r.status === 'pending' && <small style={{ display: 'block' }}>{t('admin.approval_list.step_of', { at: r.step.at, of: r.step.of, name: r.step.name })}</small>}
            {r.step && r.step.of > 1 && r.step.done.map((d) => <small key={`${d.key}-${d.at}`} style={{ display: 'block' }}>{t('admin.approval_list.step_done', { name: d.name, by: d.by })} · {when(d.at)}{d.note ? ` · “${d.note}”` : ''}</small>)}
            {r.decidedAt && <small style={{ display: 'block' }}>{STATUS[r.status].text}{r.decidedByName ? t('admin.approval_list.by', { decidedByName: r.decidedByName }) : ''} · {when(r.decidedAt)}{r.decisionNote ? ` · “${r.decisionNote}”` : ''}</small>}
          </div>
          {/* The status and the buttons centre on one line, beside the first line of the text. */}
          <span className="tgrow">
            <span className={`chip ${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>
            {may && r.status === 'pending' && view === 'waiting' && <>
              <button className="btn sm pri" disabled={busyFor(decide, r)} onClick={() => decide.mutate({ row: r, decision: 'approve' })}>{r.action || t('admin.approval_list.approve')}</button>
              <button className="btn sm" disabled={busyFor(decide, r)} onClick={() => setDeclining(r)}>{t('admin.approval_list.decline')}</button>
            </>}
            {may && view === 'decided' && (r.status === 'approved' || r.status === 'rejected') && (
              <button className="btn sm" disabled={busyFor(decide, r)} data-tip={t('admin.approval_list.put_it_back_in_the')} onClick={() => decide.mutate({ row: r, decision: 'undo' })}>{t('admin.approval_list.undo')}</button>
            )}
          </span>
        </div>
      ))}
    </div>
  ) };
}

function Decline({ row, busy, onClose, onDecline }: { row: ApprovalRow; busy: boolean; onClose: () => void; onDecline: (note: string) => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  const go = () => { if (!note.trim()) { setErr(t('admin.approval_list.say_why_so_the_person')); shake.hit(); return; } onDecline(note.trim()); };
  return (
    <Dialog title={t('admin.approval_list.decline_2', { title: row.title })} onClose={onClose} width={520} shake={shake.cls}>
      <div className="stack">
        <AreaField label={t('admin.approval_list.why')} value={note} onChange={(v) => { setNote(v); setErr(''); }} error={err} maxLength={300} rows={3} placeholder={t('admin.approval_list.the_dates_clash_with_the')} />
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.approval_list.cancel')}</button>
          <button className="btn pri" disabled={busy} onClick={go}>{busy ? t('admin.approval_list.declining') : t('admin.approval_list.decline')}</button>
        </div>
      </div>
    </Dialog>
  );
}
