import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MEETING_MODES, MeetingInput, schoolToday, type MeetingRow, type MeetingSlotRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, EmptyNote, Field, NumberField, Segmented, SelectField, TimeField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, dateLabel, problem, stamp } from '../../app/kit';

const MODE = { inPerson: t('admin.meetings.in_person'), online: t('admin.meetings.online'), either: t('admin.meetings.in_person_or_online') } as const;
const STATE = { draft: { label: t('admin.meetings.draft'), tone: '' }, open: { label: t('admin.meetings.open_to_book'), tone: 'g' }, closed: { label: t('admin.meetings.closed'), tone: 'a' } } as const;
const time = (iso: string) => stamp(iso).split(', ').pop();

/** Parent-teacher meetings: the day, its hours and its slots per teacher; families book in the app; the office sees and changes bookings. */
export function MeetingsPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const canManage = app.user.permissions.includes('meetings.manage');
  const list = useQuery({ queryKey: ['meetings'], queryFn: app.api.meetings.list });
  const [editing, setEditing] = useState<MeetingRow | 'new' | null>(null);
  const [open, setOpen] = useState<MeetingRow | null>(null);
  const done = (m: string) => { setEditing(null); void qc.invalidateQueries({ queryKey: ['meetings'] }); say(m); };
  const rows = list.data ?? [];
  return (
    <Page title={t('admin.meetings.meetings')} sub={t('admin.meetings.sub')} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={canManage ? <AddBtn onClick={() => setEditing('new')}>{t('admin.meetings.plan_a_meeting')}</AddBtn> : undefined}
      overlays={<>
        {editing && <MeetingDialog meeting={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={done} />}
        {open && <SlotsDialog meeting={open} canManage={canManage} onClose={() => setOpen(null)} say={say} />}
      </>}>
      <Card style={{ padding: 0 }}>
        {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="calendarAdd" title={t('admin.meetings.no_meetings')} body={t('admin.meetings.no_meetings_body')}
          action={canManage ? <button className="btn sm" onClick={() => setEditing('new')}>{t('admin.meetings.plan_a_meeting')}</button> : undefined} /></div>
          : rows.map((m) => (
            <div key={m.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
                <b style={{ font: '700 14px/1.3 var(--fb)' }}>{m.title}</b>
                <small className="help" style={{ display: 'block', margin: 0 }}>{dateLabel(m.date)} · {m.from}–{m.to} · {MODE[m.mode]}{m.place ? ` · ${m.place}` : ''}</small>
              </span>
              <span className={`chip ${STATE[m.status].tone}`}>{m.date < schoolToday() ? t('admin.meetings.over') : STATE[m.status].label}</span>
              <button className="btn sm" onClick={() => setOpen(m)}>{t('admin.meetings.booked_of', { n: m.booked, of: m.slots })}</button>
              {canManage && <button className="btn sm" onClick={() => setEditing(m)}>{t('admin.meetings.edit')}</button>}
            </div>
          ))}
      </Card>
    </Page>
  );
}

function MeetingDialog({ meeting, onClose, onDone }: { meeting: MeetingRow | null; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const [f, setF] = useState<MeetingInput>(() => meeting
    ? { title: meeting.title, date: meeting.date, from: meeting.from, to: meeting.to, slotMinutes: meeting.slotMinutes, gapMinutes: meeting.gapMinutes, mode: meeting.mode, place: meeting.place, link: meeting.link,
      classIds: meeting.classIds, teacherIds: meeting.teacherIds, closesAt: meeting.closesAt, status: meeting.status }
    : { title: '', date: schoolToday(), from: '09:00', to: '12:00', slotMinutes: 10, gapMinutes: 0, mode: 'inPerson', place: '', link: '', classIds: [], teacherIds: [], closesAt: null, status: 'draft' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const put = (p: Partial<MeetingInput>) => { setF({ ...f, ...p }); setErr({}); };
  const save = useMutation({
    mutationFn: () => { const b = MeetingInput.parse(f); return meeting ? app.api.meetings.save(meeting.id, b) : app.api.meetings.add(b); },
    onSuccess: (r) => onDone(meeting ? t('admin.meetings.saved', { title: r.title }) : t('admin.meetings.planned', { title: r.title, n: r.slots })),
    onError: (e) => { const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      setErr(issues ? { [String(issues[0]!.path[0] ?? '_')]: issues[0]!.message } : problem(e)); shake.hit(); },
  });
  const del = useMutation({ mutationFn: () => app.api.meetings.remove(meeting!.id), onSuccess: () => onDone(t('admin.meetings.removed')), onError: (e) => setErr(problem(e)) });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Dialog title={meeting ? t('admin.meetings.edit_meeting') : t('admin.meetings.plan_a_meeting')} onClose={onClose} width={720} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.meetings.title')} value={f.title} error={err.title} maxLength={100} onChange={(v) => put({ title: v })} />
        <div className="two">
          <DateField label={t('admin.meetings.day')} value={f.date} error={err.date} min={meeting ? undefined : schoolToday()} onChange={(v) => put({ date: v })} />
          <SelectField label={t('admin.meetings.how')} value={f.mode} onChange={(v) => put({ mode: v as MeetingInput['mode'] })} options={MEETING_MODES.map((m) => ({ value: m, label: MODE[m] }))} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 130 }}><TimeField label={t('admin.meetings.from')} value={f.from} onChange={(v) => put({ from: v })} /></div>
          <div style={{ width: 130 }}><TimeField label={t('admin.meetings.until')} value={f.to} error={err.to} onChange={(v) => put({ to: v })} /></div>
          <div style={{ width: 140 }}><NumberField label={t('admin.meetings.minutes_each')} min={5} max={60} value={String(f.slotMinutes)} onChange={(v) => put({ slotMinutes: Math.min(60, Math.max(5, Number(v) || 10)) })} /></div>
          <div style={{ width: 140 }}><NumberField label={t('admin.meetings.minutes_between')} min={0} max={30} value={String(f.gapMinutes)} onChange={(v) => put({ gapMinutes: Math.min(30, Math.max(0, Number(v) || 0)) })} /></div>
        </div>
        {f.mode !== 'online' && <Field label={t('admin.meetings.where')} value={f.place} maxLength={100} onChange={(v) => put({ place: v })} />}
        {f.mode !== 'inPerson' && <Field label={t('admin.meetings.link_optional')} value={f.link} error={err.link} maxLength={300} onChange={(v) => put({ link: v })} />}
        <div className="fld"><label>{t('admin.meetings.whose_families_book')}</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{(classes.data ?? []).map((c) => <Checkbox key={c.id} checked={f.classIds.includes(c.id)} label={c.name} onChange={() => put({ classIds: toggle(f.classIds, c.id) })} />)}</div>
          {err.classIds && <div className="emsg">{err.classIds}</div>}
        </div>
        <div className="fld"><label>{t('admin.meetings.teachers_none_means_class_teachers')}</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{(staff.data ?? []).map((s) => <Checkbox key={s.id} checked={f.teacherIds.includes(s.id)} label={s.name} onChange={() => put({ teacherIds: toggle(f.teacherIds, s.id) })} />)}</div>
          {err.teacherIds && <div className="emsg">{err.teacherIds}</div>}
        </div>
        <Segmented label={t('admin.meetings.state')} value={f.status} onChange={(v) => put({ status: v })} options={(['draft', 'open', 'closed'] as const).map((s) => ({ value: s, label: STATE[s].label }))} />
        {(meeting?.booked ?? 0) > 0 && <div className="help" style={{ marginTop: 0 }}>{t('admin.meetings.booked_locked')}</div>}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {meeting && (confirm
          ? <span style={{ marginInlineEnd: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm dngf" disabled={del.isPending} onClick={() => del.mutate()}>{t('admin.meetings.yes_remove')}</button><button className="btn sm" onClick={() => setConfirm(false)}>{t('admin.meetings.keep')}</button></span>
          : <button className="btn dng" style={{ marginInlineEnd: 'auto' }} onClick={() => setConfirm(true)}>{t('admin.meetings.remove')}</button>)}
        <button className="btn" onClick={onClose}>{t('admin.meetings.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || f.title.trim().length < 3 || !f.classIds.length} onClick={() => save.mutate()}>{t('admin.meetings.save')}</button>
      </div>
    </Dialog>
  );
}

/** Each teacher's times: who booked which, how; the office can cancel a booking (the family is told). */
function SlotsDialog({ meeting, canManage, onClose, say }: { meeting: MeetingRow; canManage: boolean; onClose: () => void; say: (m: string, tone?: 'ok' | 'bad') => void }) { const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meeting-slots', meeting.id], queryFn: () => app.api.meetings.slots(meeting.id) });
  const cancel = useMutation({ mutationFn: (s: MeetingSlotRow) => app.api.meetings.cancel(s.id), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['meeting-slots', meeting.id] }); void qc.invalidateQueries({ queryKey: ['meetings'] }); say(t('admin.meetings.booking_cancelled')); },
    onError: (e) => say((e as Error).message, 'bad') });
  const teachers = [...new Map((q.data ?? []).map((s) => [s.teacherId, s.teacherName])).entries()];
  return (
    <Dialog title={meeting.title} tag={{ text: dateLabel(meeting.date), tone: 'v' }} onClose={onClose} width={760}>
      {!teachers.length ? <EmptyNote icon="calendarAdd" title={t('admin.meetings.no_times')} /> : teachers.map(([tid, name]) => (
        <div key={tid} style={{ marginBottom: 16 }}>
          <div className="lbl">{name}</div>
          {(q.data ?? []).filter((s) => s.teacherId === tid).map((s) => (
            <div key={s.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 40, padding: '4px 0', flexWrap: 'wrap' }}>
              <b style={{ flex: '0 0 70px' }}>{time(s.startsAt)}</b>
              <span style={{ flex: 1 }}>{s.state === 'booked' ? `${s.studentName ?? ''}${s.bookedBy ? ` · ${s.bookedBy}` : ''}${s.mode ? ` · ${MODE[s.mode]}` : ''}` : s.state === 'closed' ? t('admin.meetings.closed_by_teacher') : t('admin.meetings.free')}</span>
              {s.state === 'booked' && canManage && <button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(s)}>{t('admin.meetings.cancel_booking')}</button>}
            </div>
          ))}
        </div>
      ))}
    </Dialog>
  );
}
