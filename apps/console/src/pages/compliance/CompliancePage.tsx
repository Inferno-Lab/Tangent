import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { breachNotice, schoolToday, type ComplianceRow } from '@tangent/contracts';
import { AreaField, DateField, Dialog, Field, FilePick, SelectField, useShake, EmptyState, Icon, t } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { ago, when } from '../../app/format';
import { url } from '../../app/base';
import { usePageTabs } from '../../app/tabs';

const KIND = { dpa: t('console.compliance_page.agreement'), breach: t('console.compliance_page.breach') } as const;

/** Time left on a breach's 72-hour clock, in words. */
function clock(deadline: string | null): { text: string; late: boolean } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  return { text: ms >= 0 ? t('console.compliance_page.h_left_to_tell_the', { h }) : t('console.compliance_page.h_past_the_72_hour', { h }), late: ms < 0 };
}

/** Agreements with each school, breaches and their 72-hour clock, who else handles the data, and data requests across schools. */
export function CompliancePage() {
  const app = useApp();
  const qc = useQueryClient();
  const { tab, tabs } = usePageTabs('/compliance');
  const { toast, say } = useToast();
  const [adding, setAdding] = useState<'dpa' | 'breach' | null>(null);
  const [signing, setSigning] = useState<ComplianceRow | null>(null);
  const [telling, setTelling] = useState<ComplianceRow | null>(null);
  const q = useQuery({ queryKey: ['compliance'], queryFn: app.api.compliance.list });
  const requests = useQuery({ queryKey: ['compliance-requests'], queryFn: app.api.compliance.requests, enabled: tab === 'requests' && app.can('audit.read') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['compliance'] });
  const close = useMutation({ mutationFn: (id: string) => app.api.compliance.update(id, { status: 'closed', note: '' }), onSuccess: () => { refresh(); say(t('console.compliance_page.closed')); }, onError: (e) => say((e as Error).message, 'bad') });
  const canWrite = app.can('compliance.write');
  const items = q.data?.items ?? [];
  const agreements = items.filter((i) => i.kind === 'dpa');
  const breaches = items.filter((i) => i.kind === 'breach');
  const download = (r: ComplianceRow) => void app.api.compliance.file(r.id).then((b) => { const x = document.createElement('a'); x.href = URL.createObjectURL(b); x.download = r.fileName ?? 'agreement'; x.click(); URL.revokeObjectURL(x.href); });
  return (
    <Page title={t('console.compliance_page.compliance')} sub={t('console.compliance_page.agreements_with_each_school_and')} toast={toast} loading={q.isLoading}
      error={q.isError ? { message: (q.error as Error).message, retry: () => void q.refetch() } : null}
      tabs={tabs} actions={<>{canWrite && tab === 'agreements' && <button className="btn pri" onClick={() => setAdding('dpa')}><Icon name="plus" />{t('console.compliance_page.add_an_agreement')}</button>}{canWrite && tab === 'breaches' && <button className="btn pri" onClick={() => setAdding('breach')}><Icon name="plus" />{t('console.compliance_page.log_a_breach')}</button>}</>}
      overlays={<>
        {adding && <Add kind={adding} onClose={() => setAdding(null)} onDone={(m) => { setAdding(null); refresh(); say(m); }} />}
        {signing && <Sign r={signing} onClose={() => setSigning(null)} onDone={() => { setSigning(null); refresh(); say(t('console.compliance_page.agreement_signed_with_its_file')); }} />}
        {telling && <Tell r={telling} onClose={() => setTelling(null)} onDone={(m) => { setTelling(null); refresh(); say(m); }} />}
      </>}>
      {tab === 'breaches' && (
        <Card title={t('console.compliance_page.breaches')} chip={<span className={`chip ${breaches.some((b) => b.status !== 'closed') ? 'c' : 'g'}`}>{breaches.filter((b) => b.status !== 'closed').length} {t('console.compliance_page.open')}</span>}>
          {breaches.length === 0 ? <EmptyState scene="breaches" onAction={canWrite ? () => setAdding('breach') : undefined} />
            : breaches.map((b) => <Row key={b.id} r={b} canWrite={canWrite} busy={close.isPending} onTell={() => setTelling(b)} onClose={() => close.mutate(b.id)} />)}
        </Card>
      )}
      {tab === 'agreements' && (
        <Card title={t('console.compliance_page.agreements')} chip={<span className="chip">{agreements.filter((x) => x.status === 'open').length} {t('console.compliance_page.to_sign')}</span>}>
          {agreements.length === 0 ? <EmptyState scene="compliance" label={t('console.compliance_page.add_an_agreement')} onAction={canWrite ? () => setAdding('dpa') : undefined} />
            : agreements.map((x) => <Row key={x.id} r={x} canWrite={canWrite} busy={false} onSign={() => setSigning(x)} onFile={() => download(x)} />)}
        </Card>
      )}
      {tab === 'processors' && (
        <Card title={t('console.compliance_page.who_else_handles_the_data')} chip={<span className="chip">{q.data?.subprocessors.length ?? 0}</span>}>
          <div className="help" style={{ marginTop: 0 }}>{t('console.compliance_page.every_provider_with_a_live')}</div>
          {(q.data?.subprocessors ?? []).length === 0 && <EmptyState scene="processors" onAction={() => app.go('/integrations')} />}
          {(q.data?.subprocessors ?? []).map((x, i) => <div className="kv" key={`${x.name}${i}`}><span><b style={{ color: 'var(--ink)', textAlign: 'start' }}>{x.name}</b><br /><small style={{ color: 'var(--ink3)' }}>{x.purpose} · {x.serves}</small></span><b style={{ whiteSpace: 'nowrap' }}>{x.region}</b></div>)}
        </Card>
      )}
      {tab === 'requests' && (
        <Card title={t('console.compliance_page.data_requests_at_every_school')} chip={<span className="chip">{requests.data?.length ?? 0} {t('console.compliance_page.open')}</span>}>
          <div className="help" style={{ marginTop: 0 }}>{t('console.compliance_page.asked_for_by_families_and')}</div>
          {!app.can('audit.read') ? <div className="help">{t('console.compliance_page.your_role_does_not_include')}</div>
            : requests.isLoading ? <div className="skc" style={{ height: 160, borderRadius: 16 }} />
              : !(requests.data ?? []).length ? <EmptyState scene="datarequests" onAction={() => app.go('/schools')} />
                : requests.data!.map((r) => (
                  <div key={`${r.schoolId}${r.id}`} className="kv" style={{ alignItems: 'flex-start' }}>
                    <span><b style={{ color: 'var(--ink)' }}>{r.subjectName}</b> · {r.kind}<br /><small style={{ color: 'var(--ink3)' }}><a href={url(`/schools/${r.schoolId}/data`)} onClick={(e) => { e.preventDefault(); app.go(`/schools/${r.schoolId}/data`); }} style={{ color: 'inherit', fontWeight: 700 }}>{r.schoolName}</a> · {r.requestedBy || t('console.compliance_page.the_office')} · {ago(r.createdAt)}</small></span>
                    <b>{when(r.createdAt)}</b>
                  </div>
                ))}
        </Card>
      )}
    </Page>
  );
}

function Row({ r, canWrite, busy, onTell, onClose, onSign, onFile }: { r: ComplianceRow; canWrite: boolean; busy: boolean; onTell?: () => void; onClose?: () => void; onSign?: () => void; onFile?: () => void }) {
  const c = r.status === 'closed' || r.status === 'signed' ? null : clock(r.deadlineAt);
  const done = r.status === 'closed' || r.status === 'signed';
  return (
    <div className="kv" style={{ alignItems: 'flex-start', gap: 12 }}>
      <span style={{ minWidth: 0 }}>
        <b style={{ color: 'var(--ink)', display: 'block', textAlign: 'start' }}>{r.title}</b>
        <small style={{ color: 'var(--ink3)' }}>{r.schoolName} · {KIND[r.kind]} · {ago(r.createdAt)} {t('console.compliance_page.by')}{' '}{r.createdBy}</small>
        {r.note && <small style={{ display: 'block', color: 'var(--ink2)', marginTop: 4 }}>{r.note}</small>}
        {r.signedOn && <small style={{ display: 'block', color: 'var(--ink2)', marginTop: 4 }}>{t('console.compliance_page.signed_on')}{' '}{r.signedOn} {t('console.compliance_page.by')}{' '}{r.signedBy}</small>}
        {c && <small className={`chip ${c.late ? 'c' : 'a'}`} style={{ marginTop: 6 }}>{c.text}</small>}
      </span>
      <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
        <span className={`st ${done ? 'g' : r.status === 'notified' ? 'v' : 'a'}`}><i></i>{({ open: t('console.compliance_page.open_2'), signed: t('console.compliance_page.signed'), notified: t('console.compliance_page.school_told'), closed: t('console.compliance_page.closed_2') } as const)[r.status]}</span>
        {r.fileName && onFile && <button className="btn sm" onClick={onFile}>{t('console.compliance_page.signed_file')}</button>}
        {canWrite && !done && r.kind === 'dpa' && onSign && <button className="btn sm" onClick={onSign}>{t('console.compliance_page.signed_2')}</button>}
        {canWrite && !done && r.kind === 'breach' && r.status === 'open' && onTell && <button className="btn sm" onClick={onTell}>{t('console.compliance_page.tell_the_school')}</button>}
        {canWrite && !done && r.kind === 'breach' && r.status === 'notified' && onClose && <button className="btn sm" disabled={busy} onClick={onClose}>{t('console.compliance_page.close')}</button>}
      </span>
    </div>
  );
}

/** Signing records the signed file, the day and who signed for the school; without them an agreement proves nothing. */
function Sign({ r, onClose, onDone }: { r: ComplianceRow; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const shake = useShake();
  const [f, setF] = useState({ on: schoolToday(), by: '' });
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [err, setErr] = useState('');
  const go = useMutation({
    mutationFn: () => app.api.compliance.update(r.id, { status: 'signed', note: '', signedOn: f.on, signedBy: f.by.trim(), file: file! }),
    onSuccess: onDone,
    onError: (e) => { setErr((e as Error).message); shake.hit(); },
  });
  return (
    <Dialog title={t('console.compliance_page.signed_3', { schoolName: r.schoolName })} tag={{ text: r.title, tone: 'v' }} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <DateField label={t('console.compliance_page.signed_on')} value={f.on} max={schoolToday()} onChange={(v) => setF({ ...f, on: v })} />
          <Field label={t('console.compliance_page.signed_by_for_the_school')} value={f.by} onChange={(v) => { setF({ ...f, by: v }); setErr(''); }} maxLength={80} placeholder={t('console.compliance_page.name_and_title')} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilePick accept="application/pdf,image/png,image/jpeg" className="btn sm" onPick={(x) => {
            if (x.size > 5 * 1024 * 1024) { setErr(t('console.compliance_page.the_signed_file_must_be')); return; }
            const rd = new FileReader(); rd.onload = () => { setFile({ name: x.name, data: String(rd.result).split(',')[1] ?? '' }); setErr(''); }; rd.readAsDataURL(x);
          }}>{file ? t('console.compliance_page.choose_another') : t('console.compliance_page.attach_the_signed_file')}</FilePick>
          {file && <span className="chip g">{file.name}</span>}
        </div>
        {err && <div className="emsg" role="alert">{err}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.compliance_page.cancel')}</button>
        <button className="btn pri" disabled={go.isPending} onClick={() => { if (!file || f.by.trim().length < 2 || !f.on) { setErr(t('console.compliance_page.attach_the_signed_file_and')); shake.hit(); } else go.mutate(); }}>{t('console.compliance_page.save_as_signed')}</button>
      </div>
    </Dialog>
  );
}

/** The notice is shown as the school will read it, then sent. */
function Tell({ r, onClose, onDone }: { r: ComplianceRow; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const [note, setNote] = useState(r.note);
  const go = useMutation({ mutationFn: () => app.api.compliance.update(r.id, { status: 'notified', note: note.trim() }), onSuccess: () => onDone(t('console.compliance_page.was_told_through_tangent_s', { schoolName: r.schoolName })) });
  return (
    <Dialog title={t('console.compliance_page.tell', { schoolName: r.schoolName })} tag={{ text: t('console.compliance_page.sent_by_email_to_its'), tone: 'a' }} onClose={onClose} width={540}>
      <AreaField label={t('console.compliance_page.what_happened_in_words_for')} value={note} onChange={setNote} rows={3} maxLength={600} />
      <div className="lbl" style={{ margin: '12px 0 6px' }}>{t('console.compliance_page.the_school_receives')}</div>
      <div className="card" style={{ padding: 16, whiteSpace: 'pre-wrap', font: '400 14px/1.5 var(--fb)', background: 'var(--s2)', boxShadow: 'none' }}>{breachNotice(r.schoolName, r.title, note.trim())}</div>
      {go.isError && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{(go.error as Error).message}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.compliance_page.cancel')}</button>
        <button className="btn pri" disabled={go.isPending} onClick={() => go.mutate()}>{t('console.compliance_page.send_it')}</button>
      </div>
    </Dialog>
  );
}

function Add({ kind, onClose, onDone }: { kind: 'dpa' | 'breach'; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const [f, setF] = useState({ schoolId: '', title: kind === 'dpa' ? t('console.compliance_page.data_processing_agreement') : '', note: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const make = useMutation({
    mutationFn: () => app.api.compliance.create({ schoolId: f.schoolId, kind, title: f.title.trim(), note: f.note.trim() }),
    onSuccess: (r) => onDone(kind === 'breach' ? t('console.compliance_page.breach_logged_tell_within_72', { schoolName: r.schoolName }) : t('console.compliance_page.agreement_added_for', { schoolName: r.schoolName })),
    onError: (e) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (!f.schoolId) p.schoolId = t('console.compliance_page.choose_a_school');
    if (f.title.trim().length < 3) p.title = t('console.compliance_page.say_what_this_is');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else make.mutate();
  };
  return (
    <Dialog title={kind === 'dpa' ? t('console.compliance_page.add_an_agreement') : t('console.compliance_page.log_a_breach')} tag={kind === 'breach' ? { text: t('console.compliance_page.72_hour_clock_starts'), tone: 'c' } : undefined} onClose={onClose} width={500} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('console.compliance_page.school')} value={f.schoolId} onChange={set('schoolId')} error={err.schoolId} options={[{ value: '', label: t('console.compliance_page.choose_a_school_2') }, ...(schools.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        <Field label={kind === 'dpa' ? t('console.compliance_page.agreement') : t('console.compliance_page.what_happened')} value={f.title} onChange={set('title')} error={err.title} maxLength={120} />
        <Field label={t('console.compliance_page.details_optional')} value={f.note} onChange={set('note')} maxLength={600} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('console.compliance_page.cancel')}</button>
        <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? t('console.compliance_page.saving') : kind === 'dpa' ? t('console.compliance_page.add_agreement') : t('console.compliance_page.log_breach')}</button>
      </div>
    </Dialog>
  );
}
