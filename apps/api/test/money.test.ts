import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const send = (method: string, url: string, body?: unknown) => h.call(method, url, { token, body });

describe('money in any currency', () => {
  it('bills, pays and settles amounts with cents exactly', async () => {
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await send('POST', '/v1/students/assign-fee', { ids: ['stu_aarav'], head: 'activities', title: 'Robotics kit', amount: 12.5, dueOn: due })).status).toBe(200);
    const inv = (await send('GET', '/v1/fees/invoices?studentId=stu_aarav')).json.find((i: any) => i.title === 'Robotics kit');
    expect(inv.amount).toBe(12.5);
    expect(inv.paid).toBe(0);
    // Two parts that do not add up exactly in floating point still settle to zero.
    const first = await send('POST', '/v1/fees/payments', { studentId: 'stu_aarav', invoiceId: inv.id, amount: 12.2, method: 'cash' });
    expect(first.status).toBe(200);
    expect(first.json.outstanding).toBe(0.3);
    const second = await send('POST', '/v1/fees/payments', { studentId: 'stu_aarav', invoiceId: inv.id, amount: 0.3, method: 'cash' });
    expect(second.status).toBe(200);
    expect(second.json.outstanding).toBe(0);
    const after = (await send('GET', '/v1/fees/invoices?studentId=stu_aarav')).json.find((i: any) => i.id === inv.id);
    expect(after.status).toBe('paid');
  });

  it('refuses more decimals than any currency has, and more than is owed', async () => {
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await send('POST', '/v1/students/assign-fee', { ids: ['stu_aarav'], head: 'activities', title: 'Too precise', amount: 1.2345, dueOn: due })).status).toBe(400);
    await send('POST', '/v1/students/assign-fee', { ids: ['stu_aarav'], head: 'activities', title: 'Lab coat', amount: 7.25, dueOn: due });
    const inv = (await send('GET', '/v1/fees/invoices?studentId=stu_aarav')).json.find((i: any) => i.title === 'Lab coat');
    expect((await send('POST', '/v1/fees/payments', { studentId: 'stu_aarav', invoiceId: inv.id, amount: 7.26, method: 'cash' })).status).toBe(400);
  });
});
