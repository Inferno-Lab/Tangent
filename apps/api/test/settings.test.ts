import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

let h: Harness;
let principal: string;
let teacher: string;
beforeAll(async () => {
  h = await startHarness();
  principal = await h.login();
  teacher = await h.login(h.people.classTeacher.email);
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
    // Sign-in, the app, messages, the privacy notice and printed documents are Tangent's to set (the school asks).
    for (const k of ['security.passwordMinLength', 'app.layout', 'notify.quietFrom', 'templates.messages', 'privacy.notice', 'documents.templates']) {
      const r = await change({ [k]: k === 'security.passwordMinLength' ? 12 : k === 'notify.quietFrom' ? '21:00' : k === 'privacy.notice' ? 'x' : {} });
      expect(r.status, k).toBe(400);
      expect(r.json.fields[k], k).toContain('Tangent');
    }
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

  it('keeps a locked setting at Tangent’s value', async () => {
    await h.entitle({ locks: ['library.finePerDay'], overrides: { 'library.finePerDay': 2 } });
    const v = await view();
    expect(v.json.values['library.finePerDay']).toBe(2);
    expect(v.json.locks.map((l: any) => l.key)).toContain('library.finePerDay');
    expect((await change({ 'library.finePerDay': 5 })).status).toBe(400);
    await h.entitle({ locks: [], overrides: {} });
  });

  it('a risky setting waits for a second person in the school', async () => {
    const r = await change({ 'fees.refundApprovalAbove': 48000 }, principal, 'Board raised the limit');
    expect(r.status).toBe(200);
    expect(r.json.pending).toBe(true);
    expect((await view()).json.values['fees.refundApprovalAbove']).not.toBe(48000);
    // The same change asked again while it waits is the same request, not a second one.
    const again = await change({ 'fees.refundApprovalAbove': 48000 }, principal, 'Board raised the limit');
    expect(again.json.approvalId).toBe(r.json.approvalId);
    // The one who asked cannot approve it; a second person with the right to change settings can, and it applies then.
    const self = await h.call('POST', `/v1/approvals/${r.json.approvalId}/decision`, { token: principal, body: { decision: 'approve' } });
    expect(self.status).toBe(403);
    const staff = (await h.call('GET', '/v1/staff', { token: principal })).json;
    const sunita = (Array.isArray(staff) ? staff : staff.items).find((s: any) => s.email === h.people.mathsTeacher.email);
    expect((await h.call('PATCH', `/v1/staff/${sunita.id}`, { token: principal, body: { roleId: 'role_principal' } })).status).toBe(200);
    const second = await h.login(h.people.mathsTeacher.email);
    // The second person sees the setting as it is and as it becomes.
    const waiting = (await h.call('GET', '/v1/approvals?view=waiting', { token: second })).json as { id: string; changes?: { key: string; before: unknown; after: unknown }[] }[];
    const before = (await view()).json.values['fees.refundApprovalAbove'];
    expect(waiting.find((x) => x.id === r.json.approvalId)?.changes).toEqual([{ key: 'fees.refundApprovalAbove', before, after: 48000 }]);
    const ok =await h.call('POST', `/v1/approvals/${r.json.approvalId}/decision`, { token: second, body: { decision: 'approve' } });
    expect(ok.status).toBe(200);
    expect((await view()).json.values['fees.refundApprovalAbove']).toBe(48000);
  });

  it('marks attendance with the school’s own marks, named its way and counted by what they mean', async () => {
    const marks = [
      { key: 'present', name: 'Present', meaning: 'present', code: '/' }, { key: 'absent', name: 'Unauthorised absence', meaning: 'absent', code: 'O' },
      { key: 'late', name: 'Late', meaning: 'late', code: 'L' }, { key: 'medical', name: 'Medical appointment', meaning: 'leave', code: 'M' },
    ];
    expect((await change({ 'attendance.statuses': marks })).status).toBe(200);
    // A list without a mark for present, or with two of the same key, is refused.
    expect((await change({ 'attendance.statuses': marks.filter((m) => m.meaning !== 'present') })).status).toBe(400);
    const date = new Date().toISOString().slice(0, 10);
    const day = (await h.call('GET', `/v1/attendance/day?classId=${await h.classId('8 A')}&date=${date}`, { token: principal })).json;
    const first = day.marks[0].studentId;
    const put = await h.call('PUT', '/v1/attendance/day', { token: principal, body: { classId: await h.classId('8 A'), date, marks: day.marks.map((m: any, i: number) => ({ studentId: m.studentId, status: i === 0 ? 'medical' : 'present' })) } });
    expect(put.status).toBe(200);
    expect(put.json.marks.find((m: any) => m.studentId === first).status).toBe('medical');
    // A mark the school does not use is refused; the meaning's own name (as the app sends it) still works.
    expect((await h.call('PUT', '/v1/attendance/day', { token: principal, body: { classId: await h.classId('8 A'), date, marks: [{ studentId: first, status: 'holiday' }] } })).status).toBe(400);
    expect((await h.call('PUT', '/v1/attendance/day', { token: principal, body: { classId: await h.classId('8 A'), date, marks: day.marks.map((m: any) => ({ studentId: m.studentId, status: m.studentId === first ? 'medical' : 'present' })) } })).status).toBe(200);
  });

  it('reads phone numbers the school’s country way, and finds a family however they type their number', async () => {
    // The school is in the United Arab Emirates for this test (the registry's copy of its country).
    await h.registry.query("update schools set country = 'AE' where slug = $1", [h.slug]);
    await h.entitle({});
    try {
      const classId = await h.classId('8 A');
      const add = (phone: string) => h.call('POST', '/v1/students', { token: principal, body: { name: 'Layla Haddad', classId, dob: '2014-03-01', guardianName: 'Omar Haddad', guardianPhone: phone } });
      const short = await add('050 123');
      expect(short.status).toBe(400);
      expect(short.json.fields.guardianPhone).toContain('+971');
      expect((await add('050 123 4567')).status).toBe(201);
      // The family signs in with the number in international form; it is the same person.
      const code = (await h.call('POST', '/v1/auth/code', { body: { identifier: '+971 50 123 4567' } })).json;
      expect(code.maskedTo).toBeTruthy();
      const again = (await h.call('POST', '/v1/auth/code', { body: { identifier: '0501234567' } })).json;
      expect(again.maskedTo).toBe(code.maskedTo);
    } finally {
      await h.registry.query("update schools set country = 'IN' where slug = $1", [h.slug]);
      await h.entitle({});
    }
  });
});

describe('the school’s own fields on its records', () => {
  it('keeps what the school adds to a student, checks it, and imports it', async () => {
    const fields = { student: [
      { key: 'passport', label: 'Passport number', kind: 'text' },
      { key: 'bus_pass', label: 'Bus pass', kind: 'yesno' },
      { key: 'diet', label: 'Diet', kind: 'choice', options: [{ key: 'veg', name: 'Vegetarian' }, { key: 'any', name: 'No restriction' }] },
    ] };
    expect((await change({ 'fields.custom': fields })).status).toBe(200);
    const body = { name: 'Field Child', classId: await h.classId('8 A'), dob: '2014-03-04', guardianName: 'Field Parent', guardianPhone: '9822099301' };
    // A choice not on the field's list is refused with the field named.
    const bad = await h.call('POST', '/v1/students', { token: principal, body: { ...body, custom: { diet: 'Halal' } } });
    expect(bad.status).toBe(400);
    expect(bad.json.fields['custom.diet']).toBeTruthy();
    const made = await h.call('POST', '/v1/students', { token: principal, body: { ...body, custom: { passport: 'X1234567', diet: 'Vegetarian', bus_pass: true } } });
    expect(made.status).toBe(201);
    expect(made.json.custom).toEqual({ passport: 'X1234567', diet: 'veg', bus_pass: true });
    // A change sends only what changes; the rest stays.
    const edited = await h.call('PATCH', `/v1/students/${made.json.id}`, { token: principal, body: { custom: { bus_pass: false } } });
    expect(edited.json.custom).toEqual({ passport: 'X1234567', diet: 'veg', bus_pass: false });
    // The import reads the fields by their names; an empty cell leaves the value as it was.
    const csv = `admission_no,name,class,dob,guardian,phone,Diet,Passport number\n${made.json.admissionNo},Field Child,8 A,2014-03-04,Field Parent,9822099301,No restriction,\n`;
    const r = (await h.call('POST', '/v1/students/import', { token: principal, body: { csv } })).json;
    expect(r.errors).toEqual([]);
    const after = (await h.call('GET', `/v1/students/${made.json.id}`, { token: principal })).json;
    expect(after.custom).toEqual({ passport: 'X1234567', diet: 'any', bus_pass: false });
    await change({ 'fields.custom': {} });
  });

  it('shows a family only the fields the school marks for the app, in the reader’s words', async () => {
    const parent = await h.login(h.people.parentOfTwo.phone);
    await change({ 'fields.custom': { student: [
      { key: 'bus_pass', label: 'Bus pass', kind: 'yesno', app: true },
      { key: 'note', label: 'Office note', kind: 'text' },
    ] } });
    const child = (await h.schoolSql('select id from students where admission_no = $1', [h.people.parentOfTwo.children![0]!.admissionNo]))[0].id;
    await h.call('PATCH', `/v1/students/${child}`, { token: principal, body: { custom: { bus_pass: true, note: 'Private' } } });
    const s = (await h.call('GET', `/v1/f/students/${child}`, { token: parent })).json;
    expect(s.fields).toEqual({ 'Bus pass': 'Yes' });
    await change({ 'fields.custom': {} });
  });
});

describe('the school’s own steps for a request', () => {
  // The class teacher asks for a day off in the app; the school's own steps take it from there.
  let leave: string;
  beforeAll(async () => {
    const day = await h.openDay(40);
    const asked = await h.call('POST', '/v1/f/staff/leave', { token: teacher, body: { type: 'casual', from: day, to: day, reason: 'A family wedding', halfDay: null } });
    expect(asked.status, asked.text).toBe(200);
    leave = (await h.schoolSql("select id from approvals where kind = 'staff_leave' order by created_at desc limit 1"))[0].id;
  });
  const decide0 = (token: string) => h.call('POST', `/v1/approvals/${leave}/decision`, { token, body: { decision: 'undo' } });

  it('takes a leave request through the office and then the head, each a different person, and undoes back to the start', async () => {
    const office = await h.login(h.people.office.email);
    await change({ 'workflows.steps': { staff_leave: [{ key: 'office', name: 'Office checks', who: 'role', ref: 'office' }, { key: 'head', name: 'Head decides', who: 'permission' }] } });
    const decide = (token: string, decision: string, note?: string) => h.call('POST', `/v1/approvals/${leave}/decision`, { token, body: { decision, note } });
    // The first step is the office's: the principal waits for it.
    expect((await decide(principal, 'approve')).status).toBe(403);
    const waiting = (await h.call('GET', '/v1/approvals?view=waiting', { token: office })).json;
    expect(waiting.find((a: any) => a.id === leave).step).toMatchObject({ at: 1, of: 2, name: 'Office checks' });
    const one = await decide(office, 'approve', 'Cover arranged');
    expect(one.json).toMatchObject({ status: 'pending', step: { at: 2, of: 2, name: 'Head decides' } });
    // The one who took a step does not take the next.
    expect((await decide(office, 'approve')).status).toBe(403);
    const two = await decide(principal, 'approve');
    expect(two.json.status).toBe('approved');
    expect(two.json.step.done.map((d: any) => d.name)).toEqual(['Office checks', 'Head decides']);
    const back = await decide(principal, 'undo');
    expect(back.json).toMatchObject({ status: 'pending', step: { at: 1, done: [] } });
  });

  it('approves a step that waited past its days when the school says so', async () => {
    await change({ 'workflows.steps': { staff_leave: [{ key: 'decide', name: 'Decide', who: 'permission', days: 2, then: 'approve' }] } });
    const { ApprovalsService } = await import('../src/school/approvals.service.js');
    const { TenantService } = await import('../src/tenancy/tenant.js');
    const t = await h.app.get(TenantService).resolve(h.slug);
    await t.pool.query("update approvals set step_at = now() - interval '3 days' where id = $1", [leave]);
    expect(await h.app.get(ApprovalsService).timeLimits(t)).toMatch(/1 approved/);
    expect((await t.pool.query('select status from approvals where id = $1', [leave])).rows[0].status).toBe('approved');
    await decide0(principal);
    await change({ 'workflows.steps': {} });
  });
});

describe('addresses written the country’s way', () => {
  it('keeps an address in the country’s parts, checks its postcode, and writes it as one line', async () => {
    const { COUNTRY_PACKS } = await import('@tangent/contracts');
    expect((await change({ 'people.addressFormat': COUNTRY_PACKS.GB!['people.addressFormat'] })).status).toBe(200);
    const body = { name: 'Address Child', classId: await h.classId('8 A'), dob: '2014-05-06', guardianName: 'Address Parent', guardianPhone: '9822099401' };
    const bad = await h.call('POST', '/v1/students', { token: principal, body: { ...body, addressParts: { line1: '10 High Street', postcode: '12345' } } });
    expect(bad.status).toBe(400);
    expect(bad.json.fields['address.postcode']).toBe('Like SW1A 1AA.');
    const ok = await h.call('POST', '/v1/students', { token: principal, body: { ...body, addressParts: { line1: '10 High Street', city: 'York', region: 'North Yorkshire', postcode: 'YO1 7HH' } } });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ address: '10 High Street, York, North Yorkshire YO1 7HH', addressParts: { city: 'York' } });
    await change({ 'people.addressFormat': (await import('@tangent/contracts')).DEFAULT_ADDRESS_FORMAT });
  });
});

describe('grading the school’s way', () => {
  it('gives a GPA where the year group is graded with points', async () => {
    const scheme = { key: 'gpa', name: 'GPA', kind: 'points', passPct: 40, grades: [8], bands: [{ grade: 'A', minPct: 80, points: 4 }, { grade: 'B', minPct: 60, points: 3 }, { grade: 'C', minPct: 0, points: 2 }] };
    expect((await change({ 'grading.schemes': [scheme] })).status).toBe(200);
    // The first test of the year in 8 A, as the old system's marks brought it.
    const [{ id: exam }] = await h.schoolSql("select id from exams where class_id = $1 and name = 'Periodic Test 1'", [await h.classId('8 A')]);
    const r = (await h.call('GET', `/v1/exams/${exam}/results`, { token: principal })).json;
    expect(r.rows[0].gpa).toBeGreaterThanOrEqual(2);
    expect(['A', 'B', 'C']).toContain(r.rows[0].grade);
    await change({ 'grading.schemes': [] });
    expect((await h.call('GET', `/v1/exams/${exam}/results`, { token: principal })).json.rows[0].gpa).toBeNull();
  });
});

describe('the school’s own printed documents', () => {
  it('prints a receipt and a report card from the school’s own template, and previews one being edited', async () => {
    const receipt = { size: 'A5', blocks: [{ kind: 'school' }, { kind: 'heading', text: 'Official receipt {receiptNo}', align: 'center' }, { kind: 'items' }, { kind: 'signatures', value: 'Bursar\nParent' }] };
    await h.setSettings({ 'documents.templates': { receipt } });
    const preview = await h.call('POST', '/v1/school/documents/preview', { token: principal, body: { kind: 'reportCard', template: { blocks: [{ kind: 'school' }, { kind: 'items' }, { kind: 'fact', text: 'GPA', value: '{gpa}', when: 'gpa' }] } } });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    // A block that is not a block is refused before anything prints.
    expect((await h.call('POST', '/v1/school/documents/preview', { token: principal, body: { kind: 'receipt', template: { blocks: [{ kind: 'banner' }] } } })).status).toBe(400);
    expect((await h.call('POST', '/v1/school/documents/preview', { token: teacher, body: { kind: 'receipt', template: receipt } })).status).toBe(403);
    // A receipt the old system wrote, printed on the school's own template.
    const [{ id }] = await h.schoolSql('select id from payments order by receipt_no limit 1');
    const pdf = await h.call('GET', `/v1/fees/payments/${id}/receipt.pdf`, { token: principal });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await h.setSettings({ 'documents.templates': {} });
  });
});

describe('roles the school makes', () => {
  it('makes, changes and deletes a role with only what its plan includes, and leaves the principal’s alone', async () => {
    const send = (method: string, path: string, body?: unknown, token = principal) => h.call(method, path, { token, body });
    const made = await send('POST', '/v1/roles', { name: 'Exam cell', description: 'Runs the exams', permissions: ['exams.read', 'exams.write'] });
    expect(made.status).toBe(201);
    const cell = made.json.find((r: any) => r.name === 'Exam cell');
    expect(cell).toMatchObject({ locked: false, people: 0, permissions: ['exams.read', 'exams.write'] });
    expect((await send('POST', '/v1/roles', { name: 'exam CELL', permissions: [] })).status).toBe(400);
    expect((await send('PUT', `/v1/roles/${cell.id}`, { name: 'Exam cell', permissions: ['no.such'] })).status).toBe(400);
    expect((await send('PUT', '/v1/roles/role_principal', { name: 'Head', permissions: [] })).status).toBe(409);
    expect((await send('DELETE', '/v1/roles/role_teacher')).status).toBe(409);
    expect((await send('PUT', `/v1/roles/${cell.id}`, { name: 'Exam cell', permissions: ['exams.read'] }, teacher)).status).toBe(403);
    // A permission of a module the school does not have is refused.
    const was = (await h.registry.query("select entitlement->'modules' m from schools where slug = $1", [h.slug])).rows[0].m;
    await h.entitle({ modules: (was as string[]).filter((m) => m !== 'library') });
    try {
      expect((await send('PUT', `/v1/roles/${cell.id}`, { name: 'Exam cell', permissions: ['library.read'] })).status).toBe(400);
    } finally { await h.entitle({ modules: was }); }
    // Tangent can hold the roles for a school.
    await h.setSettings({ 'roles.schoolEdits': false });
    expect((await send('DELETE', `/v1/roles/${cell.id}`)).status).toBe(403);
    await h.setSettings({ 'roles.schoolEdits': true });
    const left = await send('DELETE', `/v1/roles/${cell.id}`);
    expect(left.status).toBe(200);
    expect(left.json.some((r: any) => r.id === cell.id)).toBe(false);
  }, 30_000);
});
