import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, schoolToday, type HomeworkDetail, type HomeworkFile, type HomeworkRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Field, NumberField, Segmented, Select, SelectField, useShake, EmptyState, EmptyNote, t, useUnsaved } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, Attach, Avatar, dateLabel, problem, useOpenParam, useSetting } from '../../app/kit';
import { uploadFile } from '@tangent/api-client';
import { usePageTabs } from '../../app/tabs';

const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['homework', 'dashboard'].includes(String(q.queryKey[0])) });

export function HomeworkPage() {
  const { tabs } = usePageTabs('/homework');
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [classId, setClassId] = useState('');
  const [setting, setSetting] = useState(false);
  const [changing, setChanging] = useState<HomeworkDetail | null>(null);
  const [open, setOpen] = useOpenParam();
  const [subjectId, setSubjectId] = useState('');
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [mine, setMine] = useState(false);
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects, staleTime: 10 * 60_000 });
  const list = useQuery({ queryKey: ['homework', classId, subjectId], queryFn: () => app.api.homework.list({ ...(classId ? { classId } : {}), ...(subjectId ? { subjectId } : {}) }) });
  const all = list.data ?? [];
  // A teacher's own homework comes first; "Mine" shows only theirs.
  const rows = all.filter((r) => (state === 'all' || (state === 'open') === (r.dueOn >= schoolToday())) && (!mine || r.teacherId === app.user.id))
    .sort((a, b) => Number(b.teacherId === app.user.id) - Number(a.teacherId === app.user.id));
  const iSet = all.some((r) => r.teacherId === app.user.id);
  const canWrite = app.user.permissions.includes('homework.write');
  const handed = rows.reduce((a, r) => a + r.handedIn, 0);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const onTime = rows.reduce((a, r) => a + r.onTime, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const today = schoolToday();
  return (
    <Page title={t('admin.homework_page.homework')} sub={classId ? t('admin.homework_page.class', { p0: classes.data?.find((c) => c.id === classId)?.name ?? '' }) : t('admin.homework_page.what_has_been_set_and')} tabs={tabs} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      filters={<Select compact aria-label={t('admin.homework_page.class_2')} value={classId} onChange={setClassId} options={[{ value: '', label: t('admin.homework_page.all_classes') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.homework_page.class_3', { name: c.name }) }))]} />}
      actions={canWrite && <AddBtn onClick={() => setSetting(true)}>{t('admin.homework_page.set_homework')}</AddBtn>}
      overlays={<>
        {setting && <SetHomework defaultClass={classId} onClose={() => setSetting(false)} onDone={(d, failed) => { setSetting(false); refresh(qc); say(failed.length ? t('admin.homework_page.homework_set_but_could_not', { p0: failed.join(', ') }) : t('admin.homework_page.homework_set_families_are_told'), failed.length ? 'bad' : undefined); setOpen(d.id); }} />}
        {changing && <SetHomework hw={changing} defaultClass={classId} onClose={() => setChanging(null)} onDone={(_d, failed) => { setChanging(null); refresh(qc); say(failed.length ? t('admin.homework_page.saved_but_could_not_be', { p0: failed.join(', ') }) : t('admin.homework_page.homework_changed')); }} />}
        {open && !changing && <HomeworkSheet id={open} canWrite={canWrite} onChange={setChanging} onClose={() => setOpen(null)} onSaved={(m) => { refresh(qc); say(m); }} onRemoved={() => { setOpen(null); refresh(qc); say(t('admin.homework_page.homework_removed')); }} />}
      </>}>
      {all.length === 0 ? (
        <div><EmptyState scene="homework" onAction={canWrite ? () => setSetting(true) : undefined} /></div>
      ) : (
        <section className="grid">
          <div className="tile t-v s4 rise"><span className="lbl">{t('admin.homework_page.handed_in')}</span><div className="big" style={{ marginTop: 8 }}>{pct(handed)}%</div><div style={{ font: '600 13px var(--fb)', opacity: 0.8 }}>{handed} {t('admin.homework_page.of')}{' '}{total} {t('admin.homework_page.pieces_of_work')}</div></div>
          <div className="tile t-a s4 rise" style={{ '--d': '.05s' } as React.CSSProperties}><span className="lbl">{t('admin.homework_page.on_time')}</span><div className="big" style={{ marginTop: 8 }}>{pct(onTime)}%</div><div style={{ font: '600 13px var(--fb)', opacity: 0.75 }}>{t('admin.homework_page.handed_in_by_the_due')}</div></div>
          <div className="tile t-l s4 rise" style={{ '--d': '.1s' } as React.CSSProperties}><span className="lbl">{t('admin.homework_page.homework_set')}</span><div className="big" style={{ marginTop: 8 }}>{rows.length}</div><div style={{ font: '600 13px var(--fb)', color: 'var(--ink3)' }}>{rows.filter((r) => r.dueOn >= today).length} {t('admin.homework_page.still_open')}</div></div>
          <div className="card tbl s12 rise" style={{ '--d': '.14s', padding: 0 } as React.CSSProperties}>
            <div className="ch" style={{ padding: '24px 24px 12px', flexWrap: 'wrap', gap: 10 }}>
              <h2>{t('admin.homework_page.homework')}</h2><span className="chip v">{rows.length}</span>
              <span className="grow"></span>
              <Segmented label={t('admin.homework_page.open_or_closed')} value={state} onChange={setState} options={[{ value: 'open', label: t('admin.homework_page.open') }, { value: 'closed', label: t('admin.homework_page.closed') }, { value: 'all', label: t('admin.homework_page.all') }]} />
              <Select compact aria-label={t('admin.homework_page.subject')} value={subjectId} onChange={setSubjectId} options={[{ value: '', label: t('admin.homework_page.all_subjects') }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
              {iSet && <Checkbox checked={mine} onChange={setMine} label={t('admin.homework_page.only_mine')} />}
            </div>
            <div className="scroll-x lscroll" data-fill="">
              <div className="hwlw" style={{ minWidth: 640 }}>
                <div className="grd th" style={{ '--cols': COLS } as React.CSSProperties}><span>{t('admin.homework_page.homework')}</span><span>{t('admin.homework_page.class_2')}</span><span>{t('admin.homework_page.due')}</span><span>{t('admin.homework_page.handed_in')}</span><span style={{ textAlign: 'end' }}>{t('admin.homework_page.count')}</span></div>
                {rows.map((r) => <Row key={r.id} r={r} today={today} onOpen={() => setOpen(r.id)} />)}
                {rows.length === 0 && <div style={{ padding: '4px 20px 20px' }}><EmptyNote icon="filter" title={t('admin.homework_page.nothing_fits_these_filters')} body={t('admin.homework_page.try_another_class_or_status')} /></div>}
              </div>
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}

const COLS = 'minmax(0,1.7fr) 70px 90px minmax(120px,1fr) 90px';

function Row({ r, today, onOpen }: { r: HomeworkRow; today: string; onOpen: () => void }) {
  const p = r.total ? Math.round((r.handedIn / r.total) * 100) : 0;
  const overdue = r.dueOn < today && r.handedIn < r.total;
  return (
    <button className="rowbtn" onClick={onOpen} aria-label={t('admin.homework_page.open_2', { title: r.title, className: r.className })}>
      <div className="grd rw hwl" style={{ '--cols': COLS } as React.CSSProperties}>
        <span style={{ minWidth: 0 }}>
          <b data-tip={r.title} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', font: '700 14px/1.25 var(--fb)' }}>{r.title}</b>
          <small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{r.subjectName} {t('admin.homework_page.set')}{' '}{dateLabel(r.assignedOn)}{r.teacherName ? t('admin.homework_page.by', { teacherName: r.teacherName }) : ''}</small>
        </span>
        <span className="chip">{r.className}</span>
        <span className={`chip ${overdue ? 'c' : ''}`}>{t('admin.homework_page.due')}{' '}{dateLabel(r.dueOn)}</span>
        <span className="us hs" style={{ gap: 6 }}><div className="bar" style={{ height: 14 }}><i style={{ width: `${p}%` }}></i></div></span>
        <b className="num" style={{ font: '700 13px var(--fb)', textAlign: 'end' }}>{r.handedIn} / {r.total}</b>
      </div>
    </button>
  );
}

/** Sets homework, or changes it later (families are not told again for a correction). */
function SetHomework({ hw, defaultClass, onClose, onDone }: { hw?: HomeworkDetail; defaultClass: string; onClose: () => void; onDone: (d: HomeworkDetail, failed: string[]) => void }) {
  const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects, staleTime: 10 * 60_000 });
  const dueDays = useSetting<number>('homework.defaultDueDays', 2);
  const outOf = useSetting<number>('homework.defaultMarks', 20);
  const [f, setF] = useState({ classId: hw?.classId ?? defaultClass, subjectId: hw?.subjectId ?? '', title: hw?.title ?? '', description: hw?.description ?? '', dueOn: hw?.dueOn ?? addDays(schoolToday(), dueDays), maxMarks: String(hw?.maxMarks ?? outOf) });
  const [graded, setGraded] = useState(hw?.graded ?? true);
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const [files, setFiles] = useState<File[]>([]);
  const make = useMutation({
    mutationFn: async () => {
      const body = { classId: f.classId, subjectId: f.subjectId, title: f.title.trim(), description: f.description.trim(), dueOn: f.dueOn, maxMarks: Number(f.maxMarks) || outOf, graded, draft: false, fileIds: [] };
      const d = hw ? await app.api.homework.update(hw.id, body) : await app.api.homework.create(body);
      // Attached once the homework exists; one that fails is said by name, and the homework stays set.
      const failed: string[] = [];
      for (const file of files) await uploadFile(app.api, 'homework_attachment', d.id, file).catch(() => failed.push(file.name));
      return { d, failed };
    },
    onSuccess: ({ d, failed }) => onDone(d, failed), onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (!f.classId) p.classId = t('admin.homework_page.choose_a_class');
    if (!f.subjectId) p.subjectId = t('admin.homework_page.choose_a_subject');
    if (f.title.trim().length < 3) p.title = t('admin.homework_page.give_the_homework_a_title');
    if (f.dueOn < schoolToday() && f.dueOn !== hw?.dueOn) p.dueOn = t('admin.homework_page.pick_today_or_a_later');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else make.mutate();
  };
  return (
    <Dialog title={hw ? t('admin.homework_page.change', { title: hw.title }) : t('admin.homework_page.set_homework')} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          {!hw && <SelectField label={t('admin.homework_page.class_2')} value={f.classId} onChange={set('classId')} error={err.classId} options={[{ value: '', label: t('admin.homework_page.pick_a_class') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.homework_page.class_3', { name: c.name }) }))]} />}
          <SelectField label={t('admin.homework_page.subject')} value={f.subjectId} onChange={set('subjectId')} error={err.subjectId} options={[{ value: '', label: t('admin.homework_page.pick_a_subject') }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </div>
        <Field label={t('admin.homework_page.title')} value={f.title} onChange={set('title')} error={err.title} maxLength={120} placeholder={t('admin.homework_page.linear_equations_questions_1_to')} />
        <AreaField label={t('admin.homework_page.what_to_do_optional')} value={f.description} onChange={set('description')} error={err.description} maxLength={1000} rows={3} />
        <div className="two">
          <DateField label={t('admin.homework_page.due_on')} value={f.dueOn} min={schoolToday()} onChange={set('dueOn')} error={err.dueOn} />
          {graded ? <NumberField label={t('admin.homework_page.marks_out_of')} min={1} max={100} value={f.maxMarks} onChange={set('maxMarks')} error={err.maxMarks} /> : <div className="help" style={{ alignSelf: 'center' }}>{t('admin.homework_page.checked_when_handed_in_not')}</div>}
        </div>
        <Checkbox checked={graded} onChange={setGraded} label={t('admin.homework_page.marked_out_of_a_number')} />
        <Attach files={files} onChange={setFiles} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{t('admin.homework_page.cancel')}</button>
        <button className="btn pri" disabled={make.isPending} onClick={go}>{make.isPending ? t('admin.homework_page.saving') : hw ? t('admin.homework_page.save_changes') : t('admin.homework_page.set_homework')}</button>
      </div>
    </Dialog>
  );
}

interface Draft { handed: boolean; score: string; feedback: string }

function HomeworkSheet({ id, canWrite, onChange, onClose, onSaved, onRemoved }: { id: string; canWrite: boolean; onChange: (d: HomeworkDetail) => void; onClose: () => void; onSaved: (msg: string) => void; onRemoved: () => void }) {
  const app = useApp();
  const detail = useQuery({ queryKey: ['homework', 'detail', id], queryFn: () => app.api.homework.detail(id) });
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const shake = useShake();
  const d = detail.data;
  useEffect(() => { if (d) setDraft(Object.fromEntries(d.students.map((s) => [s.studentId, { handed: !!s.handedAt, score: s.score == null ? '' : String(s.score), feedback: s.feedback }]))); }, [d]);
  const save = useMutation({
    mutationFn: () => {
      const changed = d!.students.filter((s) => { const x = draft[s.studentId]; return x && (x.handed !== !!s.handedAt || x.score !== (s.score == null ? '' : String(s.score)) || x.feedback !== s.feedback); });
      return app.api.homework.mark(id, { marks: changed.map((s) => { const x = draft[s.studentId]!; return { studentId: s.studentId, handed: x.handed, score: x.score === '' ? null : Number(x.score), feedback: x.feedback }; }) });
    },
    onSuccess: (r) => { onSaved(t('admin.homework_page.saved_hand_ins_are_up')); setErr(''); setDraft(Object.fromEntries(r.students.map((s) => [s.studentId, { handed: !!s.handedAt, score: s.score == null ? '' : String(s.score), feedback: s.feedback }]))); void detail.refetch(); },
    onError: (e) => { setErr(problem(e)._ ?? t('admin.homework_page.could_not_save')); shake.hit(); },
  });
  const remove = useMutation({ mutationFn: () => app.api.homework.remove(id), onSuccess: onRemoved, onError: (e) => { setErr((e as Error).message); setConfirm(false); } });
  const dirty = d ? d.students.some((s) => { const x = draft[s.studentId]; return x && (x.handed !== !!s.handedAt || x.score !== (s.score == null ? '' : String(s.score)) || x.feedback !== s.feedback); }) : false;
  useUnsaved(dirty);
  const nothing = !dirty || save.isPending;
  return (
    <Dialog title={d ? d.title : t('admin.homework_page.homework')} tag={d ? { text: t('admin.homework_page.class_4', { subjectName: d.subjectName, className: d.className }), tone: 'v' } : undefined} onClose={onClose} width={720} shake={shake.cls}>
      {!d ? <div className="skc" style={{ height: 240, borderRadius: 16 }} /> : (
        <>
          {d.description && <p style={{ margin: '0 0 6px', font: '400 14px/1.5 var(--fb)', color: 'var(--ink2)' }}>{d.description}</p>}
          <div className="tgrow" style={{ margin: '8px 0 12px' }}>
            <span className="chip">{t('admin.homework_page.set_2')}{' '}{dateLabel(d.assignedOn)}</span><span className="chip a">{t('admin.homework_page.due')}{' '}{dateLabel(d.dueOn)}</span>{d.graded ? <span className="chip">{t('admin.homework_page.out_of')}{' '}{d.maxMarks}</span> : <span className="chip">{t('admin.homework_page.checked_not_marked')}</span>}<span className="chip g">{d.handedIn} {t('admin.homework_page.of')}{' '}{d.total} {t('admin.homework_page.handed_in_2')}</span>
            <FileChips files={d.files} />
          </div>
          <div className="lscroll" style={{ maxHeight: 'min(48dvh,420px)', border: '1px solid var(--line)', borderRadius: 16 }}>
            {d.students.map((s) => {
              const x = draft[s.studentId] ?? { handed: false, score: '', feedback: '' };
              return (
                <div key={s.studentId} className="hwr">
                  <span className="rn num">{s.rollNo || '–'}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Avatar name={s.name} size={30} /><b style={{ font: '700 14px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} data-tip={s.name}>{s.name}</b></span>
                  <Checkbox checked={x.handed} disabled={!canWrite} onChange={(handed) => setDraft({ ...draft, [s.studentId]: { ...x, handed } })} label={<span>{x.handed ? (s.onTime || !s.handedAt ? t('admin.homework_page.handed_in') : t('admin.homework_page.late')) : t('admin.homework_page.not_yet')}</span>} />
                  {d.graded ? <input className="hws" inputMode="numeric" aria-label={t('admin.homework_page.marks_for', { name: s.name })} placeholder="–" disabled={!canWrite || !x.handed} value={x.score} onChange={(e) => setDraft({ ...draft, [s.studentId]: { ...x, score: e.target.value.replace(/\D/g, '').slice(0, 3) } })} /> : <span />}
                  {(x.handed || s.files.length > 0) && (
                    <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 6 }}>
                      <FileChips files={s.files} />
                      <input className="hws" style={{ flex: '1 1 200px', width: 'auto', minWidth: 0, textAlign: 'start' }} aria-label={t('admin.homework_page.feedback_for', { name: s.name })} placeholder={t('admin.homework_page.a_word_of_feedback_the')} disabled={!canWrite} maxLength={300}
                        value={x.feedback} onChange={(e) => setDraft({ ...draft, [s.studentId]: { ...x, feedback: e.target.value } })} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {err && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {canWrite ? (confirm
              ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="help">{t('admin.homework_page.remove_this_homework')}</span><button className="btn dngf sm" onClick={() => remove.mutate()}>{t('admin.homework_page.yes_remove')}</button><button className="btn sm" onClick={() => setConfirm(false)}>{t('admin.homework_page.keep')}</button></span>
              : <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn dng" onClick={() => setConfirm(true)}>{t('admin.homework_page.remove_homework')}</button>{d && <button className="btn" onClick={() => onChange(d)}>{t('admin.homework_page.change_2')}</button>}</span>) : <span />}
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn" onClick={onClose}>{t('admin.homework_page.close')}</button>
              {canWrite && <button className="btn pri" disabled={nothing} onClick={() => save.mutate()}>{save.isPending ? t('admin.homework_page.saving') : t('admin.homework_page.save_hand_ins')}</button>}
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Files to open in a new tab: their links last a few minutes, so each is fetched on the click. */
function FileChips({ files }: { files: HomeworkFile[] }) {
  const app = useApp();
  if (!files.length) return null;
  const open = (id: string) => void app.api.files.url(id, true).then((u) => window.open(u.url, '_blank', 'noopener')).catch(() => undefined);
  return <>{files.map((f) => <button key={f.id} type="button" className="chip v" data-tip={t('admin.homework_page.open')} onClick={() => open(f.id)}>{f.name}</button>)}</>;
}
