import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type StudentDetail } from '@tangent/contracts';
import { Dialog, Field, SelectField, useShake } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { DialogActions as Actions, fieldsOf, messageOf } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { currencySymbol, fmtDate, fmtMoney } from '@tangent/contracts';


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
  useEffect(() => { if (chosen) setAmount(String(chosen.amount - chosen.paid)); }, [chosen?.id]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    const n = Math.round(Number(amount));
    if (!(n > 0)) { setErr({ amount: 'Enter an amount.' }); shake.hit(); return; }
    setBusy(true);
    try { const r = await api.fees.pay({ studentId: student.id, invoiceId: chosen.id, amount: n, method, reference: ref || undefined }); onDone(`Receipt ${r.receiptNo} recorded for ${fmtMoney(n)}`); }
    catch (x) { setBusy(false); setErr({ amount: fieldsOf(x).amount ?? messageOf(x) }); shake.hit(); }
  };
  return (
    <Dialog title={`Collect a fee from ${student.name}`} onClose={onClose} shake={shake.cls}>
      {inv.isLoading ? <div className="skc" style={{ height: 120 }} /> : open.length === 0 ? (
        <>
          <p>Nothing is due for {student.name}. Every invoice is paid.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn pri" onClick={onClose}>Close</button></div>
        </>
      ) : (
        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SelectField label="Invoice" value={chosen?.id ?? ''} onChange={setPick} options={open.map((i) => ({ value: i.id, label: `${i.title} · ${fmtMoney(i.amount - i.paid)} due ${fmtDate(i.dueOn, 'day')}` }))} />
          <div className="two">
            <Field label={`Amount (${currencySymbol()})`} value={amount} onChange={(v) => { setAmount(v); setErr({}); }} error={err.amount} inputMode="numeric" />
            <SelectField label="Paid by" value={method} onChange={setMethod} options={methods} />
          </div>
          {method !== 'cash' && <Field label="Reference (optional)" value={ref} onChange={setRef} maxLength={60} />}
          <Actions onClose={onClose} busy={busy} label="Record payment" />
        </form>
      )}
    </Dialog>
  );
}
