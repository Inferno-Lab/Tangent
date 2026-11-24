import { Injectable } from '@nestjs/common';
import { nextNumber, newId } from '@tangent/db';
import { type LateRule, fmtDate, schoolCurrency, roundToCurrency, roundMoney, currencyDigits, fmtMoney, addDays, dayName, dayMonth, schoolToday, type FeeHead, type FeeHeadsPut, type FeeSummary, type InvoiceDetail, type InvoiceRow, type PaymentCreate, type ReceiptCancel, type WaiverRequest, type ReceiptTax, receiptTax, tx } from '@tangent/contracts';
import { ApiError, notFound } from '@tangent/nest-kit';
import type { TenantCtx } from '../tenancy/tenant.js';
import { AuditService, Messenger, SettingsService } from './support.js';


@Injectable()
export class FeesService {
  constructor(
    private readonly audit: AuditService,
    private readonly messenger: Messenger,
    private readonly settings: SettingsService,
  ) {}

  /** Money for the month of the latest school day: what fell due, what came in, and what is late. */
  /**
   * Money for a period: this month (the default), the current term or the current academic year, from the school's calendar.
   * The comparison is with the period just before it of the same length.
   */
  async summary(t: TenantCtx, count = 6, period: 'month' | 'term' | 'year' = 'month'): Promise<FeeSummary> {
    const today = schoolToday();
    const { last, days } = await this.settings.openDays(t, count);
    let monthStart = `${last.slice(0, 7)}-01`;
    let nextMonth = addDays(monthStart, 32).slice(0, 7) + '-01';
    // The month in the reader's language (fmtDate reads the school's locale).
    let label = fmtDate(monthStart, 'month');
    if (period !== 'month') {
      const r = (await t.pool.query<{ name: string; s: string; e: string }>(period === 'term'
        ? 'select name, starts_on::text s, ends_on::text e from terms where starts_on <= $1 and ends_on >= $1 order by starts_on desc limit 1'
        : 'select label name, starts_on::text s, ends_on::text e from academic_years where starts_on <= $1 and ends_on >= $1 order by starts_on desc limit 1', [today])).rows[0];
      if (r) { monthStart = r.s; nextMonth = addDays(r.e, 1); label = r.name; }
    }
    const span = Math.max(1, Math.round((Date.parse(nextMonth) - Date.parse(monthStart)) / 86_400_000));
    const prevStart = period === 'month' ? addDays(monthStart, -1).slice(0, 7) + '-01' : addDays(monthStart, -span);
    const [byHead, totals, daily, prev, target, headList] = await Promise.all([
      t.pool.query<{ head: string; due: string; collected: string }>(
        `select i.head, coalesce(sum(i.amount - i.waived_amount),0) due,
           coalesce(sum((select coalesce(sum(p.amount - p.refunded),0) from payments p where p.invoice_id = i.id)),0) collected
         from fee_invoices i where i.due_on >= $1 and i.due_on < $2 group by i.head`, [monthStart, nextMonth]),
      t.pool.query<{ collected: string; overdue: string; fam: string; pending: string }>(
        `with paid as (select invoice_id, sum(amount - refunded) p from payments group by invoice_id)
         select (select coalesce(sum(amount - refunded),0) from payments where paid_on >= $1 and paid_on < $2) collected,
           coalesce(sum(greatest(i.amount - i.waived_amount - coalesce(paid.p,0),0)) filter (where i.due_on < $3::date),0) overdue,
           count(distinct i.student_id) filter (where i.due_on < $3::date and i.amount - i.waived_amount - coalesce(paid.p,0) > 0) fam,
           coalesce(sum(greatest(i.amount - i.waived_amount - coalesce(paid.p,0),0)) filter (where i.due_on >= $1 and i.due_on < $2),0) pending
         from fee_invoices i left join paid on paid.invoice_id = i.id`, [monthStart, nextMonth, today]),
      t.pool.query<{ d: string; amount: string }>(
        `select to_char(paid_on,'YYYY-MM-DD') d, sum(amount - refunded) amount from payments where paid_on = any($1::date[]) group by 1`, [days]),
      t.pool.query<{ collected: string }>('select coalesce(sum(amount - refunded),0) collected from payments where paid_on >= $1 and paid_on < $2', [prevStart, monthStart]),
      this.settings.value<number>(t, 'fees.dailyTarget', 150000),
      this.heads(t),
    ]);
    const amounts = new Map(daily.rows.map((r) => [r.d, Number(r.amount)]));
    // Every head the school keeps, plus any an old invoice still names, so no money goes missing from the totals.
    const known = [...headList.map((h) => [h.key, h.name] as const), ...byHead.rows.filter((r) => !headList.some((h) => h.key === r.head)).map((r) => [r.head, r.head] as const)];
    const heads = known.map(([key, label]) => {
      const r = byHead.rows.find((x) => x.head === key);
      const due = Number(r?.due ?? 0);
      const collected = Math.min(due, Number(r?.collected ?? 0));
      return { head: key, label, due, collected, pct: due ? Math.round((collected / due) * 100) : 0 };
    });
    const due = heads.reduce((a, h) => a + h.due, 0);
    const tt = totals.rows[0]!;
    const collected = Number(tt.collected);
    const prevCollected = Number(prev.rows[0]!.collected);
    return {
      monthLabel: label, due, collected, pending: Number(tt.pending), overdue: Number(tt.overdue), overdueFamilies: Number(tt.fam),
      pct: due ? Math.round((collected / due) * 100) : 0, collectedDelta: prevCollected ? Math.round(((collected - prevCollected) / prevCollected) * 1000) / 10 : 0,
      byHead: heads,
      daily: days.map((d) => ({ date: d, label: dayName(d, true), full: `${dayName(d)} ${dayMonth(d)}${d === last ? ' · today' : ''}`, amount: amounts.get(d) ?? 0, isToday: d === last })),
      dailyTarget: target,
    };
  }

  async invoice(t: TenantCtx, id: string): Promise<InvoiceDetail> {
    const i = (await t.pool.query<{ id: string; student_id: string; title: string; amount: number; waived_amount: number; due_on: string; head: string; name: string; class_name: string; head_name: string | null }>(
      `select i.id, i.student_id, i.title, i.amount, i.waived_amount, i.due_on::text, i.head, s.name, c.name class_name, h.name head_name
       from fee_invoices i join students s on s.id = i.student_id join classes c on c.id = s.class_id left join fee_heads h on h.key = i.head where i.id = $1`, [id])).rows[0];
    if (!i) throw notFound('That invoice');
    const pays = (await t.pool.query<{ id: string; receipt_no: string; amount: number; refunded: number; method: string; paid_on: string; cancelled_at: Date | null; cancel_reason: string }>(
      'select id, receipt_no, amount, refunded, method, paid_on::text, cancelled_at, cancel_reason from payments where invoice_id = $1 order by paid_on, receipt_no', [id])).rows;
    const pending = (await t.pool.query<{ id: string; title: string }>(
      "select id, title from approvals where status = 'pending' and ((kind = 'fee_waiver' and payload->>'invoiceId' = $1) or (kind = 'receipt_cancel' and payload->>'invoiceId' = $1)) limit 1", [id])).rows[0] ?? null;
    const paid = pays.reduce((a, p) => a + p.amount - p.refunded, 0);
    const outstanding = Math.max(0, roundMoney(i.amount - i.waived_amount - paid));
    return {
      id: i.id, studentId: i.student_id, title: i.title, amount: i.amount, paid, dueOn: i.due_on, status: outstanding === 0 ? 'paid' : i.due_on < schoolToday() ? 'overdue' : paid ? 'partial' : 'due',
      studentName: i.name, className: i.class_name, head: i.head, headName: i.head_name ?? i.head, waived: i.waived_amount, outstanding,
      payments: pays.map((p) => ({ id: p.id, receiptNo: p.receipt_no, amount: p.amount, refunded: p.refunded, method: p.method, paidOn: p.paid_on, cancelled: !!p.cancelled_at, cancelReason: p.cancel_reason })),
      pending,
    };
  }

  /** Asks for part (or, to cancel it, all that is left) of an invoice to be waived; someone else with fees.waive decides. */
  async requestWaiver(t: TenantCtx, user: { id: string; name: string }, id: string, b: WaiverRequest): Promise<InvoiceDetail> {
    const inv = await this.invoice(t, id);
    if (inv.pending) throw new ApiError('conflict', 'A request for this invoice is already waiting in Approvals.');
    const amount = b.cancel ? inv.outstanding : b.amount;
    if (amount <= 0) throw new ApiError('conflict', 'Nothing is left to waive on this invoice.');
    if (amount > inv.outstanding) throw new ApiError('validation', tx('At most {p0} is left to pay.', { p0: fmtMoney(inv.outstanding) }), { fields: { amount: tx('At most {p0}.', { p0: fmtMoney(inv.outstanding) }) } });
    await t.pool.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'fee_waiver',$2,$3,$4,$5,$6,$7)",
      [newId('apr'), b.cancel ? `Cancel ${inv.title} for ${inv.studentName}` : `Waive ${fmtMoney(amount)} of ${inv.title} for ${inv.studentName}`, b.reason, user.name, user.id, inv.studentId,
        JSON.stringify({ invoiceId: id, amount, cancel: b.cancel, reason: b.reason })]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: b.cancel ? 'fee.cancel_asked' : 'fee.waiver_asked', entity: 'invoice', entityId: id, detail: { amount } });
    return this.invoice(t, id);
  }

  /** Asks for a desk receipt to be cancelled (recorded by mistake); someone else who may refund decides. */
  async requestReceiptCancel(t: TenantCtx, user: { id: string; name: string }, paymentId: string, b: ReceiptCancel): Promise<InvoiceDetail> {
    const p = (await t.pool.query<{ invoice_id: string; receipt_no: string; amount: number; cancelled_at: Date | null; online: boolean }>(
      "select invoice_id, receipt_no, amount, cancelled_at, (provider_payment_id is not null or method = 'online') online from payments where id = $1", [paymentId])).rows[0];
    if (!p) throw notFound('That receipt');
    if (p.cancelled_at) throw new ApiError('conflict', 'That receipt is already cancelled.');
    if (p.online) throw new ApiError('conflict', 'An online payment is refunded from Online payments, not cancelled.');
    const inv = await this.invoice(t, p.invoice_id);
    if (inv.pending) throw new ApiError('conflict', 'A request for this invoice is already waiting in Approvals.');
    await t.pool.query("insert into approvals (id, kind, title, subtitle, requester_name, requested_by, subject_ref, payload) values ($1,'receipt_cancel',$2,$3,$4,$5,$6,$7)",
      [newId('apr'), `Cancel receipt ${p.receipt_no} (${fmtMoney(p.amount)}) for ${inv.studentName}`, b.reason, user.name, user.id, inv.studentId, JSON.stringify({ paymentId, invoiceId: p.invoice_id, reason: b.reason })]);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'receipt.cancel_asked', entity: 'payment', entityId: paymentId });
    return this.invoice(t, p.invoice_id);
  }

  /** The school's fee heads, in its order. */
  async heads(t: TenantCtx): Promise<FeeHead[]> {
    return (await t.pool.query<FeeHead>('select key, name, sort, concession from fee_heads order by sort, name')).rows;
  }

  /**
   * Replaces the list (Tangent's console, or the school when `feeStructures.schoolEdits` is on). A head that invoices or fee
   * structures use cannot be removed, only renamed, so no money loses its kind.
   */
  async setHeads(t: TenantCtx, body: FeeHeadsPut, by: { id: string; name: string }): Promise<FeeHead[]> {
    if (!(await this.settings.value<boolean>(t, 'feeStructures.schoolEdits', true))) throw new ApiError('forbidden', 'Tangent keeps this school’s fee heads. Ask Tangent to change them.');
    const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'fee';
    const next = body.heads.map((h, i) => ({ key: h.key ?? slug(h.name), name: h.name, sort: i + 1, concession: h.concession }));
    if (new Set(next.map((h) => h.key)).size !== next.length) throw new ApiError('validation', 'Two fee heads have the same name.');
    const used = (await t.pool.query<{ head: string }>('select distinct head from fee_invoices union select distinct head from fee_structures')).rows.map((r) => r.head);
    const dropped = used.filter((k) => !next.some((h) => h.key === k));
    const before = await this.heads(t);
    if (dropped.length) {
      const names = dropped.map((k) => before.find((h) => h.key === k)?.name ?? k);
      throw new ApiError('conflict', tx('{p0} {p1} used by invoices or fee structures, so {p2}. Rename instead.', { p0: names.join(', '), p1: names.length === 1 ? 'is' : 'are', p2: names.length === 1 ? 'it stays' : 'they stay' }));
    }
    const client = await t.pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from fee_heads where not (key = any($1::text[]))', [next.map((h) => h.key)]);
      for (const h of next) {
        await client.query('insert into fee_heads (key, name, sort, concession, updated_at) values ($1,$2,$3,$4,now()) on conflict (key) do update set name = excluded.name, sort = excluded.sort, concession = excluded.concession, updated_at = now()', [h.key, h.name, h.sort, h.concession]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.audit.record(t, { actorId: by.id, actorName: by.name, action: 'fees.heads', entity: 'fee_heads', detail: { before: before.map((h) => h.name), after: next.map((h) => h.name) } });
    return this.heads(t);
  }

  async invoices(t: TenantCtx, studentId: string): Promise<InvoiceRow[]> {
    const { rows } = await t.pool.query<{ id: string; student_id: string; title: string; amount: number; waived: number; paid: string; due_on: string }>(
      `select i.id, i.student_id, i.title, i.amount, i.waived_amount waived, coalesce((select sum(amount - refunded) from payments where invoice_id = i.id),0) paid, to_char(i.due_on,'YYYY-MM-DD') due_on
       from fee_invoices i where i.student_id = $1 order by i.due_on desc, i.title, i.id`, [studentId]);
    const today = schoolToday();
    return rows.map((r) => {
      const net = roundMoney(r.amount - r.waived);
      const paid = roundMoney(Number(r.paid));
      return { id: r.id, studentId: r.student_id, title: r.title, amount: net, paid, dueOn: r.due_on, status: paid >= net ? 'paid' : r.due_on < today ? 'overdue' : paid > 0 ? 'partial' : 'due' };
    });
  }

  /** The office records only the ways the school takes money (Fees → Settings → How the office records payments). */
  async checkMethod(t: TenantCtx, method: string): Promise<void> {
    const allowed = (await this.settings.effective(t)).settings['fees.paymentMethods'] as { key: string }[];
    if (!allowed.some((m) => m.key === method)) throw new ApiError('validation', 'The school does not take payments that way.', { fields: { method: 'Choose another way to pay.' } });
  }

  /** The tax in a payment (§3.4.2) when the school has tax receipts, is registered and the invoice's head carries tax. */
  private async tax(t: TenantCtx, head: string, amount: number): Promise<ReceiptTax | null> {
    const cfg = await this.settings.effective(t);
    if (!cfg.features.includes('fees.taxReceipts')) return null;
    const v = cfg.settings;
    const rate = Number(v['tax.ratePct'] ?? 0);
    if (!((v['tax.heads'] as string[] | undefined) ?? []).includes(head) || !rate || !v['tax.number']) return null;
    return receiptTax({ name: String(v['tax.name']), number: String(v['tax.number']), numberLabel: String(v['tax.numberLabel']), code: String(v['tax.code'] ?? ''),
      codeLabel: String(v['tax.codeLabel'] ?? ''), ratePct: rate, inclusive: v['tax.inclusive'] !== false, split: (v['tax.split'] as { name: string; sharePct: number }[]) ?? [] }, amount, roundToCurrency);
  }

  async pay(t: TenantCtx, user: { id: string; name: string }, body: PaymentCreate, online?: { providerPaymentId: string }): Promise<{ receiptNo: string; amount: number; outstanding: number; paymentId: string }> {
    // Receipt numbers follow the school's own series (set from the console), one at a time so two payments never share a number.
    const pattern = await this.settings.value<string>(t, 'fees.receiptPrefix', 'RCPT-{yyyy}-{seq:5}');
    const start = await this.settings.value<number>(t, 'fees.receiptStart', 1);
    const ay = (await t.pool.query<{ label: string }>('select label from academic_years where current limit 1')).rows[0]?.label ?? '';
    const paymentId = newId('pay');
    const client = await t.pool.connect();
    let receiptNo: string;
    let inv: { id: string; amount: number; waived: number; paid: string; title: string; head: string } | undefined;
    let outstanding = 0;
    try {
      await client.query('begin');
      // The invoice is held while what is left on it is counted, so a desk payment and an online one at once cannot both pay it.
      await client.query('select 1 from fee_invoices where id = $1 for update', [body.invoiceId]);
      inv = (await client.query<{ id: string; amount: number; waived: number; paid: string; title: string; head: string }>(
        `select i.id, i.amount, i.waived_amount waived, coalesce((select sum(amount - refunded) from payments where invoice_id = i.id),0) paid, i.title, i.head
         from fee_invoices i where i.id = $1 and i.student_id = $2`, [body.invoiceId, body.studentId])).rows[0];
      if (!inv) throw notFound('That invoice');
      outstanding = roundMoney(inv.amount - inv.waived - Number(inv.paid));
      if (outstanding <= 0) throw new ApiError('conflict', 'That invoice is already paid.');
      if (body.amount > outstanding) throw new ApiError('validation', tx('The most that can be paid on this invoice is {p0}.', { p0: fmtMoney(outstanding) }), { fields: { amount: 'That is more than is due.' } });
      const tax = await this.tax(t, inv.head, body.amount);
      // After the highest number in the series, not start + count: receipts imported from the old system keep their own numbers.
      receiptNo = await nextNumber(client, { pattern, start, day: schoolToday(), ay, table: 'payments', column: 'receipt_no' });
      await client.query('insert into payments (id, invoice_id, amount, method, reference, receipt_no, paid_on, recorded_by, tax, provider_payment_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [paymentId, inv.id, body.amount, body.method, body.reference ?? null, receiptNo, schoolToday(), online ? null : user.id, tax ? JSON.stringify(tax) : null, online?.providerPaymentId ?? null]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const paidOn = inv!;
    await this.audit.record(t, { actorId: online ? null : user.id, actorName: user.name, action: 'payment.recorded', entity: 'invoice', entityId: paidOn.id, detail: { amount: body.amount, receipt: receiptNo } });
    const g = await t.pool.query<{ phone: string | null }>('select g.phone from student_guardians sg join guardians g on g.id = sg.guardian_id where sg.student_id = $1 and sg.gets_bills', [body.studentId]);
    await this.messenger.notify(t, 'fees.receipt', g.rows.filter((r) => r.phone).map((r) => ({ to: r.phone!, vars: { receipt: receiptNo, amount: fmtMoney(body.amount), title: paidOn.title } })));
    return { receiptNo, amount: body.amount, outstanding: roundMoney(outstanding - body.amount), paymentId };
  }

  /**
   * Daily (job fees.reminders): families of an unpaid invoice on each of the school's reminder days (fees.reminderDays: -3
   * three days before the due date, 7 a week after; else fees.remindDaysBefore days before), once per invoice per day. A
   * reminder after the due date says the fee is overdue.
   */
  async dailyReminders(t: TenantCtx, day: string): Promise<string> {
    const cfg = await this.settings.effective(t);
    if (!cfg.features.includes('fees.reminders')) return 'Fee reminders are off for this school.';
    const set = await this.settings.value<number[]>(t, 'fees.reminderDays', []);
    const days = [...new Set(set.length ? set : [-(await this.settings.value<number>(t, 'fees.remindDaysBefore', 3))])];
    let sent = 0;
    for (const d of days) {
      // Due on the day that is `d` days before today's run (d negative: still to come).
      const { rows } = await t.pool.query<{ id: string; phone: string | null; name: string }>(
        `select i.id, g.phone, s.name from fee_invoices i join students s on s.id = i.student_id and s.status = 'active'
         join student_guardians sg on sg.student_id = s.id and sg.gets_bills join guardians g on g.id = sg.guardian_id
         where i.due_on = $1::date - $2::int and i.amount - i.waived_amount > coalesce((select sum(amount - refunded) from payments where invoice_id = i.id), 0)
           and not exists (select 1 from fee_reminders r where r.invoice_id = i.id and r.day = $1::date)`, [day, d]);
      for (const id of new Set(rows.map((r) => r.id))) await t.pool.query('insert into fee_reminders (invoice_id, day) values ($1,$2) on conflict do nothing', [id, day]);
      sent += await this.messenger.notify(t, d > 0 ? 'fees.overdue' : 'fees.reminder', rows.filter((r) => r.phone).map((r) => ({ to: r.phone!, vars: { student: r.name } })));
    }
    return `${sent} reminders (${days.join(', ')} days from due).`;
  }

  /**
   * Daily (job fees.lateFines): the school's late-fee rule (fees.lateRule; without one, fees.lateFeePct once a month) on
   * every invoice still owed past its due date and grace days. Each period (the invoice's "once", a week, a month; a month
   * for a fee by the day) has one fine invoice, recomputed each run and only ever raised, so a missed run catches up and a
   * second run charges nothing more. The cap is for all of an invoice's late fees together.
   */
  async lateFines(t: TenantCtx, day: string): Promise<string> {
    const cfg = await this.settings.effective(t);
    if (!cfg.features.includes('fees.lateFines')) return 'Late fines are off for this school.';
    const pct = await this.settings.value<number>(t, 'fees.lateFeePct', 0);
    const rule = (await this.settings.value<LateRule | null>(t, 'fees.lateRule', null)) ?? (pct ? { kind: 'percent' as const, amount: pct, every: 'month' as const, graceDays: 0, cap: 0, heads: [] } : null);
    if (!rule || !rule.amount) return 'There is no late fee.';
    const { rows } = await t.pool.query<{ id: string; student_id: string; title: string; head: string; due_on: string; owed: number }>(
      `select i.id, i.student_id, i.title, i.head, i.due_on::text, (i.amount - i.waived_amount - coalesce((select sum(amount - refunded) from payments where invoice_id = i.id), 0)) owed
       from fee_invoices i join students s on s.id = i.student_id and s.status = 'active'
       where i.due_on + $2::int < $1::date and i.head <> 'fine' and ($3::text[] = '{}' or i.head = any($3))`, [day, rule.graceDays, rule.heads]);
    const smallest = 1 / 10 ** currencyDigits(schoolCurrency());
    let n = 0;
    for (const r of rows.filter((x) => Number(x.owed) > 0)) {
      const start = addDays(r.due_on, rule.graceDays + 1);
      // What each period of this invoice owes, from the first late day to today.
      const periods = new Map<string, number>();
      if (rule.every === 'once') periods.set('once', 1);
      else for (let d = start; d <= day; d = addDays(d, 1)) {
        const key = rule.every === 'week' ? addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)) : d.slice(0, 7);
        periods.set(key, rule.every === 'day' ? (periods.get(key) ?? 0) + 1 : 1);
      }
      const each = rule.kind === 'fixed' ? rule.amount : roundToCurrency((Number(r.owed) * rule.amount) / 100);
      const kept = new Map((await t.pool.query<{ month: string; amount: string; fine_invoice_id: string }>('select month, amount, fine_invoice_id from fee_fines where invoice_id = $1', [r.id])).rows.map((x) => [x.month, x]));
      let total = [...kept.values()].reduce((a, x) => a + Number(x.amount), 0);
      for (const [key, units] of periods) {
        const was = kept.get(key);
        let want = Math.max(smallest, roundToCurrency(units * each));
        if (rule.cap > 0) want = Math.min(want, roundToCurrency(rule.cap - (total - Number(was?.amount ?? 0))));
        if (want <= Number(was?.amount ?? 0) || want <= 0) continue;
        const amount = await this.settings.billed(t, 'fine', want);
        const label = rule.every === 'once' ? r.title : `${r.title} (${key})`;
        const client = await t.pool.connect();
        try {
          await client.query('begin');
          if (was) {
            await client.query('update fee_invoices set amount = $2 where id = $1', [was.fine_invoice_id, amount]);
            await client.query('update fee_fines set amount = $3 where invoice_id = $1 and month = $2', [r.id, key, want]);
          } else {
            const fineId = newId('inv');
            await client.query("insert into fee_invoices (id, student_id, head, title, amount, due_on) values ($1,$2,'fine',$3,$4,$5)", [fineId, r.student_id, tx('Late fee: {title}', { title: label }), amount, day]);
            await client.query('insert into fee_fines (id, invoice_id, fine_invoice_id, month, amount) values ($1,$2,$3,$4,$5)', [newId('fin'), r.id, fineId, key, want]);
          }
          await client.query('commit');
          total += want - Number(was?.amount ?? 0);
          n++;
        } catch {
          await client.query('rollback').catch(() => undefined);
        } finally {
          client.release();
        }
      }
    }
    if (n) await this.audit.record(t, { action: 'fees.lateFines', entity: 'invoice', detail: { count: n, rule: `${rule.kind} ${rule.amount} ${rule.every}` } });
    return `${n} late fees charged or raised.`;
  }

  async remind(t: TenantCtx, user: { id: string; name: string }, ids: string[] | 'overdue'): Promise<{ sent: number }> {
    // "Every overdue family": all of them, not only the ones a page happens to show.
    if (ids === 'overdue') {
      ids = (await t.pool.query<{ id: string }>(
        `with paid as (select invoice_id, sum(amount - refunded) p from payments group by invoice_id)
         select distinct i.student_id id from fee_invoices i left join paid on paid.invoice_id = i.id join students s on s.id = i.student_id and s.status = 'active'
         where i.due_on < $1 and i.amount - i.waived_amount - coalesce(paid.p, 0) > 0`, [schoolToday()])).rows.map((r) => r.id);
    }
    const { rows } = await t.pool.query<{ phone: string | null; name: string }>(
      `select g.phone, s.name from students s join student_guardians sg on sg.student_id = s.id and sg.gets_bills join guardians g on g.id = sg.guardian_id where s.id = any($1)`, [ids]);
    const list = rows.filter((r) => r.phone).map((r) => ({ to: r.phone!, vars: { student: r.name } }));
    await this.messenger.notify(t, 'fees.reminder', list);
    await this.audit.record(t, { actorId: user.id, actorName: user.name, action: 'fee.reminded', entity: 'student', detail: { count: list.length } });
    return { sent: list.length };
  }

}
