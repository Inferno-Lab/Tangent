import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnlinePaymentRow, ReconRow, RefundRow } from '@tangent/contracts';
import { Dialog, Field, NumberField, Segmented, useShake, EmptyState, EmptyNote, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Card, Page, useToast } from '../../app/Page';
import { AreaField, dateLabel, openPdf, problem, stamp, useOpenParam } from '../../app/kit';
import { fmtMoney, roundToCurrency } from '@tangent/contracts';

const REFUND: Record<RefundRow['status'], { text: string; tone: string }> = {
  requested: { text: t('admin.online_payments_page.needs_a_second_person'), tone: 'a' }, sent: { text: t('admin.online_payments_page.sent_to_the_bank'), tone: 'v' }, done: { text: t('admin.online_payments_page.refunded'), tone: 'g' }, failed: { text: t('admin.online_payments_page.failed'), tone: 'c' }, rejected: { text: t('admin.online_payments_page.declined'), tone: '' },
};

export function OnlinePaymentsPage({ tabs }: { tabs?: React.ReactNode }) {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  // Which list is shown is in the address (?show=refunds), so a link from Approvals or a reload lands on it.
  const [show, setShow] = useOpenParam('show');
  const tab = (show === 'refunds' || show === 'recon' ? show : 'payments') as 'payments' | 'refunds' | 'recon';
  const setTab = (v: 'payments' | 'refunds' | 'recon') => setShow(v === 'payments' ? null : v);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [deciding, setDeciding] = useState<{ r: RefundRow; yes: boolean } | null>(null);
  const [sorting, setSorting] = useState<ReconRow | null>(null);
  const [refund, setRefund] = useState<OnlinePaymentRow | null>(null);
  const perms = app.user.permissions;
  const canRefund = perms.includes('fees.refund');
  const payments = useQuery({ queryKey: ['online', 'payments'], queryFn: app.api.online.payments });
  const refunds = useQuery({ queryKey: ['online', 'refunds'], queryFn: app.api.online.refunds, retry: false });
  const recon = useQuery({ queryKey: ['online', 'recon'], queryFn: app.api.online.reconciliation });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['online'] });
  const decide = useMutation({ mutationFn: ({ id, yes, note }: { id: string; yes: boolean; note: string }) => app.api.online.decide(id, yes, note), onSuccess: (r) => { setDeciding(null); refresh(); say(r.status === 'rejected' ? t('admin.online_payments_page.refund_declined') : r.status === 'failed' ? t('admin.online_payments_page.the_bank_refused', { error: r.error }) : t('admin.online_payments_page.refund_of_sent', { amount: fmtMoney(r.amount) })); }, onError: (e) => say((e as Error).message, 'bad') });
  const resolve = useMutation({ mutationFn: ({ id, note }: { id: string; note: string }) => app.api.online.resolve(id, note), onSuccess: () => { setSorting(null); refresh(); say(t('admin.online_payments_page.marked_as_sorted_out')); }, onError: (e) => say((e as Error).message, 'bad') });
  const all = payments.data ?? [];
  const term = q.trim().toLowerCase();
  const found = all.filter((p) => !term || `${p.receiptNo} ${p.student} ${p.title} ${p.providerPaymentId}`.toLowerCase().includes(term));
  const list = found.slice((page - 1) * 25, page * 25);
  const open = (recon.data ?? []).filter((r) => !r.resolved);
  const waiting = (refunds.data ?? []).filter((r) => r.status === 'requested');
  return (
    <Page title={t('admin.online_payments_page.fees')} sub={t('admin.online_payments_page.what_families_paid_in_the')} toast={toast} tabs={tabs}
      loading={payments.isLoading && !payments.data} error={payments.isError && !payments.data ? { message: (payments.error as Error).message, retry: () => void payments.refetch() } : null}
      overlays={<>
        {refund && <RefundDialog p={refund} onClose={() => setRefund(null)} onDone={(m) => { setRefund(null); refresh(); say(m); }} />}
        {deciding && <NoteDialog title={deciding.yes ? t('admin.online_payments_page.send_back_to', { amount: fmtMoney(deciding.r.amount), student: deciding.r.student }) : t('admin.online_payments_page.decline_the_refund_for', { student: deciding.r.student })}
          label={deciding.yes ? t('admin.online_payments_page.a_note_optional') : t('admin.online_payments_page.why_the_person_who_asked')} need={!deciding.yes} action={deciding.yes ? t('admin.online_payments_page.yes_send_it') : t('admin.online_payments_page.decline')} busy={decide.isPending}
          help={deciding.yes ? t('admin.online_payments_page.the_money_goes_back_to') : undefined}
          onClose={() => setDeciding(null)} onSend={(note) => decide.mutate({ id: deciding.r.id, yes: deciding.yes, note })} />}
        {sorting && <NoteDialog title={t('admin.online_payments_page.sorted_out')} label={t('admin.online_payments_page.what_was_done')} need action={t('admin.online_payments_page.mark_sorted_out')} busy={resolve.isPending} onClose={() => setSorting(null)} onSend={(note) => resolve.mutate({ id: sorting.id, note })} />}
      </>}>
      <Segmented label={t('admin.online_payments_page.online_payments')} value={tab} onChange={setTab} options={[
        { value: 'payments', label: t('admin.online_payments_page.payments'), count: all.length }, { value: 'refunds', label: t('admin.online_payments_page.refunds'), count: waiting.length || undefined, countTone: waiting.length ? 'a' : undefined },
        { value: 'recon', label: t('admin.online_payments_page.reconciliation'), count: open.length || undefined, countTone: open.length ? 'c' : undefined },
      ]} />
      {tab === 'payments' && all.length > 0 && <div style={{ maxWidth: 360, margin: '12px 0' }}><Field label={t('admin.online_payments_page.search_payments')} value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t('admin.online_payments_page.receipt_student_or_fee')} /></div>}
      {tab === 'payments' && (!all.length ? (
        <div><EmptyState scene="payments" onAction={() => app.go('/fees/invoices')} /></div>
      ) : (
        <Card style={{ padding: 0 }}>
          <div className="tbl scroll-x"><div style={{ minWidth: 720 }} className="lscroll">
            <div className="grd th" style={{ '--cols': '140px minmax(0,1.4fr) minmax(0,1.4fr) 110px 100px 190px' } as React.CSSProperties}><span>{t('admin.online_payments_page.receipt')}</span><span>{t('admin.online_payments_page.student')}</span><span>{t('admin.online_payments_page.fee')}</span><span>{t('admin.online_payments_page.amount')}</span><span>{t('admin.online_payments_page.paid')}</span><span></span></div>
            {list.map((p) => (
              <div key={p.id} className="grd rw" style={{ '--cols': '140px minmax(0,1.4fr) minmax(0,1.4fr) 110px 100px 190px', height: 'auto', minHeight: 52, padding: '8px 20px' } as React.CSSProperties}>
                <b className="num" style={{ font: '700 13px var(--fb)' }} data-tip={p.providerPaymentId}>{p.receiptNo}</b>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.student}</span>
                <span className="help" style={{ margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-tip={p.title}>{p.title}</span>
                <span className="num">{fmtMoney(p.amount)}{p.refunded ? <small className="help" style={{ display: 'block' }}>−{fmtMoney(p.refunded)}</small> : null}</span>
                <span className="num">{dateLabel(p.paidOn)}</span>
                <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => void openPdf(app.api.online.receipt(p.id)).catch((e: Error) => say(e.message, 'bad'))}>{t('admin.online_payments_page.receipt')}</button>
                  {canRefund && p.amount - p.refunded > 0 && <button className="btn sm" onClick={() => setRefund(p)}>{t('admin.online_payments_page.refund')}</button>}
                </span>
              </div>
            ))}
          </div></div>
          {found.length > 25 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
              <span className="help">{(page - 1) * 25 + 1}–{(page - 1) * 25 + list.length} {t('admin.online_payments_page.of')}{' '}{found.length}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('admin.online_payments_page.previous')}</button><button className="btn sm" disabled={page * 25 >= found.length} onClick={() => setPage(page + 1)}>{t('admin.online_payments_page.next')}</button></span>
            </div>
          )}
          {term && !found.length && <EmptyNote icon="search" title={t('admin.online_payments_page.no_payment_matches', { q })} body={t('admin.online_payments_page.search_by_the_family_s')} />}
        </Card>
      ))}
      {tab === 'refunds' && (
        <Card style={{ padding: 0 }}>
          {refunds.isError ? <div className="help" style={{ padding: 20 }}>{(refunds.error as Error).message}</div>
            : !(refunds.data ?? []).length ? <EmptyNote icon="undo" title={t('admin.online_payments_page.no_refunds_yet')} body={t('admin.online_payments_page.refund_a_payment_from_the')} />
            : refunds.data!.map((r) => (
              <div key={r.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap' }}>
                <span className={`chip ${REFUND[r.status].tone}`} data-tip={r.error ?? undefined}>{REFUND[r.status].text}</span>
                <b className="num" style={{ font: '700 13px var(--fb)' }}>{fmtMoney(r.amount)}</b>
                <span style={{ flex: 1, minWidth: 180 }}>{r.student} · {r.receiptNo}<small className="help" style={{ display: 'block' }}>{r.reason} {t('admin.online_payments_page.asked_by')}{' '}{r.requestedBy ?? 'someone'} {stamp(r.createdAt)}{r.approvedBy ? t('admin.online_payments_page.by', { status: r.status === 'rejected' ? 'rejected' : 'approved', approvedBy: r.approvedBy }) : ''}{r.decisionNote ? ` · “${r.decisionNote}”` : ''}</small></span>
                {canRefund && r.status === 'requested' && <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn sm" disabled={decide.isPending} onClick={() => setDeciding({ r, yes: false })}>{t('admin.online_payments_page.decline')}</button>
                  <button className="btn sm pri" disabled={decide.isPending} onClick={() => setDeciding({ r, yes: true })}>{t('admin.online_payments_page.approve')}</button>
                </span>}
              </div>
            ))}
        </Card>
      )}
      {tab === 'recon' && (
        <Card style={{ padding: 0 }}>
          <div className="help" style={{ padding: '16px 20px 8px' }}>{t('admin.online_payments_page.each_morning_yesterday_s_payments')}</div>
          {!(recon.data ?? []).length ? <div className="help" style={{ padding: '0 20px 20px' }}>{t('admin.online_payments_page.everything_has_matched_so_far')}</div>
            : recon.data!.map((r) => (
              <div key={r.id} className="rw" style={{ display: 'flex', gap: 10, alignItems: 'center', height: 'auto', minHeight: 56, padding: '10px 20px', flexWrap: 'wrap', opacity: r.resolved ? 0.6 : 1 }}>
                <span className={`chip ${r.resolved ? 'g' : 'c'}`}>{r.resolved ? t('admin.online_payments_page.sorted_out') : dateLabel(r.day)}</span>
                <span style={{ flex: 1, minWidth: 200 }}>{r.problem}<small className="help" style={{ display: 'block' }}>{r.providerPaymentId} {t('admin.online_payments_page.provider')}{' '}{r.providerAmount == null ? '–' : fmtMoney(r.providerAmount)} {t('admin.online_payments_page.receipt_2')}{' '}{r.receiptAmount == null ? '–' : fmtMoney(r.receiptAmount)}{r.note ? ` · ${r.note}` : ''}</small></span>
                {!r.resolved && perms.includes('fees.collect') && <button className="btn sm" disabled={resolve.isPending} onClick={() => setSorting(r)}>{t('admin.online_payments_page.sorted_out')}</button>}
              </div>
            ))}
        </Card>
      )}
    </Page>
  );
}

function RefundDialog({ p, onClose, onDone }: { p: OnlinePaymentRow; onClose: () => void; onDone: (m: string) => void }) {
  const app = useApp();
  const shake = useShake();
  const left = p.amount - p.refunded;
  const [amount, setAmount] = useState(String(roundToCurrency(left)));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => app.api.online.refund({ paymentId: p.id, amount: Number(amount), reason: reason.trim() }),
    onSuccess: (r) => onDone(r.status === 'requested' ? t('admin.online_payments_page.is_above_the_school_s', { amount: fmtMoney(r.amount) }) : r.status === 'failed' ? t('admin.online_payments_page.the_bank_refused', { error: r.error }) : t('admin.online_payments_page.refund_of_sent_the_family', { amount: fmtMoney(r.amount) })),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  return (
    <Dialog title={t('admin.online_payments_page.refund_2', { receiptNo: p.receiptNo })} tag={{ text: p.student, tone: 'v' }} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        <NumberField label={t('admin.online_payments_page.amount_up_to', { amount: fmtMoney(left) })} value={amount} onChange={(x) => { setAmount(x); setErr({}); }} min={0} max={left} error={err.amount} decimals />
        <Field label={t('admin.online_payments_page.why')} value={reason} onChange={(x) => { setReason(x); setErr({}); }} error={err.reason} placeholder={t('admin.online_payments_page.paid_twice')} />
        <div className="help">{t('admin.online_payments_page.the_money_goes_back_to_2')}</div>
        {err._ && <div className="emsg" role="alert">{err._}</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={onClose}>{t('admin.online_payments_page.cancel')}</button>
        <button className="btn pri" disabled={send.isPending || !(Number(amount) > 0) || reason.trim().length < 3} onClick={() => send.mutate()}>{send.isPending ? t('admin.online_payments_page.sending') : t('admin.online_payments_page.refund')}</button>
      </div>
    </Dialog>
  );
}

/** A decision that needs a few words: why a refund is declined, what was done about a finding, a note on sending money. */
function NoteDialog({ title, label, need, action, busy, help, onClose, onSend }: { title: string; label: string; need?: boolean; action: string; busy: boolean; help?: string; onClose: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  const go = () => { if (need && note.trim().length < 3) { setErr(t('admin.online_payments_page.write_a_few_words')); shake.hit(); } else onSend(note.trim()); };
  return (
    <Dialog title={title} onClose={onClose} width={480} shake={shake.cls}>
      <div className="stack">
        {help && <p className="help" style={{ margin: 0 }}>{help}</p>}
        <AreaField label={label} value={note} onChange={(v) => { setNote(v); setErr(''); }} error={err} rows={3} maxLength={300} />
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.online_payments_page.cancel')}</button>
          <button className="btn pri" disabled={busy} onClick={go}>{busy ? t('admin.online_payments_page.working') : action}</button>
        </div>
      </div>
    </Dialog>
  );
}
