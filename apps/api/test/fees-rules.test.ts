import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, schoolToday } from '@tangent/contracts';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let token: string;
beforeAll(async () => {
  h = await startHarness();
  token = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (method: string, path: string, body?: unknown) => h.call(method, path, { token, body });
const pool = async () => (await h.app.get((await import('../src/tenancy/tenant.js')).TenantService).resolve(h.slug));

describe('fee categories', () => {
  it('bills a category its own fee in place of the everyone fee of that head, and refuses a category the school does not have', async () => {
    await h.setSettings({ 'fees.categories': [{ key: 'staff', name: 'Staff child' }] });
    try {
      const stu = (await call('GET', '/v1/students?classId=cls_3a')).json.items.slice(0, 2).map((s: any) => s.id);
      expect((await call('PATCH', `/v1/students/${stu[0]}`, { feeCategory: 'royalty' })).status).toBe(400);
      expect((await call('PATCH', `/v1/students/${stu[0]}`, { feeCategory: 'Staff child' })).json.feeCategory).toBe('staff');
      const due = addDays(schoolToday(), 40);
      const put = (row: Record<string, string>) => call('PUT', '/v1/setup/fee_structures', { row });
      const first = await put({ grade: '3', head: 'tuition', title: 'Cat check', amount: '1000', due_on: due });
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      const second = await put({ grade: '3', head: 'tuition', title: 'Cat check staff', amount: '200', due_on: due, fee_category: 'staff' });
      expect(second.status, JSON.stringify(second.json)).toBe(200);
      const rows = (await call('GET', '/v1/setup')).json.find((s: any) => s.kind === 'fee_structures').rows;
      const all = rows.find((r: any) => r.title === 'Cat check'), staff = rows.find((r: any) => r.title === 'Cat check staff');
      await call('POST', `/v1/setup/fee_structures/${all.id}/apply`);
      await call('POST', `/v1/setup/fee_structures/${staff.id}/apply`);
      const titles = async (id: string) => (await call('GET', `/v1/fees/invoices?studentId=${id}`)).json.map((i: any) => i.title);
      expect(await titles(stu[0])).toContain('Cat check staff');
      expect(await titles(stu[0])).not.toContain('Cat check');
      expect(await titles(stu[1])).toContain('Cat check');
      expect(await titles(stu[1])).not.toContain('Cat check staff');
    } finally {
      await h.setSettings({ 'fees.categories': [] });
    }
  });
});

describe('late fees and reminders', () => {
  it('charges a fee by the day after the grace days up to the cap, once per run, and catches up a missed run', async () => {
    const t = await pool();
    const stu = (await call('GET', '/v1/students?classId=cls_2b')).json.items[0].id;
    const today = schoolToday();
    await t.pool.query("insert into fee_invoices (id, student_id, head, title, amount, due_on) values ('inv_late_test', $1, 'tuition', 'Late check', 1000, $2)", [stu, addDays(today, -10)]);
    await h.setSettings({ 'fees.lateRule': { kind: 'fixed', amount: 5, every: 'day', graceDays: 3, cap: 25, heads: ['tuition'] } });
    const { FeesService } = await import('../src/school/fees.service.js');
    const fees = h.app.get(FeesService);
    try {
      await fees.lateFines(t, today);
      const fines = async () => (await t.pool.query("select f.month, f.amount::float a from fee_fines f where f.invoice_id = 'inv_late_test' order by month")).rows;
      const total = async () => (await fines()).reduce((a: number, r: any) => a + r.a, 0);
      // Ten days late, three of grace: six late days (from the fourth after the due date to today) at 5, capped at 25.
      expect(await total()).toBe(25);
      await fees.lateFines(t, today);
      expect(await total()).toBe(25);
      // A once-only rule is one fine whatever the days.
      await t.pool.query("delete from fee_invoices where id in (select fine_invoice_id from fee_fines where invoice_id = 'inv_late_test')");
      await h.setSettings({ 'fees.lateRule': { kind: 'percent', amount: 10, every: 'once', graceDays: 0, cap: 0, heads: [] } });
      await fees.lateFines(t, today);
      expect(await fines()).toEqual([{ month: 'once', a: 100 }]);
    } finally {
      await h.setSettings({ 'fees.lateRule': null });
      await t.pool.query("delete from fee_invoices where id in (select fine_invoice_id from fee_fines where invoice_id = 'inv_late_test')");
      await t.pool.query("delete from fee_invoices where id = 'inv_late_test'");
    }
  });

  it('reminds on each of the school’s days, saying overdue after the due date, once a day', async () => {
    const t = await pool();
    const stu = (await call('GET', '/v1/students?classId=cls_2b')).json.items[1].id;
    const today = schoolToday();
    await t.pool.query("insert into fee_invoices (id, student_id, head, title, amount, due_on) values ('inv_rem_a', $1, 'tuition', 'Rem before', 100, $2), ('inv_rem_b', $1, 'tuition', 'Rem after', 100, $3)", [stu, addDays(today, 5), addDays(today, -7)]);
    await h.setSettings({ 'fees.reminderDays': [-5, 7] });
    const { FeesService } = await import('../src/school/fees.service.js');
    try {
      const before = Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1", [h.slug])).rows[0].n);
      await h.app.get(FeesService).dailyReminders(t, today);
      const reminded = (await t.pool.query("select invoice_id from fee_reminders where invoice_id in ('inv_rem_a','inv_rem_b') and day = $1 order by 1", [today])).rows.map((r: any) => r.invoice_id);
      expect(reminded).toEqual(['inv_rem_a', 'inv_rem_b']);
      const after = Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1", [h.slug])).rows[0].n);
      expect(after).toBeGreaterThan(before);
      await h.app.get(FeesService).dailyReminders(t, today);
      expect(Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1", [h.slug])).rows[0].n)).toBe(after);
    } finally {
      await h.setSettings({ 'fees.reminderDays': [] });
      await t.pool.query("delete from fee_invoices where id in ('inv_rem_a','inv_rem_b')");
    }
  });
});
