import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { schoolInstant, fmtDate, EVENT_KINDS, schoolToday, type Category, type EventKind, type EventRow, type ExamRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Field, NumberField, SelectField, TimeField, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { AddBtn, AreaField, Ico, problem, useSetting } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { usePageTabs } from '../../app/tabs';

const KIND: Record<EventKind, { label: string; tone: string }> = { event: { label: tr('admin.events_page.event'), tone: 'v' }, holiday: { label: tr('admin.events_page.holiday'), tone: 'g' }, exam: { label: tr('admin.events_page.exams'), tone: 'a' }, ptm: { label: tr('admin.events_page.parent_meeting'), tone: 'k' }, routine: { label: tr('admin.events_page.routine'), tone: '' } };
const AUDIENCE: Record<string, string> = { everyone: tr('admin.events_page.everyone'), parents: tr('admin.events_page.parents'), staff: tr('admin.events_page.staff_only'), class: 'One class' };
const WEEK = [tr('admin.events_page.mon'), tr('admin.events_page.tue'), tr('admin.events_page.wed'), tr('admin.events_page.thu'), tr('admin.events_page.fri'), tr('admin.events_page.sat'), tr('admin.events_page.sun')];
const PREV = 'caretLeft';
const NEXT = 'caretRight';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayOf = (iso: string) => ymd(new Date(iso));
const when = (e: EventRow) => {
  const s = new Date(e.startsAt);
  const day = fmtDate(s, 'weekday');
  const t = (d: Date) => fmtDate(d, 'time');
  if (e.kind === 'holiday' || e.kind === 'exam') return e.endsAt ? tr('admin.events_page.to', { day, fmtDate: fmtDate(e.endsAt, 'day') }) : day;
  return tr('admin.events_page.text', { day, t: t(s), p2: e.endsAt ? tr('admin.events_page.to_time', { time: t(new Date(e.endsAt)) }) : '' });
};
/** Exams shown on the calendar as the weeks they run (opened in Exams, not edited here). */
const examEvents = (exams: ExamRow[]): EventRow[] => exams.map((x) => ({
  id: `exam:${x.id}`, title: tr('admin.events_page.class', { name: x.name, className: x.className }), startsAt: schoolInstant(x.startsOn).toISOString(), endsAt: schoolInstant(x.endsOn).toISOString(), kind: 'exam', venue: '', note: '', audience: 'everyone',
  category: '', needsRsvp: false, lat: null, lng: null, going: 0, maybe: 0, cant: 0, adults: 0, classId: x.classId, className: x.className,
}));
const refresh = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ predicate: (q) => ['events', 'dashboard'].includes(String(q.queryKey[0])) });

export function EventsPage() {
  const { tabs } = usePageTabs('/events');
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | 'new' | null>(null);
  const list = useQuery({ queryKey: ['events'], queryFn: app.api.events.list });
  const canWrite = app.user.permissions.includes('events.write');
  // Exam weeks live in Exams; they show here from there, typed once.
  const { shell } = useShellChrome();
  const seeExams = !!shell?.modules.includes('exams') && app.user.permissions.includes('exams.read');
  const exams = useQuery({ queryKey: ['exams', ''], queryFn: () => app.api.exams.list(), enabled: seeExams });
  const sunday = useSetting<string>('calendar.weekStarts', 'mon') === 'sun';
  const all = useMemo(() => [...(list.data ?? []).filter((e) => e.kind !== 'exam'), ...examEvents(exams.data ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [list.data, exams.data]);
  const today = schoolToday();
  const byDay = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    for (const e of all) {
      const start = new Date(e.startsAt);
      const end = e.endsAt && (e.kind === 'holiday' || e.kind === 'exam') ? new Date(e.endsAt) : start;
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) { const k = ymd(d); m.set(k, [...(m.get(k) ?? []), e]); }
    }
    return m;
  }, [all]);
  const shown = day ? byDay.get(day) ?? [] : all.filter((e) => dayOf(e.endsAt ?? e.startsAt) >= today);
  const past = day ? [] : all.filter((e) => dayOf(e.endsAt ?? e.startsAt) < today).reverse();
  // The week starts on the school's first day (console: calendar.weekStarts).
  const first = sunday ? month.getDay() : month.getDay() === 0 ? 6 : month.getDay() - 1;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: first }, () => null), ...Array.from({ length: days }, (_, i) => ymd(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  return (
    <Page title={tr('admin.events_page.events')} sub={tr('admin.events_page.the_school_calendar_and_who')} tabs={tabs} toast={toast} loading={list.isLoading && !list.data}
      error={list.isError && !list.data ? { message: (list.error as Error).message, retry: () => void list.refetch() } : null}
      actions={canWrite ? <AddBtn onClick={() => setEditing('new')}>{tr('admin.events_page.add_event')}</AddBtn> : undefined}
      overlays={editing && <EventDialog event={editing === 'new' ? null : editing} defaultDay={day} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); refresh(qc); say(m); }} />}>
      {all.length === 0 ? (
        <div><EmptyState scene="events" onAction={canWrite ? () => setEditing('new') : undefined} /></div>
      ) : (
        <section className="evg" data-even="">
          <div className="evcol">
          <div className="card rise evc">
            <div className="ch"><h2>{fmtDate(month, 'month')}</h2>
              <button className="btn sm" aria-label={tr('admin.events_page.previous_month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Ico d={PREV} /></button>
              <button className="btn sm" aria-label={tr('admin.events_page.next_month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Ico d={NEXT} /></button>
            </div>
            <div className="cal" role="grid" aria-label={tr('admin.events_page.calendar')}>
              {(sunday ? [tr('admin.events_page.sun'), ...WEEK.slice(0, 6)] : WEEK).map((d) => <span className="calh" key={d}>{d}</span>)}
              {cells.map((c, i) => c ? (
                <button key={c} className={`calc ${c === today ? 'now' : ''} ${c === day ? 'sel' : ''}`} aria-pressed={c === day} aria-label={`${c}${byDay.get(c)?.length ? tr('admin.events_page.events_2', { length: byDay.get(c)!.length }) : ''}`} onClick={() => setDay(c === day ? null : c)}>
                  {Number(c.slice(8))}
                  <span className="cald">{(byDay.get(c) ?? []).slice(0, 3).map((e) => <i key={e.id} className={`k-${e.kind}`}></i>)}</span>
                </button>
              ) : <span key={`b${i}`}></span>)}
            </div>
            <div className="tgrow" style={{ marginTop: 12, gap: 12 }}>{(['event', 'ptm', 'exam', 'holiday'] as EventKind[]).map((k) => <span key={k} className="lgd"><i className={`k-${k}`} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', marginInlineEnd: 6 }}></i>{KIND[k].label}</span>)}</div>
          </div>
          </div>
          <div className="card rise evl" style={{ '--d': '.06s' } as React.CSSProperties}>
            <div className="ch"><h2>{day ? fmtDate(day, 'weekdayLong') : tr('admin.events_page.coming_up')}</h2>{day && <button className="btn sm" onClick={() => setDay(null)}>{tr('admin.events_page.show_all')}</button>}</div>
            <div className="lscroll" data-even-scroll="" style={{ maxHeight: 'min(62dvh,620px)', marginTop: 8 }}>
              {shown.length === 0 && <EmptyNote icon="calendar" title={day ? tr('admin.events_page.nothing_on_this_day') : tr('admin.events_page.nothing_coming_up')} body={day ? tr('admin.events_page.pick_another_day_or_add') : tr('admin.events_page.add_an_event_and_it')} />}
              {shown.map((e) => <EventItem key={e.id} e={e} canWrite={canWrite} onOpen={() => (e.id.startsWith('exam:') ? app.go(`/exams?open=${e.id.slice(5)}`) : setEditing(e))} />)}
              {past.length > 0 && <><div className="lbl" style={{ padding: '16px 0 6px' }}>{tr('admin.events_page.earlier')}</div>{past.map((e) => <EventItem key={e.id} e={e} canWrite={canWrite} onOpen={() => (e.id.startsWith('exam:') ? app.go(`/exams?open=${e.id.slice(5)}`) : setEditing(e))} dim />)}</>}
            </div>
          </div>
        </section>
      )}
    </Page>
  );
}

function EventItem({ e, canWrite, onOpen, dim }: { e: EventRow; canWrite: boolean; onOpen: () => void; dim?: boolean }) {
  const replies = e.going + e.maybe + e.cant;
  return (
    <button className="evi" style={{ opacity: dim ? 0.6 : 1 }} onClick={onOpen} aria-label={`${canWrite ? tr('admin.events_page.edit') : tr('admin.events_page.open')} ${e.title}`}>
      <span className={`evk k-${e.kind}`}></span>
      <span style={{ minWidth: 0, flex: 1, textAlign: 'start' }}>
        <b data-tip={e.title}>{e.title}</b>
        <small>{when(e)}{e.venue ? ` · ${e.venue}` : ''}</small>
        {e.note && <small className="evn">{e.note}</small>}
      </span>
      <span style={{ display: 'grid', gap: 4, justifyItems: 'end' }}>
        <span className={`chip ${KIND[e.kind].tone}`}>{KIND[e.kind].label}</span>
        {replies > 0 && <span className="chip g" data-tip={tr('admin.events_page.going_maybe_cannot', { going: e.going, maybe: e.maybe, cant: e.cant })}>{e.going} {tr('admin.events_page.going')}</span>}
        {e.audience !== 'everyone' && <span className="chip">{e.audience === 'class' ? tr('admin.events_page.class_2', { p0: e.className ?? '' }) : AUDIENCE[e.audience]}</span>}
      </span>
    </button>
  );
}

/** A stored time as the school's day and clock (India Standard Time), whatever the browser's time zone. */
const local = (iso: string) => { const d = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };

function EventDialog({ event, defaultDay, onClose, onDone }: { event: EventRow | null; defaultDay: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const app = useApp();
  const canWrite = app.user.permissions.includes('events.write');
  const s = event ? local(event.startsAt) : { date: defaultDay ?? schoolToday(), time: '10:00' };
  const en = event?.endsAt ? local(event.endsAt) : { date: s.date, time: '12:00' };
  const cats = useSetting<Category[]>('events.categories', []);
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000, enabled: canWrite });
  const replies = useQuery({ queryKey: ['events', event?.id, 'replies'], queryFn: () => app.api.events.replies(event!.id), enabled: !!event && event.going + event.maybe + event.cant > 0 });
  const [showReplies, setShowReplies] = useState(false);
  const [f, setF] = useState({ title: event?.title ?? '', kind: (event?.kind ?? 'event') as EventKind, date: s.date, time: s.time, endDate: en.date, endTime: en.time, venue: event?.venue ?? '', note: event?.note ?? '', audience: event?.audience ?? 'everyone', classId: event?.classId ?? '',
    category: event?.category ?? cats[0]?.key ?? '', lat: event?.lat == null ? '' : String(event.lat), lng: event?.lng == null ? '' : String(event.lng) });
  const [needsRsvp, setNeedsRsvp] = useState(event?.needsRsvp ?? false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const shake = useShake();
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const holiday = f.kind === 'holiday';
  // Times are the school's (India Standard Time), whatever the browser's clock is set to.
  const body = () => ({
    title: f.title.trim(), kind: f.kind, venue: f.venue.trim(), note: f.note.trim(), audience: f.audience as 'everyone', classId: f.audience === 'class' ? f.classId : null, category: f.category, needsRsvp: !holiday && needsRsvp,
    lat: f.lat ? Number(f.lat) : null, lng: f.lng ? Number(f.lng) : null,
    startsAt: schoolInstant(f.date, holiday ? '00:00' : f.time).toISOString(), endsAt: schoolInstant(f.endDate, holiday ? '00:00' : f.endTime).toISOString(),
  });
  const save = useMutation({
    mutationFn: () => (event ? app.api.events.save(event.id, body()) : app.api.events.create(body())),
    onSuccess: (r) => onDone(event ? tr('admin.events_page.was_updated', { title: r.title }) : tr('admin.events_page.was_added', { title: r.title, p1: r.audience === 'staff' ? '' : tr('admin.events_page.families_are_told') })),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const del = useMutation({ mutationFn: () => app.api.events.remove(event!.id), onSuccess: () => onDone(tr('admin.events_page.was_removed', { title: event!.title })), onError: (e) => { setConfirm(false); setErr(problem(e)); shake.hit(); } });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.title.trim().length < 3) p.title = tr('admin.events_page.name_the_event');
    if (f.audience === 'class' && !f.classId) p.classId = tr('admin.events_page.choose_the_class');
    if (!f.date) p.date = tr('admin.events_page.pick_the_day');
    if (f.endDate < f.date || (!holiday && f.endDate === f.date && f.endTime < f.time)) p.endDate = tr('admin.events_page.it_cannot_end_before_it');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else save.mutate();
  };
  return (
    <Dialog title={event ? (canWrite ? tr('admin.events_page.edit_event') : event.title) : tr('admin.events_page.add_event')} tag={event ? { text: KIND[event.kind].label, tone: 'v' } : undefined} onClose={onClose} width={560} shake={shake.cls}>
      {event && (event.going + event.maybe + event.cant > 0) && (
        <div style={{ marginBottom: 12 }}>
          <div className="tgrow"><span className="chip g">{event.going} {tr('admin.events_page.going')}{event.adults ? tr('admin.events_page.adults', { adults: event.adults }) : ''}</span><span className="chip a">{event.maybe} {tr('admin.events_page.maybe')}</span><span className="chip">{event.cant} {tr('admin.events_page.cannot_come')}</span>
            <button className="btn sm" onClick={() => setShowReplies((x) => !x)}>{showReplies ? tr('admin.events_page.hide_who') : tr('admin.events_page.see_who')}</button></div>
          {showReplies && (
            <div className="lscroll" style={{ maxHeight: 220, marginTop: 8, border: '1px solid var(--line)', borderRadius: 12, padding: '4px 12px' }}>
              {(replies.data ?? []).map((r, i) => <div key={i} className="kv"><span>{r.studentName} {tr('admin.events_page.class_3')}{' '}{r.className}<small style={{ display: 'block', color: 'var(--ink3)' }}>{r.guardianName}</small></span><b>{r.status === 'going' ? tr('admin.events_page.going_2', { adults: r.adults ? tr('admin.events_page.n_adults', { n: r.adults }) : '' }) : r.status === 'maybe' ? tr('admin.events_page.maybe_2') : tr('admin.events_page.cannot_come_2')}</b></div>)}
            </div>
          )}
        </div>
      )}
      {event && !canWrite ? (
        <div className="stack">
          <div className="kv"><span>{tr('admin.events_page.when')}</span><b>{when(event)}</b></div>
          {event.venue && <div className="kv"><span>{tr('admin.events_page.where')}</span><b>{event.venue}</b></div>}
          <div className="kv"><span>{tr('admin.events_page.for')}</span><b>{event.audience === 'class' ? tr('admin.events_page.class_2', { p0: event.className ?? '' }) : AUDIENCE[event.audience]}</b></div>
          {event.note && <p style={{ margin: 0, font: '400 14px/1.5 var(--fb)' }}>{event.note}</p>}
        </div>
      ) : (
      <div className="stack">
        <Field label={tr('admin.events_page.name')} value={f.title} onChange={set('title')} error={err.title} maxLength={100} />
        <div className="two">
          <SelectField label={tr('admin.events_page.kind')} value={f.kind} onChange={set('kind')} options={EVENT_KINDS.filter((k) => k !== 'routine' && k !== 'exam').map((k) => ({ value: k, label: KIND[k].label }))} />
          <SelectField label={tr('admin.events_page.who_is_told')} value={f.audience} onChange={set('audience')} options={Object.entries(AUDIENCE).map(([value, label]) => ({ value, label }))} />
        </div>
        {f.audience === 'class' && <SelectField label={tr('admin.events_page.which_class')} value={f.classId} onChange={set('classId')} error={err.classId} options={[{ value: '', label: tr('admin.events_page.choose_a_class') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: tr('admin.events_page.class_4', { name: c.name }) }))]} />}
        {holiday && <div className="help" style={{ marginTop: -6 }}>{tr('admin.events_page.holidays_close_the_school_no')}</div>}
        <div className="two">
          <DateField label={holiday ? tr('admin.events_page.from') : tr('admin.events_page.day')} value={f.date} onChange={(v) => setF((x) => ({ ...x, date: v, endDate: x.endDate < v ? v : x.endDate }))} error={err.date} />
          {holiday ? <DateField label={tr('admin.events_page.to_2')} value={f.endDate} min={f.date} onChange={set('endDate')} error={err.endDate} /> : <TimeField label={tr('admin.events_page.starts_at')} value={f.time} onChange={set('time')} />}
        </div>
        {!holiday && <div className="two"><DateField label={tr('admin.events_page.ends_on')} value={f.endDate} min={f.date} onChange={set('endDate')} error={err.endDate} /><TimeField label={tr('admin.events_page.ends_at')} value={f.endTime} onChange={set('endTime')} /></div>}
        {!holiday && cats.length > 0 && <SelectField label={tr('admin.events_page.category')} value={f.category} onChange={set('category')} options={cats.map((c) => ({ value: c.key, label: c.name }))} />}
        <Field label={tr('admin.events_page.where_optional')} value={f.venue} onChange={set('venue')} maxLength={80} />
        {!holiday && <div className="two"><NumberField label={tr('admin.events_page.latitude_optional')} decimals value={f.lat} onChange={set('lat')} min={-90} max={90} step={0.0001} /><NumberField label={tr('admin.events_page.longitude_optional')} decimals value={f.lng} onChange={set('lng')} min={-180} max={180} step={0.0001} /></div>}
        {!holiday && <div className="help" style={{ marginTop: -6 }}>{tr('admin.events_page.with_the_place_on_the')}</div>}
        {!holiday && <Checkbox checked={needsRsvp} onChange={setNeedsRsvp} label={tr('admin.events_page.ask_families_whether_they_are')} />}
        <AreaField label={tr('admin.events_page.note_optional')} value={f.note} onChange={set('note')} rows={2} maxLength={300} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {event && canWrite ? (confirm
          ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="help">{tr('admin.events_page.remove_this_event')}</span><button className="btn dngf sm" onClick={() => del.mutate()}>{tr('admin.events_page.yes_remove')}</button><button className="btn sm" onClick={() => setConfirm(false)}>{tr('admin.events_page.keep')}</button></span>
          : <button className="btn dng" onClick={() => setConfirm(true)}>{tr('admin.events_page.remove')}</button>) : <span />}
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={onClose}>{canWrite ? tr('admin.events_page.cancel') : tr('admin.events_page.close')}</button>
          {canWrite && <button className="btn pri" disabled={save.isPending} onClick={go}>{save.isPending ? tr('admin.events_page.saving') : event ? tr('admin.events_page.save') : tr('admin.events_page.add_event')}</button>}
        </span>
      </div>
    </Dialog>
  );
}
