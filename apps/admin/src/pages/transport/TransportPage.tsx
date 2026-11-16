import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BusRouteRow, RiderRow, StopInput } from '@tangent/contracts';
import { DateField, Dialog, Field, NumberField, Select, SelectField, TimeField, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, Ico, problem, stamp } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';
import { useShellChrome } from '../../app/Layout';
import { currencySymbol, fmtMoney } from '@tangent/contracts';

const rupees = (n: number) => fmtMoney(n);
const UP = 'up';
const DOWN = 'down';
const X = 'close';
// A position older than ten minutes is "last seen", not live.
const isLive = (at: string) => Date.now() - Date.parse(at) < 10 * 60_000;

export function TransportPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const { tab: at, tabs } = usePageTabs('/transport');
  const tab = at || 'routes';
  const [edit, setEdit] = useState<BusRouteRow | 'new' | null>(null);
  const [billing, setBilling] = useState<BusRouteRow | null>(null);
  const { shell } = useShellChrome();
  const canBill = app.user.permissions.includes('fees.collect') && !!shell?.modules.includes('fees');
  const view = useQuery({ queryKey: ['transport'], queryFn: app.api.transport.view, refetchInterval: 30_000 });
  const canWrite = app.user.permissions.includes('transport.write');
  const v = view.data;
  const done = (m: string) => { setEdit(null); void qc.invalidateQueries({ queryKey: ['transport'] }); say(m); };
  return (
    <Page title={tr('admin.transport_page.transport')} sub={tr('admin.transport_page.routes_stops_and_times_who')} toast={toast} loading={view.isLoading && !v}
      error={view.isError && !v ? { message: (view.error as Error).message, retry: () => void view.refetch() } : null}
      tabs={tabs} actions={<>{canWrite && <AddBtn onClick={() => setEdit('new')}>{tr('admin.transport_page.add_a_route')}</AddBtn>}</>}
      overlays={<>
        {edit && <RouteDialog route={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={done} />}
        {billing && <BillDialog route={billing} onClose={() => setBilling(null)} onDone={(m) => { setBilling(null); say(m); }} />}
      </>}>
      {v && (!v.routes.length ? (
        tab === 'riders' || tab === 'live' ? <div><EmptyState scene={tab} onAction={canWrite ? () => setEdit('new') : undefined} /></div>
        : <div><EmptyState scene="transport" onAction={canWrite ? () => setEdit('new') : undefined} /></div>
      ) : <>
        <section className="grid">
          {[
            { label: tr('admin.transport_page.routes'), value: v.routes.length, note: tr('admin.transport_page.stops', { p0: v.routes.reduce((n, r) => n + r.stops.length, 0) }), tone: 'v' },
            { label: tr('admin.transport_page.riders'), value: v.riders.filter((r) => r.routeId).length, note: tr('admin.transport_page.of_students', { length: v.riders.length }), tone: 'a' },
            { label: tr('admin.transport_page.buses_live_now'), value: v.routes.filter((r) => r.bus && isLive(r.bus.at)).length, note: tr('admin.transport_page.sharing_their_position'), tone: 'g' },
          ].map((t, i) => (
            <div key={t.label} className={`tile t-${t.tone} s4 rise`} style={{ '--d': `${i * 0.05}s` } as React.CSSProperties}>
              <span className="lbl">{t.label}</span>
              <div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{t.value}</div>
              <div style={{ opacity: 0.75, font: '600 13px var(--fb)' }}>{t.note}</div>
            </div>
          ))}
        </section>
        {tab === 'routes' && (
          <section className="grid" data-even="">
            {v.routes.map((r) => (
              <Card key={r.id} span="s6" title={r.name} chip={<>{r.bus ? <span className={`chip ${isLive(r.bus.at) ? 'g' : ''}`} data-tip={`${r.bus.lat.toFixed(4)}, ${r.bus.lng.toFixed(4)}`}>{isLive(r.bus.at) ? tr('admin.transport_page.live') : tr('admin.transport_page.seen', { stamp: stamp(r.bus.at) })}</span> : null}{canWrite && <button className="btn sm" onClick={() => setEdit(r)}>{tr('admin.transport_page.edit')}</button>}</>}>
                <div className="kv">{tr('admin.transport_page.bus')}<b>{r.vehicle || '–'}</b></div>
                <div className="kv">{tr('admin.transport_page.driver')}<b>{r.driverName ? `${r.driverName}${r.driverPhone ? ` · ${r.driverPhone}` : ''}` : '–'}</b></div>
                <div className="kv">{tr('admin.transport_page.route_fee')}<b style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{r.fee ? tr('admin.transport_page.a_term', { rupees: rupees(r.fee) }) : tr('admin.transport_page.none')}{canBill && r.fee > 0 && r.riders > 0 && <button className="btn sm" onClick={() => setBilling(r)}>{tr('admin.transport_page.bill_riders')}</button>}</b></div>
                <div className="kv">{tr('admin.transport_page.riders')}<b>{r.riders}</b></div>
                <div className="lbl" style={{ margin: '12px 0 4px' }}>{tr('admin.transport_page.stops_2')}</div>
                <div className="lscroll" data-even-scroll="" style={{ maxHeight: 240 }}>
                  {!r.stops.length && <EmptyNote icon="route" title={tr('admin.transport_page.no_stops_yet')} body={tr('admin.transport_page.add_the_stops_in_the')} />}
                  {r.stops.map((s) => (
                    <div key={s.id} className="kv" style={{ alignItems: 'center' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={s.lat == null ? tr('admin.transport_page.not_on_the_map_no') : tr('admin.transport_page.on_the_map')}>{s.position}. {s.name}</span>
                      <b className="num">{s.pickup || '–'}{s.dropTime ? ` / ${s.dropTime}` : ''} · {s.riders}</b>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </section>
        )}
        {tab === 'riders' && <Riders routes={v.routes} riders={v.riders} canWrite={canWrite} say={say} />}
        {tab === 'live' && <Live routes={v.routes} />}
      </>)}
    </Page>
  );
}

function Riders({ routes, riders, canWrite, say }: { routes: BusRouteRow[]; riders: RiderRow[]; canWrite: boolean; say: (m: string, tone?: 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const classes = useMemo(() => [...new Set(riders.map((r) => r.className))], [riders]);
  const [cls, setCls] = useState(classes[0] ?? '');
  const [q, setQ] = useState('');
  const set = useMutation({
    mutationFn: app.api.transport.rider,
    onSuccess: (_r, b) => { void qc.invalidateQueries({ queryKey: ['transport'] }); const who = riders.find((x) => x.studentId === b.studentId)?.student ?? tr('admin.transport_page.the_student'); say(b.routeId ? tr('admin.transport_page.saved', { who }) : tr('admin.transport_page.no_longer_rides_a_bus', { who })); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  // A name typed finds the student in any class; otherwise one class at a time.
  const term = q.trim().toLowerCase();
  const shown = term ? riders.filter((r) => r.student.toLowerCase().includes(term)).slice(0, 60) : riders.filter((r) => r.className === cls);
  return (
    <Card title={tr('admin.transport_page.who_rides_which_bus')} chip={<span className="tgrow"><Field label={tr('admin.transport_page.find_a_student')} value={q} onChange={setQ} placeholder={tr('admin.transport_page.name')} />{!term && <Select compact aria-label={tr('admin.transport_page.class')} value={cls} onChange={setCls} options={classes.map((c) => ({ value: c, label: c }))} />}</span>} style={{ padding: 0 }}>
      <div className="tbl scroll-x"><div style={{ minWidth: 640 }} className="lscroll">
        <div className="grd th" style={{ '--cols': 'minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr)' } as React.CSSProperties}><span>{tr('admin.transport_page.student')}</span><span>{tr('admin.transport_page.route')}</span><span>{tr('admin.transport_page.stop')}</span></div>
        {shown.map((r) => {
          const route = routes.find((x) => x.id === r.routeId);
          return (
            <div key={r.studentId} className="grd rw" style={{ '--cols': 'minmax(0,1.4fr) minmax(0,1.2fr) minmax(0,1.2fr)', height: 'auto', minHeight: 56, padding: '8px 20px' } as React.CSSProperties}>
              <b style={{ font: '700 13px var(--fb)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.student}{term && <small className="help" style={{ display: 'block', margin: 0 }}>{r.className}</small>}</b>
              <Select compact aria-label={tr('admin.transport_page.route_for', { student: r.student })} disabled={!canWrite || set.isPending} value={r.routeId ?? ''} onChange={(x) => set.mutate({ studentId: r.studentId, routeId: x || null, stopId: null })}
                options={[{ value: '', label: tr('admin.transport_page.does_not_ride') }, ...routes.map((x) => ({ value: x.id, label: x.name }))]} />
              <Select compact aria-label={tr('admin.transport_page.stop_for', { student: r.student })} disabled={!canWrite || !route || set.isPending} value={r.stopId ?? ''} onChange={(x) => set.mutate({ studentId: r.studentId, routeId: r.routeId, stopId: x || null })}
                options={[{ value: '', label: route ? tr('admin.transport_page.choose_a_stop') : '–' }, ...(route?.stops ?? []).map((s) => ({ value: s.id, label: `${s.name}${s.pickup ? ` · ${s.pickup}` : ''}` }))]} />
            </div>
          );
        })}
      </div></div>
    </Card>
  );
}

type StopDraft = { id?: string; name: string; pickup: string; dropTime: string; lat: string; lng: string };

function RouteDialog({ route, onClose, onDone }: { route: BusRouteRow | null; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const [f, setF] = useState({ name: route?.name ?? '', vehicle: route?.vehicle ?? '', driverUserId: route?.driverUserId ?? '', attendantName: route?.attendantName ?? '', attendantPhone: route?.attendantPhone ?? '', trackerId: route?.trackerId ?? '', fee: String(route?.fee ?? 0) });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const [sure, setSure] = useState(false);
  const [stops, setStops] = useState<StopDraft[]>(() => (route?.stops ?? []).map((s) => ({ id: s.id, name: s.name, pickup: s.pickup, dropTime: s.dropTime, lat: s.lat == null ? '' : String(s.lat), lng: s.lng == null ? '' : String(s.lng) })));
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (x: string) => { setF((o) => ({ ...o, [k]: x })); setErr((e) => ({ ...e, [k]: '', _: '' })); };
  const setStop = (i: number, k: keyof StopDraft) => (x: string) => setStops((list) => list.map((s, j) => (j === i ? { ...s, [k]: x } : s)));
  const move = (i: number, by: -1 | 1) => setStops((list) => { const n = [...list]; [n[i + by], n[i]] = [n[i]!, n[i + by]!]; return n; });
  const [dropping, setDropping] = useState<number | null>(null);
  const ridersAt = (id?: string) => route?.stops.find((x) => x.id === id)?.riders ?? 0;
  const channels = useQuery({ queryKey: ['settings', 'channels'], queryFn: app.api.settings.channels, staleTime: 5 * 60_000 });
  const maps = channels.data?.channels.find((c) => c.capability === 'maps')?.state === 'on';
  const body = () => ({ ...f, name: f.name.trim(), driverUserId: f.driverUserId || null, fee: Number(f.fee || 0), stops: stops.filter((s) => s.name.trim()).map((s): StopInput => ({ id: s.id, name: s.name.trim(), pickup: s.pickup, dropTime: s.dropTime, lat: s.lat ? Number(s.lat) : null, lng: s.lng ? Number(s.lng) : null })) });
  const save = useMutation({ mutationFn: () => (route ? app.api.transport.save(route.id, body()) : app.api.transport.add(body())), onSuccess: (r) => onDone(tr('admin.transport_page.was_saved_with_stops', { name: r.name, length: r.stops.length })), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  const del = useMutation({ mutationFn: () => app.api.transport.remove(route!.id), onSuccess: () => onDone(tr('admin.transport_page.was_removed', { name: route!.name })), onError: (e) => { setErr(problem(e)); shake.hit(); } });
  return (
    <Dialog title={route ? tr('admin.transport_page.edit_2', { name: route.name }) : tr('admin.transport_page.add_a_route')} onClose={onClose} width={640} shake={shake.cls}>
      <div className="stack">
        <div className="two"><Field label={tr('admin.transport_page.route_name')} value={f.name} onChange={set('name')} error={err.name} placeholder={tr('admin.transport_page.route_4_baner')} /><Field label={tr('admin.transport_page.bus_number')} value={f.vehicle} onChange={set('vehicle')} placeholder={tr('admin.transport_page.mh12_ab_1234')} /></div>
        <div>
          <SelectField label={tr('admin.transport_page.driver')} value={f.driverUserId} onChange={set('driverUserId')} error={err.driverUserId}
            options={[{ value: '', label: tr('admin.transport_page.no_driver_yet') }, ...(staff.data ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: `${p.name}${p.designation ? ` · ${p.designation}` : ''}` }))]} />
          <div className="help" style={{ marginTop: 6 }}>{tr('admin.transport_page.the_driver_signs_in_to')}</div>
        </div>
        <div className="two"><Field label={tr('admin.transport_page.attendant')} value={f.attendantName} onChange={set('attendantName')} placeholder={tr('admin.transport_page.meena_kale')} /><Field label={tr('admin.transport_page.attendant_s_phone')} type="tel" value={f.attendantPhone} onChange={set('attendantPhone')} hint={tr('admin.transport_page.families_call_the_attendant_or')} /></div>
        <Field label={tr('admin.transport_page.gps_tracker_number_optional')} value={f.trackerId} onChange={set('trackerId')} hint={tr('admin.transport_page.if_the_bus_has_a')} />
        <NumberField label={tr('admin.transport_page.route_fee_for_a_term', { currencySymbol: currencySymbol() })} value={f.fee} onChange={set('fee')} min={0} />
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>{tr('admin.transport_page.stops_in_order')}</div>
          {stops.map((s, i) => (
            <div key={s.id ?? `n${i}`} className="card" style={{ padding: 12, marginBottom: 8, boxShadow: 'none', background: 'var(--s2)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 0 }}><Field label={tr('admin.transport_page.stop_2', { p0: i + 1 })} value={s.name} onChange={setStop(i, 'name')} placeholder={tr('admin.transport_page.baner_gaon')} /></div>
                <button type="button" className="btn sm" aria-label={tr('admin.transport_page.move_up')} disabled={i === 0} onClick={() => move(i, -1)}><Ico d={UP} /></button>
                <button type="button" className="btn sm" aria-label={tr('admin.transport_page.move_down')} disabled={i === stops.length - 1} onClick={() => move(i, 1)}><Ico d={DOWN} /></button>
                <button type="button" className="btn sm" aria-label={tr('admin.transport_page.remove_stop')} onClick={() => (ridersAt(s.id) ? setDropping(i) : setStops((list) => list.filter((_, j) => j !== i)))}><Ico d={X} /></button>
              </div>
              {dropping === i && <div className="tgrow" style={{ marginTop: 8 }}><span className="help">{ridersAt(s.id)} {ridersAt(s.id) === 1 ? tr('admin.transport_page.rider_loses') : tr('admin.transport_page.riders_lose')} {tr('admin.transport_page.this_stop_and_must_be')}</span><button type="button" className="btn sm dngf" onClick={() => { setStops((list) => list.filter((_, j) => j !== i)); setDropping(null); }}>{tr('admin.transport_page.remove_it')}</button><button type="button" className="btn sm" onClick={() => setDropping(null)}>{tr('admin.transport_page.keep')}</button></div>}
              <div className="two"><TimeField label={tr('admin.transport_page.pick_up')} value={s.pickup} onChange={setStop(i, 'pickup')} /><TimeField label={tr('admin.transport_page.drop')} value={s.dropTime} onChange={setStop(i, 'dropTime')} /></div>
              {maps && <PlaceFind placed={!!s.lat} onPick={(p) => setStops((list) => list.map((x, j) => (j === i ? { ...x, lat: String(p.lat), lng: String(p.lng) } : x)))} />}
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setStops((l) => [...l, { name: '', pickup: '', dropTime: '', lat: '', lng: '' }])}>{tr('admin.transport_page.add_a_stop')}</button>
          <div className="help" style={{ marginTop: 6 }}>{maps ? tr('admin.transport_page.with_a_stop_s_place') : tr('admin.transport_page.once_tangent_connects_maps_for')}</div>
        </div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        {route && (sure
          ? <button className="btn dng" style={{ marginRight: 'auto' }} disabled={del.isPending} onClick={() => del.mutate()}>{tr('admin.transport_page.remove')}{' '}{route.name} {tr('admin.transport_page.and_unassign_its')}{' '}{route.riders} {tr('admin.transport_page.riders_2')}</button>
          : <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setSure(true)}>{tr('admin.transport_page.remove_route')}</button>)}
        <button className="btn" onClick={onClose}>{tr('admin.transport_page.cancel')}</button>
        <button className="btn pri" disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>{save.isPending ? tr('admin.transport_page.saving') : tr('admin.transport_page.save_route')}</button>
      </div>
    </Dialog>
  );
}

const KIND = { morning: tr('admin.transport_page.morning'), afternoon: tr('admin.transport_page.afternoon') } as const;

/** Today on every route: which trip runs, where the bus was last seen, who got on and off, and any delay the driver reported. */
function Live({ routes }: { routes: BusRouteRow[] }) {
  return (
    <section className="grid" data-even="">
      {routes.map((r) => {
        const running = r.trips.find((t) => !t.endedAt);
        return (
          <Card key={r.id} span="s6" title={r.name} chip={<span className={`chip ${running ? 'g' : ''}`}>{running ? tr('admin.transport_page.trip_running', { p0: KIND[running.kind] }) : r.trips.length ? tr('admin.transport_page.no_trip_running') : tr('admin.transport_page.not_out_today')}</span>}>
            <div className="kv">{tr('admin.transport_page.bus')}<b>{r.vehicle || '–'}</b></div>
            <div className="kv">{tr('admin.transport_page.driver')}<b>{r.driverName || tr('admin.transport_page.none_chosen')}</b></div>
            <div className="kv">{tr('admin.transport_page.last_seen')}<b>{r.bus ? `${stamp(r.bus.at)}${isLive(r.bus.at) ? tr('admin.transport_page.live_2') : ''}` : tr('admin.transport_page.not_yet_today')}</b></div>
            <RouteMap id={r.id} at={r.bus?.at ?? ''} />
            {!r.trips.length && <div className="help" style={{ marginTop: 8 }}>{tr('admin.transport_page.the_driver_starts_each_trip')}</div>}
            {r.trips.map((t) => (
              <div key={t.id} className="kv" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span style={{ minWidth: 0 }}>{KIND[t.kind]}<small style={{ display: 'block', color: 'var(--ink3)' }}>{stamp(t.startedAt)}{t.endedAt ? tr('admin.transport_page.to', { stamp: stamp(t.endedAt) }) : tr('admin.transport_page.running')}{t.lateMinutes ? tr('admin.transport_page.min_late', { lateMinutes: t.lateMinutes, lateReason: t.lateReason }) : ''}</small></span>
                <b className="num">{t.boarded} {tr('admin.transport_page.on')}{' '}{t.dropped} {tr('admin.transport_page.off')}{t.absent ? tr('admin.transport_page.absent', { absent: t.absent }) : ''}</b>
              </div>
            ))}
          </Card>
        );
      })}
    </section>
  );
}

/** Finds a stop's place through the school's maps connection: type the name or address, pick the right one. */
function PlaceFind({ placed, onPick }: { placed: boolean; onPick: (p: { lat: number; lng: number }) => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState('');
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const found = useQuery({ queryKey: ['places', term], queryFn: () => app.api.transport.places(term), enabled: term.length >= 3 });
  return (
    <div style={{ marginTop: 8 }}>
      <Field label={placed ? tr('admin.transport_page.on_the_map_find_again') : tr('admin.transport_page.find_it_on_the_map')} value={q} onChange={(v) => { setQ(v); setChosen(''); }} placeholder={tr('admin.transport_page.stop_name_or_address')} hint={chosen || undefined} />
      {!chosen && (found.data?.length ?? 0) > 0 && (
        <div className="pks">{found.data!.map((p) => <button key={`${p.lat},${p.lng}`} type="button" className="pk" onClick={() => { onPick(p); setChosen(tr('admin.transport_page.placed_at', { label: p.label })); }}><span><b>{p.label}</b></span></button>)}</div>
      )}
      {!chosen && term.length >= 3 && found.data?.length === 0 && <EmptyNote icon="map" title={tr('admin.transport_page.nothing_found')} body={tr('admin.transport_page.try_the_street_address_or')} />}
    </div>
  );
}

/** The route's stops and the bus on the school's map; nothing without a maps connection. */
function RouteMap({ id, at }: { id: string; at: string }) {
  const app = useApp();
  const q = useQuery({ queryKey: ['transport', 'map', id, at], queryFn: () => app.api.transport.map(id), staleTime: 60_000 });
  if (!q.data?.url) return null;
  return <img src={q.data.url} alt={tr('admin.transport_page.the_route_on_a_map')} loading="lazy" style={{ width: '100%', borderRadius: 12, marginTop: 8, display: 'block', background: 'var(--s2)' }} />;
}

/** Bills every rider of a route its fee as a Transport fee; billing twice under the same name adds nothing. */
function BillDialog({ route, onClose, onDone }: { route: BusRouteRow; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const { shell } = useShellChrome();
  const [title, setTitle] = useState(`${route.name} · ${shell?.term.name || tr('admin.transport_page.this_term')}`);
  const [dueOn, setDueOn] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const bill = useMutation({
    mutationFn: () => app.api.transport.bill(route.id, { title: title.trim(), dueOn }),
    onSuccess: (r) => onDone(tr('admin.transport_page.billed', { created: r.created, p1: r.created === 1 ? 'family was' : 'families were', rupees: rupees(route.fee), p3: r.skipped ? ` ${r.skipped} already had it.` : '' })),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={tr('admin.transport_page.bill_the_riders_of', { name: route.name })} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <p className="help" style={{ margin: 0 }}>{route.riders} {route.riders === 1 ? 'rider' : 'riders'} {tr('admin.transport_page.get_a_transport_fee_of')}{' '}{rupees(route.fee)}.</p>
        <Field label={tr('admin.transport_page.fee_name')} value={title} onChange={(v) => { setTitle(v); setErr({}); }} error={err.title} maxLength={80} />
        <DateField label={tr('admin.transport_page.due_on')} value={dueOn} onChange={(v) => { setDueOn(v); setErr({}); }} error={err.dueOn} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{tr('admin.transport_page.cancel')}</button>
          <button className="btn pri" disabled={bill.isPending || !dueOn || title.trim().length < 3} onClick={() => bill.mutate()}>{bill.isPending ? tr('admin.transport_page.billing') : tr('admin.transport_page.bill', { riders: route.riders })}</button>
        </div>
      </div>
    </Dialog>
  );
}
