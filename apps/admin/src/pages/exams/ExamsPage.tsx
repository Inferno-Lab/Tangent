import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, listLabel, listOptions, schoolToday, type ExamRow, type ListItem } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Field, NumberField, Segmented, Select, SelectField, TimeField, currentLanguage, useShake, useMore, EmptyState, t, EmptyNote, useUnsaved, Skeleton } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, Avatar, dateLabel, problem, useOpenParam, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

const TONE = { upcoming: 'n', marking: 'a', published: 'g' } as const;
const LABEL = { upcoming: t('admin.exams_page.coming_up'), marking: t('admin.exams_page.marking'), published: t('admin.exams_page.published') } as const;
const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['exams', 'students', 'dashboard'].includes(String(q.queryKey[0])) });

export function ExamsPage() { const { tabs } = usePageTabs('/exams');
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
          {groups.map((g) => <ExamGroup key={g.s} s={g.s} items={g.items} onOpen={setOpen} />)}
        </div>
      )}
    </Page>
  );
}

// A group shows a dozen exams at a time, so a full term's results do not run the page on for screens.
function ExamGroup({ s, items, onOpen }: { s: 'marking' | 'upcoming' | 'published'; items: ExamRow[]; onOpen: (id: string) => void }) {
  const [shown, more] = useMore(items, 12);
  return (
    <section className="exbs rise">
      <div className="ch"><h2>{LABEL[s]}</h2><span className={`chip ${s === 'published' ? 'g' : s === 'marking' ? 'a' : ''}`}>{items.length}</span></div>
      <div className="exg">
        {shown.map((e) => <ExamCard key={e.id} e={e} onOpen={() => onOpen(e.id)} />)}
      </div>
      {more}
    </section>
  );
}

function ExamCard({ e, onOpen }: { e: ExamRow; onOpen: () => void }) { const p = e.expected ? Math.round((e.entered / e.expected) * 100) : 0;
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

type Paper = { on: string; from: string; to: string; room: string; max: string; invigilator: string };

/** One form to add an exam or change it while its results are not out: each paper with its day, time, room and marks. */
function ExamDialog({ exam, defaultClass, onClose, onDone }: { exam?: ExamRow; defaultClass: string; onClose: () => void; onDone: (e: ExamRow) => void }) { const app = useApp();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: app.api.subjects, staleTime: 10 * 60_000 });
  const lead = useSetting<number>('exams.leadDays', 7);
  const outOf = useSetting<number>('exams.defaultMaxMarks', 100);
  const types = useSetting<ListItem[]>('exams.types', []);
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const [f, setF] = useState({ name: exam?.name ?? '', kind: exam?.kind ?? '', classId: exam?.classId ?? defaultClass, startsOn: exam?.startsOn ?? addDays(schoolToday(), lead), endsOn: exam?.endsOn ?? addDays(schoolToday(), lead + 4) });
  const [also, setAlso] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, Paper>>(() => Object.fromEntries((exam?.subjects ?? []).map((s) => [s.subjectId, { on: s.onDate ?? '', from: s.startsAt ?? '', to: s.endsAt ?? '', room: s.room, max: String(s.maxMarks), invigilator: s.invigilatorId ?? '' }])));
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const save = useMutation({ mutationFn: () => { const body = { name: f.name.trim(), kind: f.kind, classId: f.classId, alsoClassIds: exam ? [] : also.filter((c) => c !== f.classId), startsOn: f.startsOn, endsOn: f.endsOn,
        subjects: Object.entries(picked).map(([subjectId, v]) => ({ subjectId, onDate: v.on || null, startsAt: v.from || null, endsAt: v.to || null, room: v.room.trim(), maxMarks: Number(v.max) || outOf, invigilatorId: v.invigilator || null })) };
      return exam ? app.api.exams.update(exam.id, body) : app.api.exams.create(body);
    },
    onSuccess: onDone, onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const go = () => { const p: Record<string, string> = {};
    if (f.name.trim().length < 3) p.name = t('admin.exams_page.name_the_exam');
    if (!f.classId) p.classId = t('admin.exams_page.choose_a_class');
    if (f.endsOn < f.startsOn) p.endsOn = t('admin.exams_page.pick_a_day_on_or');
    if (!Object.keys(picked).length) p.subjects = t('admin.exams_page.pick_at_least_one_subject');
    if (Object.values(picked).some((v) => v.from && v.to && v.to <= v.from)) p.subjects = t('admin.exams_page.a_paper_must_end_after');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate();
  };
  const toggle = (id: string) => { setErr({ ...err, subjects: '' }); setPicked((x) => { const n = { ...x }; if (n[id]) delete n[id]; else n[id] = { on: f.startsOn, from: '', to: '', room: '', max: String(outOf), invigilator: '' }; return n; }); };
  const put = (id: string, patch: Partial<Paper>) => setPicked((x) => ({ ...x, [id]: { ...x[id]!, ...patch } }));
  return (
    <Dialog title={exam ? t('admin.exams_page.change', { name: exam.name }) : t('admin.exams_page.new_exam')} onClose={onClose} width={760} shake={shake.cls}>
      <div className="stack">
        <div className="two">
          <Field label={t('admin.exams_page.name')} value={f.name} onChange={(name) => { setF({ ...f, name }); setErr({ ...err, name: '' }); }} error={err.name} placeholder={t('admin.exams_page.mid_term_exams')} maxLength={80} />
          <SelectField label={t('admin.exams_page.kind_of_exam')} value={f.kind} onChange={(kind) => { setF({ ...f, kind }); setErr({ ...err, kind: '' }); }} error={err.kind}
            options={[{ value: '', label: t('admin.exams_page.no_kind') }, ...listOptions(types, f.kind).map((i) => ({ value: i.key, label: listLabel(types, i.key, currentLanguage()) }))]} />
        </div>
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
            {(subjects.data ?? []).map((s) => { const on = picked[s.id];
              return (
                <div key={s.id} className={`exr ${on ? 'on' : ''}`} style={{ flexWrap: 'wrap' }}>
                  <Checkbox checked={!!on} onChange={() => toggle(s.id)} label={<span>{s.name}</span>} />
                  {on && <>
                    <DateField compact label={t('admin.exams_page.date', { name: s.name })} value={on.on} min={f.startsOn} max={f.endsOn} onChange={(v) => put(s.id, { on: v })} />
                    <TimeField label={t('admin.exams_page.starts', { name: s.name })} value={on.from} onChange={(v) => put(s.id, { from: v })} />
                    <TimeField label={t('admin.exams_page.ends', { name: s.name })} value={on.to} onChange={(v) => put(s.id, { to: v })} />
                    <Field label={t('admin.exams_page.room', { name: s.name })} value={on.room} onChange={(v) => put(s.id, { room: v })} placeholder={t('admin.exams_page.hall_a')} maxLength={40} />
                    <Select compact aria-label={t('admin.exams_page.invigilator', { name: s.name })} value={on.invigilator} onChange={(v) => put(s.id, { invigilator: v })}
                      options={[{ value: '', label: t('admin.exams_page.no_invigilator') }, ...(staff.data ?? []).filter((x) => x.status === 'active' || x.id === on.invigilator).map((x) => ({ value: x.id, label: x.name }))]} />
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

type Cell = { score: string; absent: boolean; grade: string; criteria?: Record<string, string> };
const levels = (c?: Record<string, string> | null) => JSON.stringify(Object.entries(c ?? {}).filter(([, v]) => v !== '').sort());

function ExamSheet({ id, onClose, onChange, onChanged, onRemoved }: { id: string; onClose: () => void; onChange: (e: ExamRow) => void; onChanged: (msg?: string) => void; onRemoved: () => void }) { const app = useApp();
  const [tab, setTab] = useState<'marks' | 'results' | 'remarks'>('marks');
  const bank = useSetting<ListItem[]>('exams.remarks', []);
  const [said, setSaid] = useState<Record<string, string>>({});
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
  const saved = (stu: string, sub: string): Cell => { const x = m?.students.find((s) => s.studentId === stu)?.marks[sub];
    return { score: x?.score == null ? '' : String(x.score), absent: !!x?.absent, grade: x?.grade ?? '', criteria: x?.criteria ? Object.fromEntries(Object.entries(x.criteria).map(([k, v]) => [k, String(v)])) : undefined }; };
  const [levelsFor, setLevelsFor] = useState<{ stu: string; name: string; sub: string } | null>(null);
  const cell = (stu: string, sub: string): Cell => draft[key(stu, sub)] ?? saved(stu, sub);
  useEffect(() => { setDraft({}); setSaid({}); }, [m]);
  const remarkOf = (stu: string) => said[stu] ?? m?.students.find((s) => s.studentId === stu)?.remark ?? '';
  const remarksDirty = Object.keys(said).filter((k) => said[k]!.trim() !== (m?.students.find((s) => s.studentId === k)?.remark ?? ''));
  const saveRemarks = useMutation({ mutationFn: () => app.api.exams.putRemarks(id, { remarks: remarksDirty.map((studentId) => ({ studentId, remark: said[studentId]!.trim() })) }),
    onSuccess: () => { setErr(''); void marks.refetch(); onChanged(t('admin.exams_page.remarks_saved')); },
    onError: (e) => { setErr(problem(e)._ ?? t('admin.exams_page.could_not_save')); shake.hit(); } });
  const dirty = Object.keys(draft).filter((k) => { const [a, b] = k.split('|') as [string, string]; const s = saved(a, b); const d = draft[k]!; return s.score !== d.score || s.absent !== d.absent || s.grade !== d.grade || levels(s.criteria) !== levels(d.criteria); });
  useUnsaved(dirty.length > 0);
  const save = useMutation({ mutationFn: () => app.api.exams.putMarks(id, { marks: dirty.map((k) => { const [studentId, subjectId] = k.split('|') as [string, string]; const d = draft[k]!; return { studentId, subjectId, score: d.absent || d.criteria || d.score === '' ? null : Number(d.score), absent: d.absent, grade: d.absent || !d.grade ? undefined : d.grade,
      // A rubric's levels: the server works the score out from them; none given clears the mark.
      ...(d.criteria && !d.absent && Object.values(d.criteria).some((v) => v !== '') ? { criteria: Object.fromEntries(Object.entries(d.criteria).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) } : {}) }; }) }),
    onSuccess: () => { setErr(''); void marks.refetch(); void results.refetch(); onChanged(t('admin.exams_page.marks_saved')); },
    onError: (e) => { setErr(problem(e)._ ?? t('admin.exams_page.could_not_save')); shake.hit(); } });
  const publish = useMutation({ mutationFn: () => app.api.exams.publish(id),
    onSuccess: (r) => { setConfirm(null); void marks.refetch(); void results.refetch(); onChanged(t('admin.exams_page.results_published_told', { families: r.families })); },
    onError: (e) => { setConfirm(null); setErr((e as Error).message); shake.hit(); } });
  const remove = useMutation({ mutationFn: () => app.api.exams.remove(id), onSuccess: onRemoved, onError: (e) => { setConfirm(null); setErr((e as Error).message); shake.hit(); } });
  const reopen = useMutation({ mutationFn: () => app.api.exams.reopen(id, note.trim()),
    onSuccess: () => { setConfirm(null); setNote(''); void marks.refetch(); onChanged(t('admin.exams_page.results_reopened_marks_can_be')); },
    onError: (e) => { setErr(problem(e).note ?? (e as Error).message); shake.hit(); } });
  // Enter moves down the column, like a spreadsheet.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key !== 'Enter') return;
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
      {levelsFor && ex && (() => {
        const sub = ex.subjects.find((x) => x.subjectId === levelsFor.sub)!;
        const c = cell(levelsFor.stu, sub.subjectId);
        const put = (k: string, v: string) => setDraft({ ...draft, [key(levelsFor.stu, sub.subjectId)]: { ...c, absent: false, grade: '', criteria: { ...(c.criteria ?? {}), [k]: v } } });
        const total = sub.criteria.reduce((a, cr) => a + (Number(c.criteria?.[cr.key]) || 0), 0);
        const most = sub.criteria.reduce((a, cr) => a + cr.max, 0);
        return (
          <Dialog title={t('admin.exams_page.levels_for', { name: levelsFor.name, subject: sub.name })} onClose={() => setLevelsFor(null)} width={460}>
            <div className="stack">
              {sub.criteria.map((cr) => <NumberField key={cr.key} label={t('admin.exams_page.criterion_up_to', { name: cr.name, max: cr.max })} min={0} max={cr.max} value={c.criteria?.[cr.key] ?? ''} onChange={(v) => put(cr.key, v)} />)}
              <p className="help" style={{ margin: 0 }}>{t('admin.exams_page.levels_total', { total, most, max: sub.maxMarks })}</p>
              <div className="tgrow" style={{ justifyContent: 'flex-end' }}><button className="btn pri" onClick={() => setLevelsFor(null)}>{t('admin.exams_page.done')}</button></div>
            </div>
          </Dialog>
        );
      })()}
      {!m || !ex ? <Skeleton kind="table" rows={6} /> : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
            <Segmented value={tab} onChange={setTab} label={t('admin.exams_page.exam_view')} options={[{ value: 'marks', label: t('admin.exams_page.marks_2') }, { value: 'results', label: t('admin.exams_page.results') }, { value: 'remarks', label: t('admin.exams_page.remarks') }]} />
            <span className="chip">{ex.entered} {t('admin.exams_page.of')}{' '}{ex.expected} {t('admin.exams_page.marks_entered_2')}</span>
          </div>
          {tab === 'marks' ? (
            <div className="lscroll" ref={grid} style={{ maxHeight: 'min(50dvh,440px)', border: '1px solid var(--line)', borderRadius: 16 }}>
              <div style={{ minWidth: 120 + ex.subjects.length * 96 + 220 }}>
                <div className="mkh" style={{ '--n': ex.subjects.length } as React.CSSProperties}>
                  <span>{t('admin.exams_page.roll')}</span><span>{t('admin.exams_page.student')}</span>
                  {ex.subjects.map((s) => <span key={s.subjectId} data-tip={s.grades.length ? t('admin.exams_page.graded', { name: s.name }) : t('admin.exams_page.out_of', { name: s.name, maxMarks: s.maxMarks })} style={{ textAlign: 'center' }}>{s.name}<small>{s.grades.length ? t('admin.exams_page.grade_word') : `/ ${s.maxMarks}`}</small></span>)}
                </div>
                {m.students.map((s) => (
                  <div className="mkr" key={s.studentId} style={{ '--n': ex.subjects.length } as React.CSSProperties}>
                    <span className="rn num">{s.rollNo || '–'}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><Avatar name={s.name} size={26} /><b data-tip={s.name} style={{ font: '700 13px var(--fb)', overflowWrap: 'anywhere' }}>{s.name}</b></span>
                    {ex.subjects.map((sub) => { const c = cell(s.studentId, sub.subjectId);
                      const over = c.score !== '' && Number(c.score) > sub.maxMarks;
                      return (
                        <span key={sub.subjectId} className="mkc">
                          {sub.criteria.length ? (
                            <button type="button" className="hws" style={{ cursor: editable && !c.absent ? 'pointer' : 'default' }} disabled={!editable || c.absent} aria-label={t('admin.exams_page.levels_for', { name: s.name, subject: sub.name })}
                              onClick={() => setLevelsFor({ stu: s.studentId, name: s.name, sub: sub.subjectId })}>{c.absent ? t('admin.exams_page.abs') : c.criteria && Object.values(c.criteria).some((v) => v !== '') && levels(c.criteria) !== levels(saved(s.studentId, sub.subjectId).criteria) ? '…' : c.score || '–'}</button>
                          ) : sub.grades.length ? (
                            <Select compact aria-label={`${s.name}, ${sub.name}`} value={c.absent ? '' : c.grade} disabled={!editable || c.absent}
                              onChange={(grade) => setDraft({ ...draft, [key(s.studentId, sub.subjectId)]: { score: '', absent: false, grade } })}
                              options={[{ value: '', label: c.absent ? t('admin.exams_page.abs') : '–' }, ...sub.grades.map((g) => ({ value: g, label: g }))]} />
                          ) : (
                          <input data-col={sub.subjectId} inputMode="decimal" aria-label={`${s.name}, ${sub.name}`} className={`hws ${over ? 'bad' : ''}`} disabled={!editable || c.absent} placeholder={c.absent ? t('admin.exams_page.abs') : '–'} value={c.score}
                            onKeyDown={onKey} onChange={(e) => setDraft({ ...draft, [key(s.studentId, sub.subjectId)]: { score: e.target.value.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 5), absent: false, grade: '' } })} />
                          )}
                          {editable && <button type="button" className={`abs ${c.absent ? 'on' : ''}`} data-tip={c.absent ? t('admin.exams_page.marked_absent_click_to_undo') : t('admin.exams_page.mark_absent')} aria-label={t('admin.exams_page.absent', { name: s.name, name1: sub.name })} aria-pressed={c.absent}
                            onClick={() => setDraft({ ...draft, [key(s.studentId, sub.subjectId)]: { score: '', absent: !c.absent, grade: '' } })}>A</button>}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : tab === 'remarks' ? (
            <div className="lscroll" style={{ maxHeight: 'min(50dvh,440px)', border: '1px solid var(--line)', borderRadius: 16, padding: 12 }}>
              <p className="help" style={{ marginTop: 0 }}>{t('admin.exams_page.remarks_help')}</p>
              {m.students.map((s) => (
                <div key={s.studentId} className="kv" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 160 }}>{s.name}</span>
                  <span style={{ flex: 1, minWidth: 220 }}><Field label={t('admin.exams_page.remark_for', { name: s.name })} value={remarkOf(s.studentId)} disabled={!editable} maxLength={400} onChange={(v) => setSaid({ ...said, [s.studentId]: v })} /></span>
                  {editable && listOptions(bank).length > 0 && <Select compact aria-label={t('admin.exams_page.pick_a_remark', { name: s.name })} value="" onChange={(k) => k && setSaid({ ...said, [s.studentId]: listLabel(bank, k, currentLanguage()) })}
                    options={[{ value: '', label: t('admin.exams_page.pick_a_remark_short') }, ...listOptions(bank).map((i) => ({ value: i.key, label: listLabel(bank, i.key, currentLanguage()) }))]} />}
                </div>
              ))}
            </div>
          ) : (
            !results.data ? <Skeleton kind="table" rows={5} /> : results.data.rows.length === 0 ? <div style={{ padding: 16 }}><EmptyNote icon="exams" title={t('admin.exams_page.no_results_yet')} body={t('admin.exams_page.results_appear_here_as_marks')} /></div> : (
              <>
                <div className="tgrow" style={{ marginBottom: 10 }}><span className="chip v">{t('admin.exams_page.average')}{' '}{results.data.average}%</span><span className="chip g">{results.data.passPct}{t('admin.exams_page.passed')}</span><span className="chip">{results.data.rows.length} {t('admin.exams_page.students')}</span></div>
                <div className="lscroll" style={{ maxHeight: 'min(46dvh,400px)', border: '1px solid var(--line)', borderRadius: 16 }}>
                  <div style={{ minWidth: 520 }}>
                    {results.data.rows.map((r) => (
                      <div className="grd rw" key={r.studentId} style={{ '--cols': '44px minmax(0,1.6fr) 90px 70px 60px' } as React.CSSProperties}>
                        <b className="num" style={{ font: '700 14px var(--fb)', color: r.rank <= 3 ? 'var(--brand)' : 'var(--ink3)' }}>#{r.rank}</b>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Avatar name={r.name} size={28} /><b data-tip={r.name} style={{ font: '700 14px var(--fb)', overflowWrap: 'anywhere' }}>{r.name}</b></span>
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
              {editable && tab === 'remarks' && <button className="btn" disabled={!remarksDirty.length || saveRemarks.isPending} onClick={() => saveRemarks.mutate()}>{saveRemarks.isPending ? t('admin.exams_page.saving') : t('admin.exams_page.save_remarks')}</button>}
              {editable && tab !== 'remarks' && <button className="btn" disabled={!dirty.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('admin.exams_page.saving') : dirty.length ? t('admin.exams_page.save', { length: dirty.length }) : t('admin.exams_page.save_marks')}</button>}
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
