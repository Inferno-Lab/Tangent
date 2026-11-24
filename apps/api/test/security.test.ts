import { toCsv, zip, zipEntries } from '@tangent/db';
import { totp } from '@tangent/security';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_PASSWORD, startHarness, type Harness } from './harness.js';

let h: Harness;
let admin: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
  teacher = await h.login(h.people.classTeacher.email);
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (token: string | undefined, method: string, path: string, body?: unknown) => h.call(method, path, { token, body });

describe('sign-in says nothing about who has an account', () => {
  it('answers a wrong password and an unknown account the same way', async () => {
    const wrong = await call(undefined, 'POST', '/v1/auth/login', { identifier: h.people.office.email, password: 'not-the-password' });
    const nobody = await call(undefined, 'POST', '/v1/auth/login', { identifier: 'nobody.here@example.org', password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(nobody.json.message).toBe(wrong.json.message);
    expect(nobody.json.fields).toEqual(wrong.json.fields);
    expect(wrong.json.attemptsLeft).toBeUndefined();
  });

  it('gives an unknown phone a code screen, and sends nothing', async () => {
    const r = await call(undefined, 'POST', '/v1/auth/code', { identifier: '+919800000999' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ challengeId: expect.any(String), channel: 'sms', maskedTo: expect.any(String) });
    expect(await h.lastMessage('+919800000999')).toBeUndefined();
    expect((await call(undefined, 'POST', '/v1/auth/verify', { challengeId: r.json.challengeId, code: '123456' })).status).toBe(401);
    const reset = await call(undefined, 'POST', '/v1/auth/reset/start', { identifier: 'nobody.here@example.org' });
    expect(reset.status).toBe(200);
    expect(reset.json.channel).toBe('email');
  });

  it('holds back one address after a few wrong passwords, and not the person elsewhere', async () => {
    const email = h.people.accountant.email;
    for (let i = 0; i < 5; i++) await h.app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'x-school': h.slug, 'content-type': 'application/json' }, remoteAddress: '198.51.100.7', payload: JSON.stringify({ identifier: email, password: 'wrong-wrong' }) });
    const held = await h.app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'x-school': h.slug, 'content-type': 'application/json' }, remoteAddress: '198.51.100.7', payload: JSON.stringify({ identifier: email, password: STAFF_PASSWORD }) });
    expect(held.statusCode).toBe(423);
    // The same person from their own computer still signs in.
    const home = await h.app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'x-school': h.slug, 'content-type': 'application/json' }, remoteAddress: '203.0.113.20', payload: JSON.stringify({ identifier: email, password: STAFF_PASSWORD }) });
    expect(home.statusCode).toBe(200);
  });
});

describe('staff who run the school confirm sign-in with an authenticator', () => {
  it('adds one at the first sign-in, asks for it after, and never takes the same code twice', async () => {
    await h.setSettings({ 'security.staffAuthenticator': true });
    const first = await call(undefined, 'POST', '/v1/auth/login', { identifier: h.people.principal.email, password: STAFF_PASSWORD });
    expect(first.json).toMatchObject({ step: 'otp', challenge: { channel: 'app', enroll: { secret: expect.any(String), uri: expect.stringMatching(/^otpauth:\/\/totp\//) } } });
    const secret = first.json.challenge.enroll.secret as string;
    // A texted code is not what it takes: nothing was sent to the principal's phone or email.
    expect((await call(undefined, 'POST', '/v1/auth/verify', { challengeId: first.json.challenge.challengeId, code: '000000' })).status).toBe(401);
    const code = totp(secret);
    expect((await call(undefined, 'POST', '/v1/auth/verify', { challengeId: first.json.challenge.challengeId, code })).status).toBe(200);
    const again = await call(undefined, 'POST', '/v1/auth/login', { identifier: h.people.principal.email, password: STAFF_PASSWORD });
    expect(again.json.challenge).toMatchObject({ channel: 'app' });
    expect(again.json.challenge.enroll).toBeUndefined();
    expect((await call(undefined, 'POST', '/v1/auth/verify', { challengeId: again.json.challenge.challengeId, code })).status).toBe(401);
    // A teacher (who runs nothing) keeps the texted code.
    const t = await call(undefined, 'POST', '/v1/auth/login', { identifier: h.people.classTeacher.email, password: STAFF_PASSWORD });
    expect(t.json.step === 'done' || t.json.challenge.channel !== 'app').toBe(true);
    await h.setSettings({ 'security.staffAuthenticator': false });
    await h.schoolSql("update users set totp_secret = null, totp_last = null where lower(email) = lower($1)", [h.people.principal.email]);
  });
});

describe('a person gives no more access than they have', () => {
  it('refuses a role above theirs, and changes to anyone above them', async () => {
    const roles = (await call(admin, 'GET', '/v1/roles')).json as { id: string; key: string; permissions: string[] }[];
    const principalRole = roles.find((r) => r.key === 'principal')!;
    const made = await call(admin, 'POST', '/v1/roles', { name: 'People desk', description: '', permissions: ['staff.read', 'staff.write', 'settings.manage'] });
    expect(made.status).toBe(201);
    const desk = (made.json as { id: string; name: string }[]).find((r) => r.name === 'People desk')!;
    const officeId = await h.userId(h.people.office.email);
    expect((await call(admin, 'PATCH', `/v1/staff/${officeId}`, { roleId: desk.id })).status).toBe(200);
    const office = await h.login(h.people.office.email);
    // Not a principal made on their own email, nor the principal's role on someone else.
    expect((await call(office, 'POST', '/v1/staff', { name: 'New Principal', email: 'new.principal@example.org', phone: '+919845001234', roleId: principalRole.id, subjectIds: [] })).status).toBe(403);
    const teacherId = await h.userId(h.people.mathsTeacher.email);
    expect((await call(office, 'PATCH', `/v1/staff/${teacherId}`, { roleId: principalRole.id })).status).toBe(403);
    // The principal's email is not theirs to change: that is how an account is taken.
    const principalId = await h.userId(h.people.principal.email);
    expect((await call(office, 'PATCH', `/v1/staff/${principalId}`, { email: 'office.owns@example.org' })).status).toBe(403);
    // A role with more than theirs cannot be made or changed either.
    expect((await call(office, 'POST', '/v1/roles', { name: 'Everything', description: '', permissions: principalRole.permissions })).status).toBe(403);
    // Within their own access they work as before.
    expect((await call(office, 'POST', '/v1/staff', { name: 'Desk Helper', email: 'desk.helper@example.org', phone: '+919845001235', roleId: desk.id, subjectIds: [] })).status).toBe(201);
  });
});

describe('teachers act on the classes they teach', () => {
  it('marks, enters marks and sees receipts only where their role reaches', async () => {
    const me = await h.userId(h.people.classTeacher.email);
    const other = (await h.schoolSql<{ id: string }>(
      'select id from classes where coalesce(class_teacher_id, \'\') <> $1 and id not in (select class_id from timetable_slots where teacher_id = $1 or cover_teacher_id = $1) limit 1', [me]))[0]!.id;
    const day = await h.openDay(0);
    const kids = await h.schoolSql<{ id: string }>("select id from students where class_id = $1 and status = 'active' limit 2", [other]);
    const put = await call(teacher, 'PUT', '/v1/attendance/day', { classId: other, date: day, marks: kids.map((k) => ({ studentId: k.id, status: 'present' })) });
    expect(put.status).toBe(403);
    expect((await call(teacher, 'GET', `/v1/f/attendance/roll?classId=${other}&date=${day}`)).status).toBe(403);
    // A receipt is the office's: a teacher without fees.read does not get one through the app either.
    const pay = (await h.schoolSql<{ id: string }>('select id from payments limit 1'))[0];
    if (pay) expect((await call(teacher, 'GET', `/v1/f/receipts/${pay.id}/pdf`)).status).toBe(403);
  });
});

describe('files and spreadsheets', () => {
  it('keeps what a family typed as text in an exported spreadsheet', () => {
    const csv = toCsv([['=HYPERLINK("http://x")', '+1', '@SUM(A1)', '-5', '-2.5', 'plain']]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toMatch(/,-5,-2\.5,plain/);
  });

  it('refuses a zip entry that unpacks past its limit, whatever its header says', () => {
    const big = zip([{ name: 'sheet.xml', content: Buffer.alloc(3 * 1024 * 1024) }]);
    expect(() => zipEntries(big, { entry: 1024 * 1024 })[0]!.read()).toThrow(/too large/);
    // A header that understates the size: the unpacking itself stops at what it promised.
    const lie = Buffer.from(big);
    const cd = lie.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lie.writeUInt32LE(10, cd + 24);
    expect(() => zipEntries(lie)[0]!.read()).toThrow(/too large/);
    expect(zipEntries(big)[0]!.read().length).toBe(3 * 1024 * 1024);
  });
});
