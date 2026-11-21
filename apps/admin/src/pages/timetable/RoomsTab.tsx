import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dayLabel, schoolToday, type RoomRow } from '@tangent/contracts';
import { EmptyNote, Checkbox, DateField, Dialog, ErrorLine, Field, NumberField, TimeField, useShake, EmptyState, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, problem } from '../../app/kit';

/**
 * The school's rooms (a timetabled lesson can only use one of them once there are any) and, for a chosen room and day, the
 * lessons the timetable puts in it and the bookings people made. Anyone who sees the timetable can book a free room.
 */
export function RoomsTab({ tabs }: { tabs: React.ReactNode }) {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const canEdit = app.user.permissions.includes('timetable.edit');
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: app.api.timetable.roomList });
  const [sel, setSel] = useState('');
  const [date, setDate] = useState(schoolToday());
  const [edit, setEdit] = useState<RoomRow | 'new' | null>(null);
  const list = rooms.data ?? [];
  const cur = list.find((r) => r.id === sel) ?? list[0];
  useEffect(() => { if (!sel && list[0]) setSel(list[0].id); }, [list, sel]);
  const day = useQuery({ queryKey: ['room-day', cur?.id, date], queryFn: () => app.api.timetable.roomDay(cur!.id, date), enabled: !!cur });
  const after = (m: string) => { void qc.invalidateQueries({ predicate: (q) => ['rooms', 'room-day', 'timetable'].includes(String(q.queryKey[0])) }); say(m); };
  const cancel = useMutation({ mutationFn: (id: string) => app.api.timetable.cancelBooking(id), onSuccess: () => after(t('admin.rooms_tab.booking_cancelled')), onError: (e) => say((e as Error).message, 'bad') });

  return (
    <Page title={t('admin.rooms_tab.timetable')} sub={t('admin.rooms_tab.the_school_s_rooms')} tabs={tabs} toast={toast} loading={rooms.isLoading}
      error={rooms.isError ? { message: (rooms.error as Error).message, retry: () => void rooms.refetch() } : null}
      actions={canEdit ? <AddBtn onClick={() => setEdit('new')}>{t('admin.rooms_tab.add_a_room')}</AddBtn> : undefined}
      overlays={edit && <RoomDialog room={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={(m) => { setEdit(null); after(m); }} />}>
      {!list.length ? (
        <EmptyState scene="rooms" onAction={canEdit ? () => setEdit('new') : undefined} />
      ) : (
        <div className="g" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)', alignItems: 'start' }}>
          <Card title={t('admin.rooms_tab.rooms')} chip={<span className="chip">{list.length}</span>}>
            {list.map((r) => (
              <div key={r.id} className="kv" style={{ alignItems: 'center', gap: 12 }}>
                <button type="button" className={`chip ${r.id === cur?.id ? 'v' : ''}`} aria-pressed={r.id === cur?.id} onClick={() => setSel(r.id)} style={{ cursor: 'pointer' }}>{r.name}</button>
                <span className="help" style={{ margin: 0, flex: 1 }}>{[r.capacity ? t('admin.rooms_tab.seats', { n: r.capacity }) : '', t('admin.rooms_tab.lessons', { n: r.lessons }), r.bookable ? '' : t('admin.rooms_tab.not_for_booking')].filter(Boolean).join(' · ')}</span>
                {canEdit && <button className="btn sm" onClick={() => setEdit(r)}>{t('admin.rooms_tab.edit')}</button>}
              </div>
            ))}
          </Card>
          {cur && (
            <Card title={t('admin.rooms_tab.room_on_day', { room: cur.name, day: dayLabel(date) })}>
              <div style={{ maxWidth: 240 }}><DateField label={t('admin.rooms_tab.day')} value={date} onChange={(d) => d && setDate(d)} /></div>
              {day.isError ? <ErrorLine>{(day.error as Error).message}</ErrorLine> : <>
                <div className="lbl" style={{ marginTop: 12 }}>{t('admin.rooms_tab.lessons_in_it')}</div>
                {day.data?.lessons.length ? day.data.lessons.map((l) => <div key={`${l.start}${l.label}`} className="kv"><span>{l.start}–{l.end}</span><b>{l.label}</b></div>)
                  : <EmptyNote icon="timetable" title={t('admin.rooms_tab.no_lessons_that_day')} />}
                <div className="lbl" style={{ marginTop: 12 }}>{t('admin.rooms_tab.bookings')}</div>
                {day.data?.bookings.length ? day.data.bookings.map((b) => (
                  <div key={b.id} className="kv" style={{ alignItems: 'center', gap: 12 }}>
                    <span>{b.start}–{b.end}</span><b style={{ flex: 1 }}>{b.purpose}<small style={{ display: 'block', color: 'var(--ink3)' }}>{b.bookedBy}</small></b>
                    {(b.mine || canEdit) && <button className="btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(b.id)}>{t('admin.rooms_tab.cancel_booking')}</button>}
                  </div>
                )) : <EmptyNote icon="calendar" title={t('admin.rooms_tab.no_bookings')} />}
                {cur.bookable && date >= schoolToday() && <BookForm roomId={cur.id} date={date} onDone={() => after(t('admin.rooms_tab.room_booked', { room: cur.name }))} />}
              </>}
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}

function BookForm({ roomId, date, onDone }: { roomId: string; date: string; onDone: () => void }) {
  const app = useApp();
  const shake = useShake();
  const [f, setF] = useState({ start: '', end: '', purpose: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr({}); };
  const book = useMutation({
    mutationFn: () => app.api.timetable.book({ roomId, date, start: f.start, end: f.end, purpose: f.purpose.trim() }),
    onSuccess: () => { setF({ start: '', end: '', purpose: '' }); onDone(); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (!f.start) p.start = t('admin.rooms_tab.choose_the_start');
    if (!f.end) p.end = t('admin.rooms_tab.choose_the_end');
    else if (f.start && f.end <= f.start) p.end = t('admin.rooms_tab.end_after_start');
    if (f.purpose.trim().length < 2) p.purpose = t('admin.rooms_tab.say_what_it_is_for');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else book.mutate();
  };
  return (
    <div className={shake.cls} style={{ marginTop: 16 }}>
      <div className="lbl">{t('admin.rooms_tab.book_it')}</div>
      <div className="two">
        <TimeField label={t('admin.rooms_tab.from')} value={f.start} onChange={set('start')} error={err.start} />
        <TimeField label={t('admin.rooms_tab.until')} value={f.end} onChange={set('end')} error={err.end} />
      </div>
      <Field label={t('admin.rooms_tab.what_for')} value={f.purpose} onChange={set('purpose')} error={err.purpose} maxLength={120} />
      {err._ && <ErrorLine>{err._}</ErrorLine>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri" disabled={book.isPending} onClick={go}>{book.isPending ? t('admin.rooms_tab.booking') : t('admin.rooms_tab.book')}</button></div>
    </div>
  );
}

function RoomDialog({ room, onClose, onDone }: { room: RoomRow | null; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const [f, setF] = useState({ name: room?.name ?? '', capacity: room?.capacity ? String(room.capacity) : '', note: room?.note ?? '', bookable: room?.bookable ?? true });
  const [err, setErr] = useState<Record<string, string>>({});
  const [sure, setSure] = useState(false);
  const body = () => ({ name: f.name.trim(), capacity: f.capacity ? Number(f.capacity) : null, note: f.note.trim(), bookable: f.bookable });
  const save = useMutation({
    mutationFn: () => (room ? app.api.timetable.saveRoom(room.id, body()) : app.api.timetable.addRoom(body())),
    onSuccess: () => onDone(room ? t('admin.rooms_tab.room_saved', { room: f.name.trim() }) : t('admin.rooms_tab.room_added', { room: f.name.trim() })),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const remove = useMutation({ mutationFn: () => app.api.timetable.deleteRoom(room!.id), onSuccess: () => onDone(t('admin.rooms_tab.room_removed')), onError: (e) => { setErr(problem(e)); setSure(false); shake.hit(); } });
  const go = () => { if (!f.name.trim()) { setErr({ name: t('admin.rooms_tab.name_the_room') }); shake.hit(); } else save.mutate(); };
  return (
    <Dialog title={room ? room.name : t('admin.rooms_tab.add_a_room')} onClose={onClose} width={460} shake={shake.cls}>
      <div className="stack">
        <Field label={t('admin.rooms_tab.name')} value={f.name} onChange={(name) => { setF({ ...f, name }); setErr({}); }} error={err.name} maxLength={20} hint={room?.lessons ? t('admin.rooms_tab.renaming_follows_lessons') : undefined} />
        <NumberField label={t('admin.rooms_tab.seats_optional')} value={f.capacity} onChange={(capacity) => setF({ ...f, capacity })} min={1} max={5000} />
        <Field label={t('admin.rooms_tab.note_optional')} value={f.note} onChange={(note) => setF({ ...f, note })} maxLength={120} />
        <Checkbox checked={f.bookable} onChange={(bookable) => setF({ ...f, bookable })} label={t('admin.rooms_tab.people_can_book_it')} />
        {err._ && <ErrorLine>{err._}</ErrorLine>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>{room && (sure
            ? <span style={{ display: 'flex', gap: 8 }}><button className="btn sm dng" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('admin.rooms_tab.yes_remove')}</button><button className="btn sm" onClick={() => setSure(false)}>{t('admin.rooms_tab.keep')}</button></span>
            : <button className="btn dng" onClick={() => setSure(true)}>{t('admin.rooms_tab.remove_room')}</button>)}</span>
          <span style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={onClose}>{t('admin.rooms_tab.cancel')}</button>
            <button className="btn pri" disabled={save.isPending} onClick={go}>{save.isPending ? t('admin.rooms_tab.saving') : t('admin.rooms_tab.save')}</button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
