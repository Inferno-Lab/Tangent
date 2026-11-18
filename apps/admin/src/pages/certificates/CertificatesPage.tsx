import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtMoney, type CertificateRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, EmptyNote, Field, Segmented, SelectField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, StudentPick, openPdf, problem, stamp, useOpenParam } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

type Tab = 'requests' | 'register' | 'cards';
type Say = (m: string, tone?: 'ok' | 'bad') => void;
const STATE = {
  pending: { label: t('admin.certificates.waiting'), tone: 'a' }, issued: { label: t('admin.certificates.issued'), tone: 'g' }, rejected: { label: t('admin.certificates.declined'), tone: 'c' },
  cancelled: { label: t('admin.certificates.cancelled'), tone: '' }, revoked: { label: t('admin.certificates.revoked'), tone: 'c' },
} as const;

/** Certificates asked for and issued (each with a QR code that proves it), and ID cards printed for a class or the staff. */
export function CertificatesPage() { const app = useApp();
  const { toast, say } = useToast();
  const { tab: at, tabs } = usePageTabs('/certificates');
  const tab = (at || 'requests') as Tab;
  const [asking, setAsking] = useState(false);
  // From a student's record: ask for one for them.
  const [forStudent, setForStudent] = useOpenParam('ask');
  const close = () => { setAsking(false); setForStudent(null); };
  return (
    <Page title={t('admin.certificates.certificates')} sub={t('admin.certificates.sub')} toast={toast} tabs={tabs}
      actions={tab === 'requests' ? <AddBtn onClick={() => setAsking(true)}>{t('admin.certificates.ask_for_one')}</AddBtn> : undefined}
      overlays={(asking || !!forStudent) && <AskDialog studentId={forStudent} onClose={close} onDone={(m) => { close(); say(m); }} />}>
      {tab === 'requests' && <List state="pending" say={say} />}
      {tab === 'register' && <List state="register" say={say} />}
      {tab === 'cards' && <Cards say={say} canPrint={app.user.permissions.includes('certificates.issue')} />}
    </Page>
  );
}

function List({ state, say }: { state: 'pending' | 'register'; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['certificates', state, q], queryFn: () => app.api.certificates.list({ state: state === 'pending' ? 'pending' : undefined, q }) });
  const [revoking, setRevoking] = useState<CertificateRow | null>(null);
  const [note, setNote] = useState('');
  const canIssue = app.user.permissions.includes('certificates.issue');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['certificates'] });
  const cancel = useMutation({ mutationFn: (id: string) => app.api.certificates.cancel(id), onSuccess: () => { refresh(); say(t('admin.certificates.request_cancelled')); }, onError: (e) => say((e as Error).message, 'bad') });
  const revoke = useMutation({ mutationFn: () => app.api.certificates.revoke(revoking!.id, note), onSuccess: () => { setRevoking(null); setNote(''); refresh(); say(t('admin.certificates.revoked_done')); }, onError: (e) => say((e as Error).message, 'bad') });
  const rows = (list.data ?? []).filter((c) => state === 'pending' || c.state === 'issued' || c.state === 'revoked');
  return <>
    <Card style={{ padding: 0 }} chip={<div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ width: 220 }}><Field label={t('admin.certificates.search')} value={q} onChange={setQ} maxLength={60} /></div>
      {state === 'register' && <button className="btn sm" onClick={() => void openPdf(app.api.certificates.register()).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.certificates.print_the_register')}</button>}
    </div>} title={state === 'pending' ? t('admin.certificates.waiting_for_a_decision') : t('admin.certificates.issue_register')}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="card" title={state === 'pending' ? t('admin.certificates.nothing_waiting') : t('admin.certificates.none_issued')} body={t('admin.certificates.empty_body')} /></div> : rows.map((c) => (
        <div key={c.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>
            <b style={{ font: '700 14px/1.3 var(--fb)' }}>{c.typeName} · {c.studentName}</b>
            <small className="help" style={{ display: 'block', margin: 0 }}>
              {c.number ? `${c.number} · ` : ''}{c.className}{c.purpose ? ` · ${c.purpose}` : ''} · {c.issuedAt ? t('admin.certificates.issued_on', { when: stamp(c.issuedAt), by: c.issuedBy ?? '' }) : t('admin.certificates.asked_by', { name: c.requestedBy, when: stamp(c.createdAt) })}
              {c.note ? ` · ${c.note}` : ''}
            </small>
          </span>
          {c.feeDue > 0 && <span className="chip a">{t('admin.certificates.fee_due', { amount: fmtMoney(c.feeDue) })}</span>}
          <span className={`chip ${STATE[c.state].tone}`}>{STATE[c.state].label}</span>
          {c.state === 'pending' && <a className="btn sm" href={`${app.base}/approvals`}>{t('admin.certificates.decide')}</a>}
          {c.state === 'pending' && <button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>{t('admin.certificates.cancel')}</button>}
          {c.state === 'issued' && <button className="btn sm" onClick={() => void openPdf(app.api.certificates.pdf(c.id)).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.certificates.print')}</button>}
          {c.state === 'issued' && canIssue && <button className="btn sm" onClick={() => setRevoking(c)}>{t('admin.certificates.revoke')}</button>}
        </div>
      ))}
    </Card>
    {revoking && (
      <Dialog title={t('admin.certificates.revoke_title', { number: revoking.number ?? '' })} onClose={() => setRevoking(null)} width={480}>
        <p className="help" style={{ marginTop: 0 }}>{t('admin.certificates.revoke_body')}</p>
        <Field label={t('admin.certificates.why')} value={note} onChange={setNote} maxLength={200} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={() => setRevoking(null)}>{t('admin.certificates.keep')}</button>
          <button className="btn dngf" disabled={note.trim().length < 3 || revoke.isPending} onClick={() => revoke.mutate()}>{t('admin.certificates.revoke')}</button>
        </div>
      </Dialog>
    )}
  </>;
}

function AskDialog({ studentId, onClose, onDone }: { studentId: string | null; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const types = useQuery({ queryKey: ['certificate-types'], queryFn: app.api.certificates.types });
  const offered = (types.data ?? []).filter((x) => x.active !== false);
  const [student, setStudent] = useState<{ id: string; name: string; className: string } | null>(null);
  const preset = useQuery({ queryKey: ['student', studentId], queryFn: () => app.api.students.detail(studentId!), enabled: !!studentId });
  useEffect(() => { if (preset.data) setStudent({ id: preset.data.id, name: preset.data.name, className: preset.data.className }); }, [preset.data]);
  const [type, setType] = useState('');
  const [purpose, setPurpose] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const chosen = offered.find((x) => x.key === (type || offered[0]?.key));
  const save = useMutation({
    mutationFn: () => app.api.certificates.request({ type: chosen!.key, studentId: student!.id, purpose }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ['certificates'] }); onDone(t('admin.certificates.asked', { type: c.typeName, name: c.studentName })); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={t('admin.certificates.ask_for_one')} onClose={onClose} width={540} shake={shake.cls}>
      <div className="stack">
        <StudentPick label={t('admin.certificates.student')} value={student} onChange={setStudent} error={err.studentId} />
        <SelectField label={t('admin.certificates.certificate')} value={chosen?.key ?? ''} error={err.type} onChange={setType} options={offered.map((x) => ({ value: x.key, label: x.fee ? `${x.name} · ${fmtMoney(x.fee)}` : x.name }))} />
        <Field label={t('admin.certificates.for_optional')} value={purpose} onChange={setPurpose} maxLength={200} />
        {chosen?.noDues && <div className="help" style={{ marginTop: 0 }}>{t('admin.certificates.no_dues_note')}</div>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.certificates.cancel')}</button>
        <button className="btn pri" disabled={!student || !chosen || save.isPending} onClick={() => save.mutate()}>{t('admin.certificates.ask')}</button>
      </div>
    </Dialog>
  );
}

function Cards({ say, canPrint }: { say: Say; canPrint: boolean }) { const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes });
  const [who, setWho] = useState<'students' | 'staff'>('students');
  const [picked, setPicked] = useState<string[]>([]);
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try { await openPdf(app.api.certificates.idCards({ classIds: who === 'staff' ? [] : picked, studentIds: [], staff: who === 'staff', validUntil: until || null })); say(t('admin.certificates.cards_ready')); }
    catch (e) { say((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  if (!canPrint) return <Card><EmptyNote icon="card" title={t('admin.certificates.cards_need_permission')} /></Card>;
  return (
    <Card title={t('admin.certificates.id_cards')}>
      <div className="stack">
        <Segmented label={t('admin.certificates.for_whom')} value={who} onChange={setWho} options={[{ value: 'students', label: t('admin.certificates.students') }, { value: 'staff', label: t('admin.certificates.staff') }]} />
        {who === 'students' && (
          <div className="fld"><label>{t('admin.certificates.classes')}</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{(classes.data ?? []).map((c) => <Checkbox key={c.id} checked={picked.includes(c.id)} label={c.name}
              onChange={(on) => setPicked(on ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />)}</div>
          </div>
        )}
        <div style={{ width: 220 }}><DateField label={t('admin.certificates.valid_until_optional')} value={until} onChange={setUntil} /></div>
        <small className="help" style={{ margin: 0 }}>{t('admin.certificates.cards_help')}</small>
        <button className="btn pri" style={{ alignSelf: 'flex-start' }} disabled={busy || (who === 'students' && !picked.length)} onClick={() => void print()}>{busy ? t('admin.certificates.making') : t('admin.certificates.print_cards')}</button>
      </div>
    </Card>
  );
}
