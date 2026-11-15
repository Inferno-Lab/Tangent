import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let principal: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  principal = await h.login();
  teacher = await h.login('kavita.iyer@greenfield.edu.in');
}, 240_000);
afterAll(async () => {
  await h?.close();
});

const view = (token = principal) => h.call('GET', '/v1/settings/edit', { token });
const change = (changes: Record<string, unknown>, token = principal, note = '') =>
  view(token).then((v) => h.call('PATCH', '/v1/settings', { token, body: { expectedVersion: v.json.version, changes, note } }));

describe('the school changes its own settings', () => {
  it('saves a setting of its own, and the apps read it', async () => {
    const r = await change({ 'library.loanDays': 21 });
    expect(r.status).toBe(200);
    expect(r.json.version).toBeGreaterThan(0);
    expect((await view()).json.values['library.loanDays']).toBe(21);
    expect((await h.call('GET', '/v1/config', { token: principal })).json.settings['library.loanDays']).toBe(21);
    // The console's history shows the school's change.
    const v = await h.registry.query("select by from config_versions where changes::text like '%library.loanDays%' order by at desc limit 1");
    expect(v.rows[0]?.by).toContain('(school)');
  });

  it('refuses Tangent’s own settings, bad values and a person without the permission', async () => {
    expect((await change({ 'brand.color': '#123456' })).status).toBe(400);
    const bad = await change({ 'library.loanDays': 500 });
    expect(bad.status).toBe(400);
    expect(bad.json.fields['library.loanDays']).toBeTruthy();
    expect((await change({ 'nope.setting': 1 })).status).toBe(400);
    expect((await change({ 'library.loanDays': 10 }, teacher)).status).toBe(403);
  });

  it('refuses a stale save', async () => {
    const v = await view();
    expect((await h.call('PATCH', '/v1/settings', { token: principal, body: { expectedVersion: v.json.version, changes: { 'library.maxRenewals': 2 } } })).status).toBe(200);
    expect((await h.call('PATCH', '/v1/settings', { token: principal, body: { expectedVersion: v.json.version, changes: { 'library.maxRenewals': 3 } } })).status).toBe(409);
  });

  it('keeps a locked setting at Tangent’s value, and a floor only lets the school be stricter', async () => {
    await h.entitle({ locks: ['library.finePerDay', 'security.passwordMinLength'], overrides: { 'library.finePerDay': 2, 'security.passwordMinLength': 12 } });
    const v = await view();
    expect(v.json.values['library.finePerDay']).toBe(2);
    expect(v.json.locks.map((l: any) => l.key)).toContain('library.finePerDay');
    expect((await change({ 'library.finePerDay': 5 })).status).toBe(400);
    const looser = await change({ 'security.passwordMinLength': 10 });
    expect(looser.status).toBe(400);
    expect(looser.json.fields['security.passwordMinLength']).toContain('at least 12');
    expect((await change({ 'security.passwordMinLength': 14 })).status).toBe(200);
    expect((await view()).json.values['security.passwordMinLength']).toBe(14);
    await h.entitle({ locks: [], overrides: {} });
  });

  it('a risky setting waits for a second person in the school', async () => {
    const r = await change({ 'privacy.retentionMonths': 48 }, principal, 'Board asked for four years');
    expect(r.status).toBe(200);
    expect(r.json.pending).toBe(true);
    expect((await view()).json.values['privacy.retentionMonths']).not.toBe(48);
    // The one who asked cannot approve it; a second person with the right to change settings can, and it applies then.
    const self = await h.call('POST', `/v1/approvals/${r.json.approvalId}/decision`, { token: principal, body: { decision: 'approve' } });
    expect(self.status).toBe(403);
    const staff = (await h.call('GET', '/v1/staff', { token: principal })).json;
    const sunita = (Array.isArray(staff) ? staff : staff.items).find((s: any) => s.email === 'sunita.desai@greenfield.edu.in');
    expect((await h.call('PATCH', `/v1/staff/${sunita.id}`, { token: principal, body: { roleId: 'role_principal' } })).status).toBe(200);
    const second = await h.login('sunita.desai@greenfield.edu.in');
    const ok = await h.call('POST', `/v1/approvals/${r.json.approvalId}/decision`, { token: second, body: { decision: 'approve' } });
    expect(ok.status).toBe(200);
    expect((await view()).json.values['privacy.retentionMonths']).toBe(48);
  });
});
