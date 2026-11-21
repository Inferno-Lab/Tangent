import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_ID_TYPES, DEFAULT_VISITOR_PURPOSES, listOptions, schoolInstant, schoolToday, type CustomFieldsSetting, type CustomValues, type GatePassRow, type ListItem, type VisitorInput, type VisitorRow } from '@tangent/contracts';
import { uploadFile } from '@tangent/api-client';
import { CustomFieldInputs, DateField, Dialog, EmptyNote, Field, FilePick, PhoneField, SelectField, TimeField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, StudentPick, dateLabel, openPdf, problem, stamp, useCountry, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

type Tab = 'today' | 'expected' | 'passes' | 'pickup' | 'late' | 'roll';
type Say = (m: string, tone?: 'ok' | 'bad') => void;
const time = (iso: string | null) => (iso ? stamp(iso).split(', ').pop() : '');
const PASS = {
  consent: { label: t('admin.visitors.family_to_agree'), tone: 'a' }, pending: { label: t('admin.visitors.waiting'), tone: 'a' }, approved: { label: t('admin.visitors.approved'), tone: 'g' },
  rejected: { label: t('admin.visitors.declined'), tone: 'c' }, left: { label: t('admin.visitors.left'), tone: 'v' }, cancelled: { label: t('admin.visitors.cancelled'), tone: '' },
} as const;

/** The front desk: who is on site, who is expected, children leaving early or being collected, late arrivals and the emergency roll call. */
export function VisitorsPage() { const app = useApp();
  const { toast, say } = useToast();
  const { tab: at, tabs } = usePageTabs('/visitors');
  const tab = (at || 'today') as Tab;
  const desk = app.user.permissions.includes('visitors.manage');
  const [signing, setSigning] = useState<'now' | 'invite' | null>(null);
  const [passing, setPassing] = useState(false);
  return (
    <Page title={t('admin.visitors.visitors')} sub={t('admin.visitors.sub')} toast={toast} tabs={tabs}
      actions={desk ? (tab === 'passes' ? <AddBtn onClick={() => setPassing(true)}>{t('admin.visitors.new_gate_pass')}</AddBtn>
        : tab === 'expected' ? <AddBtn onClick={() => setSigning('invite')}>{t('admin.visitors.invite_a_visitor')}</AddBtn>
          : tab === 'today' ? <AddBtn onClick={() => setSigning('now')}>{t('admin.visitors.sign_someone_in')}</AddBtn> : undefined) : undefined}
      overlays={<>
        {signing && <VisitorDialog invite={signing === 'invite'} onClose={() => setSigning(null)} onDone={(m) => { setSigning(null); say(m); }} />}
        {passing && <PassDialog onClose={() => setPassing(false)} onDone={(m) => { setPassing(false); say(m); }} />}
      </>}>
      {(tab === 'today' || tab === 'expected') && <Visitors view={tab} desk={desk} say={say} />}
      {tab === 'passes' && <Passes desk={desk} say={say} />}
      {tab === 'pickup' && <Pickup desk={desk} say={say} />}
      {tab === 'late' && <Late desk={desk} say={say} />}
      {tab === 'roll' && <Roll say={say} />}
    </Page>
  );
}

function Visitors({ view, desk, say }: { view: 'today' | 'expected'; desk: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const list = useQuery({ queryKey: ['visitors', view, q], queryFn: () => app.api.visitors.list(view, q) });
  const act = useMutation({
    mutationFn: ({ v, what }: { v: VisitorRow; what: 'in' | 'out' | 'cancel' }) => (what === 'in' ? app.api.visitors.signIn(v.id) : what === 'out' ? app.api.visitors.signOut(v.id) : app.api.visitors.cancel(v.id)),
    onSuccess: (v, x) => { void qc.invalidateQueries({ queryKey: ['visitors'] }); say(x.what === 'in' ? t('admin.visitors.signed_in', { name: v.name, badge: v.badgeNo ?? '' }) : x.what === 'out' ? t('admin.visitors.signed_out', { name: v.name }) : t('admin.visitors.visit_cancelled')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const find = useMutation({ mutationFn: () => app.api.visitors.byCode(code), onSuccess: (v) => { setCode(''); act.mutate({ v, what: 'in' }); }, onError: (e) => say((e as Error).message, 'bad') });
  const rows = list.data ?? [];
  return (
    <Card style={{ padding: 0 }} chip={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div style={{ width: 200 }}><Field label={t('admin.visitors.search')} value={q} onChange={setQ} maxLength={60} /></div>
      {view === 'expected' && desk && <>
        <div style={{ width: 150 }}><Field label={t('admin.visitors.pass_code')} value={code} onChange={setCode} maxLength={12} /></div>
        <button className="btn sm" disabled={code.trim().length < 4 || find.isPending} onClick={() => find.mutate()}>{t('admin.visitors.arrived')}</button>
      </>}
    </div>} title={view === 'today' ? t('admin.visitors.on_site_today') : t('admin.visitors.expected')}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="shield" title={view === 'today' ? t('admin.visitors.nobody_on_site') : t('admin.visitors.nobody_expected')}
        body={view === 'today' ? t('admin.visitors.nobody_on_site_body') : t('admin.visitors.nobody_expected_body')} /></div> : rows.map((v) => (
        <div key={v.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <b style={{ font: '700 14px/1.3 var(--fb)' }}>{v.name}</b>
            <small className="help" style={{ display: 'block', margin: 0 }}>
              {v.purposeName}{v.hostName ? ` · ${t('admin.visitors.to_see', { name: v.hostName })}` : ''}{v.badgeNo ? ` · ${v.badgeNo}` : ''}
              {v.inAt ? ` · ${t('admin.visitors.in_at', { time: time(v.inAt) })}` : v.expectedOn ? ` · ${dateLabel(v.expectedOn)}` : ''}{v.outAt ? ` · ${t('admin.visitors.out_at', { time: time(v.outAt) })}` : ''}
            </small>
          </span>
          <span className={`chip ${v.state === 'in' ? 'g' : v.state === 'pending' ? 'a' : ''}`}>{v.state === 'in' ? t('admin.visitors.on_site') : v.state === 'out' ? t('admin.visitors.gone') : v.state === 'pending' ? t('admin.visitors.waiting_for_approval') : t('admin.visitors.invited')}</span>
          {v.badgeNo && <button className="btn sm" onClick={() => void openPdf(app.api.visitors.badge(v.id)).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.visitors.badge')}</button>}
          {desk && v.state === 'in' && <button className="btn sm pri" disabled={act.isPending} onClick={() => act.mutate({ v, what: 'out' })}>{t('admin.visitors.sign_out')}</button>}
          {desk && v.state === 'invited' && <button className="btn sm pri" disabled={act.isPending} onClick={() => act.mutate({ v, what: 'in' })}>{t('admin.visitors.arrived')}</button>}
          {desk && (v.state === 'invited' || v.state === 'pending') && <button className="btn sm" disabled={act.isPending} onClick={() => act.mutate({ v, what: 'cancel' })}>{t('admin.visitors.cancel')}</button>}
        </div>
      ))}
    </Card>
  );
}

function VisitorDialog({ invite, onClose, onDone }: { invite: boolean; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const purposes = listOptions(useSetting<ListItem[]>('visitors.purposes', DEFAULT_VISITOR_PURPOSES));
  const ids = listOptions(useSetting<ListItem[]>('visitors.idTypes', DEFAULT_ID_TYPES));
  const defs = useSetting<CustomFieldsSetting>('fields.custom', {}).visitor ?? [];
  const country = useCountry();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const [f, setF] = useState<VisitorInput>({ name: '', phone: '', purpose: purposes[0]?.key ?? '', hostId: null, idType: '', idNumber: '', photoFileId: null, vehicle: '', note: '', custom: {}, expectedOn: invite ? schoolToday() : null });
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const put = (p: Partial<VisitorInput>) => { setF({ ...f, ...p }); setErr({}); };
  const save = useMutation({
    mutationFn: async () => app.api.visitors.add({ ...f, photoFileId: photo ? (await uploadFile(app.api, 'visitor_photo', 'desk', photo)).id : null }),
    onSuccess: (v) => { void qc.invalidateQueries({ queryKey: ['visitors'] }); onDone(v.state === 'in' ? t('admin.visitors.signed_in', { name: v.name, badge: v.badgeNo ?? '' }) : t('admin.visitors.invited_n', { name: v.name, code: v.code ?? '' })); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={invite ? t('admin.visitors.invite_a_visitor') : t('admin.visitors.sign_someone_in')} onClose={onClose} width={620} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <Field label={t('admin.visitors.name')} value={f.name} error={err.name} maxLength={80} onChange={(v) => put({ name: v })} />
          <PhoneField country={country} label={t('admin.visitors.phone_optional')} value={f.phone} error={err.phone} onChange={(v) => put({ phone: v })} />
        </div>
        <div className="two">
          <SelectField label={t('admin.visitors.why')} value={f.purpose} error={err.purpose} onChange={(v) => put({ purpose: v })} options={purposes.map((p) => ({ value: p.key, label: p.name }))} />
          <SelectField label={t('admin.visitors.to_see_optional')} value={f.hostId ?? ''} error={err.hostId} onChange={(v) => put({ hostId: v || null })}
            options={[{ value: '', label: t('admin.visitors.nobody_in_particular') }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </div>
        <div className="two">
          <SelectField label={t('admin.visitors.id_document')} value={f.idType} error={err.idType} onChange={(v) => put({ idType: v })} options={[{ value: '', label: t('admin.visitors.none_shown') }, ...ids.map((p) => ({ value: p.key, label: p.name }))]} />
          <Field label={t('admin.visitors.id_number')} value={f.idNumber} maxLength={40} onChange={(v) => put({ idNumber: v })} />
        </div>
        {invite && <DateField label={t('admin.visitors.expected_on')} value={f.expectedOn ?? schoolToday()} min={schoolToday()} error={err.expectedOn} onChange={(v) => put({ expectedOn: v })} />}
        <Field label={t('admin.visitors.vehicle_optional')} value={f.vehicle} maxLength={20} onChange={(v) => put({ vehicle: v })} />
        <CustomFieldInputs defs={defs} values={f.custom as CustomValues} onChange={(custom) => put({ custom })} errors={Object.fromEntries(Object.entries(err).filter(([k]) => k.startsWith('custom.')).map(([k, m]) => [k.slice(7), m]))} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <FilePick accept="image/jpeg,image/png,image/webp" className="btn sm" onPick={setPhoto}>{photo ? t('admin.visitors.another_photo') : t('admin.visitors.add_a_photo')}</FilePick>
          {photo && <small className="help" style={{ margin: 0 }}>{photo.name}</small>}
        </div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.visitors.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate()}>{invite ? t('admin.visitors.send_the_pass') : t('admin.visitors.sign_in')}</button>
      </div>
    </Dialog>
  );
}

function Passes({ desk, say }: { desk: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [day, setDay] = useState(schoolToday());
  const list = useQuery({ queryKey: ['gate-passes', day], queryFn: () => app.api.visitors.passes(day) });
  const act = useMutation({
    mutationFn: ({ g, what }: { g: GatePassRow; what: 'out' | 'cancel' }) => (what === 'out' ? app.api.visitors.passOut(g.id) : app.api.visitors.cancelPass(g.id)),
    onSuccess: (g) => { void qc.invalidateQueries({ queryKey: ['gate-passes'] }); say(g.state === 'left' ? t('admin.visitors.has_left', { name: g.studentName }) : t('admin.visitors.pass_cancelled')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const rows = list.data ?? [];
  return (
    <Card style={{ padding: 0 }} title={dateLabel(day)} chip={<div style={{ width: 180 }}><DateField compact label={t('admin.visitors.day')} value={day} onChange={(v) => v && setDay(v)} /></div>}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="shield" title={t('admin.visitors.no_gate_passes')} body={t('admin.visitors.no_gate_passes_body')} /></div> : rows.map((g) => (
        <div key={g.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 220 }}>
            <b style={{ font: '700 14px/1.3 var(--fb)' }}>{g.studentName} · {g.className}</b>
            <small className="help" style={{ display: 'block', margin: 0 }}>{time(g.leaveAt)} · {g.reason} · {t('admin.visitors.collected_by', { name: g.collector })}{g.number ? ` · ${g.number}` : ''}</small>
          </span>
          <span className={`chip ${PASS[g.state].tone}`}>{PASS[g.state].label}</span>
          {g.state === 'pending' && <a className="btn sm" href={`${app.base}/approvals`}>{t('admin.visitors.decide')}</a>}
          {(g.state === 'approved' || g.state === 'left') && <button className="btn sm" onClick={() => void openPdf(app.api.visitors.passPdf(g.id)).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.visitors.print')}</button>}
          {desk && g.state === 'approved' && <button className="btn sm pri" disabled={act.isPending} onClick={() => act.mutate({ g, what: 'out' })}>{t('admin.visitors.let_them_leave')}</button>}
          {desk && ['consent', 'pending', 'approved'].includes(g.state) && <button className="btn sm" disabled={act.isPending} onClick={() => act.mutate({ g, what: 'cancel' })}>{t('admin.visitors.cancel')}</button>}
        </div>
      ))}
    </Card>
  );
}

function PassDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const [student, setStudent] = useState<{ id: string; name: string; className: string } | null>(null);
  const [f, setF] = useState({ day: schoolToday(), at: '12:00', reason: '', collector: '', pickupId: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const people = useQuery({ queryKey: ['pickup-people', student?.id], queryFn: () => app.api.visitors.people(student!.id), enabled: !!student });
  const save = useMutation({
    mutationFn: () => app.api.visitors.askPass({ studentId: student!.id, leaveAt: schoolInstant(f.day, f.at).toISOString(), reason: f.reason, pickupId: f.pickupId || null, collector: f.collector, returns: false }),
    onSuccess: (g) => { void qc.invalidateQueries({ queryKey: ['gate-passes'] }); onDone(g.state === 'consent' ? t('admin.visitors.family_asked', { name: g.studentName }) : t('admin.visitors.pass_sent_for_approval')); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={t('admin.visitors.new_gate_pass')} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <StudentPick label={t('admin.visitors.student')} value={student} onChange={setStudent} error={err.studentId} />
        <div className="two">
          <DateField label={t('admin.visitors.day')} value={f.day} min={schoolToday()} onChange={(v) => setF({ ...f, day: v })} />
          <TimeField label={t('admin.visitors.leaves_at')} value={f.at} error={err.leaveAt} onChange={(v) => setF({ ...f, at: v })} />
        </div>
        <Field label={t('admin.visitors.reason')} value={f.reason} error={err.reason} maxLength={300} onChange={(v) => setF({ ...f, reason: v })} />
        {!!people.data?.length && <SelectField label={t('admin.visitors.collected_by_one_named')} value={f.pickupId} onChange={(v) => setF({ ...f, pickupId: v })}
          options={[{ value: '', label: t('admin.visitors.someone_else') }, ...people.data.map((p) => ({ value: p.id, label: `${p.name} (${p.relation})` }))]} />}
        {!f.pickupId && <Field label={t('admin.visitors.who_collects')} value={f.collector} error={err.collector} maxLength={80} onChange={(v) => setF({ ...f, collector: v })} />}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.visitors.cancel')}</button>
        <button className="btn pri" disabled={!student || f.reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>{t('admin.visitors.ask')}</button>
      </div>
    </Dialog>
  );
}

/** At the gate at home time: check the family's code (or a named person), record who collected whom; and keep the named people. */
function Pickup({ desk, say }: { desk: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof app.api.visitors.check>> | null>(null);
  const [who, setWho] = useState<Record<string, string>>({});
  const today = useQuery({ queryKey: ['pickups', schoolToday()], queryFn: () => app.api.visitors.pickups(schoolToday()) });
  const check = useMutation({ mutationFn: () => app.api.visitors.check(code), onSuccess: setFound, onError: (e) => { setFound(null); say((e as Error).message, 'bad'); } });
  const record = useMutation({
    mutationFn: (b: { studentId: string; pickupId: string | null; name: string; code: string }) => app.api.visitors.pickup(b),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['pickups'] }); say(t('admin.visitors.pickup_recorded')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const [student, setStudent] = useState<{ id: string; name: string; className: string } | null>(null);
  const people = useQuery({ queryKey: ['pickup-people', student?.id], queryFn: () => app.api.visitors.people(student!.id), enabled: !!student });
  return <>
    {desk && (
      <Card title={t('admin.visitors.check_a_code')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ width: 200 }}><Field label={t('admin.visitors.family_code')} value={code} onChange={setCode} maxLength={64} /></div>
          <button className="btn pri" disabled={code.trim().length < 4 || check.isPending} onClick={() => check.mutate()}>{t('admin.visitors.check')}</button>
        </div>
        {found && (
          <div className="stack" style={{ marginTop: 12 }}>
            <div className="help" style={{ margin: 0 }}>{t('admin.visitors.code_of', { name: found.parent })}</div>
            {found.students.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <b style={{ flex: '0 0 200px' }}>{s.name} · {s.className}</b>
                <div style={{ width: 220 }}><Field label={t('admin.visitors.collected_by_name')} value={who[s.id] ?? ''} onChange={(v) => setWho({ ...who, [s.id]: v })} maxLength={80} /></div>
                <button className="btn sm pri" disabled={(who[s.id] ?? '').trim().length < 2 || record.isPending} onClick={() => record.mutate({ studentId: s.id, pickupId: null, name: who[s.id]!, code })}>{t('admin.visitors.collected')}</button>
              </div>
            ))}
            {!!found.people.length && <small className="help" style={{ margin: 0 }}>{t('admin.visitors.named_people', { names: found.people.map((p) => `${p.name} (${p.relation})`).join(', ') })}</small>}
          </div>
        )}
      </Card>
    )}
    <Card title={t('admin.visitors.who_may_collect')}>
      <StudentPick label={t('admin.visitors.student')} value={student} onChange={setStudent} />
      {student && (
        <div className="stack" style={{ marginTop: 10, gap: 0 }}>
          {!(people.data ?? []).length ? <small className="help">{t('admin.visitors.nobody_named')}</small> : (people.data ?? []).map((p) => (
            <div key={p.id} className="rw" style={{ display: 'flex', gap: 8, alignItems: 'center', height: 'auto', minHeight: 44, padding: '4px 0', flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }}>{p.name} · {p.relation}{p.phone ? ` · ${p.phone}` : ''}</span>
              {desk && <button className="btn sm pri" disabled={record.isPending} onClick={() => record.mutate({ studentId: student.id, pickupId: p.id, name: p.name, code: '' })}>{t('admin.visitors.collected_by_them')}</button>}
              {desk && <button className="btn sm" onClick={() => void app.api.visitors.removePerson(p.id).then(() => qc.invalidateQueries({ queryKey: ['pickup-people'] })).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.visitors.remove')}</button>}
            </div>
          ))}
        </div>
      )}
    </Card>
    <Card title={t('admin.visitors.collected_today')} style={{ padding: 0 }}>
      {!(today.data ?? []).length ? <div style={{ padding: 20 }}><EmptyNote icon="students" title={t('admin.visitors.nobody_collected')} /></div> : (today.data ?? []).map((p) => (
        <div key={p.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 44, padding: '6px 20px' }}>
          <b style={{ flex: 1 }}>{p.studentName} · {p.className}</b>
          <span>{p.name}</span><small className="help" style={{ margin: 0 }}>{time(p.at)}{p.byCode ? ` · ${t('admin.visitors.with_the_code')}` : ''}</small>
        </div>
      ))}
    </Card>
  </>;
}

function Late({ desk, say }: { desk: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [student, setStudent] = useState<{ id: string; name: string; className: string } | null>(null);
  const [reason, setReason] = useState('');
  const list = useQuery({ queryKey: ['late', schoolToday()], queryFn: () => app.api.visitors.lateList(schoolToday()) });
  const save = useMutation({ mutationFn: () => app.api.visitors.late({ studentId: student!.id, reason }), onSuccess: () => { setStudent(null); setReason(''); void qc.invalidateQueries({ queryKey: ['late'] }); say(t('admin.visitors.late_written')); },
    onError: (e) => say((e as Error).message, 'bad') });
  return <>
    {desk && (
      <Card title={t('admin.visitors.came_late')}>
        <div className="stack">
          <StudentPick label={t('admin.visitors.student')} value={student} onChange={setStudent} />
          <Field label={t('admin.visitors.reason_optional')} value={reason} onChange={setReason} maxLength={200} />
          <button className="btn pri" style={{ alignSelf: 'flex-start' }} disabled={!student || save.isPending} onClick={() => save.mutate()}>{t('admin.visitors.write_it_down')}</button>
        </div>
      </Card>
    )}
    <Card title={t('admin.visitors.late_today')} style={{ padding: 0 }}>
      {!(list.data ?? []).length ? <div style={{ padding: 20 }}><EmptyNote icon="late" title={t('admin.visitors.nobody_late')} /></div> : (list.data ?? []).map((l) => (
        <div key={l.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 44, padding: '6px 20px' }}>
          <b style={{ flex: 1 }}>{l.studentName} · {l.className}</b><span>{time(l.at)}</span>{l.reason && <small className="help" style={{ margin: 0 }}>{l.reason}</small>}
        </div>
      ))}
    </Card>
  </>;
}

/** Everyone on site now, to check off in an emergency (printed, since screens and power may fail). */
function Roll({ say }: { say: Say }) { const app = useApp();
  const q = useQuery({ queryKey: ['roll-call'], queryFn: app.api.visitors.rollCall, refetchInterval: 60_000 });
  const r = q.data;
  return <>
    <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <button className="btn pri" onClick={() => void openPdf(app.api.visitors.rollCallPdf()).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.visitors.print_the_roll_call')}</button>
      <button className="btn" onClick={() => void q.refetch()}>{t('admin.visitors.refresh')}</button>
      {r && <small className="help" style={{ margin: 0, alignSelf: 'center' }}>{t('admin.visitors.as_of', { time: time(r.at) })}</small>}
    </div>
    {/* One card with three columns: their headings and notes sit on one line whatever each list holds. */}
    {r && <section className="card rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 24, alignItems: 'start' }}>
      {[
        { title: t('admin.visitors.students_n', { n: r.students.length }), note: r.marked.students ? t('admin.visitors.from_todays_marks') : t('admin.visitors.not_marked_everyone_expected'), items: r.students.map((s) => [s.name, s.className]) },
        { title: t('admin.visitors.staff_n', { n: r.staff.length }), note: r.marked.staff ? t('admin.visitors.from_check_ins') : t('admin.visitors.not_marked_everyone_expected'), items: r.staff.map((s) => [s.name, '']) },
        { title: t('admin.visitors.visitors_n', { n: r.visitors.length }), note: t('admin.visitors.signed_in_at_the_gate'), items: r.visitors.map((v) => [v.name, v.hostName ?? '']) },
      ].map((g) => (
        <div key={g.title} style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0 }}>{g.title}</h3>
          <small className="help" style={{ display: 'block', margin: '2px 0 10px' }}>{g.note}</small>
          {g.items.length ? <div className="lscroll" style={{ maxHeight: 360 }}>{g.items.map(([name, more], i) => <div key={i} className="kv"><span>{name}</span>{more && <small className="help" style={{ margin: 0 }}>{more}</small>}</div>)}</div>
            : <EmptyNote icon="people" title={t('admin.visitors.nobody_on_site_in_this')} body={t('admin.visitors.the_roll_call_fills_in')} />}
        </div>
      ))}
    </section>}
  </>;
}
