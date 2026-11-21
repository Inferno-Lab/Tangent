import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdmissionStages, DEFAULT_ADMISSION_STAGES, addDays, schoolToday, stageName, type AdmissionStage, type EnquiryPatch, type EnquiryRow, type EnquiryStage } from '@tangent/contracts';
import { EmptyNote, Checkbox, DateField, Dialog, Field, PhoneField, SelectField, currentLanguage, useShake, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, Avatar, dateLabel, problem, useCountry, useGrades, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

type Column = { stage: EnquiryStage; label: string; hint: string; def?: AdmissionStage };
/** The school's stages (People → Settings), read the way the server reads them. */
function useStages(): AdmissionStage[] {
  const raw = useSetting<unknown>('admissions.stages', DEFAULT_ADMISSION_STAGES);
  const parsed = AdmissionStages.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ADMISSION_STAGES;
}
/** A stage's name for the board: the fixed three, else the school's own name in the reader's language. */
const labelOf = (stages: AdmissionStage[], s: EnquiryStage) =>
  s === 'enquiry' ? t('admin.admissions_page.enquiry') : s === 'enrolled' ? t('admin.admissions_page.enrolled') : s === 'declined' ? t('admin.admissions_page.declined') : stageName(stages, s, currentLanguage());
/** A source as stored (older rows keep a key like `walk-in`), shown as words. */
const sourceLabel = (s: string) => (s.includes(' ') || /[A-Z]/.test(s) ? s : s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['admissions', 'students', 'shell', 'dashboard', 'classes'].includes(String(q.queryKey[0])) });

export function AdmissionsPage() {
  const { tabs } = usePageTabs('/admissions');
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [adding, setAdding] = useState(false);
  const [dlg, setDlg] = useState<{ kind: 'day' | 'enrol' | 'view'; row: EnquiryRow; to?: EnquiryStage } | null>(null);
  const [showDeclined, setShowDeclined] = useState(false);
  const list = useQuery({ queryKey: ['admissions'], queryFn: app.api.admissions.list });
  const grades = useGrades();
  const grade = (g: number) => grades.find((x) => x.value === String(g))?.label ?? t('admin.admissions_page.grade', { g });
  // The school's stages, with any stage it removed that still holds a card (shown after its own, until it is empty).
  const stages = useStages();
  const online = useSetting<boolean>('admissions.onlineForm', false);
  const label = (s: EnquiryStage) => labelOf(stages, s);
  const gone = [...new Set((list.data ?? []).map((r) => r.stage))].filter((s) => !['enquiry', 'enrolled', 'declined'].includes(s) && !stages.some((x) => x.key === s));
  const columns: Column[] = [
    { stage: 'enquiry', label: label('enquiry'), hint: t('admin.admissions_page.asked_about_a_seat') },
    ...stages.map((d) => ({ stage: d.key, label: label(d.key), hint: d.hint, def: d })),
    ...gone.map((g) => ({ stage: g, label: g, hint: t('admin.admissions_page.no_longer_a_stage') })),
    { stage: 'enrolled', label: label('enrolled'), hint: t('admin.admissions_page.now_a_student') },
  ];
  const flow = ['enquiry', ...stages.map((d) => d.key), 'enrolled'];
  const step = (s: EnquiryStage, by: 1 | -1) => { const i = flow.indexOf(s); return i < 0 ? (by > 0 ? flow[1] : undefined) : flow[i + by]; };
  const canWrite = app.user.permissions.includes('admissions.write');
  const rows = list.data ?? [];
  const move = useMutation({
    mutationFn: (v: { id: string; stage: EnquiryStage; stageOn?: string }) => app.api.admissions.patch(v.id, { stage: v.stage, stageOn: v.stageOn }),
    onSuccess: (r) => { refresh(qc); say(stages.find((d) => d.key === r.stage)?.tellFamily ? t('admin.admissions_page.moved_and_told', { childName: r.childName, label: label(r.stage), guardianName: r.guardianName }) : t('admin.admissions_page.moved_to', { childName: r.childName, label: label(r.stage) })); setDlg(null); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const act = (r: EnquiryRow, to: EnquiryStage) => {
    if (stages.find((d) => d.key === to)?.needsDate) setDlg({ kind: 'day', row: r, to });
    else if (to === 'enrolled') setDlg({ kind: 'enrol', row: r });
    else move.mutate({ id: r.id, stage: to });
  };
  const declined = rows.filter((r) => r.stage === 'declined');
  const open = rows.filter((r) => r.stage !== 'enrolled' && r.stage !== 'declined').length;
  return (
    <Page title={t('admin.admissions_page.admissions')} sub={rows.length ? t('admin.admissions_page.open_enrolled', { open, length: rows.filter((r) => r.stage === 'enrolled').length }) : t('admin.admissions_page.from_first_enquiry_to_first')} tabs={tabs} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={<>{online && <a className="btn" href={`${app.base}/apply`} target="_blank" rel="noreferrer" data-tip={t('admin.admissions_page.the_page_families_apply_from')}>{t('admin.admissions_page.application_page')}</a>}{canWrite && <AddBtn onClick={() => setAdding(true)}>{t('admin.admissions_page.new_enquiry')}</AddBtn>}</>}
      overlays={<>
        {adding && <NewEnquiry onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(qc); say(t('admin.admissions_page.enquiry_added')); }} />}
        {dlg?.kind === 'day' && dlg.to && <StageDay row={dlg.row} stage={label(dlg.to)} onClose={() => setDlg(null)} onPick={(d) => move.mutate({ id: dlg.row.id, stage: dlg.to!, stageOn: d })} busy={move.isPending} />}
        {dlg?.kind === 'enrol' && <Enrol row={dlg.row} onClose={() => setDlg(null)} onDone={(name, adm) => { setDlg(null); refresh(qc); say(t('admin.admissions_page.is_enrolled_admission_number', { name, adm })); }} />}
        {dlg?.kind === 'view' && <Details row={dlg.row} stages={stages} canWrite={canWrite} back={dlg.row.stage === 'declined' ? undefined : step(dlg.row.stage, -1)} onClose={() => setDlg(null)} onMove={(stage) => act(dlg.row, stage)} onSaved={() => { refresh(qc); setDlg(null); say(t('admin.admissions_page.saved')); }} />}
      </>}>
      {rows.length === 0 ? (
        <div><EmptyState scene="admissions" onAction={canWrite ? () => setAdding(true) : undefined} /></div>
      ) : (
        <>
          <div className="adm" role="list">
            {columns.map((c) => {
              const items = rows.filter((r) => r.stage === c.stage);
              return (
                <section className="admc rise" key={c.stage} role="listitem" aria-label={c.label}>
                  <header><b>{c.label}</b><span className="chip">{items.length}</span></header>
                  <small>{c.hint || '\u00a0'}</small>
                  <div className="lscroll admcl">
                    {items.length === 0 && <EmptyNote icon="waiting" title={t('admin.admissions_page.nothing_here')} />}
                    {items.map((r) => (
                      <article className="admk" key={r.id}>
                        <button className="admo" onClick={() => setDlg({ kind: 'view', row: r })} aria-label={t('admin.admissions_page.open', { childName: r.childName })}>
                          <Avatar name={r.childName} size={32} />
                          <span style={{ minWidth: 0 }}><b data-tip={r.childName}>{r.childName}</b><small>{grade(r.gradeSought)} · {r.guardianName}</small></span>
                        </button>
                        <div className="tgrow" style={{ gap: 6 }}>
                          <span className="chip">{sourceLabel(r.source)}</span>
                          {r.stageOn && <span className="chip a">{dateLabel(r.stageOn)}</span>}
                          {r.scores[r.stage] && <span className="chip v">{r.scores[r.stage]}</span>}
                          {r.studentId && <span className="chip g">{t('admin.admissions_page.student')}</span>}
                        </div>
                        {canWrite && (() => { const to = step(r.stage, 1); return to && <button className="btn sm" disabled={move.isPending} onClick={() => act(r, to)}>{to === 'enrolled' ? t('admin.admissions_page.enrol') : t('admin.admissions_page.move_to', { label: label(to) })}</button>; })()}
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {declined.length > 0 && (
            <section className="card rise">
              <div className="ch"><h2>{t('admin.admissions_page.declined')}</h2><span className="chip">{declined.length}</span><button className="btn sm" onClick={() => setShowDeclined(!showDeclined)}>{showDeclined ? t('admin.admissions_page.hide') : t('admin.admissions_page.show')}</button></div>
              {showDeclined && <div className="tgrow" style={{ marginTop: 12 }}>{declined.map((r) => <button key={r.id} className="fp" onClick={() => setDlg({ kind: 'view', row: r })}>{r.childName} · {grade(r.gradeSought)}</button>)}</div>}
            </section>
          )}
        </>
      )}
    </Page>
  );
}

function NewEnquiry({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const grades = useGrades();
  const sources = useSetting<string[]>('admissions.sources', [t('admin.admissions_page.walk_in')]);
  const country = useCountry();
  const [f, setF] = useState({ childName: '', gradeSought: '', guardianName: '', phone: '', email: '', source: '', note: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const make = useMutation({
    mutationFn: () => app.api.admissions.create({ childName: f.childName.trim(), gradeSought: Number(f.gradeSought || grades[0]?.value || 1), guardianName: f.guardianName.trim(), phone: f.phone.trim(), email: f.email.trim(), source: f.source || sources[0] || t('admin.admissions_page.walk_in'), note: f.note.trim() }),
    onSuccess: onDone, onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.childName.trim().length < 2) p.childName = t('admin.admissions_page.enter_the_child_s_name');
    if (f.guardianName.trim().length < 2) p.guardianName = t('admin.admissions_page.enter_the_guardian_s_name');
    if (!f.phone.trim()) p.phone = t('admin.admissions_page.enter_a_phone_number');
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) p.email = t('admin.admissions_page.enter_a_valid_email_or');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else make.mutate();
  };
  return (
    <Dialog title={t('admin.admissions_page.new_enquiry')} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <Field label={t('admin.admissions_page.child_s_name')} value={f.childName} onChange={set('childName')} error={err.childName} maxLength={80} />
          <SelectField label={t('admin.admissions_page.grade_wanted')} value={f.gradeSought || grades[0]?.value || ''} onChange={set('gradeSought')} options={grades} />
        </div>
        <Field label={t('admin.admissions_page.guardian_s_name')} value={f.guardianName} onChange={set('guardianName')} error={err.guardianName} maxLength={80} />
        <div className="two">
          <PhoneField country={country} label={t('admin.admissions_page.phone')} value={f.phone} onChange={set('phone')} error={err.phone} />
          <Field label={t('admin.admissions_page.email_optional')} type="email" value={f.email} onChange={set('email')} error={err.email} />
        </div>
        <SelectField label={t('admin.admissions_page.how_they_found_us')} value={f.source || sources[0] || ''} onChange={set('source')} options={sources.map((s) => ({ value: s, label: s }))} />
        <AreaField label={t('admin.admissions_page.note_optional')} value={f.note} onChange={set('note')} rows={2} maxLength={400} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{t('admin.admissions_page.cancel')}</button>
        <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? t('admin.admissions_page.adding') : t('admin.admissions_page.add_enquiry')}</button>
      </div>
    </Dialog>
  );
}

function StageDay({ row, stage, onClose, onPick, busy }: { row: EnquiryRow; stage: string; onClose: () => void; onPick: (d: string) => void; busy: boolean }) {
  const [d, setD] = useState(addDays(schoolToday(), 3));
  return (
    <Dialog title={stage} tag={{ text: row.childName, tone: 'v' }} onClose={onClose} width={440}>
      <DateField label={t('admin.admissions_page.which_day')} value={d} onChange={setD} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.admissions_page.cancel')}</button>
        <button className="btn pri" disabled={busy || !d} onClick={() => onPick(d)}>{busy ? t('admin.admissions_page.saving') : t('admin.admissions_page.move_on_that_day')}</button>
      </div>
    </Dialog>
  );
}

function Enrol({ row, onClose, onDone }: { row: EnquiryRow; onClose: () => void; onDone: (name: string, adm: string) => void }) {
  const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const grades = useGrades();
  const fit = (classes.data ?? []).filter((c) => c.grade === row.gradeSought);
  const [classId, setClassId] = useState('');
  const [dob, setDob] = useState(row.dob ?? '');
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const chosen = classId || fit[0]?.id || '';
  const enrol = useMutation({ mutationFn: () => app.api.admissions.enrol(row.id, { classId: chosen, dob }), onSuccess: (s) => onDone(s.name, s.admissionNo), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const go = () => {
    const p: Record<string, string> = {};
    if (!chosen) p.classId = t('admin.admissions_page.choose_a_class');
    if (!dob) p.dob = t('admin.admissions_page.enter_the_date_of_birth');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else enrol.mutate();
  };
  return (
    <Dialog title={t('admin.admissions_page.enrol_2', { childName: row.childName })} tag={{ text: grades.find((x) => x.value === String(row.gradeSought))?.label ?? t('admin.admissions_page.grade_2', { gradeSought: row.gradeSought }), tone: 'v' }} onClose={onClose} width={460} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('admin.admissions_page.class')} value={chosen} onChange={(v) => { setClassId(v); setErr({ ...err, classId: '' }); }} error={err.classId}
          options={(fit.length ? fit : classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.admissions_page.class_students', { name: c.name, studentCount: c.studentCount }) }))} />
        <DateField label={t('admin.admissions_page.date_of_birth')} value={dob} max={schoolToday()} onChange={(v) => { setDob(v); setErr({ ...err, dob: '' }); }} error={err.dob} />
        <div className="help">{row.guardianName} · {row.phone || t('admin.admissions_page.no_phone_yet')} {t('admin.admissions_page.becomes_the_guardian_on_the')}</div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.admissions_page.cancel')}</button>
        <button className="btn pri" disabled={enrol.isPending} onClick={go}>{enrol.isPending ? t('admin.admissions_page.enrolling') : t('admin.admissions_page.enrol_student')}</button>
      </div>
    </Dialog>
  );
}

function Details({ row, stages, canWrite, back, onClose, onMove, onSaved }: { row: EnquiryRow; stages: AdmissionStage[]; canWrite: boolean; back?: EnquiryStage; onClose: () => void; onMove: (s: EnquiryStage) => void; onSaved: () => void }) {
  const app = useApp();
  const label = (s: EnquiryStage) => labelOf(stages, s);
  const here = stages.find((d) => d.key === row.stage);
  // Documents asked for at the stages reached so far (all of them once enrolled), and any already received.
  const reached = row.stage === 'enrolled' ? stages.length : stages.findIndex((d) => d.key === row.stage) + 1;
  const asked = [...new Set([...stages.slice(0, Math.max(reached, 0)).flatMap((d) => d.documents), ...Object.keys(row.docs)])];
  const [score, setScore] = useState(row.scores[row.stage] ?? '');
  const [docs, setDocs] = useState<Record<string, boolean>>(Object.fromEntries(asked.map((d) => [d, !!row.docs[d]])));
  const grades = useGrades();
  const sources = useSetting<string[]>('admissions.sources', [t('admin.admissions_page.walk_in')]);
  const country = useCountry();
  const locked = row.stage === 'enrolled' || !canWrite;
  const [f, setF] = useState({ childName: row.childName, gradeSought: String(row.gradeSought), guardianName: row.guardianName, phone: row.phone, email: row.email ?? '', source: row.source, note: row.note });
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const was = { childName: row.childName, gradeSought: String(row.gradeSought), guardianName: row.guardianName, phone: row.phone, email: row.email ?? '', source: row.source, note: row.note };
  const docsChanged = asked.filter((d) => docs[d] !== !!row.docs[d]);
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k].trim() !== was[k]) || score.trim() !== (row.scores[row.stage] ?? '') || docsChanged.length > 0;
  const save = useMutation({
    mutationFn: () => {
      const b: EnquiryPatch = {};
      if (f.childName.trim() !== was.childName) b.childName = f.childName.trim();
      if (f.gradeSought !== was.gradeSought) b.gradeSought = Number(f.gradeSought);
      if (f.guardianName.trim() !== was.guardianName) b.guardianName = f.guardianName.trim();
      if (f.phone.trim() !== was.phone) b.phone = f.phone.trim();
      if (f.email.trim() !== was.email) b.email = f.email.trim();
      if (f.source !== was.source) b.source = f.source;
      if (f.note.trim() !== was.note) b.note = f.note.trim();
      if (here?.scored && score.trim() !== (row.scores[row.stage] ?? '')) b.score = score.trim();
      if (docsChanged.length) b.docs = Object.fromEntries(docsChanged.map((d) => [d, docs[d]!]));
      return app.api.admissions.patch(row.id, b);
    },
    onSuccess: onSaved, onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.childName.trim().length < 2) p.childName = t('admin.admissions_page.enter_the_child_s_name');
    if (f.guardianName.trim().length < 2) p.guardianName = t('admin.admissions_page.enter_the_guardian_s_name');
    if (!f.phone.trim()) p.phone = t('admin.admissions_page.enter_a_phone_number');
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) p.email = t('admin.admissions_page.enter_a_valid_email_or');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate();
  };
  // A source the school has since removed stays choosable on the enquiry that has it.
  const sourceOptions = [...new Set([...sources, row.source])].map((s) => ({ value: s, label: sourceLabel(s) }));
  return (
    <Dialog title={row.childName} tag={{ text: label(row.stage), tone: row.stage === 'declined' ? 'a' : 'v' }} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        {locked ? <>
          <div className="kv"><span>{t('admin.admissions_page.grade_3')}</span><b>{grades.find((x) => x.value === f.gradeSought)?.label ?? t('admin.admissions_page.grade_2', { gradeSought: f.gradeSought })}</b></div>
          <div className="kv"><span>{t('admin.admissions_page.guardian')}</span><b>{row.guardianName}</b></div>
          <div className="kv"><span>{t('admin.admissions_page.phone')}</span><b>{row.phone || t('admin.admissions_page.not_given')}</b></div>
          {row.email && <div className="kv"><span>{t('admin.admissions_page.email')}</span><b>{row.email}</b></div>}
          <div className="kv"><span>{t('admin.admissions_page.found_us_through')}</span><b>{sourceLabel(row.source)}</b></div>
          {row.stageOn && <div className="kv"><span>{label(row.stage)}</span><b>{dateLabel(row.stageOn)}</b></div>}
          {Object.entries(row.scores).map(([k, v]) => <div key={k} className="kv"><span>{t('admin.admissions_page.score_at', { stage: label(k) })}</span><b>{v}</b></div>)}
          {asked.length > 0 && <div className="kv"><span>{t('admin.admissions_page.documents')}</span><b>{asked.map((d) => `${row.docs[d] ? '✓' : '·'} ${d}`).join('  ')}</b></div>}
          {row.note && <div className="kv"><span>{t('admin.admissions_page.note')}</span><b>{row.note}</b></div>}
          {row.stage === 'enrolled' && <div className="help">{t('admin.admissions_page.enrolled_change_their_details_on')}</div>}
        </> : <>
          <div className="two">
            <Field label={t('admin.admissions_page.child_s_name')} value={f.childName} onChange={set('childName')} error={err.childName} maxLength={80} />
            <SelectField label={t('admin.admissions_page.grade_wanted')} value={f.gradeSought} onChange={set('gradeSought')} options={grades.some((g) => g.value === f.gradeSought) ? grades : [{ value: f.gradeSought, label: t('admin.admissions_page.grade_2', { gradeSought: f.gradeSought }) }, ...grades]} />
          </div>
          <Field label={t('admin.admissions_page.guardian_s_name')} value={f.guardianName} onChange={set('guardianName')} error={err.guardianName} maxLength={80} />
          <div className="two">
            <PhoneField country={country} label={t('admin.admissions_page.phone')} value={f.phone} onChange={set('phone')} error={err.phone} />
            <Field label={t('admin.admissions_page.email_optional')} type="email" value={f.email} onChange={set('email')} error={err.email} />
          </div>
          <SelectField label={t('admin.admissions_page.how_they_found_us')} value={f.source} onChange={set('source')} options={sourceOptions} />
          {row.stageOn && <div className="kv"><span>{label(row.stage)}</span><b>{dateLabel(row.stageOn)}</b></div>}
          {Object.entries(row.scores).map(([k, v]) => <div key={k} className="kv"><span>{t('admin.admissions_page.score_at', { stage: label(k) })}</span><b>{v}</b></div>)}
          {here?.scored && <Field label={t('admin.admissions_page.score_at', { stage: label(row.stage) })} value={score} onChange={(v) => { setScore(v); setErr({}); }} error={err.score} maxLength={20} hint={t('admin.admissions_page.a_mark_or_a_grade')} />}
          {asked.length > 0 && (
            <div className="fld">
              <label>{t('admin.admissions_page.documents_received')}</label>
              <div className="tgrow">{asked.map((d) => <Checkbox key={d} checked={!!docs[d]} label={d} onChange={(on) => setDocs({ ...docs, [d]: on })} />)}</div>
            </div>
          )}
          <AreaField label={t('admin.admissions_page.note')} value={f.note} onChange={set('note')} rows={3} maxLength={400} />
          {err._ && <div className="emsg" role="alert">{err._}</div>}
        </>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {!locked && (row.stage === 'declined' ? <button className="btn" onClick={() => onMove('enquiry')}>{t('admin.admissions_page.reopen')}</button> : <button className="btn dng" onClick={() => onMove('declined')}>{t('admin.admissions_page.decline')}</button>)}
          {!locked && back && <button className="btn" onClick={() => onMove(back)}>{t('admin.admissions_page.back_to_stage', { label: label(back) })}</button>}
        </span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={onClose}>{locked ? t('admin.admissions_page.close') : t('admin.admissions_page.cancel')}</button>
          {!locked && <button className="btn pri" disabled={!dirty || save.isPending} onClick={go}>{save.isPending ? t('admin.admissions_page.saving') : t('admin.admissions_page.save')}</button>}
        </span>
      </div>
    </Dialog>
  );
}
