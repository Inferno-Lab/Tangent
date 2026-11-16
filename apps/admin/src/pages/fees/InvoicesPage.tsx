import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtNumber, fmtMoneyShort, fmtMoney, type InvoiceListQuery, type StudentDetail } from '@tangent/contracts';
import { EmptyCard, EmptyNote, Segmented, Select, EmptyState, t as tr } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Page, useToast } from '../../app/Page';
import { Avatar, Ico, dateLabel, useFeeHeads, useOpenParam } from '../../app/kit';
import { CollectFeeDialog } from './CollectFee';
import { InvoiceSheet } from './InvoiceSheet';

const money = (n: number) => (n >= 100000 ? fmtMoneyShort(n) : fmtMoney(n));
const STATUS: Record<string, { tone: string; label: string }> = { paid: { tone: 'g', label: tr('admin.invoices_page.paid') }, partial: { tone: 'v', label: tr('admin.invoices_page.part_paid') }, due: { tone: 'a', label: tr('admin.invoices_page.due') }, overdue: { tone: 'c', label: tr('admin.invoices_page.overdue') } };
const SEARCH = 'search';
type Filter = 'all' | 'overdue' | 'due' | 'partial' | 'paid';

export function InvoicesPage({ view, tabs }: { view: 'invoices' | 'receipts'; tabs?: React.ReactNode }) {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [status, setStatus] = useState<Filter>('all');
  const [head, setHead] = useState('');
  const heads = useFeeHeads();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState<StudentDetail | null>(null);
  // The open invoice is in the address (?open=<invoice>); a receipt opens the invoice it paid.
  const [opened, setOpened] = useOpenParam();
  const [rpage, setRpage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1); setRpage(1); }, 250); return () => clearTimeout(t); }, [q]);
  const query: Partial<InvoiceListQuery> = { status: status === 'all' ? undefined : status, head: head || undefined, query: term || undefined, page, limit: 25 };
  const inv = useQuery({ queryKey: ['invoices', query], queryFn: () => app.api.invoices.list(query), placeholderData: (p) => p, enabled: view === 'invoices' });
  const rec = useQuery({ queryKey: ['receipts', term, rpage], queryFn: () => app.api.invoices.receipts(term || undefined, rpage), placeholderData: (p) => p, enabled: view === 'receipts' });
  const open = useMutation({ mutationFn: (id: string) => app.api.students.detail(id), onSuccess: setPaying, onError: (e) => say((e as Error).message, 'bad') });
  const canPay = app.user.permissions.includes('fees.collect');
  const s = inv.data?.summary;
  const pages = Math.max(1, Math.ceil((inv.data?.total ?? 0) / 25));
  const cur = view === 'invoices' ? inv : rec;
  return (
    <Page title={tr('admin.invoices_page.fees')} sub={view === 'invoices' ? tr('admin.invoices_page.every_fee_billed') : tr('admin.invoices_page.every_receipt_given')} toast={toast} loading={cur.isLoading && !cur.data}
      error={cur.isError && !cur.data ? { message: (cur.error as Error).message, retry: () => void cur.refetch() } : null}
      tabs={tabs} actions={<>{view === 'invoices' && <button className="btn" onClick={() => void app.api.invoices.exportCsv({ ...query, page: undefined, limit: undefined }).then((csv) => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })); a.download = 'invoices.csv'; a.click(); URL.revokeObjectURL(a.href);
      }).catch((e: Error) => say(e.message, 'bad'))}>{tr('admin.invoices_page.export')}</button>}</>}
      overlays={<>
        {paying && <CollectFeeDialog student={paying} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); void qc.invalidateQueries({ predicate: (x) => ['invoices', 'receipts', 'fee-summary', 'students', 'dashboard'].includes(String(x.queryKey[0])) }); say(m); }} />}
        {opened && !paying && <InvoiceSheet id={opened} onClose={() => setOpened(null)} say={say} onCollect={(sid) => { setOpened(null); open.mutate(sid); }} />}
      </>}>
      <section className="grid">
        {view === 'invoices' && s && <>
          <div className="tile t-v s4 rise"><span className="lbl">{tr('admin.invoices_page.billed')}</span><div className="big" style={{ marginTop: 8 }}>{money(s.billed)}</div><div style={{ font: '600 13px var(--fb)', opacity: 0.8 }}>{fmtNumber(s.count)} {s.count === 1 ? 'invoice' : 'invoices'} {tr('admin.invoices_page.in_view')}</div></div>
          <div className="tile t-a s4 rise" style={{ '--d': '.05s' } as React.CSSProperties}><span className="lbl">{tr('admin.invoices_page.collected')}</span><div className="big" style={{ marginTop: 8 }}>{money(s.collected)}</div><div style={{ font: '600 13px var(--fb)', opacity: 0.75 }}>{s.billed ? Math.round((s.collected / s.billed) * 100) : 0}{tr('admin.invoices_page.of_what_was_billed')}</div></div>
          <div className="tile t-p s4 rise" style={{ '--d': '.1s' } as React.CSSProperties}><span className="lbl">{tr('admin.invoices_page.still_to_pay')}</span><div className="big" style={{ marginTop: 8, color: s.outstanding ? 'var(--bad)' : undefined }}>{money(s.outstanding)}</div><div style={{ font: '600 13px var(--fb)', color: 'var(--ink3)' }}>{tr('admin.invoices_page.across_the_invoices_in_view')}</div></div>
        </>}
        <div className="card tbl s12 rise" style={{ '--d': '.14s', padding: 0 } as React.CSSProperties}>
          <div className="ch" style={{ padding: '24px 24px 6px', flexWrap: 'wrap', rowGap: 12 }}>
            <h2>{view === 'invoices' ? tr('admin.invoices_page.invoices') : tr('admin.invoices_page.receipts')}</h2>
            <div className="srch" style={{ minWidth: 240, height: 38 }}><Ico d={SEARCH} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'invoices' ? tr('admin.invoices_page.student_or_fee') : tr('admin.invoices_page.student_or_receipt_number')} aria-label={tr('admin.invoices_page.search')} style={{ border: 0, outline: 0, background: 'none', font: '600 13px var(--fb)', color: 'var(--ink)', flex: 1, minWidth: 0 }} /></div>
          </div>
          {view === 'invoices' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '8px 24px 16px', alignItems: 'center' }}>
              <Segmented value={status} onChange={(v) => { setStatus(v); setPage(1); }} label={tr('admin.invoices_page.status')} options={[{ value: 'all', label: tr('admin.invoices_page.all') }, { value: 'overdue', label: tr('admin.invoices_page.overdue') }, { value: 'due', label: tr('admin.invoices_page.due') }, { value: 'partial', label: tr('admin.invoices_page.part_paid') }, { value: 'paid', label: tr('admin.invoices_page.paid') }]} />
              <Select compact aria-label={tr('admin.invoices_page.kind_of_fee')} value={head} onChange={(v) => { setHead(v); setPage(1); }} options={[{ value: '', label: tr('admin.invoices_page.all_fees') }, ...heads]} />
            </div>
          )}
          {view === 'invoices' ? (
            (inv.data?.items.length ?? 0) === 0 ? (
              !(term || status !== 'all' || head) ? <div style={{ padding: '0 24px 24px' }}><EmptyState scene="invoices" label={tr('admin.invoices_page.set_up_the_fee_structure')} onAction={() => app.go('/fees/structure')} /></div> : <div style={{ padding: '0 24px 24px' }}><EmptyCard title={tr('admin.invoices_page.invoices')} chip={{ text: '0', tone: 'v' }} icon="search" heading={term || status !== 'all' || head ? tr('admin.invoices_page.no_invoice_matches') : tr('admin.invoices_page.nothing_has_been_billed_yet')} body={term || status !== 'all' || head ? tr('admin.invoices_page.try_another_word_or_clear') : tr('admin.invoices_page.assign_a_fee_from_the')} actions={term || status !== 'all' || head ? <button className="btn" onClick={() => { setQ(''); setStatus('all'); setHead(''); }}>{tr('admin.invoices_page.clear_filters')}</button> : undefined} /></div>
            ) : (
              <>
                <div className="scroll-x lscroll" data-fill="">
                  <div className="inw" style={{ minWidth: 820 }}>
                    <div className="grd th inv" style={{ '--cols': 'minmax(0,1.6fr) minmax(0,1.3fr) 90px 100px 100px 100px 90px' } as React.CSSProperties}><span>{tr('admin.invoices_page.student')}</span><span className="hs">{tr('admin.invoices_page.fee')}</span><span className="hs">{tr('admin.invoices_page.due')}</span><span style={{ textAlign: 'end' }}>{tr('admin.invoices_page.billed')}</span><span className="hs" style={{ textAlign: 'end' }}>{tr('admin.invoices_page.paid')}</span><span>{tr('admin.invoices_page.status')}</span><span></span></div>
                    {inv.data!.items.map((r) => (
                      <div className="grd rw inv" key={r.id} role="button" tabIndex={0} aria-label={tr('admin.invoices_page.open_for', { title: r.title, studentName: r.studentName })} onClick={() => setOpened(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpened(r.id); }}
                        style={{ '--cols': 'minmax(0,1.6fr) minmax(0,1.3fr) 90px 100px 100px 100px 90px', cursor: 'pointer' } as React.CSSProperties}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Avatar name={r.studentName} size={30} /><span style={{ minWidth: 0 }}><b data-tip={r.studentName} style={{ font: '700 14px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.studentName}</b><small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{tr('admin.invoices_page.class')}{' '}{r.className}</small></span></span>
                        <span className="hs" data-tip={r.title} style={{ font: '600 13px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</span>
                        <span className="hs" style={{ font: '600 13px var(--fb)', color: 'var(--ink2)' }}>{dateLabel(r.dueOn)}</span>
                        <b className="num" style={{ font: '700 13px var(--fb)', textAlign: 'end' }}>{fmtMoney(r.amount - r.waived)}</b>
                        <span className="num hs" style={{ font: '600 13px var(--fb)', textAlign: 'end', color: 'var(--ink2)' }}>{fmtMoney(r.paid)}</span>
                        <span className={`st ${STATUS[r.status]!.tone}`}><i></i>{STATUS[r.status]!.label}</span>
                        <span>{canPay && r.outstanding > 0 && <button className="btn sm" disabled={open.isPending} onClick={(e) => { e.stopPropagation(); open.mutate(r.studentId); }}>{tr('admin.invoices_page.collect')}</button>}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '16px 24px 20px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <span className="help">{tr('admin.invoices_page.page')}{' '}{page} {tr('admin.invoices_page.of')}{' '}{pages} · {fmtNumber(inv.data!.total)} {tr('admin.invoices_page.invoices_2')}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr('admin.invoices_page.previous')}</button><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>{tr('admin.invoices_page.next')}</button></span>
                </div>
              </>
            )
          ) : (rec.data?.items.length ?? 0) === 0 ? (
            <div style={{ padding: '0 24px 24px' }}>{term
              ? <EmptyNote icon="search" title={tr('admin.invoices_page.no_receipt_matches', { term })} body={tr('admin.invoices_page.check_the_spelling_or_search')} />
              : <EmptyState scene="receipts" onAction={() => app.go('/fees')} />}</div>
          ) : (
            <div className="scroll-x lscroll" data-fill="">
              <div style={{ minWidth: 720 }}>
                {rec.data!.items.map((r) => (
                  <button className="rowbtn" key={r.id} onClick={() => setOpened(r.invoiceId)} aria-label={tr('admin.invoices_page.open_receipt', { receiptNo: r.receiptNo })}>
                    <div className="grd rw" style={{ '--cols': '150px minmax(0,1.5fr) minmax(0,1.2fr) 100px 100px' } as React.CSSProperties}>
                      <b className="num" style={{ font: '700 13px var(--fb)' }}>{r.receiptNo}</b>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Avatar name={r.studentName} size={28} /><b data-tip={r.studentName} style={{ font: '700 14px var(--fb)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.studentName}</b></span>
                      <span className="hs" data-tip={r.title} style={{ font: '600 13px var(--fb)', color: 'var(--ink2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.title}</span>
                      <span style={{ font: '600 13px var(--fb)', color: 'var(--ink3)' }}>{dateLabel(r.paidOn)}</span>
                      <b className="num" style={{ font: '700 14px var(--fb)', textAlign: 'end', textDecoration: r.cancelled ? 'line-through' : undefined }} data-tip={r.cancelled ? tr('admin.invoices_page.cancelled', { cancelReason: r.cancelReason }) : undefined}>{fmtMoney(r.amount)}</b>
                    </div>
                  </button>
                ))}
              </div>
              {rec.data!.total > 25 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '16px 24px 20px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <span className="help">{(rpage - 1) * 25 + 1}–{(rpage - 1) * 25 + rec.data!.items.length} {tr('admin.invoices_page.of')}{' '}{fmtNumber(rec.data!.total)} {tr('admin.invoices_page.receipts_2')}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm" disabled={rpage <= 1} onClick={() => setRpage(rpage - 1)}>{tr('admin.invoices_page.previous')}</button><button className="btn sm" disabled={rpage * 25 >= rec.data!.total} onClick={() => setRpage(rpage + 1)}>{tr('admin.invoices_page.next')}</button></span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </Page>
  );
}
