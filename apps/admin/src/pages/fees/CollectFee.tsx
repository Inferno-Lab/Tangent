import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type StudentDetail } from '@tangent/contracts';
import { Dialog, Field, SelectField, useShake, t, Skeleton } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { DialogActions as Actions, fieldsOf, messageOf } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { amountText, currencySymbol, fmtDate, fmtMoney, readAmount } from '@tangent/contracts';


/** Records a payment at the desk against one of a student's open invoices. */
export function CollectFeeDialog({ student, onClose, onDone }: { student: StudentDetail; onClose: () => void; onDone: (message: string) => void }) {
  const { api } = useApp();
  const shake = useShake();
  const inv = useQuery({ queryKey: ['invoices', student.id], queryFn: () => api.fees.invoices(student.id) });
  const open = (inv.data ?? []).filter((i) => i.paid < i.amount);
  const [pick, setPick] = useState('');
  const [amount, setAmount] = useState('');
  // The ways the school takes money, by the names it uses (Fees → Settings → How the office records payments).
  const methods = (useShellChrome().shell?.school.paymentMethods ?? []).map((m) => ({ value: m.key, label: m.name }));
  const [method, setMethod] = useState(methods[0]?.value ?? 'cash');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const chosen = open.find((i) => i.id === (pick || open[0]?.id));
  useEffect(() => { if (chosen) setAmount(amountText(chosen.amount - chosen.paid)); }, [chosen?.id]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    const n = readAmount(amount);
    if (!(n > 0)) { setErr({ amount: t('admin.collect_fee.enter_an_amount') }); shake.hit(); return; }
    setBusy(true);
    try { const r = await api.fees.pay({ studentId: student.id, invoiceId: chosen.id, amount: n, method, reference: ref || undefined }); onDone(t('admin.collect_fee.receipt_recorded_for', { receiptNo: r.receiptNo, fmtMoney: fmtMoney(n) })); }
    catch (x) { setBusy(false); setErr({ amount: fieldsOf(x).amount ?? messageOf(x) }); shake.hit(); }
  };
  return (
    <Dialog title={t('admin.collect_fee.collect_a_fee_from', { name: student.name })} onClose={onClose} shake={shake.cls}>
      {inv.isLoading ? <Skeleton kind="rows" rows={2} /> : open.length === 0 ? (
        <>
          <p>{t('admin.collect_fee.nothing_is_due_for')}{' '}{student.name}{t('admin.collect_fee.every_invoice_is_paid')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn pri" onClick={onClose}>{t('admin.collect_fee.close')}</button></div>
        </>
      ) : (
        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SelectField label={t('admin.collect_fee.invoice')} value={chosen?.id ?? ''} onChange={setPick} options={open.map((i) => ({ value: i.id, label: t('admin.collect_fee.due', { title: i.title, fmtMoney: fmtMoney(i.amount - i.paid), fmtDate: fmtDate(i.dueOn, 'day') }) }))} />
          <div className="two">
            <Field label={t('admin.collect_fee.amount', { currencySymbol: currencySymbol() })} value={amount} onChange={(v) => { setAmount(v); setErr({}); }} error={err.amount} inputMode="numeric" />
            <SelectField label={t('admin.collect_fee.paid_by')} value={method} onChange={setMethod} options={methods} />
          </div>
          {method !== 'cash' && <Field label={t('admin.collect_fee.reference_optional')} value={ref} onChange={setRef} maxLength={60} />}
          <Actions onClose={onClose} busy={busy} label={t('admin.collect_fee.record_payment')} />
        </form>
      )}
    </Dialog>
  );
}
