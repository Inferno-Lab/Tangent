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

  it('numbers receipts and admissions the school’s own way, carrying on after numbers already used', async () => {
    const v = (await send('GET', '/v1/settings/edit')).json;
    expect((await send('PATCH', '/v1/settings', { expectedVersion: v.version, changes: { 'fees.receiptPrefix': 'GIS/{yy}/{seq:3}', 'fees.receiptStart': 7, 'people.admissionNumber': 'ADM-{yyyy}-{seq}', 'people.admissionStart': 40 } })).status).toBe(200);
    // A pattern with an unknown token is refused.
    const v2 = (await send('GET', '/v1/settings/edit')).json;
    expect((await send('PATCH', '/v1/settings', { expectedVersion: v2.version, changes: { 'fees.receiptPrefix': 'R-{date}-{seq}' } })).status).toBe(400);
    const yy = new Date().toISOString().slice(2, 4);
    const due = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await send('POST', '/v1/students/assign-fee', { ids: ['stu_aarav'], head: 'activities', title: 'Series check', amount: 30, dueOn: due });
    const inv = (await send('GET', '/v1/fees/invoices?studentId=stu_aarav')).json.find((i: any) => i.title === 'Series check');
    const a = await send('POST', '/v1/fees/payments', { studentId: 'stu_aarav', invoiceId: inv.id, amount: 10, method: 'cash' });
    expect(a.json.receiptNo).toBe(`GIS/${yy}/007`);
    const b = await send('POST', '/v1/fees/payments', { studentId: 'stu_aarav', invoiceId: inv.id, amount: 10, method: 'cash' });
    expect(b.json.receiptNo).toBe(`GIS/${yy}/008`);
    const year = new Date().getFullYear();
    const cls = (await send('GET', '/v1/classes')).json[0].id;
    const add = (name: string, phone: string) => send('POST', '/v1/students', { name, classId: cls, guardianName: 'A Parent', guardianPhone: phone, dob: '2015-04-01' });
    const s1 = await add('Series Child One', '9876500001');
    expect(s1.status, JSON.stringify(s1.json)).toBe(201);
    const one = (await send('GET', `/v1/students/${s1.json.id}`)).json;
    expect(one.admissionNo).toBe(`ADM-${year}-40`);
    const s2 = await add('Series Child Two', '9876500002');
    expect((await send('GET', `/v1/students/${s2.json.id}`)).json.admissionNo).toBe(`ADM-${year}-41`);
  });
});
