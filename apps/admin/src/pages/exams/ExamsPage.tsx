import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, schoolToday, type ExamRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Field, Segmented, Select, SelectField, TimeField, useShake, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, Avatar, dateLabel, problem, useOpenParam, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

const TONE = { upcoming: 'n', marking: 'a', published: 'g' } as const;
const LABEL = { upcoming: t('admin.exams_page.coming_up'), marking: t('admin.exams_page.marking'), published: t('admin.exams_page.published') } as const;
const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['exams', 'students', 'dashboard'].includes(String(q.queryKey[0])) });

export function ExamsPage() {
  const { tabs } = usePageTabs('/exams');
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [classId, setClassId] = useState('');
  const [creating, setCreating] = useState(() => !!new URLSearchParams(window.location.search).get('new'));
  const [changing, setChanging] = useState<ExamRow | null>(null);
  const [open, setOpen] = useOpenParam();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const list = useQuery({ queryKey: ['exams', classId], queryFn: () => app.api.exams.list(classId || undefined) });
  const rows = list.data ?? [];
  const canWrite = app.user.permissions.includes('exams.write');
  const groups = useMemo(() => (['marking', 'upcoming', 'published'] as const).map((s) => ({ s, items: rows.filter((r) => r.status === s) })).filter((g) => g.items.length), [rows]);
  return (
    <Page title={t('admin.exams_page.exams')} sub={t('admin.exams_page.schedules_marks_and_results')} tabs={tabs} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      filters={<Select compact aria-label={t('admin.exams_page.class')} value={classId} onChange={setClassId} options={[{ value: '', label: t('admin.exams_page.all_classes') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.exams_page.class_2', { name: c.name }) }))]} />}
      actions={canWrite && <AddBtn onClick={() => setCreating(true)}>{t('admin.exams_page.new_exam')}</AddBtn>}
      overlays={<>
        {creating && <ExamDialog defaultClass={classId} onClose={() => setCreating(false)} onDone={(e) => { setCreating(false); refresh(qc); say(t('admin.exams_page.exam_added_to_the_schedule')); setOpen(e.id); }} />}
        {changing && <ExamDialog exam={changing} defaultClass={classId} onClose={() => setChanging(null)} onDone={() => { setChanging(null); refresh(qc); say(t('admin.exams_page.exam_changed_the_timetable_in')); }} />}
        {open && !changing && <ExamSheet id={open} onClose={() => setOpen(null)} onChange={(e) => setChanging(e)} onChanged={(m) => { refresh(qc); if (m) say(m); }} onRemoved={() => { setOpen(null); refresh(qc); say(t('admin.exams_page.exam_removed')); }} />}
      </>}>
      {rows.length === 0 ? (
        <div><EmptyState scene="exams" onAction={canWrite ? () => setCreating(true) : undefined} /></div>
      ) : (
        <div className="exb">
          {groups.map((g) => (
            <section className="exbs rise" key={g.s}>
              <div className="ch"><h2>{LABEL[g.s]}</h2><span className={`chip ${g.s === 'published' ? 'g' : g.s === 'marking' ? 'a' : ''}`}>{g.items.length}</span></div>
              <div className="exg">
                {g.items.map((e) => <ExamCard key={e.id} e={e} onOpen={() => setOpen(e.id)} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

function ExamCard({ e, onOpen }: { e: ExamRow; onOpen: () => void }) {
  const p = e.expected ? Math.round((e.entered / e.expected) * 100) : 0;
  return (
    <button className="exc" onClick={onOpen} aria-label={t('admin.exams_page.open_class', { name: e.name, className: e.className })}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="chip v">{t('admin.exams_page.class')}{' '}{e.className}</span><span className={`st ${TONE[e.status]}`}><i></i>{LABEL[e.status]}</span></span>
      <b className="fd" style={{ fontSize: 17, letterSpacing: '-.02em', lineHeight: 1.2 }}>{e.name}</b>
      <small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{dateLabel(e.startsOn)}{e.endsOn !== e.startsOn ? t('admin.exams_page.to', { dateLabel: dateLabel(e.endsOn) }) : ''} · {e.subjects.length} {t('admin.exams_page.subjects')}</small>
      <span className="us" style={{ gap: 6, marginTop: 4 }}>
        <span className="r"><span>{t('admin.exams_page.marks_entered')}</span><b>{e.entered} {t('admin.exams_page.of')}{' '}{e.expected}</b></span>
        <span className="bar" style={{ height: 14 }}><i style={{ width: `${p}%` }}></i></span>
      </span>
    </button>
  );
}

type Paper = { on: string; from: string; to: string; room: string; max: string };

/** One form to add an exam or change it while its results are not out: each paper with its day, time, room and marks. */
function ExamDialog({ exam, defaultClass, onClose, onDone }: { exam?: ExamRow; defaultClass: string; onClose: () => void; onDone: (e: ExamRow) => void }) {
  const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects, staleTime: 10 * 60_000 });
  const lead = useSetting<number>('exams.leadDays', 7);
  const outOf = useSetting<number>('exams.defaultMaxMarks', 100);
  const [f, setF] = useState({ name: exam?.name ?? '', classId: exam?.classId ?? defaultClass, startsOn: exam?.startsOn ?? addDays(schoolToday(), lead), endsOn: exam?.endsOn ?? addDays(schoolToday(), lead + 4) });
  const [also, setAlso] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, Paper>>(() => Object.fromEntries((exam?.subjects ?? []).map((s) => [s.subjectId, { on: s.onDate ?? '', from: s.startsAt ?? '', to: s.endsAt ?? '', room: s.room, max: String(s.maxMarks) }])));
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), classId: f.classId, alsoClassIds: exam ? [] : also.filter((c) => c !== f.classId), startsOn: f.startsOn, endsOn: f.endsOn,
        subjects: Object.entries(picked).map(([subjectId, v]) => ({ subjectId, onDate: v.on || null, startsAt: v.from || null, endsAt: v.to || null, room: v.room.trim(), maxMarks: Number(v.max) || outOf })) };
      return exam ? app.api.exams.update(exam.id, body) : app.api.exams.create(body);
    },
    onSuccess: onDone, onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.name.trim().length < 3) p.name = t('admin.exams_page.name_the_exam');
    if (!f.classId) p.classId = t('admin.exams_page.choose_a_class');
    if (f.endsOn < f.startsOn) p.endsOn = t('admin.exams_page.pick_a_day_on_or');
    if (!Object.keys(picked).length) p.subjects = t('admin.exams_page.pick_at_least_one_subject');
    if (Object.values(picked).some((v) => v.from && v.to && v.to <= v.from)) p.subjects = t('admin.exams_page.a_paper_must_end_after');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate();
  };
  const toggle = (id: string) => { setErr({ ...err, subjects: '' }); setPicked((x) => { const n = { ...x }; if (n[id]) delete n[id]; else n[id] = { on: f.startsOn, from: '', to: '', room: '', max: String(outOf) }; return n; }); };
  const put = (id: string, patch: Partial<Paper>) => setPicked((x) => ({ ...x, [id]: { ...x[id]!, ...patch } }));
  return (
    <Dialog title={exam ? t('admin.exams_page.change', { name: exam.name }) : t('admin.exams_page.new_exam')} onClose={onClose} width={760} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.exams_page.name')} value={f.name} onChange={(name) => { setF({ ...f, name }); setErr({ ...err, name: '' }); }} error={err.name} placeholder={t('admin.exams_page.mid_term_exams')} maxLength={80} />
        {!exam && <SelectField label={t('admin.exams_page.class')} value={f.classId} onChange={(classId) => { setF({ ...f, classId }); setErr({ ...err, classId: '' }); }} error={err.classId} options={[{ value: '', label: t('admin.exams_page.pick_a_class') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.exams_page.class_2', { name: c.name }) }))]} />}
        {!exam && f.classId && (classes.data?.length ?? 0) > 1 && (
          <div className="fld">
            <label>{t('admin.exams_page.also_for_these_classes_the')}</label>
            <div className="tgrow">
              {(classes.data ?? []).filter((c) => c.id !== f.classId).map((c) => <Checkbox key={c.id} checked={also.includes(c.id)} onChange={(on) => setAlso(on ? [...also, c.id] : also.filter((x) => x !== c.id))} label={c.name} />)}
            </div>
          </div>
        )}
        <div className="two">
          <DateField label={t('admin.exams_page.first_day')} value={f.startsOn} onChange={(startsOn) => setF({ ...f, startsOn })} />
          <DateField label={t('admin.exams_page.last_day')} value={f.endsOn} min={f.startsOn} onChange={(endsOn) => { setF({ ...f, endsOn }); setErr({ ...err, endsOn: '' }); }} error={err.endsOn} />
        </div>
        <div className="fld">
          <label>{t('admin.exams_page.papers')}</label>
          <div className="help" style={{ marginTop: 0 }}>{t('admin.exams_page.each_paper_s_day_time')}</div>
          <div className="exs">
            {(subjects.data ?? []).map((s) => {
              const on = picked[s.id];
              return (
                <div key={s.id} className={`exr ${on ? 'on' : ''}`} style={{ flexWrap: 'wrap' }}>
                  <Checkbox checked={!!on} onChange={() => toggle(s.id)} label={<span>{s.name}</span>} />
                  {on && <>
                    <DateField compact label={t('admin.exams_page.date', { name: s.name })} value={on.on} min={f.startsOn} max={f.endsOn} onChange={(v) => put(s.id, { on: v })} />
                    <TimeField label={t('admin.exams_page.starts', { name: s.name })} value={on.from} onChange={(v) => put(s.id, { from: v })} />
                    <TimeField label={t('admin.exams_page.ends', { name: s.name })} value={on.to} onChange={(v) => put(s.id, { to: v })} />
                    <Field label={t('admin.exams_page.room', { name: s.name })} value={on.room} onChange={(v) => put(s.id, { room: v })} placeholder={t('admin.exams_page.hall_a')} maxLength={40} />
                    <input className="hws" inputMode="numeric" aria-label={t('admin.exams_page.marks_out_of', { name: s.name })} value={on.max} onChange={(e) => put(s.id, { max: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                    <small>{t('admin.exams_page.marks')}</small>
                  </>}
                </div>
              );
            })}
          </div>
          {err.subjects && <div className="emsg" role="alert">{err.subjects}</div>}
        </div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>{t('admin.exams_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending} onClick={go}>{save.isPending ? t('admin.exams_page.saving') : exam ? t('admin.exams_page.save_changes') : t('admin.exams_page.add_exam')}</button>
      </div>
    </Dialog>
  );
}

type Cell = { score: string; absent: boolean };

function ExamSheet({ id, onClose, onChange, onChanged, onRemoved }: { id: string; onClose: () => void; onChange: (e: ExamRow) => void; onChanged: (msg?: string) => void; onRemoved: () => void }) {
  const app = useApp();
  const [tab, setTab] = useState<'marks' | 'results'>('marks');
  const marks = useQuery({ queryKey: ['exams', 'marks', id], queryFn: () => app.api.exams.marks(id) });
  const results = useQuery({ queryKey: ['exams', 'results', id], queryFn: () => app.api.exams.results(id), enabled: tab === 'results' });
  const [draft, setDraft] = useState<Record<string, Cell>>({});
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<'publish' | 'remove' | 'reopen' | null>(null);
  const [note, setNote] = useState('');
  const pass = useSetting<number>('grading.passPct', 33);
  const shake = useShake();
  const grid = useRef<HTMLDivElement>(null);
  const m = marks.data;
  const canWrite = app.user.permissions.includes('exams.write');
  const canPublish = app.user.permissions.includes('exams.publish');
  const key = (stu: string, sub: string) => `${stu}|${sub}`;
  const saved = (stu: string, sub: string): Cell => { const x = m?.students.find((s) => s.studentId === stu)?.marks[sub]; return { score: x?.score == null ? '' : String(x.score), absent: !!x?.absent }; };
  const cell = (stu: string, sub: string): Cell => draft[key(stu, sub)] ?? saved(stu, sub);
  useEffect(() => { setDraft({}); }, [m]);
  const dirty = Object.keys(draft).filter((k) => { const [a, b] = k.split('|') as [string, string]; const s = saved(a, b); const d = draft[k]!; return s.score !== d.score || s.absent !== d.absent; });
  const save = useMutation({
    mutationFn: () => app.api.exams.putMarks(id, { marks: dirty.map((k) => { const [studentId, subjectId] = k.split('|') as [string, string]; const d = draft[k]!; return { studentId, subjectId, score: d.absent || d.score === '' ? null : Number(d.score), absent: d.absent }; }) }),
    onSuccess: () => { setErr(''); void marks.refetch(); void results.refetch(); onChanged(t('admin.exams_page.marks_saved')); },
    onError: (e) => { setErr(problem(e)._ ?? t('admin.exams_page.could_not_save')); shake.hit(); },
  });
  const publish = useMutation({
    mutationFn: () => app.api.exams.publish(id),
    onSuccess: (r) => { setConfirm(null); void marks.refetch(); void results.refetch(); onChanged(t('admin.exams_page.results_published_told', { families: r.families, p1: r.families === 1 ? 'family is' : 'families are' })); },
    onError: (e) => { setConfirm(null); setErr((e as Error).message); shake.hit(); },
  });
  const remove = useMutation({ mutationFn: () => app.api.exams.remove(id), onSuccess: onRemoved, onError: (e) => { setConfirm(null); setErr((e as Error).message); shake.hit(); } });
  const reopen = useMutation({
    mutationFn: () => app.api.exams.reopen(id, note.trim()),
    onSuccess: () => { setConfirm(null); setNote(''); void marks.refetch(); onChanged(t('admin.exams_page.results_reopened_marks_can_be')); },
    onError: (e) => { setErr(problem(e).note ?? (e as Error).message); shake.hit(); },
  });
  // Enter moves down the column, like a spreadsheet.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const col = e.currentTarget.dataset.col;
    const next = [...(grid.current?.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]:not(:disabled)`) ?? [])];
    next[next.indexOf(e.currentTarget) + 1]?.focus();
  };
  const ex = m?.exam;
  // Published results are locked: they are reopened (with why) before any mark changes.
  const editable = canWrite && ex?.status !== 'published';
  return (
    <Dialog title={ex ? ex.name : t('admin.exams_page.exam')} tag={ex ? { text: t('admin.exams_page.class_3', { className: ex.className, p1: LABEL[ex.status] }), tone: ex.status === 'published' ? 'g' : 'v' } : undefined} onClose={onClose} width={860} shake={shake.cls}>
      {!m || !ex ? <div className="skc" style={{ height: 280, borderRadius: 16 }} /> : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
            <Segmented value={tab} onChange={setTab} label={t('admin.exams_page.exam_view')} options={[{ value: 'marks', label: t('admin.exams_page.marks_2') }, { value: 'results', label: t('admin.exams_page.results') }]} />
            <span className="chip">{ex.entered} {t('admin.exams_page.of')}{' '}{ex.expected} {t('admin.exams_page.marks_entered_2')}</span>
          </div>
          {tab === 'marks' ? (
            <div className="lscroll" ref={grid} style={{ maxHeight: 'min(50dvh,440px)', border: '1px solid var(--line)', borderRadius: 16 }}>
              <div style={{ minWidth: 120 + ex.subjects.length * 96 + 220 }}>
                <div className="mkh" style={{ '--n': ex.subjects.length } as React.CSSProperties}>
                  <span>{t('admin.exams_page.roll')}</span><span>{t('admin.exams_page.student')}</span>
                  {ex.subjects.map((s) => <span key={s.subjectId} data-tip={t('admin.exams_page.out_of', { name: s.name, maxMarks: s.maxMarks })} style={{ textAlign: 'center' }}>{s.name}<small>/ {s.maxMarks}</small></span>)}
                </div>
                {m.students.map((s) => (
                  <div className="mkr" key={s.studentId} style={{ '--n': ex.subjects.length } as React.CSSProperties}>
                    <span className="rn num">{s.rollNo || '–'}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><Avatar name={s.name} size={26} /><b data-tip={s.name} style={{ font: '700 13px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.name}</b></span>
                    {ex.subjects.map((sub) => {
                      const c = cell(s.studentId, sub.subjectId);
                      const over = c.score !== '' && Number(c.score) > sub.maxMarks;
                      return (
                        <span key={sub.subjectId} className="mkc">
                          <input data-col={sub.subjectId} inputMode="decimal" aria-label={`${s.name}, ${sub.name}`} className={`hws ${over ? 'bad' : ''}`} disabled={!editable || c.absent} placeholder={c.absent ? t('admin.exams_page.abs') : '–'} value={c.score}
                            onKeyDown={onKey} onChange={(e) => setDraft({ ...draft, [key(s.studentId, sub.subjectId)]: { score: e.target.value.replace(/[^\d.]/g, '').slice(0, 5), absent: false } })} />
                          {editable && <button type="button" className={`abs ${c.absent ? 'on' : ''}`} data-tip={c.absent ? t('admin.exams_page.marked_absent_click_to_undo') : t('admin.exams_page.mark_absent')} aria-label={t('admin.exams_page.absent', { name: s.name, name1: sub.name })} aria-pressed={c.absent}
                            onClick={() => setDraft({ ...draft, [key(s.studentId, sub.subjectId)]: { score: '', absent: !c.absent } })}>A</button>}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            !results.data ? <div className="skc" style={{ height: 240, borderRadius: 16 }} /> : results.data.rows.length === 0 ? <div className="help" style={{ padding: 16 }}>{t('admin.exams_page.results_appear_here_as_marks')}</div> : (
              <>
                <div className="tgrow" style={{ marginBottom: 10 }}><span className="chip v">{t('admin.exams_page.average')}{' '}{results.data.average}%</span><span className="chip g">{results.data.passPct}{t('admin.exams_page.passed')}</span><span className="chip">{results.data.rows.length} {t('admin.exams_page.students')}</span></div>
                <div className="lscroll" style={{ maxHeight: 'min(46dvh,400px)', border: '1px solid var(--line)', borderRadius: 16 }}>
                  <div style={{ minWidth: 520 }}>
                    {results.data.rows.map((r) => (
                      <div className="grd rw" key={r.studentId} style={{ '--cols': '44px minmax(0,1.6fr) 90px 70px 60px' } as React.CSSProperties}>
                        <b className="num" style={{ font: '700 14px var(--fb)', color: r.rank <= 3 ? 'var(--brand)' : 'var(--ink3)' }}>#{r.rank}</b>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Avatar name={r.name} size={28} /><b data-tip={r.name} style={{ font: '700 14px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.name}</b></span>
                        <span className="num" style={{ font: '600 13px var(--fb)' }}>{r.total} / {r.max}</span>
                        <b className="num" style={{ font: '700 14px var(--fb)' }}>{r.pct}%</b>
                        <span className={`chip ${r.pct >= pass ? 'g' : 'c'}`}>{r.grade}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )
          )}
          {err && <div className="emsg" role="alert" style={{ marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {editable ? (confirm === 'remove'
              ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="help">{t('admin.exams_page.remove_this_exam_and_its')}</span><button className="btn dngf sm" onClick={() => remove.mutate()}>{t('admin.exams_page.yes_remove')}</button><button className="btn sm" onClick={() => setConfirm(null)}>{t('admin.exams_page.keep')}</button></span>
              : <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn dng" onClick={() => setConfirm('remove')}>{t('admin.exams_page.remove_exam')}</button><button className="btn" onClick={() => onChange(ex)}>{t('admin.exams_page.change_exam')}</button></span>)
              : canPublish && ex.status === 'published' ? (confirm === 'reopen'
                ? <span style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}><div style={{ minWidth: 260 }}><Field label={t('admin.exams_page.what_is_being_corrected_families')} value={note} onChange={setNote} maxLength={200} placeholder={t('admin.exams_page.science_marks_for_8_a')} /></div>
                  <button className="btn sm pri" disabled={note.trim().length < 5 || reopen.isPending} onClick={() => reopen.mutate()}>{t('admin.exams_page.reopen')}</button><button className="btn sm" onClick={() => setConfirm(null)}>{t('admin.exams_page.keep_locked')}</button></span>
                : <button className="btn" onClick={() => setConfirm('reopen')}>{t('admin.exams_page.reopen_to_correct')}</button>) : <span />}
            <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {confirm === 'publish' && <span className="help">{t('admin.exams_page.families_will_see_these_results')}</span>}
              <button className="btn" onClick={onClose}>{t('admin.exams_page.close')}</button>
              {editable && <button className="btn" disabled={!dirty.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('admin.exams_page.saving') : dirty.length ? t('admin.exams_page.save', { length: dirty.length, p1: dirty.length === 1 ? 'mark' : 'marks' }) : t('admin.exams_page.save_marks')}</button>}
              {canPublish && ex.status !== 'published' && (confirm === 'publish'
                ? <button className="btn pri" disabled={publish.isPending || dirty.length > 0} onClick={() => publish.mutate()}>{publish.isPending ? t('admin.exams_page.publishing') : t('admin.exams_page.yes_publish')}</button>
                : <button className="btn pri" disabled={dirty.length > 0} data-tip={dirty.length ? t('admin.exams_page.save_the_marks_first') : undefined} onClick={() => setConfirm('publish')}>{ex.reopenedNote ? t('admin.exams_page.publish_the_correction') : t('admin.exams_page.publish_results')}</button>)}
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}
