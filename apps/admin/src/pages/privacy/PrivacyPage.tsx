import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtDate, DATA_REQUEST_KINDS, type DataRequestRow } from '@tangent/contracts';
import { Dialog, Field, SelectField, useShake, useToast, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AddBtn, AreaField, problem } from '../../app/kit';
import { Page } from '../../app/Page';

const KIND = { access: t('admin.privacy_page.copy_of_their_data'), correction: t('admin.privacy_page.correction'), erasure: t('admin.privacy_page.erasure') } as const;
const when = (iso: string) => fmtDate(iso, 'dayYear');

/** Families' requests about their data: those sent from the app and those the office logs, each answered and closed once. */
export function PrivacyPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const reqs = useQuery({ queryKey: ['privacy', 'requests'], queryFn: app.api.privacy.requests });
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<DataRequestRow | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['privacy'] });
  const rows = reqs.data ?? [];
  const open = rows.filter((r) => r.status === 'open').length;
  // The copy an access request is answered with, saved as a zip of spreadsheets.
  const download = async (r: DataRequestRow) => {
    try {
      const blob = await app.api.privacy.exportData(r.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${r.subjectName || 'data'}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { say((e as Error).message, 'bad'); }
  };
  return (
    <Page title={t('admin.privacy_page.privacy_requests')} sub={open ? t('admin.privacy_page.waiting_for_an_answer', { open }) : t('admin.privacy_page.requests_for_a_copy_of')} toast={toast} loading={reqs.isLoading}
      error={reqs.isError && !reqs.data ? { message: (reqs.error as Error).message, retry: () => void reqs.refetch() } : null}
      actions={<AddBtn onClick={() => setAdding(true)}>{t('admin.privacy_page.log_a_request')}</AddBtn>}
      overlays={<>
        {adding && <LogDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); say(t('admin.privacy_page.request_logged')); }} />}
        {deciding && <AnswerDialog r={deciding} onClose={() => setDeciding(null)} onDone={(m) => { setDeciding(null); refresh(); say(m); }} />}
      </>}>
      {!rows.length ? (
        <EmptyState scene="privacy" onAction={() => app.go('/profile/privacy')} />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {rows.map((r) => (
            <div key={r.id} className="exr" style={{ alignItems: 'flex-start', padding: '16px 20px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ font: '700 15px var(--fb)', display: 'block' }}>{KIND[r.kind]} · {r.subjectName}</b>
                <small style={{ display: 'block' }}>{r.requestedBy ? t('admin.privacy_page.asked_by', { requestedBy: r.requestedBy }) : ''}{when(r.createdAt)}{r.fromApp ? t('admin.privacy_page.from_the_app') : ''}</small>
                {r.note && <small style={{ display: 'block' }}>“{r.note}”</small>}
                {r.answer && <small style={{ display: 'block' }}>{t('admin.privacy_page.answer')}{' '}{r.answer}</small>}
              </div>
              {r.fromApp && r.kind === 'access' && <button className="btn sm" style={{ marginInlineEnd: 8 }} onClick={() => void download(r)}>{t('admin.privacy_page.download_their_data')}</button>}
              {r.status === 'open'
                ? <button className="btn sm pri" onClick={() => setDeciding(r)}>{t('admin.privacy_page.answer_2')}</button>
                : <span className={`chip ${r.status === 'done' ? 'g' : ''}`}>{r.status === 'done' ? t('admin.privacy_page.done') : t('admin.privacy_page.declined')}</span>}
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

function LogDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ kind: 'access', subjectName: '', requestedBy: '', note: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const make = useMutation({
    mutationFn: () => app.api.privacy.create({ kind: f.kind as 'access', subjectName: f.subjectName.trim(), requestedBy: f.requestedBy.trim(), note: f.note.trim() }),
    onSuccess: onDone, onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => { if (f.subjectName.trim().length < 2) { setErr({ subjectName: t('admin.privacy_page.whose_data_is_this_about') }); shake.hit(); } else make.mutate(); };
  return (
    <Dialog title={t('admin.privacy_page.log_a_data_request')} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('admin.privacy_page.what_do_they_want')} value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={DATA_REQUEST_KINDS.map((k) => ({ value: k, label: KIND[k] }))} />
        <Field label={t('admin.privacy_page.whose_data')} value={f.subjectName} onChange={(subjectName) => { setF({ ...f, subjectName }); setErr({}); }} error={err.subjectName} maxLength={80} />
        <Field label={t('admin.privacy_page.asked_by_optional')} value={f.requestedBy} onChange={(requestedBy) => setF({ ...f, requestedBy })} maxLength={80} />
        <AreaField label={t('admin.privacy_page.details_optional')} value={f.note} onChange={(note) => setF({ ...f, note })} rows={3} maxLength={400} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.privacy_page.cancel')}</button>
          <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? t('admin.privacy_page.saving') : t('admin.privacy_page.log_request')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** The answer goes back to a family that asked from the app, so a decline always says why. */
function AnswerDialog({ r, onClose, onDone }: { r: DataRequestRow; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  const go = useMutation({
    mutationFn: (status: 'done' | 'declined') => app.api.privacy.decide(r.id, { status, note: note.trim() }),
    onSuccess: (x) => onDone(x.status === 'done' ? t('admin.privacy_page.closed_as_done', { p0: r.fromApp ? t('admin.privacy_page.the_family_is_told') : '' }) : t('admin.privacy_page.declined_2', { p0: r.fromApp ? t('admin.privacy_page.the_family_is_told_why') : '' })),
    onError: (e) => { setErr((e as Error).message); shake.hit(); },
  });
  const decline = () => { if (!note.trim()) { setErr(t('admin.privacy_page.say_why_so_the_family')); shake.hit(); } else go.mutate('declined'); };
  return (
    <Dialog title={`${KIND[r.kind]} · ${r.subjectName}`} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <AreaField label={r.fromApp ? t('admin.privacy_page.your_answer_the_family_reads') : t('admin.privacy_page.what_was_done')} value={note} onChange={(v) => { setNote(v); setErr(''); }} error={err} rows={3} maxLength={400} />
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.privacy_page.cancel')}</button>
          <button className="btn dng" disabled={go.isPending} onClick={decline}>{t('admin.privacy_page.decline')}</button>
          <button className="btn pri" disabled={go.isPending} onClick={() => go.mutate('done')}>{t('admin.privacy_page.mark_done')}</button>
        </div>
      </div>
    </Dialog>
  );
}
