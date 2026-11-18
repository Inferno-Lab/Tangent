import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportQuery } from '@tangent/contracts';
import { Checkbox, DateField, Dialog, Select, SelectField, EmptyState, EmptyNote, currentLanguage, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { Ico, useOpenParam } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';

const DOWNLOAD = 'download';
const PRINT = 'print';
/** Which reports each tab of the page (config-engine: the school module's reports page) holds, by the server's report areas. */
const AREAS: Record<string, string> = { attendance: t('admin.reports_page.attendance'), money: t('admin.reports_page.fees'), learning: t('admin.reports_page.learning'), people: t('admin.reports_page.people') };
/** A number in a cell ("88%", "₹1,200", 12) as a number, so columns sort by value. */
const num = (v: string | number) => (typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, '')) || 0);

export function ReportsPage() {
  const app = useApp();
  const { toast, say } = useToast();
  const { tab, tabs } = usePageTabs('/reports');
  // The open report is in the address (?open=<report>), with its filters kept while it is open.
  const [id, setId] = useOpenParam();
  const [q, setQ] = useState<ReportQuery>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const all = useQuery({ queryKey: ['reports'], queryFn: app.api.reports.list, staleTime: 10 * 60_000 });
  const classes = useQuery({ queryKey: ['classes'], queryFn: app.api.classes, staleTime: 5 * 60_000 });
  const periods = useQuery({ queryKey: ['reports', 'periods'], queryFn: app.api.reports.periods, staleTime: 10 * 60_000 });
  const span = (periods.data ?? []).find((p) => p.from === q.from && p.to === q.to);
  const list = all.data?.filter((r) => r.area === AREAS[tab]);
  const pick = (list?.some((r) => r.id === id) ? id : '') || list?.[0]?.id || '';
  const info = list?.find((r) => r.id === pick);
  const data = useQuery({ queryKey: ['reports', pick, q], queryFn: () => app.api.reports.get(pick, q), enabled: !!pick, placeholderData: (p) => p });
  const open = (next: string) => { setId(next); setQ({}); setSort(null); };
  const download = async () => {
    setBusy(true);
    try {
      const csv = await app.api.reports.csv(pick, q);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
      a.download = t('admin.reports_page.csv', { p0: d?.title ?? 'Report', p1: d?.scope ?? '' });
      a.click();
      URL.revokeObjectURL(a.href);
      say(t('admin.reports_page.report_downloaded'));
    } catch (e) { say((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const d = data.data;
  const rows = d && sort ? [...d.rows].sort((a, b) => {
    const x = a[sort.key] ?? '', y = b[sort.key] ?? '';
    const right = d.columns.find((c) => c.key === sort.key)?.align === 'right';
    return (right ? num(x) - num(y) : String(x).localeCompare(String(y))) * sort.dir;
  }) : d?.rows ?? [];
  const cols = d ? `minmax(0,1.5fr) ${d.columns.slice(1).map(() => 'minmax(64px,1fr)').join(' ')}` : '';
  return (
    <Page title={t('admin.reports_page.reports')} sub={t('admin.reports_page.numbers_you_can_read_download')} toast={toast} loading={all.isLoading && !all.data}
      error={all.isError && !all.data ? { message: (all.error as Error).message, retry: () => void all.refetch() } : null}
      tabs={tabs} overlays={scheduling && pick ? <Schedules reportId={pick} title={info?.title ?? ''} classId={q.classId ?? null} onClose={() => setScheduling(false)} say={say} /> : undefined}
      actions={<>{d && <>
        <button className="btn" onClick={() => setScheduling(true)}>{t('admin.reports_page.send_regularly')}</button>
        <button className="btn" onClick={() => window.print()}><Ico d={PRINT} />{t('admin.reports_page.print')}</button>
        <button className="btn" disabled={busy} onClick={() => void download()}><Ico d={DOWNLOAD} />{busy ? t('admin.reports_page.preparing') : t('admin.reports_page.download_csv')}</button>
      </>}</>}>
      {(list?.length ?? 0) === 0 ? (
        <div><EmptyState scene="reports" onAction={() => app.go('/attendance')} onLink={() => app.go('/fees')} /></div>
      ) : (
        <section className="rpg">
          <nav className="card rpl rise" aria-label={t('admin.reports_page.reports')}>
            {list!.map((r) => (
              <button key={r.id} className={`rpb ${r.id === pick ? 'on' : ''}`} aria-current={r.id === pick} onClick={() => open(r.id)}><b>{r.title}</b><small>{r.blurb}</small></button>
            ))}
          </nav>
          <div className="card tbl rise" style={{ padding: 0, minWidth: 0 }}>
            {!d ? <div className="skc" style={{ height: 320, borderRadius: 24 }} /> : (
              <>
                <div className="ch" style={{ padding: '24px 24px 6px', flexWrap: 'wrap', gap: 10 }}>
                  <h2 style={{ whiteSpace: 'nowrap' }}>{d.title}</h2><span className="chip v">{d.scope}</span>
                  <span className="grow"></span>
                  {info?.filters.includes('class') && <Select compact aria-label={t('admin.reports_page.class')} value={q.classId ?? ''} onChange={(v) => setQ({ ...q, classId: v || undefined })} options={[{ value: '', label: t('admin.reports_page.whole_school') }, ...(classes.data ?? []).map((c) => ({ value: c.id, label: t('admin.reports_page.class_2', { name: c.name }) }))]} />}
                  {info?.filters.includes('dates') && <>
                    {(periods.data?.length ?? 0) > 0 && <Select compact aria-label={t('admin.reports_page.period')} value={span ? `${span.from}|${span.to}` : ''}
                      onChange={(v) => { const [from, to] = v.split('|'); setQ({ ...q, from: from || undefined, to: to || undefined }); }}
                      options={[{ value: '', label: t('admin.reports_page.any_dates') }, ...periods.data!.map((p) => ({ value: `${p.from}|${p.to}`, label: p.name }))]} />}
                    <DateField compact label={t('admin.reports_page.from')} value={q.from ?? ''} onChange={(v) => setQ({ ...q, from: v || undefined })} max={q.to} />
                    <DateField compact label={t('admin.reports_page.to')} value={q.to ?? ''} onChange={(v) => setQ({ ...q, to: v || undefined })} min={q.from} />
                  </>}
                </div>
                <div className="tgrow" style={{ padding: '10px 24px 16px', gap: 8 }}>{d.summary.map((s) => <span className="chip" key={s.label}>{s.label}: <b style={{ color: 'var(--ink)' }}>{s.value}</b></span>)}</div>
                {d.rows.length === 0 ? <div style={{ padding: '0 24px 24px' }}><EmptyNote icon="reports" title={t('admin.reports_page.nothing_to_report_for_this')} body={t('admin.reports_page.it_fills_in_as_the')} /></div> : (
                  <div className="scroll-x">
                    <div style={{ minWidth: Math.max(480, d.columns.length * 96) }}>
                      <div className="grd th" style={{ '--cols': cols } as React.CSSProperties}>
                        {d.columns.map((c) => (
                          <button key={c.key} type="button" className="sortb" style={{ textAlign: c.align, justifyContent: c.align === 'right' ? 'flex-end' : undefined, border: 0, background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer', padding: 0 }}
                            aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 } : { key: c.key, dir: c.align === 'right' ? -1 : 1 })}>
                            {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                          </button>
                        ))}
                      </div>
                      {rows.map((r, i) => {
                        const sid = r._student ? String(r._student) : null;
                        return (
                          <div className="grd rw" key={i} role={sid ? 'button' : undefined} tabIndex={sid ? 0 : undefined} onClick={sid ? () => app.go(`/students?open=${sid}`) : undefined}
                            onKeyDown={sid ? (e) => { if (e.key === 'Enter') app.go(`/students?open=${sid}`); } : undefined} style={{ '--cols': cols, cursor: sid ? 'pointer' : undefined } as React.CSSProperties}>
                            {d.columns.map((c, j) => <span key={c.key} className={j ? 'num' : ''} style={{ textAlign: c.align, font: j ? '600 13px var(--fb)' : '700 14px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} data-tip={String(r[c.key] ?? '')}>{r[c.key]}</span>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </Page>
  );
}

/** A report sent by itself: every week or month, on a day, to chosen staff by email, covering the week or month before. */
function Schedules({ reportId, title, classId, onClose, say }: { reportId: string; title: string; classId: string | null; onClose: () => void; say: (m: string, tone?: 'ok' | 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['report-schedules'], queryFn: app.api.reports.schedules });
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => app.api.staff.list() });
  const [every, setEvery] = useState<'week' | 'month'>('week');
  const [day, setDay] = useState('1');
  const [to, setTo] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const mine = (list.data ?? []).filter((s) => s.reportId === reportId);
  const add = useMutation({ mutationFn: () => app.api.reports.schedule({ reportId, classId, every, day: Number(day), to }),
    onSuccess: (rows) => { qc.setQueryData(['report-schedules'], rows); setTo([]); setErr(''); say(t('admin.reports_page.scheduled')); }, onError: (e) => setErr((e as Error).message) });
  const drop = useMutation({ mutationFn: (id: string) => app.api.reports.unschedule(id), onSuccess: (rows) => qc.setQueryData(['report-schedules'], rows), onError: (e) => setErr((e as Error).message) });
  const weekday = (n: number) => new Intl.DateTimeFormat(currentLanguage(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15 + n)));
  return (
    <Dialog title={t('admin.reports_page.send_title_regularly', { title })} onClose={onClose} width={560}>
      <div className="stack">
        {mine.map((s) => (
          <div key={s.id} className="kv" style={{ alignItems: 'center' }}>
            <span>{s.every === 'week' ? t('admin.reports_page.every_weekday', { day: weekday(s.day) }) : t('admin.reports_page.every_month_on', { day: s.day })} · {s.toNames.join(', ')}</span>
            <button className="btn sm" disabled={drop.isPending} onClick={() => drop.mutate(s.id)}>{t('admin.reports_page.stop')}</button>
          </div>
        ))}
        <div className="two">
          <SelectField label={t('admin.reports_page.how_often')} value={every} onChange={(v) => { setEvery(v as 'week' | 'month'); setDay('1'); }} options={[{ value: 'week', label: t('admin.reports_page.weekly') }, { value: 'month', label: t('admin.reports_page.monthly') }]} />
          <SelectField label={t('admin.reports_page.on')} value={day} onChange={setDay}
            options={every === 'week' ? [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: weekday(n) })) : Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
        </div>
        <div className="fld">
          <label>{t('admin.reports_page.to_whom')}</label>
          <div className="tgrow">{(staff.data ?? []).filter((p) => p.status === 'active' && p.email).map((p) => <Checkbox key={p.id} label={p.name} checked={to.includes(p.id)} onChange={(on) => setTo(on ? [...to, p.id] : to.filter((x) => x !== p.id))} />)}</div>
          <div className="help">{t('admin.reports_page.schedule_help')}</div>
        </div>
        {err && <div className="emsg" role="alert">{err}</div>}
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.reports_page.close')}</button>
          <button className="btn pri" disabled={!to.length || add.isPending} onClick={() => add.mutate()}>{t('admin.reports_page.schedule')}</button>
        </div>
      </div>
    </Dialog>
  );
}
