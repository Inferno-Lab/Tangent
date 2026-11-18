import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';
import { deviceOf } from '../src/auth/auth.service.js';

let h: Harness;
let parent: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  parent = await h.login('priya.sharma@example.com');
  teacher = await h.login('kavita.iyer@greenfield.edu.in');
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const call = (token: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) => h.call(method, path, { token, body, headers });

describe('the account', () => {
  it('names devices in plain words', () => {
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome, Windows');
    expect(deviceOf('Dart/3.5 (dart:io)')).toBe('Tangent app');
    expect(deviceOf(null)).toBe('Unknown device');
  });

  it('changes an email only with the code sent to the new one, and never to one someone else has', async () => {
    const taken = (await h.schoolSql("select email from users where kind = 'staff' and email is not null and email <> 'kavita.iyer@greenfield.edu.in' limit 1"))[0].email;
    expect((await call(teacher, 'POST', '/v1/me/contact', { email: taken })).status).toBe(409);
    expect((await call(teacher, 'POST', '/v1/me/contact', { email: 'kavita.iyer@greenfield.edu.in' })).status).toBe(400);
    expect((await call(teacher, 'POST', '/v1/me/contact', { phone: '+14155550111', email: 'x@example.org' })).status).toBe(400);
    const ch = (await call(teacher, 'POST', '/v1/me/contact', { email: 'kavita.new@example.org' })).json;
    expect(ch).toMatchObject({ channel: 'email', maskedTo: expect.stringMatching(/@example\.org$/), resendInSeconds: expect.any(Number) });
    // The demo school's code is fixed; a sign-in code cannot stand in for it, nor can someone else use it.
    const wrong = await call(parent, 'POST', '/v1/f/me/contact/confirm', { challengeId: ch.challengeId, code: ch.demoCode });
    expect(wrong.status, JSON.stringify(wrong.json)).toBe(401);
    expect((await call(teacher, 'POST', '/v1/me/contact/confirm', { challengeId: ch.challengeId, code: '000000' })).status).toBe(401);
    const ch2 = (await call(teacher, 'POST', '/v1/me/contact', { email: 'kavita.new@example.org' })).json;
    expect((await call(teacher, 'POST', '/v1/me/contact/confirm', { challengeId: ch2.challengeId, code: ch2.demoCode })).status).toBe(204);
    expect((await h.schoolSql("select email from users where email = 'kavita.new@example.org'"))).toHaveLength(1);
    // Spent: the same code does nothing twice.
    expect((await call(teacher, 'POST', '/v1/me/contact/confirm', { challengeId: ch2.challengeId, code: ch2.demoCode })).status).toBe(401);
  });

  it('changes a parent’s phone on the family’s record too', async () => {
    const r0 = await call(parent, 'POST', '/v1/f/me/contact', { phone: '+91 98220 55555' });
    expect(r0.status, JSON.stringify(r0.json)).toBe(200);
    const ch = r0.json;
    expect(ch.channel).toBe('sms');
    expect((await call(parent, 'POST', '/v1/f/me/contact/confirm', { challengeId: ch.challengeId, code: ch.demoCode })).status).toBe(204);
    const g = await h.schoolSql("select g.phone from guardians g join users u on u.id = g.user_id where u.email = 'priya.sharma@example.com'");
    expect(g[0].phone).toBe('+919822055555');
  });

  it('lists where someone is signed in and signs one out, but not the one asking', async () => {
    const other = await h.login('kavita.new@example.org');
    const list = (await call(teacher, 'GET', '/v1/me/sessions')).json;
    expect(list.length).toBeGreaterThanOrEqual(2);
    const me = list.find((s: any) => s.current);
    const them = list.find((s: any) => !s.current);
    expect((await call(teacher, 'DELETE', `/v1/me/sessions/${me.id}`)).status).toBe(400);
    expect((await call(teacher, 'DELETE', `/v1/me/sessions/${them.id}`)).status).toBe(204);
    expect((await call(teacher, 'DELETE', `/v1/me/sessions/${them.id}`)).status).toBe(404);
    // Signed out there: that session can no longer refresh.
    expect((await call(teacher, 'GET', '/v1/me/sessions')).json.some((s: any) => s.id === them.id)).toBe(false);
    expect(other).toBeTruthy();
  });
});

describe('a copy of a family’s data', () => {
  it('zips every kind of record the school keeps about them and their children', async () => {
    const { unzip } = await import('@tangent/db');
    const admin = await h.login();
    expect((await call(parent, 'POST', '/v1/f/data-requests', { kind: 'access', note: 'Please send me a copy.' })).status).toBe(200);
    const req = (await call(admin, 'GET', '/v1/privacy/requests')).json.find((r: any) => r.fromApp && r.kind === 'access');
    expect((await call(teacher, 'GET', `/v1/privacy/requests/${req.id}/export`)).status).toBe(403);
    const res = await h.call('GET', `/v1/privacy/requests/${req.id}/export`, { token: admin });
    expect(res.status).toBe(200);
    const files = unzip(res.raw);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['account.csv', 'students.csv', 'guardians.csv', 'attendance.csv', 'fees.csv']));
    expect(files.get('students.csv')!.toString('utf8')).toContain('admission_no');
    // Logged at the office (a name in words): answered by hand.
    const office = (await call(admin, 'POST', '/v1/privacy/requests', { kind: 'access', subjectName: 'Someone', requestedBy: 'At the desk', note: '' })).json;
    expect((await call(admin, 'GET', `/v1/privacy/requests/${office.id}/export`)).status).toBe(400);
  });
});
