import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type Person } from './harness.js';

let h: Harness;
let principal: string;
beforeAll(async () => {
  h = await startHarness();
  principal = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (method: string, path: string, body?: unknown, token = principal) => h.call(method, path, { token, body });
const anyClass = async () => (await call('GET', '/v1/classes')).json[0].id as string;

describe('names', () => {
  it('makes the full name from the given and family names in the school’s order, and drops parts a typed name no longer matches', async () => {
    const classId = await anyClass();
    const made = await call('POST', '/v1/students', { givenName: 'Lina', familyName: 'Haddad', nameLocal: 'لينا حداد', classId, dob: '2014-03-02', guardianName: 'Omar Haddad', guardianPhone: '9822099001' });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: 'Lina Haddad', givenName: 'Lina', familyName: 'Haddad', nameLocal: 'لينا حداد' });
    // Search finds the second script.
    expect((await call('GET', `/v1/students?query=${encodeURIComponent('حداد')}`)).json.items.some((s: any) => s.id === made.json.id)).toBe(true);
    // One part alone is refused; neither part nor name is refused.
    expect((await call('PATCH', `/v1/students/${made.json.id}`, { givenName: '', familyName: 'Haddad' })).status).toBe(400);
    expect((await call('POST', '/v1/students', { classId, dob: '2014-03-02', guardianName: 'Omar Haddad', guardianPhone: '9822099001' })).status).toBe(400);
    await h.setSettings({ 'people.nameOrder': 'family-given' });
    const swapped = await call('PATCH', `/v1/students/${made.json.id}`, { givenName: 'Lina' });
    expect(swapped.json.name).toBe('Haddad Lina');
    const typed = await call('PATCH', `/v1/students/${made.json.id}`, { name: 'Lina H. Haddad' });
    expect(typed.json).toMatchObject({ name: 'Lina H. Haddad', givenName: null, familyName: null, nameLocal: 'لينا حداد' });
    await h.setSettings({ 'people.nameOrder': 'given-family' });
  });
});

describe('households', () => {
  it('lets both parents get the messages and the bills, refuses a student nobody hears about, and the same phone twice', async () => {
    const stu = (await call('GET', `/v1/students?query=${encodeURIComponent(h.people.parentOfTwo.children![0]!.admissionNo)}`)).json.items[0].id as string;
    const before = (await call('GET', `/v1/students/${stu}`)).json.guardians;
    const first = before.find((g: any) => g.isPrimary);
    const base = { id: first.id, name: first.name, phone: first.phone, email: first.email, relation: first.relation, canCollect: true, isPrimary: true };
    const second = { name: 'Sam Sharma', phone: '9822099002', relation: first.relation, canCollect: false, isPrimary: false };
    expect((await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [{ ...base, getsMessages: false }, { ...second, getsMessages: false }] })).status).toBe(400);
    expect((await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [{ ...base, getsBills: false }, { ...second, getsBills: false, getsMessages: true }] })).status).toBe(400);
    expect((await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [base, { ...second, phone: '9822099002' }, { ...second, name: 'Again', phone: '+91 98220 99002' }] })).status).toBe(400);
    const saved = await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [base, { ...second, getsMessages: true, getsBills: true, channelsOff: ['sms'] }] });
    expect(saved.status).toBe(200);
    expect(saved.json.find((g: any) => g.name === 'Sam Sharma')).toMatchObject({ getsMessages: true, getsBills: true, channelsOff: ['sms'] });
    // Left out by an older client: only the guardian contacted first gets them.
    const old = await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [base, second] });
    expect(old.json.find((g: any) => g.name === 'Sam Sharma')).toMatchObject({ getsMessages: false, getsBills: false });
    await call('PUT', `/v1/students/${stu}/guardians`, { guardians: [base] });
  });
});

describe('leave and leaving', () => {
  it('records leave the office gives, refuses leave that overlaps, and lets two halves of one day be', async () => {
    const stu = (await call('GET', `/v1/students?query=${encodeURIComponent(h.people.parentOfTwo.children![1]!.admissionNo)}`)).json.items[0].id as string;
    const day = '2031-05-12';
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: day, to: '2031-05-10', reason: 'Unwell' })).status).toBe(400);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: day, to: '2031-05-14', reason: 'Unwell' })).status).toBe(201);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: '2031-05-14', to: '2031-05-16', reason: 'Unwell' })).status).toBe(409);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: '2031-05-20', to: '2031-05-20', halfDay: 'am', reason: 'Doctor' })).status).toBe(201);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: '2031-05-20', to: '2031-05-20', halfDay: 'pm', reason: 'Dentist' })).status).toBe(201);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: '2031-05-20', to: '2031-05-20', halfDay: 'am', reason: 'Again' })).status).toBe(409);
    expect((await call('POST', `/v1/students/${stu}/leave`, { from: day, to: '2032-09-01', reason: 'Abroad' })).status).toBe(400);
  });

  it('says why a student left, needs the new school for a transfer, and forgets both when they rejoin', async () => {
    const stu = (await call('GET', `/v1/students?query=${encodeURIComponent(h.people.parentOfOne.children![0]!.admissionNo)}`)).json.items[0].id as string;
    expect((await call('POST', '/v1/year/leavers', { studentId: stu, leftOn: '2026-11-01', reason: 'Family moved', kind: 'transferred' })).status).toBe(400);
    expect((await call('POST', '/v1/year/leavers', { studentId: stu, leftOn: '2026-11-01', reason: 'Family moved', kind: 'transferred', transferTo: 'Riverside School' })).status).toBe(204);
    expect((await call('GET', `/v1/students/${stu}`)).json.left).toMatchObject({ kind: 'transferred', transferTo: 'Riverside School' });
    expect((await call('GET', '/v1/year')).json.leavers.find((l: any) => l.id === stu)).toMatchObject({ kind: 'transferred', transferTo: 'Riverside School' });
    await call('POST', `/v1/year/leavers/${stu}/rejoin`);
    expect((await call('GET', `/v1/students/${stu}`)).json.left).toBeNull();
  });
});

describe('line managers', () => {
  it('refuses a loop, and sends a step to the line manager of whoever asked', async () => {
    const find = async (p: Person) => (await call('GET', `/v1/staff?query=${encodeURIComponent(p.name)}`)).json.find((x: any) => x.name === p.name);
    // A class teacher whose line manager is the office manager.
    const kavita = await find(h.people.classTeacher), meera = await find(h.people.office);
    expect((await call('PATCH', `/v1/staff/${kavita.id}`, { managerId: kavita.id })).status).toBe(400);
    expect((await call('PATCH', `/v1/staff/${kavita.id}`, { managerId: meera.id })).json.managerName).toBe(meera.name);
    expect((await call('PATCH', `/v1/staff/${meera.id}`, { managerId: kavita.id })).status).toBe(400);
    const view = (await call('GET', '/v1/settings/edit')).json;
    await call('PATCH', '/v1/settings', { expectedVersion: view.version, changes: { 'workflows.steps': { staff_leave: [{ key: 'manager', name: 'Line manager', who: 'lineManager' }] } } });
    const office = await h.login(h.people.office.email);
    const day = await h.openDay(45);
    const asked = await call('POST', '/v1/f/staff/leave', { type: 'casual', from: day, to: day, reason: 'A school visit', halfDay: null }, await h.login(h.people.classTeacher.email));
    expect(asked.status, asked.text).toBe(200);
    const leave = (await h.schoolSql("select id from approvals where kind = 'staff_leave' order by created_at desc limit 1"))[0].id;
    const decide = (token: string, decision: string) => call('POST', `/v1/approvals/${leave}/decision`, { decision }, token);
    expect((await decide(principal, 'approve')).status).toBe(403);
    expect((await decide(office, 'approve')).json.status).toBe('approved');
    await decide(principal, 'undo');
    // Without a manager, anyone allowed decides it.
    await call('PATCH', `/v1/staff/${kavita.id}`, { managerId: null });
    expect((await decide(principal, 'approve')).json.status).toBe('approved');
    await decide(principal, 'undo');
    const v2 = (await call('GET', '/v1/settings/edit')).json;
    await call('PATCH', '/v1/settings', { expectedVersion: v2.version, changes: { 'workflows.steps': {} } });
  });
});
