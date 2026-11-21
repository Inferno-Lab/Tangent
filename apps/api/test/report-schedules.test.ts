import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';
import { coverOf, dueOn } from '../src/school/report-schedules.js';

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await startHarness();
  admin = await h.login();
}, 240_000);
afterAll(async () => {
  await h?.close();
});

describe('scheduled reports', () => {
  it('covers the week or the month before, on the day chosen', () => {
    expect(coverOf('week', '2026-11-16')).toEqual(['2026-11-09', '2026-11-15']);
    expect(coverOf('month', '2026-03-01')).toEqual(['2026-02-01', '2026-02-28']);
    expect(coverOf('month', '2026-01-05')).toEqual(['2025-12-01', '2025-12-31']);
    expect(dueOn({ every: 'week', day: 1 }, '2026-11-16')).toBe(true);
    expect(dueOn({ every: 'week', day: 7 }, '2026-11-15')).toBe(true);
    expect(dueOn({ every: 'month', day: 1 }, '2026-11-16')).toBe(false);
  });

  it('goes only to staff who may read reports, once on its day, as email', async () => {
    const me = await h.userId(h.people.principal.email);
    const teacher = await h.userId(h.people.classTeacher.email);
    const add = (b: Record<string, unknown>) => h.call('POST', '/v1/reports/schedules', { token: admin, body: { reportId: 'attendance-class', every: 'week', day: 1, ...b } });
    expect((await add({ to: [teacher] })).status).toBe(400);
    expect((await add({ to: [me], every: 'week', day: 9 })).status).toBe(400);
    expect((await add({ reportId: 'nothing', to: [me] })).status).toBe(404);
    const ok = await add({ to: [me] });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json[0]).toMatchObject({ title: expect.any(String), every: 'week', day: 1, lastSent: null });
    const { ReportSchedules } = await import('../src/school/report-schedules.js');
    const { TenantService } = await import('../src/tenancy/tenant.js');
    const t = await h.app.get(TenantService).resolve(h.slug);
    const before = Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1 and channel = 'email'", [h.slug])).rows[0].n);
    // A Monday: due. Tuesday: not.
    expect(await h.app.get(ReportSchedules).sendDue(t, '2026-11-17')).toBe('0 scheduled reports, 0 emails.');
    expect(await h.app.get(ReportSchedules).sendDue(t, '2026-11-16')).toBe('1 scheduled reports, 1 emails.');
    expect(await h.app.get(ReportSchedules).sendDue(t, '2026-11-16')).toBe('0 scheduled reports, 0 emails.');
    const mail = (await h.registry.query("select subject, body from sandbox_messages where school_slug = $1 and channel = 'email' order by created_at desc limit 1", [h.slug])).rows[0];
    expect(Number((await h.registry.query("select count(*) n from sandbox_messages where school_slug = $1 and channel = 'email'", [h.slug])).rows[0].n)).toBe(before + 1);
    expect(mail.subject).toMatch(/9 Nov to 15 Nov|Nov/);
    expect((await h.call('DELETE', `/v1/reports/schedules/${ok.json[0].id}`, { token: admin })).json).toEqual([]);
  });
});
