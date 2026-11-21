import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LEAVE_TYPES, DEFAULT_STAFF_MARKS, addDays, schoolToday, type AttendanceMarkDef, type LeaveType, type StaffDayRow, type StaffLeaveRow } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, EmptyNote, EmptyState, Field, MonthField, NumberField, Segmented, Select, SelectField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AddBtn, dateLabel, problem, stamp, useSetting } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

type Tab = 'today' | 'leave' | 'balances' | 'month';
const time = (iso: string | null) => (iso ? stamp(iso).split(', ').pop() : '–');
const STATUS = { pending: { label: t('admin.staff_time.waiting'), tone: 'a' }, approved: { label: t('admin.staff_time.approved'), tone: 'g' }, rejected: { label: t('admin.staff_time.declined'), tone: 'c' }, withdrawn: { label: t('admin.staff_time.withdrawn'), tone: '' } } as const;

/** Staff attendance and leave: the day's register (check-ins and the office's marks), leave requests, balances and the month. */
export function StaffTimePage() { const app = useApp();
  const { toast, say } = useToast();
  const { tab: at, tabs } = usePageTabs('/staff-attendance');
  const tab = (at || 'today') as Tab;
  const canManage = app.user.permissions.includes('staffAttendance.manage');
  const [recording, setRecording] = useState(false);
  return (
    <Page title={t('admin.staff_time.staff_attendance')} sub={t('admin.staff_time.sub')} toast={toast} tabs={tabs}
      actions={canManage && tab === 'leave' ? <AddBtn onClick={() => setRecording(true)}>{t('admin.staff_time.record_leave')}</AddBtn> : undefined}
      overlays={recording && <RecordLeave onClose={() => setRecording(false)} onDone={(m) => { setRecording(false); say(m); }} />}>
      {tab === 'today' && <Day canManage={canManage} say={say} />}
      {tab === 'leave' && <Leave canManage={canManage} say={say} onRecord={() => setRecording(true)} />}
      {tab === 'balances' && <Balances canManage={canManage} say={say} />}
      {tab === 'month' && <Month say={say} />}
    </Page>
  );
}

type Say = (m: string, tone?: 'ok' | 'bad') => void;

function Day({ canManage, say }: { canManage: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const [day, setDay] = useState(schoolToday());
  const marks = useSetting<AttendanceMarkDef[]>('staffAttendance.marks', DEFAULT_STAFF_MARKS);
  const q = useQuery({ queryKey: ['staff-day', day], queryFn: () => app.api.staffTime.day(day) });
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  useEffect(() => setEdits({}), [day]);
  const save = useMutation({
    mutationFn: () => app.api.staffTime.mark(day, { marks: Object.entries(edits).map(([userId, status]) => ({ userId, status, note: '' })) }),
    onSuccess: () => { setEdits({}); void qc.invalidateQueries({ queryKey: ['staff-day'] }); say(t('admin.staff_time.marks_saved')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const rows = q.data ?? [];
  const status = (r: StaffDayRow) => (r.userId in edits ? edits[r.userId]! : r.status);
  const counts = { in: rows.filter((r) => r.checkIn).length, late: rows.filter((r) => r.late).length, away: rows.filter((r) => r.leave && !r.leave.half).length, none: rows.filter((r) => !status(r) && !r.leave).length };
  const changed = Object.keys(edits).length;
  return <>
    <section className="grid">
      {[
        { label: t('admin.staff_time.checked_in'), value: counts.in, tone: 'g' }, { label: t('admin.staff_time.late'), value: counts.late, tone: 'a' },
        { label: t('admin.staff_time.on_leave'), value: counts.away, tone: 'v' }, { label: t('admin.staff_time.not_marked'), value: counts.none, tone: counts.none ? 'c' : 'i' },
      ].map((x, i) => <div key={x.label} className={`tile t-${x.tone} s3 rise`} style={{ '--d': `${i * 0.05}s` } as React.CSSProperties}><span className="lbl">{x.label}</span><div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{x.value}</div></div>)}
    </section>
    <Card style={{ padding: 0 }} title={dateLabel(day)} chip={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ width: 170 }}><DateField compact label={t('admin.staff_time.day')} value={day} max={schoolToday()} onChange={(v) => v && setDay(v)} /></div>
      {canManage && <button className="btn sm pri" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{changed ? t('admin.staff_time.save_n', { n: changed }) : t('admin.staff_time.save')}</button>}
    </div>}>
      {q.isLoading ? null : !rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="staff" title={t('admin.staff_time.no_staff')} body={t('admin.staff_time.no_staff_body')} /></div> : <div className="lscroll">{rows.map((r) => (
        <div key={r.userId} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '8px 20px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 180 }}>
            <b style={{ font: '700 14px/1.3 var(--fb)' }}>{r.name}</b>
            <small className="help" style={{ display: 'block', margin: 0 }}>{r.designation}{r.lessons ? ` · ${t('admin.staff_time.lessons', { n: r.lessons })}` : ''}</small>
          </span>
          {r.leave && <span className="chip v">{r.leave.typeName}{r.leave.half ? ` · ${r.leave.half === 'am' ? t('admin.staff_time.morning') : t('admin.staff_time.afternoon')}` : ''}</span>}
          {r.late && <span className="chip a">{t('admin.staff_time.late')}</span>}
          {r.early && <span className="chip c">{t('admin.staff_time.left_early')}</span>}
          <small className="help" style={{ margin: 0, minWidth: 110 }}>{r.checkIn ? `${time(r.checkIn)} – ${r.checkOut ? time(r.checkOut) : '…'}` : t('admin.staff_time.no_check_in')}</small>
          {r.leave && !r.leave.half && r.lessons > 0 && <a className="btn sm" href={`${app.base}/timetable`}>{t('admin.staff_time.arrange_cover')}</a>}
          <div style={{ width: 170 }}>
            <Select compact aria-label={t('admin.staff_time.mark_for', { name: r.name })} disabled={!canManage || save.isPending} value={status(r) ?? ''}
              onChange={(v) => setEdits({ ...edits, [r.userId]: v || null })}
              options={[{ value: '', label: t('admin.staff_time.not_marked') }, ...marks.map((m) => ({ value: m.key, label: m.code ? `${m.name} (${m.code})` : m.name }))]} />
          </div>
        </div>
      ))}</div>}
    </Card>
  </>;
}

function Leave({ canManage, say, onRecord }: { canManage: boolean; say: Say; onRecord: () => void }) { const app = useApp();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'all'>('pending');
  const q = useQuery({ queryKey: ['staff-leave', status], queryFn: () => app.api.staffTime.leave(status === 'all' ? undefined : status) });
  const [cancelling, setCancelling] = useState<StaffLeaveRow | null>(null);
  const [note, setNote] = useState('');
  const cancel = useMutation({ mutationFn: () => app.api.staffTime.cancel(cancelling!.id, note), onSuccess: () => { setCancelling(null); setNote(''); void qc.invalidateQueries({ queryKey: ['staff-leave'] }); say(t('admin.staff_time.leave_cancelled')); },
    onError: (e) => say((e as Error).message, 'bad') });
  const rows = q.data ?? [];
  // Nothing waiting is not the same as no leave at all: the scene shows only when the school has no leave on record.
  const any = useQuery({ queryKey: ['staff-leave', 'all'], queryFn: () => app.api.staffTime.leave(undefined), enabled: !!q.data && !rows.length && status !== 'all' });
  const none = !!q.data && !rows.length && (status === 'all' || (any.data && !any.data.length));
  return <>
    <div style={{ marginBottom: 12 }}><Segmented label={t('admin.staff_time.show')} value={status} onChange={setStatus}
      options={[{ value: 'pending', label: t('admin.staff_time.waiting') }, { value: 'approved', label: t('admin.staff_time.approved') }, { value: 'all', label: t('admin.staff_time.all') }]} /></div>
    {none ? <EmptyState scene="staffleave" onAction={canManage ? onRecord : undefined} /> : <Card style={{ padding: 0 }}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="calendar" title={status === 'pending' ? t('admin.staff_time.nothing_waiting') : t('admin.staff_time.no_leave_yet')}
        body={t('admin.staff_time.leave_empty_body')} action={canManage ? <button className="btn sm" onClick={onRecord}>{t('admin.staff_time.record_leave')}</button> : undefined} /></div>
        : <div className="lscroll">{rows.map((r) => (
          <div key={r.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 200 }}>
              <b style={{ font: '700 14px/1.3 var(--fb)' }}>{r.name} · {r.typeName}</b>
              <small className="help" style={{ display: 'block', margin: 0 }}>
                {r.halfDay ? `${dateLabel(r.from)}, ${r.halfDay === 'am' ? t('admin.staff_time.morning') : t('admin.staff_time.afternoon')}` : r.from === r.to ? dateLabel(r.from) : `${dateLabel(r.from)} – ${dateLabel(r.to)}`}
                {' · '}{t('admin.staff_time.n_days', { n: r.days })}{r.reason ? ` · ${r.reason}` : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}
              </small>
            </span>
            <span className={`chip ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
            {r.status === 'pending' && <a className="btn sm" href={`${app.base}/approvals`}>{t('admin.staff_time.decide')}</a>}
            {canManage && (r.status === 'approved' || r.status === 'pending') && r.to >= schoolToday() && <button className="btn sm" onClick={() => setCancelling(r)}>{t('admin.staff_time.cancel')}</button>}
          </div>
        ))}</div>}
    </Card>}
    {cancelling && (
      <Dialog title={t('admin.staff_time.cancel_leave')} onClose={() => setCancelling(null)} width={460}>
        <p className="help" style={{ marginTop: 0 }}>{t('admin.staff_time.cancel_leave_body', { name: cancelling.name })}</p>
        <Field label={t('admin.staff_time.why_optional')} value={note} onChange={setNote} maxLength={200} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn" onClick={() => setCancelling(null)}>{t('admin.staff_time.keep')}</button>
          <button className="btn dngf" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t('admin.staff_time.cancel_leave')}</button>
        </div>
      </Dialog>
    )}
  </>;
}

/** The office records leave someone took or will take (by phone, on paper): approved at once. */
function RecordLeave({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const types = useSetting<LeaveType[]>('staffLeave.types', DEFAULT_LEAVE_TYPES).filter((x) => x.active !== false);
  const [f, setF] = useState({ userId: '', type: types[0]?.key ?? '', from: schoolToday(), to: schoolToday(), half: '' as '' | 'am' | 'pm', reason: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const type = types.find((x) => x.key === f.type);
  const save = useMutation({
    mutationFn: () => app.api.staffTime.record({ userId: f.userId, type: f.type, from: f.from, to: f.half ? f.from : f.to, halfDay: f.half || null, reason: f.reason }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['staff-leave'] }); void qc.invalidateQueries({ queryKey: ['staff-day'] }); onDone(t('admin.staff_time.leave_recorded', { name: r.name })); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={t('admin.staff_time.record_leave')} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <SelectField label={t('admin.staff_time.who')} value={f.userId} error={err.userId} onChange={(v) => setF({ ...f, userId: v })}
          options={[{ value: '', label: t('admin.staff_time.choose') }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        <SelectField label={t('admin.staff_time.type')} value={f.type} error={err.type} onChange={(v) => setF({ ...f, type: v, half: '' })} options={types.map((x) => ({ value: x.key, label: x.name }))} />
        <div className="two">
          <DateField label={t('admin.staff_time.from')} value={f.from} error={err.from} onChange={(v) => setF({ ...f, from: v, to: v > f.to ? v : f.to })} />
          {!f.half && <DateField label={t('admin.staff_time.to')} value={f.to} error={err.to} min={f.from} max={addDays(f.from, 366)} onChange={(v) => setF({ ...f, to: v })} />}
        </div>
        {type?.halfDays && <Segmented label={t('admin.staff_time.how_long')} value={f.half} onChange={(v) => setF({ ...f, half: v })}
          options={[{ value: '', label: t('admin.staff_time.whole_days') }, { value: 'am', label: t('admin.staff_time.morning') }, { value: 'pm', label: t('admin.staff_time.afternoon') }]} />}
        <Field label={t('admin.staff_time.reason_optional')} value={f.reason} onChange={(v) => setF({ ...f, reason: v })} maxLength={500} />
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.staff_time.cancel')}</button>
        <button className="btn pri" disabled={!f.userId || save.isPending} onClick={() => save.mutate()}>{t('admin.staff_time.record')}</button>
      </div>
    </Dialog>
  );
}

function Balances({ canManage, say }: { canManage: boolean; say: Say }) { const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['staff-balances'], queryFn: app.api.staffTime.balances });
  const [adjusting, setAdjusting] = useState<{ userId: string; name: string } | null>(null);
  const types = useSetting<LeaveType[]>('staffLeave.types', DEFAULT_LEAVE_TYPES);
  const [f, setF] = useState({ type: types[0]?.key ?? '', days: '1', note: '', less: false });
  const [err, setErr] = useState<Record<string, string>>({});
  const adjust = useMutation({
    mutationFn: () => app.api.staffTime.adjust({ userId: adjusting!.userId, type: f.type, days: (f.less ? -1 : 1) * Number(f.days), note: f.note }),
    onSuccess: () => { setAdjusting(null); void qc.invalidateQueries({ queryKey: ['staff-balances'] }); say(t('admin.staff_time.balance_changed')); },
    onError: (e) => setErr(problem(e)),
  });
  const rows = q.data?.rows ?? [];
  return <>
    <Card style={{ padding: 0 }} title={q.data ? t('admin.staff_time.leave_year', { year: q.data.year }) : undefined}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="staff" title={t('admin.staff_time.no_staff')} body={t('admin.staff_time.no_staff_body')} /></div> : <div className="lscroll">{rows.map((r) => (
        <div key={r.userId} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
          <b style={{ flex: '0 0 180px', font: '700 14px/1.3 var(--fb)' }}>{r.name}</b>
          <span style={{ flex: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.balances.map((b) => (
              <span key={b.type} className={`chip ${b.available !== null && b.available <= 0 ? 'c' : ''}`} data-tip={t('admin.staff_time.balance_tip', { given: b.allowance + b.carried + b.adjusted, used: b.used, waiting: b.pending })}>
                {b.name}: {b.available === null ? t('admin.staff_time.taken_n', { n: b.used }) : t('admin.staff_time.left_n', { n: b.available })}
              </span>
            ))}
          </span>
          {canManage && <button className="btn sm" onClick={() => { setErr({}); setAdjusting(r); }}>{t('admin.staff_time.change_balance')}</button>}
        </div>
      ))}</div>}
    </Card>
    {adjusting && (
      <Dialog title={t('admin.staff_time.change_balance_of', { name: adjusting.name })} onClose={() => setAdjusting(null)} width={480}>
        <div className="stack">
          <SelectField label={t('admin.staff_time.type')} value={f.type} onChange={(v) => setF({ ...f, type: v })} options={types.map((x) => ({ value: x.key, label: x.name }))} />
          <Segmented label={t('admin.staff_time.change')} value={f.less ? 'less' : 'more'} onChange={(v) => setF({ ...f, less: v === 'less' })}
            options={[{ value: 'more', label: t('admin.staff_time.add_days') }, { value: 'less', label: t('admin.staff_time.take_days_away') }]} />
          <NumberField label={t('admin.staff_time.days')} value={f.days} min={0.5} max={366} step={0.5} decimals error={err.days} onChange={(v) => setF({ ...f, days: v })} />
          <Field label={t('admin.staff_time.why')} value={f.note} error={err.note} onChange={(v) => setF({ ...f, note: v })} maxLength={200} />
          {err._ && <div className="emsg" role="alert">{err._}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="btn" onClick={() => setAdjusting(null)}>{t('admin.staff_time.cancel')}</button>
          <button className="btn pri" disabled={adjust.isPending || f.note.trim().length < 3 || !(Number(f.days) > 0)} onClick={() => adjust.mutate()}>{t('admin.staff_time.save')}</button>
        </div>
      </Dialog>
    )}
  </>;
}

function Month({ say }: { say: Say }) { const app = useApp();
  const [month, setMonth] = useState(schoolToday().slice(0, 7));
  const [paidOnly, setPaidOnly] = useState(false);
  const q = useQuery({ queryKey: ['staff-month', month], queryFn: () => app.api.staffTime.month(month) });
  const download = async () => {
    try {
      const csv = await app.api.staffTime.monthCsv(month);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `staff-attendance-${month}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { say((e as Error).message, 'bad'); }
  };
  const rows = (q.data ?? []).filter((r) => !paidOnly || r.leaveUnpaid > 0 || r.absent > 0);
  return (
    <Card style={{ padding: 0 }} chip={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ width: 180 }}><MonthField label={t('admin.staff_time.month')} value={month} onChange={setMonth} /></div>
      <Checkbox checked={paidOnly} onChange={setPaidOnly} label={t('admin.staff_time.only_absence_or_unpaid')} />
      <button className="btn sm" onClick={() => void download()}>{t('admin.staff_time.download_for_payroll')}</button>
    </div>} title={t('admin.staff_time.the_month')}>
      {!rows.length ? <div style={{ padding: 20 }}><EmptyNote icon="calendar" title={t('admin.staff_time.nothing_this_month')} body={t('admin.staff_time.nothing_this_month_body')} /></div> : <div className="lscroll">{rows.map((r) => (
        <div key={r.userId} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 48, padding: '8px 20px', flexWrap: 'wrap' }}>
          <b style={{ flex: '1 1 180px', font: '700 14px/1.3 var(--fb)' }}>{r.name}</b>
          <span className="chip g">{t('admin.staff_time.present_n', { n: r.present, of: r.schoolDays })}</span>
          {r.late > 0 && <span className="chip a">{t('admin.staff_time.late_n', { n: r.late })}</span>}
          {r.absent > 0 && <span className="chip c">{t('admin.staff_time.absent_n', { n: r.absent })}</span>}
          {r.leavePaid > 0 && <span className="chip v">{t('admin.staff_time.paid_leave_n', { n: r.leavePaid })}</span>}
          {r.leaveUnpaid > 0 && <span className="chip c">{t('admin.staff_time.unpaid_leave_n', { n: r.leaveUnpaid })}</span>}
          {r.unmarked > 0 && <span className="chip">{t('admin.staff_time.unmarked_n', { n: r.unmarked })}</span>}
        </div>
      ))}</div>}
    </Card>
  );
}
