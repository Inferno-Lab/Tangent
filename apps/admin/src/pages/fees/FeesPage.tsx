import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtMoneyShort, fmtMoney, type StudentDetail } from '@tangent/contracts';
import { EmptyNote, Dialog, EmptyState, Icon, Roll, Select, rollDigits, t, busyFor } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { StudentPick } from '../../app/kit';
import { usePageTabs } from '../../app/tabs';
import { CollectFeeDialog } from './CollectFee';
import { FeeStructure } from './FeeStructure';
import { InvoicesPage } from './InvoicesPage';
import { OnlinePaymentsPage } from './OnlinePaymentsPage';

const money = (n: number) => (n >= 100000 ? fmtMoneyShort(n) : fmtMoney(n));

/** Fees: one page whose tabs the fees module defines (overview, invoices, receipts, online payments, the fee structure). */
export function FeesPage() { const { tab, tabs } = usePageTabs('/fees');
  if (tab === 'invoices' || tab === 'receipts') return <InvoicesPage view={tab} tabs={tabs} />;
  if (tab === 'online') return <OnlinePaymentsPage tabs={tabs} />;
  if (tab === 'structure') return <FeeStructure tabs={tabs} />;
  return <Overview tabs={tabs} />;
}

// Kinds of fee take spectrum colours in order, as the board's payment methods do.
const HEAD_COLOURS = ['blue', 'pink', 'lime', 'orange', 'teal', 'violet'] as const;

function Overview({ tabs }: { tabs: React.ReactNode }) { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [paying, setPaying] = useState<StudentDetail | null>(null);
  // "Collect a fee" (dashboard, or the N F keys) lands here with ?collect=1: pick the student, then record the payment.
  const asked = new URLSearchParams(window.location.search).get('collect');
  const [picking, setPicking] = useState(() => asked === '1');
  const [period, setPeriod] = useState<'month' | 'term' | 'year'>('month');
  const [page, setPage] = useState(1);
  const [confirmRemind, setConfirmRemind] = useState(false);
  const summary = useQuery({ queryKey: ['fee-summary', period], queryFn: () => app.api.fees.summary(period), placeholderData: (p) => p });
  const overdue = useQuery({ queryKey: ['students', 'overdue', page], queryFn: () => app.api.students.list({ feeStatus: 'overdue', sort: 'due', dir: 'desc', page, limit: 25 }), placeholderData: (p) => p });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => ['fee-summary', 'students', 'dashboard'].includes(String(q.queryKey[0])) });
  const open = useMutation({ mutationFn: (id: string) => app.api.students.detail(id), onSuccess: setPaying, onError: (e) => say((e as Error).message, 'bad') });
  // Every overdue family, not only the page shown; how it travels is the console's rule for the fee reminder.
  const remind = useMutation({ mutationFn: () => app.api.fees.remindOverdue(),
    onSuccess: (r) => { setConfirmRemind(false); say(r.sent ? t('admin.fees_page.reminder_sent_to', { sent: r.sent }) : t('admin.fees_page.no_overdue_family_has_a')); },
    onError: (e) => say((e as Error).message, 'bad') });
  const s = summary.data;
  const rows = overdue.data?.items ?? [];
  const canPay = app.user.permissions.includes('fees.collect');
  // From a student's record (?collect=<student>): their payment opens straight away.
  useEffect(() => { if (asked && asked !== '1' && canPay) { open.mutate(asked); history.replaceState(null, '', window.location.pathname); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const err = [summary, overdue].find((q) => q.isError && !q.data);
  return (
    <Page title={t('admin.fees_page.fees')} sub={s ? t('admin.fees_page.of_what_is_due_has', { monthLabel: s.monthLabel, pct: s.pct }) : t('admin.fees_page.collections_and_dues')} toast={toast} loading={summary.isLoading}
      error={err ? { message: (err.error as Error).message, retry: () => void err.refetch() } : null}
      tabs={tabs} filters={<Select compact aria-label={t('admin.fees_page.period')} value={period} onChange={(v) => setPeriod(v as typeof period)} options={[{ value: 'month', label: t('admin.fees_page.this_month') }, { value: 'term', label: t('admin.fees_page.this_term') }, { value: 'year', label: t('admin.fees_page.this_year') }]} />} actions={<>{canPay && <button className="btn pri" onClick={() => setPicking(true)}>{t('admin.fees_page.collect_a_fee')}</button>}</>}
      overlays={<>
        {paying && <CollectFeeDialog student={paying} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); refresh(); say(m); }} />}
        {picking && canPay && !paying && (
          <Dialog title={t('admin.fees_page.collect_a_fee')} onClose={() => { setPicking(false); history.replaceState(null, '', window.location.pathname); }} width={480}>
            <StudentPick label={t('admin.fees_page.whose_fee')} value={null} onChange={(s) => { if (s) { setPicking(false); history.replaceState(null, '', window.location.pathname); open.mutate(s.id); } }} />
          </Dialog>
        )}
      </>}>
      {s && s.due === 0 && s.collected === 0 && !s.byHead.length ? <EmptyState scene="fees" onAction={() => app.go('/fees/structure')} /> : s && (
        // As the Fees board (design/hue/src/Fees.html): the month on the deep colour, what is due and overdue, each day, each kind of fee, who is late.
        <div className="hb" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="g" style={{ gridTemplateColumns: 'minmax(0,1.5fr) repeat(2,minmax(0,1fr))' }}>
            <section className="card deep">
              <span className="lbl">{t('admin.fees_page.collected_in')}{' '}{s.monthLabel}</span>
              <div className="fig" style={{ fontSize: 'clamp(34px, 11vw, 64px)' }}><Roll digits={rollDigits(money(s.collected))} /></div>
              <div className="bar" style={{ height: 10, background: 'var(--deep3)' }}><i style={{ width: `${s.pct}%`, background: 'var(--bright)' }} /></div>
              <span className="note">{s.pct}{t('admin.fees_page.of')}{' '}{money(s.due)} · {money(Math.max(0, s.due - s.collected))} {t('admin.fees_page.still_to_come')}</span>
            </section>
            <section className="card">
              <span className="lbl">{t('admin.fees_page.not_yet_due')}</span>
              <b className="d" style={{ fontSize: 40, lineHeight: '44px' }}>{money(s.pending)}</b>
              <small className="t2" style={{ fontSize: 14 }}>{t('admin.fees_page.falls_due_later')}{' '}{period === 'month' ? t('admin.fees_page.this_month_2') : period === 'term' ? t('admin.fees_page.this_term_2') : t('admin.fees_page.this_year_2')}</small>
              {s.collectedDelta !== 0 && <span className={`tag ${s.collectedDelta > 0 ? 'ok' : 'bad'}`} style={{ alignSelf: 'flex-start', marginTop: 'auto' }}><Icon name={s.collectedDelta > 0 ? 'upRight' : 'downRight'} size={14} className="i" />{Math.abs(s.collectedDelta)}{t('admin.fees_page.on_last')}{' '}{period}</span>}
            </section>
            <section className="card">
              <span className="lbl">{t('admin.fees_page.overdue')}</span>
              <b className="d" style={{ fontSize: 40, lineHeight: '44px', color: 'var(--bad-i)' }}>{money(s.overdue)}</b>
              <small className="t2" style={{ fontSize: 14 }}>{t('admin.fees_page.n_families', { n: s.overdueFamilies })}</small>
              {s.overdueFamilies > 0 && app.user.permissions.includes('fees.read') && (confirmRemind
                ? <span className="fx" style={{ gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}><button className="btn pri sm" disabled={remind.isPending} onClick={() => remind.mutate()}>{t('admin.fees_page.remind_all')}{' '}{s.overdueFamilies}</button><button className="btn sm" onClick={() => setConfirmRemind(false)}>{t('admin.fees_page.not_now')}</button></span>
                : <button className="btn ton sm" style={{ alignSelf: 'flex-start', marginTop: 'auto' }} onClick={() => setConfirmRemind(true)}>{t('admin.fees_page.send_reminders')}</button>)}
            </section>
          </div>
          <div className="g" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
            <section className="card">
              <div className="ch"><h2>{t('admin.fees_page.collected_each_day')}</h2><small>{s.dailyTarget ? t('admin.fees_page.target_a_day', { money: money(s.dailyTarget) }) : t('admin.fees_page.this_period')}</small></div>
              {s.daily.some((x) => x.amount > 0) ? (
                <div className="fx" role="img" aria-label={t('admin.fees_page.fees_collected_each_day')} style={{ alignItems: 'flex-end', gap: 8, height: 180 }}>
                  {s.daily.slice(-14).map((x) => { const top = Math.max(...s.daily.map((y) => y.amount), 1);
                    return (
                      <div key={x.date} className="vc" style={{ flex: 1, alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }} data-tip={`${x.full}: ${money(x.amount)}`}>
                        {x.amount > 0 && <b className="num" style={{ fontSize: 12 }}>{money(x.amount)}</b>}
                        <i style={{ display: 'block', width: '100%', height: `${Math.max(4, (x.amount / top) * 120)}px`, borderRadius: 7, background: x.isToday ? 'var(--brand)' : 'var(--brand-line)' }} />
                        <small className="t3" style={{ fontSize: 12 }}>{x.label}</small>
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyNote icon="payments" title={t('admin.fees_page.no_payments_yet')} body={t('admin.fees_page.payments_appear_here_day_by')} />}
            </section>
            <section className="card">
              <div className="ch"><h2>{t('admin.fees_page.by_kind_of_fee')}</h2><small>{s.monthLabel}</small></div>
              {s.byHead.length ? (
                <>
                  <div className="bar" style={{ height: 14, borderRadius: 7, gap: 3 }} aria-hidden="true">
                    {s.byHead.map((h, i) => <i key={h.head} className={`sp-${HEAD_COLOURS[i % HEAD_COLOURS.length]}`} style={{ flex: Math.max(h.collected, 1), background: 'var(--c)' }} />)}
                  </div>
                  <div className="vc" style={{ gap: 2 }}>
                    {s.byHead.map((h, i) => (
                      <div key={h.head} className="kv"><span className="fx" style={{ gap: 8 }}><i className={`dot sp-${HEAD_COLOURS[i % HEAD_COLOURS.length]}`} />{h.label}</span><b>{h.pct}%</b><span className="t2 num" style={{ minWidth: 92, textAlign: 'end' }}>{money(h.collected)}</span></div>
                    ))}
                  </div>
                </>
              ) : <p className="t2" style={{ fontSize: 14 }}>{t('admin.fees_page.fees_by_kind_appear_once')}</p>}
            </section>
          </div>
          <section className="card flush">
            <div className="ch" style={{ padding: '20px 20px 8px' }}><h2>{t('admin.fees_page.overdue')}</h2><small>{t('admin.fees_page.n_families', { n: overdue.data?.total ?? 0 })} {t('admin.fees_page.largest_first')}</small></div>
            {rows.length === 0 && !overdue.isLoading ? <div style={{ padding: '0 20px 20px' }}><EmptyNote icon="checkCircle" title={t('admin.fees_page.nobody_is_overdue_families_with')} /></div> : (
              <div className="scroll-x" data-fill="">
                <div style={{ minWidth: 620 }}>
                  <div className="trow h" style={{ '--cols': 'minmax(0,1.6fr) 70px minmax(0,1.2fr) 110px 110px' } as React.CSSProperties}><span>{t('admin.fees_page.student')}</span><span>{t('admin.fees_page.class')}</span><span>{t('admin.fees_page.parent')}</span><span className="r">{t('admin.fees_page.amount')}</span><span /></div>
                  {rows.map((r) => (
                    <div key={r.id} className="trow" role="button" tabIndex={0} style={{ '--cols': 'minmax(0,1.6fr) 70px minmax(0,1.2fr) 110px 110px', cursor: 'pointer' } as React.CSSProperties}
                      onClick={() => app.go(`/students?open=${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') app.go(`/students?open=${r.id}`); }} aria-label={t('admin.fees_page.open', { name: r.name })}>
                      <span className="fx" style={{ gap: 12, minWidth: 0 }}><span className="av sm">{r.initials}</span><b className="cut">{r.name}</b></span>
                      <span>{r.className}</span>
                      <span className="t2 cut">{r.guardianName}</span>
                      <b className="num r">{fmtMoney(r.amountDue)}</b>
                      <span className="r">{canPay && <button className="btn ton sm" disabled={busyFor(open, r.id)} onClick={(e) => { e.stopPropagation(); open.mutate(r.id); }}>{t('admin.fees_page.collect')}</button>}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(overdue.data?.total ?? 0) > 25 && (
              <div className="fx" style={{ justifyContent: 'space-between', padding: '12px 20px 20px', gap: 10 }}>
                <span className="t2" style={{ fontSize: 13 }}>{(page - 1) * 25 + 1}–{(page - 1) * 25 + rows.length} {t('admin.fees_page.of_2')}{' '}{overdue.data!.total}</span>
                <span className="fx" style={{ gap: 8 }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('admin.fees_page.previous')}</button><button className="btn sm" disabled={page * 25 >= overdue.data!.total} onClick={() => setPage(page + 1)}>{t('admin.fees_page.next')}</button></span>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
