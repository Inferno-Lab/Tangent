import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TimetableCycle, addDays, dayName, schoolToday, slotDays, weekday } from '@tangent/contracts';
import { ErrorLine, Select, TimeField, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card } from '../../app/Page';
import { problem, useSetting } from '../../app/kit';

/**
 * A day with its own bell times (a short Friday, the youngest classes leaving early): for every class or one class, on one
 * day of the school's timetable cycle. Periods left at their usual times stay usual; none different puts the day back.
 */
export function BellDays({ say }: { say: (m: string, tone?: 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const cycleRaw = useSetting<unknown>('timetable.cycle', { kind: 'week', length: 6 });
  const off = useSetting<string[]>('calendar.weeklyOff', ['sun']);
  const cycle = TimetableCycle.safeParse(cycleRaw).data ?? { kind: 'week' as const, length: 6 };
  const offIso = off.map((d) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(d) + 1).filter((d) => d > 0);
  const days = slotDays(cycle, offIso);
  // This week's Monday names the weekdays in the reader's language.
  const monday = addDays(schoolToday(), -((weekday(schoolToday()) + 6) % 7));
  const nameOf = (d: (typeof days)[number]) => (d.n ? t('admin.bell_days.day_n', { n: d.n }) : `${dayName(addDays(monday, (d.day - 1) % 7))}${d.week ? ` ${d.week.toUpperCase()}` : ''}`);
  const setup = useQuery({ queryKey: ['setup'], queryFn: app.api.setup.sections });
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const times = useQuery({ queryKey: ['period-times'], queryFn: app.api.timetable.times });
  const periods = useMemo(() => (setup.data?.find((s) => s.kind === 'periods')?.rows ?? [])
    .map((r) => ({ idx: Number(r.number), label: r.label ?? '', starts: r.starts_at ?? '', ends: r.ends_at ?? '' })).sort((a, b) => a.starts.localeCompare(b.starts)), [setup.data]);
  const [day, setDay] = useState(String(days[0]?.day ?? 1));
  const [classId, setClassId] = useState('');
  const own = (times.data ?? []).filter((x) => x.day === Number(day) && (x.classId ?? '') === classId);
  const [draft, setDraft] = useState<Record<number, { starts: string; ends: string }>>({});
  // Starts from the day's own times, else the usual ones.
  useEffect(() => { setDraft(Object.fromEntries(periods.map((p) => { const o = own.find((x) => x.period === p.idx); return [p.idx, { starts: o?.starts ?? p.starts, ends: o?.ends ?? p.ends }]; }))); }, [day, classId, times.data, periods]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (reset: boolean) => app.api.timetable.putTimes({ day: Number(day), classId: classId || null,
      times: reset ? [] : periods.filter((p) => draft[p.idx] && (draft[p.idx]!.starts !== p.starts || draft[p.idx]!.ends !== p.ends)).map((p) => ({ period: p.idx, ...draft[p.idx]! })) }),
    onSuccess: (r, reset) => { qc.setQueryData(['period-times'], r); void qc.invalidateQueries({ queryKey: ['timetable'] }); setErr({}); say(reset ? t('admin.bell_days.back_to_usual') : t('admin.bell_days.saved')); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  if (!periods.length) return null;
  return (
    <div className={shake.cls}>
      <Card title={t('admin.bell_days.a_day_with_its_own_times')} chip={own.length ? <span className="chip v">{t('admin.bell_days.n_changed', { n: own.length })}</span> : undefined}>
        <p className="help" style={{ marginTop: 0 }}>{t('admin.bell_days.help')}</p>
        <div className="tgrow">
          <Select aria-label={t('admin.bell_days.day')} value={day} onChange={setDay} options={days.map((d) => ({ value: String(d.day), label: nameOf(d) }))} />
          <Select aria-label={t('admin.bell_days.which_classes')} value={classId} onChange={setClassId} options={[{ value: '', label: t('admin.bell_days.every_class') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
        {periods.map((p) => (
          <div key={p.idx} className="kv" style={{ alignItems: 'center', gap: 12 }}>
            <span style={{ minWidth: 120 }}>{p.label}<small style={{ display: 'block', color: 'var(--ink3)' }}>{p.starts}–{p.ends}</small></span>
            <span className="two" style={{ flex: 1 }}>
              <TimeField label={t('admin.bell_days.starts')} value={draft[p.idx]?.starts ?? p.starts} onChange={(v) => setDraft({ ...draft, [p.idx]: { ...(draft[p.idx] ?? p), starts: v } })} />
              <TimeField label={t('admin.bell_days.ends')} value={draft[p.idx]?.ends ?? p.ends} onChange={(v) => setDraft({ ...draft, [p.idx]: { ...(draft[p.idx] ?? p), ends: v } })} />
            </span>
          </div>
        ))}
        {Object.values(err)[0] && <ErrorLine>{Object.values(err)[0]}</ErrorLine>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          {own.length > 0 && <button className="btn" disabled={save.isPending} onClick={() => save.mutate(true)}>{t('admin.bell_days.use_the_usual_times')}</button>}
          <button className="btn pri" disabled={save.isPending} onClick={() => save.mutate(false)}>{save.isPending ? t('admin.bell_days.saving') : t('admin.bell_days.save_this_day')}</button>
        </div>
      </Card>
    </div>
  );
}
