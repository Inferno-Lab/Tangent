import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { markMeaning, type AttendanceMarkDef, type PeriodRoll } from '@tangent/contracts';
import { EmptyCard, Select, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { problem, useSetting } from '../../app/kit';

type Mark = PeriodRoll['periods'][number]['marks'][string];
const MARK: Record<Mark, { label: string; cls: string }> = { present: { label: t('admin.period_grid.present'), cls: 'p' }, late: { label: t('admin.period_grid.late'), cls: 'l' }, absent: { label: t('admin.period_grid.absent'), cls: 'a' } };

/**
 * Attendance every period: one period at a time, marked by its teacher (or someone who approves requests). The day's roll call is
 * shown beside each name, so a child who came in and then went missing stands out.
 */
export function PeriodGrid({ classId, date, say }: { classId: string; date: string; say: (text: string, tone?: 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const roll = useQuery({ queryKey: ['attendance-periods', classId, date], queryFn: () => app.api.attendance.periods(classId, date) });
  // The day's mark as the school names it, and whether it means the child is away.
  const used = useSetting<AttendanceMarkDef[]>('attendance.statuses', []);
  const dayName = (k: string) => used.find((m) => m.key === k)?.name ?? k;
  const away = (k: string | null) => !!k && ['absent', 'leave'].includes(markMeaning(used, k) ?? '');
  const [period, setPeriod] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, Mark>>({});
  const periods = roll.data?.periods ?? [];
  const p = periods.find((x) => x.period === period) ?? periods.find((x) => x.mine) ?? periods[0];
  useEffect(() => { setDraft({}); }, [classId, date, p?.period]);
  // An unmarked period starts with everyone present who is in school that day; the teacher taps the ones who are not.
  const markOf = (s: PeriodRoll['students'][number]): Mark | undefined =>
    draft[s.studentId] ?? p?.marks[s.studentId] ?? (p?.mine && !p.markedBy && !away(s.day) ? 'present' : undefined);
  const save = useMutation({
    mutationFn: () => app.api.attendance.savePeriod({ classId, date, period: p!.period, marks: roll.data!.students.flatMap((s) => { const m = markOf(s); return m ? [{ studentId: s.studentId, status: m }] : []; }) }),
    onSuccess: (next) => { qc.setQueryData(['attendance-periods', classId, date], next); setDraft({}); say(t('admin.period_grid.saved', { label: p!.label })); },
    onError: (e) => say(Object.values(problem(e))[0] ?? t('admin.period_grid.could_not_save_try_again'), 'bad'),
  });

  if (roll.isLoading) return <div className="skc" style={{ height: 320, borderRadius: 16 }} />;
  if (roll.isError) return <EmptyCard error title={t('admin.period_grid.every_period')} chip={{ text: t('admin.period_grid.couldn_t_load'), tone: 'c' }} icon="warning" heading={t('admin.period_grid.that_didn_t_load')} body={(roll.error as Error).message} actions={<button className="btn pri" onClick={() => void roll.refetch()}>{t('admin.period_grid.try_again')}</button>} />;
  if (!p) return <EmptyCard title={t('admin.period_grid.every_period')} chip={{ text: t('admin.period_grid.0_periods'), tone: 'v' }} icon="calendar" heading={t('admin.period_grid.no_lessons_that_day')} body={t('admin.period_grid.the_class_has_no_periods')} />;
  const students = roll.data!.students;
  const changed = Object.keys(draft).length;
  return (
    <div className="card tbl rcall s12 rise" style={{ padding: 0 }}>
      <div className="ch" style={{ padding: '24px 24px 16px', flexWrap: 'wrap', gap: 12 }}>
        <Select compact aria-label={t('admin.period_grid.period')} value={String(p.period)} onChange={(v) => setPeriod(Number(v))} options={periods.map((x) => ({ value: String(x.period), label: `${x.label} · ${x.subject} · ${x.startsAt}` }))} />
        <span className={`chip ${p.markedBy ? 'g' : 'a'}`}>{p.markedBy ? t('admin.period_grid.marked_by', { markedBy: p.markedBy }) : t('admin.period_grid.not_marked_yet', { teacherName: p.teacherName })}</span>
        <span className="grow"></span>
        {p.mine && changed > 0 && <button className="btn" onClick={() => setDraft({})}>{t('admin.period_grid.discard_changes')}</button>}
        {p.mine && <button className="btn pri" disabled={save.isPending || (!changed && !!p.markedBy)} onClick={() => save.mutate()}>{save.isPending ? t('admin.period_grid.saving') : t('admin.period_grid.save_period')}</button>}
      </div>
      {!p.mine && <p className="help" style={{ margin: '0 24px 12px' }}>{p.teacherName} {t('admin.period_grid.marks_this_period')}</p>}
      <div className="scroll-x" data-fill="">
        {students.map((s) => {
          const m = markOf(s);
          return (
            <div className="grd rw" key={s.studentId} style={{ '--cols': '36px minmax(0,1fr) auto' } as React.CSSProperties}>
              <span className="rn num">{s.rollNo || '–'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <b style={{ font: '700 14px var(--fb)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</b>
                {s.day && <span className={`chip ${away(s.day) ? 'c' : ''}`} data-tip={t('admin.period_grid.the_day_s_roll_call')}>{dayName(s.day)}</span>}
              </span>
              <span className="mk" role="group" aria-label={t('admin.period_grid.for', { label: p.label, name: s.name })}>
                {(Object.keys(MARK) as Mark[]).map((k) => (
                  <button key={k} className={MARK[k].cls} aria-pressed={m === k} disabled={!p.mine} onClick={() => setDraft({ ...draft, [s.studentId]: k })}>{MARK[k].label}</button>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
