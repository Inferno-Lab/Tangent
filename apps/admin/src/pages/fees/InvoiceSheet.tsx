import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type InvoiceDetail } from '@tangent/contracts';
import { Dialog, ErrorLine, NumberField, Segmented, useShake, EmptyNote, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AreaField, dateLabel, problem } from '../../app/kit';
import { fmtMoney } from '@tangent/contracts';

/** Opens a receipt as the server's PDF (the same one families get), in a new tab to print or save. */
export function useReceiptPdf(say: (m: string, tone?: 'bad') => void) {
  const { api } = useApp();
  return (paymentId: string) => {
    const w = window.open('', '_blank');
    void api.online.receipt(paymentId).then((b) => { if (w) w.location.href = URL.createObjectURL(b); }).catch((e: Error) => { w?.close(); say(e.message, 'bad'); });
  };
}

/**
 * One invoice: what it is for, every payment against it with its receipt, and the two things a desk may ask a second person for:
 * waiving part of it (or cancelling what is left), and cancelling a receipt recorded by mistake.
 */
export function InvoiceSheet({ id, onClose, say, onCollect }: { id: string; onClose: () => void; say: (m: string, tone?: 'bad') => void; onCollect?: (studentId: string) => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => app.api.invoices.one(id) });
  const pdf = useReceiptPdf(say);
  const [ask, setAsk] = useState<null | { kind: 'waive' | 'cancel' } | { kind: 'receipt'; paymentId: string; receiptNo: string }>(null);
  const [f, setF] = useState({ amount: '', reason: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const may = app.user.permissions.includes('fees.collect');
  const done = (d: InvoiceDetail, m: string) => {
    qc.setQueryData(['invoice', id], d);
    void qc.invalidateQueries({ predicate: (x) => ['invoices', 'receipts', 'approvals', 'shell'].includes(String(x.queryKey[0])) });
    setAsk(null); setF({ amount: '', reason: '' }); say(m);
  };
  const send = useMutation({
    mutationFn: () => {
      if (!ask) throw new Error(t('admin.invoice_sheet.nothing_to_send'));
      if (ask.kind === 'receipt') return app.api.invoices.cancelReceipt(ask.paymentId, { reason: f.reason.trim() });
      return app.api.invoices.waive(id, { amount: ask.kind === 'cancel' ? 1 : Number(f.amount), reason: f.reason.trim(), cancel: ask.kind === 'cancel' });
    },
    onSuccess: (d) => done(d, t('admin.invoice_sheet.sent_to_approvals_someone_who')),
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const go = () => {
    const p: Record<string, string> = {};
    if (f.reason.trim().length < 3) p.reason = t('admin.invoice_sheet.say_why');
    if (ask?.kind === 'waive' && !(Number(f.amount) > 0)) p.amount = t('admin.invoice_sheet.enter_an_amount');
    setErr(p);
    if (Object.keys(p).length) shake.hit(); else send.mutate();
  };
  const d = q.data;
  return (
    <Dialog title={d ? d.title : t('admin.invoice_sheet.invoice')} tag={d ? { text: t('admin.invoice_sheet.class', { studentName: d.studentName, className: d.className }), tone: 'v' } : undefined} onClose={onClose} width={620} shake={shake.cls}>
      {!d ? <div className="skc" style={{ height: 240, borderRadius: 16 }} /> : (
        <div className="stack">
          <div>
            <div className="kv"><span>{t('admin.invoice_sheet.kind_of_fee')}</span><b>{d.headName}</b></div>
            <div className="kv"><span>{t('admin.invoice_sheet.due')}</span><b>{dateLabel(d.dueOn)}</b></div>
            <div className="kv"><span>{t('admin.invoice_sheet.billed')}</span><b>{fmtMoney(d.amount)}</b></div>
            {d.waived > 0 && <div className="kv"><span>{t('admin.invoice_sheet.waived')}</span><b>− {fmtMoney(d.waived)}</b></div>}
            <div className="kv"><span>{t('admin.invoice_sheet.paid')}</span><b>{fmtMoney(d.paid)}</b></div>
            <div className="kv"><span>{t('admin.invoice_sheet.still_to_pay')}</span><b style={{ color: d.outstanding ? 'var(--bad)' : undefined }}>{fmtMoney(d.outstanding)}</b></div>
          </div>
          <div>
            <div className="lbl" style={{ marginBottom: 6 }}>{t('admin.invoice_sheet.payments')}</div>
            {!d.payments.length && <EmptyNote icon="payments" title={t('admin.invoice_sheet.nothing_paid_yet')} body={t('admin.invoice_sheet.each_payment_against_this_invoice')} />}
            {d.payments.map((p) => (
              <div key={p.id} className="kv" style={{ alignItems: 'center', gap: 8 }}>
                <span style={{ minWidth: 0 }}>{p.receiptNo} · {dateLabel(p.paidOn)} · {p.method.toUpperCase()}{p.cancelled && <small style={{ display: 'block', color: 'var(--bad)' }}>{t('admin.invoice_sheet.cancelled')}{' '}{p.cancelReason}</small>}</span>
                <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {fmtMoney(p.amount)}
                  <button className="btn sm" onClick={() => pdf(p.id)}>{t('admin.invoice_sheet.receipt')}</button>
                  {may && !p.cancelled && p.method !== 'online' && !d.pending && <button className="btn sm" onClick={() => setAsk({ kind: 'receipt', paymentId: p.id, receiptNo: p.receiptNo })}>{t('admin.invoice_sheet.cancel')}</button>}
                </b>
              </div>
            ))}
          </div>
          {d.pending && <p className="help" style={{ margin: 0 }}>{t('admin.invoice_sheet.waiting_in_approvals')}{' '}{d.pending.title}.</p>}
          {ask && (
            <div className="card" style={{ padding: 16, display: 'grid', gap: 10 }}>
              {ask.kind !== 'receipt' && <Segmented label={t('admin.invoice_sheet.what_to_ask')} value={ask.kind} onChange={(k) => setAsk({ kind: k })} options={[{ value: 'waive', label: t('admin.invoice_sheet.waive_part_of_it') }, { value: 'cancel', label: t('admin.invoice_sheet.cancel_the_left', { fmtMoney: fmtMoney(d.outstanding) }) }]} />}
              {ask.kind === 'receipt' && <b style={{ font: '700 14px var(--fb)' }}>{t('admin.invoice_sheet.cancel_receipt')}{' '}{ask.receiptNo}</b>}
              {ask.kind === 'waive' && <NumberField label={t('admin.invoice_sheet.amount_to_waive_at_most', { fmtMoney: fmtMoney(d.outstanding) })} value={f.amount} onChange={(amount) => { setF({ ...f, amount }); setErr({}); }} error={err.amount} min={0} max={d.outstanding} decimals />}
              <AreaField label={t('admin.invoice_sheet.why')} value={f.reason} onChange={(reason) => { setF({ ...f, reason }); setErr({}); }} error={err.reason} rows={2} maxLength={300} placeholder={ask.kind === 'receipt' ? t('admin.invoice_sheet.recorded_against_the_wrong_student') : t('admin.invoice_sheet.sibling_concession_agreed_with_the')} />
              {err._ && <ErrorLine>{err._}</ErrorLine>}
              <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => { setAsk(null); setErr({}); }}>{t('admin.invoice_sheet.not_now')}</button>
                <button className="btn pri" disabled={send.isPending} onClick={go}>{send.isPending ? t('admin.invoice_sheet.sending') : t('admin.invoice_sheet.send_for_approval')}</button>
              </div>
            </div>
          )}
          <div className="tgrow">
            {may && !ask && !d.pending && d.outstanding > 0 && <button className="btn" onClick={() => setAsk({ kind: 'waive' })}>{t('admin.invoice_sheet.waive_or_cancel')}</button>}
            <span className="grow"></span>
            <button className="btn" onClick={onClose}>{t('admin.invoice_sheet.close')}</button>
            {onCollect && may && d.outstanding > 0 && <button className="btn pri" onClick={() => onCollect(d.studentId)}>{t('admin.invoice_sheet.collect')}</button>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
