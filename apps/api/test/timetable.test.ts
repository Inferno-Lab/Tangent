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

describe('how the timetable repeats', () => {
  it('lays out A and B weeks and a cycle of days, and tells the apps each date’s day', async () => {
    expect((await call('GET', `/v1/timetable?classId=${await h.classId('8 A')}`)).json.days.map((d: any) => d.key)).toContain('mon');
    await h.setSettings({ 'timetable.cycle': { kind: 'ab', startsOn: '2026-11-02' }, 'calendar.weeklyOff': ['sat', 'sun'] });
    try {
      const v = (await call('GET', `/v1/timetable?classId=${await h.classId('8 A')}`)).json;
      expect(v.days.map((d: any) => d.key)).toEqual(['mon-a', 'tue-a', 'wed-a', 'thu-a', 'fri-a', 'mon-b', 'tue-b', 'wed-b', 'thu-b', 'fri-b']);
      // A lesson in week B on a free period of the class, and the apps' map of dates to days.
      const used = new Set(v.slots.filter((s: any) => s.day === 9).map((s: any) => s.period));
      const free = v.periods.find((p: any) => p.kind === 'period' && !used.has(p.idx));
      if (free) {
        const placed = await call('POST', '/v1/timetable/slots', { classId: await h.classId('8 A'), day: 9, period: free.idx, subjectId: v.slots[0].subjectId, teacherId: (await call('GET', `/v1/timetable/teachers?slotId=${v.slots[0].id}`)).json.find((x: any) => x.free)?.id ?? v.slots[0].teacherId });
        expect([200, 201, 409]).toContain(placed.status);
      }
      expect((await call('POST', '/v1/timetable/slots', { classId: await h.classId('8 A'), day: 6, period: 1, subjectId: v.slots[0].subjectId, teacherId: v.slots[0].teacherId })).status).toBe(400);
      const cfg = (await call('GET', '/v1/config')).json;
      expect(cfg.timetable.keys).toHaveLength(10);
      expect(Object.values(cfg.timetable.dates).every((k: any) => /^(mon|tue|wed|thu|fri)-(a|b)$/.test(k))).toBe(true);
      await h.setSettings({ 'timetable.cycle': { kind: 'days', length: 6, startsOn: schoolToday() } });
      const six = (await call('GET', '/v1/config')).json.timetable;
      expect(six.keys).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
      // Today (if the school is open) is Day 1.
      if (six.dates[schoolToday()]) expect(six.dates[schoolToday()]).toBe('d1');
      // A cycle needs its first day.
      const bad = await h.call('PATCH', '/v1/settings', { token, body: { expectedVersion: (await call('GET', '/v1/settings/edit')).json.version, changes: { 'timetable.cycle': { kind: 'days', length: 6 } } } });
      expect(bad.status).toBe(400);
    } finally {
      await h.setSettings({ 'timetable.cycle': { kind: 'week', length: 6 }, 'calendar.weeklyOff': [] });
      await h.call('DELETE', '/v1/timetable/slots/x', { token });
    }
  });
});

describe('rooms and bookings', () => {
  it('keeps lessons to the school’s rooms, never two classes in one, follows a rename, and books only free times', async () => {
    const v = (await call('GET', `/v1/timetable?classId=${await h.classId('9 A')}`)).json;
    const slot = v.slots[0];
    const other = (await call('GET', `/v1/timetable?classId=${await h.classId('9 B')}`)).json.slots.find((s: any) => s.day === slot.day && s.period === slot.period);
    const added = await call('POST', '/v1/timetable/room-list', { name: 'Room Z9', capacity: 30 });
    expect(added.status).toBe(201);
    expect((await call('POST', '/v1/timetable/room-list', { name: 'room z9' })).status).toBe(400);
    const lab = added.json.find((r: any) => r.name === 'Room Z9');
    // With rooms listed, a lesson's room must be one of them, and only one class may be in it at a time.
    expect((await call('PATCH', `/v1/timetable/slots/${slot.id}`, { room: 'Nowhere' })).status).toBe(400);
    expect((await call('PATCH', `/v1/timetable/slots/${slot.id}`, { room: 'room z9' })).status).toBe(204);
    if (other) expect((await call('PATCH', `/v1/timetable/slots/${other.id}`, { room: 'Room Z9' })).status).toBe(409);
    const renamed = await call('PUT', `/v1/timetable/room-list/${lab.id}`, { name: 'Science Lab', capacity: 30 });
    expect(renamed.json.find((r: any) => r.id === lab.id)).toMatchObject({ name: 'Science Lab', lessons: 1 });
    expect((await call('GET', `/v1/timetable?classId=${await h.classId('9 A')}`)).json.slots.find((s: any) => s.id === slot.id).room).toBe('Science Lab');
    expect((await call('DELETE', `/v1/timetable/room-list/${lab.id}`)).status).toBe(409);
    // Bookings: not over a lesson, not over another booking, not in the past.
    const day = addDays(schoolToday(), 1);
    const roomDay = (await call('GET', `/v1/timetable/room-list/${lab.id}/day?date=${day}`)).json;
    const book = (start: string, end: string, date = day) => call('POST', '/v1/timetable/bookings', { roomId: lab.id, date, start, end, purpose: 'Parents evening' });
    if (roomDay.lessons[0]) expect((await book(roomDay.lessons[0].start, roomDay.lessons[0].end)).status).toBe(409);
    const late = await book('19:00', '20:00');
    expect(late.status).toBe(201);
    expect(late.json.bookings[0]).toMatchObject({ start: '19:00', end: '20:00', mine: true });
    expect((await book('19:30', '21:00')).status).toBe(409);
    expect((await book('20:00', '19:00')).status).toBe(400);
    expect((await book('19:00', '20:00', addDays(schoolToday(), -3))).status).toBe(400);
    expect((await call('DELETE', `/v1/timetable/bookings/${late.json.bookings[0].id}`)).status).toBe(204);
    await call('PATCH', `/v1/timetable/slots/${slot.id}`, { room: null });
    expect((await call('DELETE', `/v1/timetable/room-list/${lab.id}`)).status).toBe(200);
  });
});

describe('a day with its own bell times', () => {
  it('gives a day its own times for every class or one class, refuses overlaps, and the app reads them', async () => {
    const v = (await call('GET', `/v1/timetable?classId=${await h.classId('8 A')}`)).json;
    const first = v.periods.find((p: any) => p.kind === 'period');
    const second = v.periods.filter((p: any) => p.kind === 'period')[1];
    const day = v.slots.find((s: any) => s.period === first.idx).day;
    expect((await call('PUT', '/v1/timetable/times', { day, classId: null, times: [{ period: first.idx, starts: '08:00', ends: '09:00' }, { period: second.idx, starts: '08:30', ends: '09:10' }] })).status).toBe(400);
    expect((await call('PUT', '/v1/timetable/times', { day, classId: null, times: [{ period: first.idx, starts: '07:30', ends: '08:10' }] })).status).toBe(200);
    expect((await call('PUT', '/v1/timetable/times', { day, classId: await h.classId('8 A'), times: [{ period: first.idx, starts: '07:45', ends: '08:20' }] })).status).toBe(200);
    // The class's own wins over the school's for that day; another class has the school's.
    expect((await call('GET', `/v1/timetable?classId=${await h.classId('8 A')}`)).json.times[`${day}|${first.idx}`]).toEqual({ starts: '07:45', ends: '08:20' });
    expect((await call('GET', `/v1/timetable?classId=${await h.classId('8 B')}`)).json.times[`${day}|${first.idx}`]).toEqual({ starts: '07:30', ends: '08:10' });
    const parent = await h.login(h.people.parentOfTwo.phone);
    const keys = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const week = (await h.call('GET', `/v1/f/classes/${await h.classId('8 A')}/timetable`, { token: parent })).json;
    if (Array.isArray(week)) expect(week.find((d: any) => d.day === keys[day])?.periods.some((p: any) => p.start === '07:45')).toBe(true);
    await call('PUT', '/v1/timetable/times', { day, classId: null, times: [] });
    await call('PUT', '/v1/timetable/times', { day, classId: await h.classId('8 A'), times: [] });
    expect((await call('GET', '/v1/timetable/times')).json).toEqual([]);
  });
});
