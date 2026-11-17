import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { CAPABILITY_LABELS, schoolToday, type Capability, type InvoiceRowC } from '@tangent/contracts';
import { DateField, Dialog, EmptyCard, Field, MonthField, Select, useShake, EmptyState, EmptyNote, t as tr } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { count, price, when } from '../../app/format';

const TONE: Record<InvoiceRowC['status'], string> = { draft: 'n', sent: 'v', paid: 'g', overdue: 'c' };
const WORDS: Record<InvoiceRowC['status'], string> = { draft: tr('console.billing_page.not_sent'), sent: tr('console.billing_page.sent'), paid: tr('console.billing_page.paid'), overdue: tr('console.billing_page.overdue') };
const COLS = 'minmax(0,2fr) 100px 120px 120px 110px';
const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One invoice per live school each month: students times the plan's yearly price, divided by twelve, plus modules added on top. */
export function BillingPage() { const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [school, setSchool] = useState(() => new URLSearchParams(window.location.search).get('school') ?? '');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<InvoiceRowC | null>(null);
  const inv = useQuery({ queryKey: ['invoices'], queryFn: app.api.billing.invoices, enabled: app.can('billing.read') });
  const usage = useQuery({ queryKey: ['billing-usage'], queryFn: app.api.billing.usage, enabled: app.can('billing.read') });
  const fleet = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools(), staleTime: 60_000 });
  const slug = fleet.data?.find((x) => x.id === school)?.slug;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['invoices'] });
  const gen = useMutation({ mutationFn: () => app.api.billing.generate(period), onSuccess: (r) => { refresh(); say(r.created ? tr('console.billing_page.created_for', { created: r.created, period }) : tr('console.billing_page.every_live_school_already_has', { period })); }, onError: (e) => say((e as Error).message, 'bad') });
  if (!app.can('billing.read')) { return (
      <Page title={tr('console.billing_page.billing')} sub={tr('console.billing_page.invoices_for_every_school')}>
        <div><EmptyCard title={tr('console.billing_page.billing')} chip={{ text: tr('console.billing_page.not_for_your_role'), tone: 'a' }} icon="lock" heading={tr('console.billing_page.billing_is_for_the_finance')} body={tr('console.billing_page.ask_a_super_admin_to')} /></div>
      </Page>
    );
  }
  const all = inv.data ?? [];
  const rows = all.filter((r) => (!school || r.schoolId === school) && (!month || r.period === month) && (!status || r.status === status));
  // The tiles are for one month (the one filtered, else the latest), with all time beside them.
  const shownMonth = month || all[0]?.period || '';
  const inMonth = all.filter((r) => r.period === shownMonth);
  const sum = (l: InvoiceRowC[]) => l.reduce((n, r) => n + r.amount, 0);
  const paid = (l: InvoiceRowC[]) => l.filter((r) => r.status === 'paid');
  const months = [...new Set(all.map((r) => r.period))];
  const schools = [...new Map(all.map((r) => [r.schoolId, r.schoolName])).entries()];
  const canWrite = app.can('billing.write');
  return (
    <Page title={tr('console.billing_page.billing')} sub={tr('console.billing_page.one_invoice_per_live_school')} toast={toast} loading={inv.isLoading} error={inv.isError ? { message: (inv.error as Error).message, retry: () => void inv.refetch() } : null}
      actions={canWrite ? (
        <span className="tgrow">
          <MonthField label={tr('console.billing_page.month')} value={period} onChange={setPeriod} />
          <button className="btn pri" onClick={() => gen.mutate()} disabled={gen.isPending || !period}>{tr('console.billing_page.create_invoices')}</button>
        </span>
      ) : undefined}
      overlays={open && <InvoiceDialog r={open} can={canWrite} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); refresh(); say(m); }} />}>
      {all.length > 0 && (
        <section className="grid">
          <div className="tile t-v s4 rise"><span className="lbl">{tr('console.billing_page.invoiced')}{' '}{shownMonth}</span><div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{price(sum(inMonth))}</div><div style={{ opacity: .75, font: '600 13px var(--fb)' }}>{inMonth.length} {tr('console.billing_page.invoices')}{' '}{price(sum(all))} {tr('console.billing_page.all_time')}</div></div>
          <div className="tile t-g s4 rise" style={{ '--d': '.05s' } as React.CSSProperties}><span className="lbl">{tr('console.billing_page.paid_2')}{' '}{shownMonth}</span><div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{price(sum(paid(inMonth)))}</div><div style={{ opacity: .8, font: '600 13px var(--fb)' }}>{price(sum(paid(all)))} {tr('console.billing_page.all_time')}</div></div>
          <div className="tile t-a s4 rise" style={{ '--d': '.1s' } as React.CSSProperties}><span className="lbl">{tr('console.billing_page.still_to_collect')}</span><div className="fd" style={{ fontSize: 30, letterSpacing: '-.04em', marginTop: 8 }}>{price(sum(all) - sum(paid(all)))}</div><div style={{ opacity: .75, font: '600 13px var(--fb)' }}>{all.filter((r) => r.status === 'overdue').length} {tr('console.billing_page.overdue_all_time')}</div></div>
        </section>
      )}
      {all.length === 0 ? (
        <div><EmptyState scene="billing" label={tr('console.billing_page.make_this_month_s_invoices')} onAction={canWrite ? () => gen.mutate() : undefined} /></div>
      ) : (
        <Card title={tr('console.billing_page.invoices_2')} chip={<span className="chip">{rows.length}</span>} style={{ padding: 0 }}>
          <div className="tgrow" style={{ padding: '0 20px 12px' }}>
            <Select compact aria-label={tr('console.billing_page.school')} value={school} onChange={setSchool} options={[{ value: '', label: tr('console.billing_page.every_school') }, ...schools.map(([value, label]) => ({ value, label }))]} />
            <Select compact aria-label={tr('console.billing_page.month')} value={month} onChange={setMonth} options={[{ value: '', label: tr('console.billing_page.every_month') }, ...months.map((m) => ({ value: m, label: m }))]} />
            <Select compact aria-label={tr('console.billing_page.status')} value={status} onChange={setStatus} options={[{ value: '', label: tr('console.billing_page.every_status') }, ...Object.entries(WORDS).map(([value, label]) => ({ value, label }))]} />
          </div>
          {rows.length === 0 ? <div style={{ padding: '0 20px 20px' }}><EmptyNote icon="search" title={tr('console.billing_page.no_invoice_matches')} body={tr('console.billing_page.try_another_month_or_school')} /></div> : (
            <div className="scroll-x tbl">
              <div style={{ minWidth: 620 }}>
                <div className="grd th" style={{ '--cols': COLS } as React.CSSProperties}><span>{tr('console.billing_page.school')}</span><span>{tr('console.billing_page.month')}</span><span>{tr('console.billing_page.amount')}</span><span>{tr('console.billing_page.status')}</span><span></span></div>
                {rows.map((r) => (
                  <div key={r.id} className="grd rw" style={{ '--cols': COLS } as React.CSSProperties}>
                    <b style={{ font: '700 14px var(--fb)' }}>{r.schoolName}</b><span>{r.period}</span><span className="num" style={{ font: '700 14px var(--fb)' }}>{price(r.amount)}</span>
                    <span className={`st ${TONE[r.status]}`} data-tip={r.status === 'paid' ? `${r.paidOn} · ${r.paidRef}` : tr('console.billing_page.due', { dueOn: r.dueOn })}><i></i>{WORDS[r.status]}</span>
                    <span><button className="btn sm" onClick={() => setOpen(r)}>{tr('console.billing_page.open')}</button></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
      <Card title={tr('console.billing_page.messages_per_school')} chip={<span className="chip">{tr('console.billing_page.last_12_months')}</span>} style={{ padding: 0 }}>
        {!(usage.data ?? []).length ? <div style={{ padding: '0 20px 20px' }}><EmptyNote icon="send" title={tr('console.billing_page.no_messages_sent_yet')} body={tr('console.billing_page.texts_whatsapp_and_email_each')} /></div> : (
          <div className="tbl scroll-x"><div style={{ minWidth: 480 }}>
            <div className="grd th" style={{ '--cols': 'minmax(0,1fr) 120px 100px 100px 110px' } as React.CSSProperties}><span>{tr('console.billing_page.school')}</span><span>{tr('console.billing_page.channel')}</span><span>{tr('console.billing_page.month')}</span><span>{tr('console.billing_page.messages')}</span><span>{tr('console.billing_page.cost')}</span></div>
            {(usage.data ?? []).filter((t) => !school || t.schoolSlug === slug).map((t) => (
              <div key={`${t.schoolSlug}${t.channel}${t.month}`} className="grd rw" style={{ '--cols': 'minmax(0,1fr) 120px 100px 100px 110px' } as React.CSSProperties}>
                <b style={{ font: '700 13px var(--fb)' }}>{t.schoolSlug}</b><span>{CAPABILITY_LABELS[t.channel as Capability] ?? t.channel}</span><span>{t.month}</span><span className="num">{count(t.count)}</span><span className="num">{price(t.costPaise / 100)}</span>
              </div>
            ))}
          </div></div>
        )}
      </Card>
    </Page>
  );
}

/** One invoice: its lines, sending it, marking it paid (and undoing that), and printing or saving it. */
function InvoiceDialog({ r, can, onClose, onDone }: { r: InvoiceRowC; can: boolean; onClose: () => void; onDone: (m: string) => void }) { const app = useApp();
  const shake = useShake();
  const [paying, setPaying] = useState(false);
  const [f, setF] = useState({ paidOn: schoolToday(), reference: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const fail = (e: unknown) => { setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message }); shake.hit(); };
  const send = useMutation({ mutationFn: () => app.api.billing.send(r.id), onSuccess: (x) => onDone(tr('console.billing_page.sent_to', { to: x.to })), onError: fail });
  const pay = useMutation({ mutationFn: () => app.api.billing.paid(r.id, { paidOn: f.paidOn, reference: f.reference.trim() }), onSuccess: () => onDone(tr('console.billing_page.marked_paid')), onError: fail });
  const undo = useMutation({ mutationFn: () => app.api.billing.unpaid(r.id), onSuccess: () => onDone(tr('console.billing_page.no_longer_marked_paid')), onError: fail });
  // A plain page of the invoice in a new tab, to print or save as PDF from the browser.
  const print = () => { const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Invoice ${esc(r.schoolName)} ${r.period}</title><body style="font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">
      <h1 style="font-size:22px">Tangent invoice</h1><p>${esc(r.schoolName)}<br>Month: ${r.period}<br>Due by: ${r.dueOn}</p>
      <table style="width:100%;border-collapse:collapse">${r.lines.map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)">${esc(l.label)}</td><td style="text-align:right;border-bottom:1px solid color-mix(in srgb,currentColor 20%,transparent)">${price(l.amount)}</td></tr>`).join('')}
      <tr><td style="padding:10px 0"><b>Total</b></td><td style="text-align:right"><b>${price(r.amount)}</b></td></tr></table>
      ${r.status === 'paid' ? `<p>Paid on ${r.paidOn}, reference ${esc(r.paidRef ?? '')}.</p>` : ''}</body>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <Dialog title={`${r.schoolName} · ${r.period}`} tag={{ text: WORDS[r.status], tone: r.status === 'paid' ? 'g' : r.status === 'overdue' ? 'a' : 'v' }} onClose={onClose} width={520} shake={shake.cls}>
      <div className="stack">
        {r.lines.map((l) => <div key={l.label} className="kv">{l.label}<b className="num">{price(l.amount)}</b></div>)}
        <div className="kv"><b style={{ color: 'var(--ink)' }}>{tr('console.billing_page.total')}</b><b className="num">{price(r.amount)}</b></div>
        <div className="help">{tr('console.billing_page.due_by')}{' '}{r.dueOn}.{r.sentAt ? tr('console.billing_page.sent_to_on', { sentTo: r.sentTo, when: when(r.sentAt) }) : tr('console.billing_page.not_sent_yet')}{r.status === 'paid' ? tr('console.billing_page.paid_on_reference', { paidOn: r.paidOn, paidRef: r.paidRef }) : ''}</div>
        {paying && (
          <div className="two">
            <DateField label={tr('console.billing_page.paid_on')} value={f.paidOn} max={schoolToday()} onChange={(v) => { setF({ ...f, paidOn: v }); setErr({}); }} error={err.paidOn} />
            <Field label={tr('console.billing_page.payment_reference')} value={f.reference} onChange={(v) => { setF({ ...f, reference: v }); setErr({}); }} error={err.reference} maxLength={80} placeholder={tr('console.billing_page.bank_transfer_reference')} />
          </div>
        )}
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn" onClick={print}>{tr('console.billing_page.print_or_save')}</button>
        <span className="tgrow">
          {can && r.status !== 'paid' && !paying && <button className="btn" disabled={send.isPending} onClick={() => send.mutate()}>{r.sentAt ? tr('console.billing_page.send_again') : tr('console.billing_page.send_by_email')}</button>}
          {can && r.status !== 'paid' && (paying
            ? <button className="btn pri" disabled={pay.isPending} onClick={() => pay.mutate()}>{tr('console.billing_page.mark_paid')}</button>
            : <button className="btn pri" onClick={() => setPaying(true)}>{tr('console.billing_page.paid_3')}</button>)}
          {can && r.status === 'paid' && <button className="btn" disabled={undo.isPending} onClick={() => undo.mutate()}>{tr('console.billing_page.not_paid_after_all')}</button>}
        </span>
      </div>
    </Dialog>
  );
}
