import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { SlotRow, WeekOf } from '@tangent/contracts';
import { Dialog, ErrorLine, Field, Segmented, SelectField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { problem } from '../../app/kit';

const DAY = ['', t('admin.timetable_tools.monday'), t('admin.timetable_tools.tuesday'), t('admin.timetable_tools.wednesday'), t('admin.timetable_tools.thursday'), t('admin.timetable_tools.friday'), t('admin.timetable_tools.saturday'), t('admin.timetable_tools.sunday')];

/** Puts a lesson in a free period: subject, teacher (only those free then are accepted), room. */
export function PlaceDialog({ classId, day, dayName, period, label, onClose, onDone }: { classId: string; day: number; dayName: string; period: number; label: string; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects, staleTime: 5 * 60_000 });
  const staff = useQuery({ queryKey: ['staff', ''], queryFn: () => api.staff.list() });
  const [f, setF] = useState({ subjectId: '', teacherId: '', room: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const place = useMutation({
    mutationFn: () => api.timetable.place({ classId, day, period, subjectId: f.subjectId, teacherId: f.teacherId, room: f.room.trim() || null }),
    onSuccess: () => onDone(t('admin.timetable_tools.lesson_placed_publish_to_tell')),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const teachers = (staff.data ?? []).filter((s) => !f.subjectId || !s.subjects.length || s.subjects.some((x) => x.id === f.subjectId));
  return (
    <Dialog title={t('admin.timetable_tools.place_a_lesson', { p0: dayName, label })} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('admin.timetable_tools.subject')} value={f.subjectId} onChange={(subjectId) => { setF({ ...f, subjectId }); setErr({}); }} error={err.subjectId} options={[{ value: '', label: t('admin.timetable_tools.choose_a_subject') }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        <SelectField label={t('admin.timetable_tools.teacher')} value={f.teacherId} onChange={(teacherId) => { setF({ ...f, teacherId }); setErr({}); }} error={err.teacherId} options={[{ value: '', label: t('admin.timetable_tools.choose_a_teacher') }, ...teachers.map((s) => ({ value: s.id, label: s.name }))]} />
        <Field label={t('admin.timetable_tools.room_optional')} value={f.room} onChange={(room) => setF({ ...f, room })} maxLength={20} placeholder="B-204" />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.timetable_tools.cancel')}</button>
          <button className="btn pri" disabled={place.isPending || !f.subjectId || !f.teacherId} onClick={() => place.mutate()}>{place.isPending ? t('admin.timetable_tools.placing') : t('admin.timetable_tools.place')}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Changes a lesson's subject or room (the teacher has its own chooser), or frees the period. */
export function ChangeDialog({ slot, dayName, onClose, onDone }: { slot: SlotRow; dayName: string; onClose: () => void; onDone: (m: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: api.subjects, staleTime: 5 * 60_000 });
  const [f, setF] = useState({ subjectId: slot.subjectId, room: slot.room ?? '' });
  const [freeing, setFreeing] = useState(false);
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.timetable.patch(slot.id, { subjectId: f.subjectId !== slot.subjectId ? f.subjectId : undefined, room: f.room.trim() || null }),
    onSuccess: () => onDone(t('admin.timetable_tools.lesson_changed_publish_to_tell')), onError: (e) => { setErr((e as Error).message); shake.hit(); },
  });
  const free = useMutation({ mutationFn: () => api.timetable.free(slot.id), onSuccess: () => onDone(t('admin.timetable_tools.the_period_is_free_now')), onError: (e) => { setErr((e as Error).message); shake.hit(); } });
  return (
    <Dialog title={`${slot.subjectName} · ${dayName}`} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('admin.timetable_tools.subject')} value={f.subjectId} onChange={(subjectId) => setF({ ...f, subjectId })} options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Field label={t('admin.timetable_tools.room')} value={f.room} onChange={(room) => setF({ ...f, room })} maxLength={20} placeholder="B-204" />
        {err && <ErrorLine>{err}</ErrorLine>}
        {freeing ? (
          <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
            <span className="help">{t('admin.timetable_tools.the_class_will_have_no')}</span>
            <button className="btn" onClick={() => setFreeing(false)}>{t('admin.timetable_tools.keep_it')}</button>
            <button className="btn dng" disabled={free.isPending} onClick={() => free.mutate()}>{t('admin.timetable_tools.yes_free_it')}</button>
          </div>
        ) : (
          <div className="tgrow">
            <button className="btn dng" onClick={() => setFreeing(true)}>{t('admin.timetable_tools.free_this_period')}</button>
            <span className="grow"></span>
            <button className="btn" onClick={onClose}>{t('admin.timetable_tools.cancel')}</button>
            <button className="btn pri" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('admin.timetable_tools.saving') : t('admin.timetable_tools.save')}</button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** One teacher's or one room's week across every class, to read or print. */
export function WeekDialog({ days: shown, onClose }: { days: { day: number; name: string }[]; onClose: () => void }) {
  const days = shown.map((d) => d.day);
  const nameOf = (d: number) => shown.find((x) => x.day === d)?.name ?? DAY[((d - 1) % 7) + 1];
  const { api } = useApp();
  const [by, setBy] = useState<'teacher' | 'room'>('teacher');
  const [pick, setPick] = useState('');
  const staff = useQuery({ queryKey: ['staff', ''], queryFn: () => api.staff.list(), enabled: by === 'teacher' });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: api.timetable.rooms, enabled: by === 'room' });
  const week = useQuery<WeekOf>({ queryKey: ['week-of', by, pick], queryFn: () => api.timetable.week(by === 'teacher' ? { teacherId: pick } : { room: pick }), enabled: !!pick });
  const w = week.data;
  return (
    <Dialog title={t('admin.timetable_tools.a_teacher_s_or_a')} onClose={onClose} width={860}>
      <div className="stack">
        <div className="tgrow">
          <Segmented label={t('admin.timetable_tools.whose_week')} value={by} onChange={(v) => { setBy(v); setPick(''); }} options={[{ value: 'teacher', label: t('admin.timetable_tools.teacher') }, { value: 'room', label: t('admin.timetable_tools.room') }]} />
          <div style={{ minWidth: 240 }}>
            <SelectField label={by === 'teacher' ? t('admin.timetable_tools.teacher') : t('admin.timetable_tools.room')} value={pick} onChange={setPick}
              options={[{ value: '', label: by === 'teacher' ? t('admin.timetable_tools.choose_a_teacher') : t('admin.timetable_tools.choose_a_room') }, ...(by === 'teacher' ? (staff.data ?? []).map((s) => ({ value: s.id, label: s.name })) : (rooms.data ?? []).map((r) => ({ value: r, label: r })))]} />
          </div>
          {w && <button className="btn sm" onClick={() => window.print()}>{t('admin.timetable_tools.print')}</button>}
        </div>
        {week.isLoading && pick && <div className="skc" style={{ height: 240, borderRadius: 16 }} />}
        {w && (
          <div className="scroll-x">
            <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${days.length}, minmax(110px,1fr))`, gap: 4, minWidth: 90 + days.length * 114 }}>
              <span></span>
              {days.map((d) => <b key={d} style={{ font: '700 12px var(--fb)', color: 'var(--ink3)' }}>{nameOf(d)}</b>)}
              {w.periods.filter((p) => p.kind === 'period').map((p) => (
                <Fragment key={p.idx}>
                  <span style={{ font: '700 12px var(--fb)', color: 'var(--ink3)' }}>{p.label}<small style={{ display: 'block' }}>{p.starts}</small></span>
                  {days.map((d) => {
                    const s = w.slots.find((x) => x.day === d && x.period === p.idx);
                    return (
                      <span key={`${p.idx}-${d}`} style={{ padding: 8, borderRadius: 12, background: s ? 'var(--brand-soft)' : 'var(--s2)', minHeight: 44, font: '600 12px/1.3 var(--fb)' }}>
                        {s ? <><b style={{ display: 'block' }}>{s.subjectName}</b>{s.className}{by === 'room' ? ` · ${s.substituteName ?? s.teacherName}` : s.room ? ` · ${s.room}` : ''}</> : ''}
                      </span>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
