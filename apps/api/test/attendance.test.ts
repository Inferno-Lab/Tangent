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

const call = (method: string, path: string, body?: unknown) => h.call(method, path, { token, body });

describe('a morning and an afternoon register', () => {
  it('keeps each half on its own, puts them together where one mark a day is shown, and refuses a half the school does not keep', async () => {
    const date = (await call('GET', '/v1/dashboard')).json.day.date as string;
    const cls = 'cls_5c';
    const day = (q = '') => call('GET', `/v1/attendance/day?classId=${cls}&date=${date}${q}`);
    expect((await day('&part=am')).status).toBe(400);
    expect((await day()).json).toMatchObject({ part: 'day', parts: ['day'] });
    await h.setSettings({ 'attendance.registers': 'ampm' });
    try {
      const am = (await day('&part=am')).json;
      expect(am).toMatchObject({ part: 'am', parts: ['am', 'pm'] });
      const [first, second] = am.marks.map((m: any) => m.studentId);
      const mark = (part: string, a: string, b: string) => call('PUT', '/v1/attendance/day', { classId: cls, date, part,
        marks: am.marks.map((m: any) => ({ studentId: m.studentId, status: m.studentId === first ? a : m.studentId === second ? b : 'present' })) });
      expect((await mark('am', 'present', 'absent')).status).toBe(200);
      // The afternoon is still unmarked; the morning's marks stay the morning's.
      expect((await day('&part=pm')).json.submitted).toBe(false);
      expect((await mark('pm', 'absent', 'absent')).status).toBe(200);
      expect((await day('&part=am')).json.marks.find((m: any) => m.studentId === first).status).toBe('present');
      // One line a day: present for one half is a half day; absent both halves is absent.
      const record = async (id: string) => (await call('GET', `/v1/students/${id}`)).json.attendance10.at(-1);
      expect(await record(first)).toBe('half_day');
      expect(await record(second)).toBe('absent');
      expect((await call('PUT', '/v1/attendance/day', { classId: cls, date, part: 'day', marks: [{ studentId: first, status: 'present' }] })).status).toBe(400);
    } finally {
      await h.setSettings({ 'attendance.registers': 'day' });
    }
  });
});

describe('persistent absence', () => {
  it('lists students below the school’s limit for the year so far', async () => {
    await h.setSettings({ 'attendance.persistentPct': 99 });
    try {
      const r = (await call('GET', '/v1/reports/attendance-persistent')).json;
      expect(r.columns.map((c: any) => c.key)).toEqual(['student', 'class', 'n', 'missed', 'rate']);
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.rows.every((x: any) => Number(x.rate.replace('%', '')) < 99)).toBe(true);
    } finally {
      await h.setSettings({ 'attendance.persistentPct': 90 });
    }
  });
});
