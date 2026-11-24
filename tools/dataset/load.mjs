#!/usr/bin/env node
// Moves the dataset's school into a running Tangent through its real doors, as onboarding would: the console's new-school
// wizard (a school started for an import), its configuration, every file through the console's Migration import, then the
// principal signs in to the admin (the temporary password and the code from the Test inbox), sends the photo and report-card
// zips, and the staff a tester signs in as get the test password (TEST_PASSWORD) through "Forgot it?".
// Used by tools/dev-reset.sh, CI's browser flows and the app's tests.
// Usage: node tools/dataset/load.mjs [--today 2026-11-20]   (API, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD, DEMO_CODE, TEST_PASSWORD from the env)
import { generateSchool } from './school.mjs';
import { asUpload } from './build.mjs';
import { API, STAFF_PASSWORD, authenticatorCode, call, codeIn, consoleSignIn, fromApp, newMessage, saveManifest, setPassword } from './session.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const today = arg('today', undefined);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const { manifest, files } = generateSchool({ today });
const s = manifest.school;
const principal = manifest.people.principal;

const { accessToken: ct } = await consoleSignIn();
// The tools read who is who from here (session.mjs).
saveManifest(manifest);
if ((await call(`/console/v1/schools?query=${s.slug}`, { token: ct })).some((x) => x.slug === s.slug)) {
  console.log(`${s.name} already exists.`);
  process.exit(0);
}
const cell = (await call('/console/v1/cells', { token: ct }))[0];
const payload = {
  basics: { name: s.name, shortName: s.shortName, slug: s.slug, board: s.board, address: s.address, city: s.city, contactName: s.contactName, contactPhone: s.contactPhone, contactEmail: s.contactEmail, gstin: '', language: s.language, country: s.country, timezone: s.timezone, locale: s.locale, currency: s.currency },
  plan: { plan: 'premium', modules: manifest.modules, addOns: [], locks: [], students: 1200 },
  branding: { color: s.color, logoText: s.logoText, appName: s.appName, tagline: s.tagline },
  placement: { target: cell.target, cell: cell.key, addressing: 'path', customDomain: '' },
  admin: { name: principal.name, email: principal.email, phone: principal.phone, invite: 'email', roles: ['principal'] },
  data: { start: 'import' },
};
const { message: welcome, result: run } = await newMessage(s.slug, [principal.email], /temporary password/, async () => {
  const r = await call('/console/v1/wizard/launch', { body: { payload }, token: ct });
  console.log(`Setting up ${s.name} (run ${r.id})…`);
  for (;;) {
    await sleep(800);
    const x = await call(`/console/v1/runs/${r.id}`, { token: ct });
    if (x.status === 'succeeded') return r;
    if (x.status === 'failed') throw new Error(`Setup stopped: ${x.steps.find((y) => y.status === 'failed')?.error}`);
  }
});
const id = (await call(`/console/v1/schools?query=${s.slug}`, { token: ct })).find((x) => x.slug === s.slug).id;

// What Tangent sets for the school before its files come in.
const config = await call(`/console/v1/schools/${id}/config`, { token: ct });
await call(`/console/v1/schools/${id}/config`, { method: 'PATCH', body: { expectedVersion: config.version, changes: manifest.settings, note: 'Before moving in' }, token: ct });

for (const f of files.filter((x) => x.kind)) {
  const input = { kind: f.kind, csv: asUpload(f), fileName: f.name };
  const preview = await call(`/console/v1/schools/${id}/import/preview`, { body: input, token: ct });
  const bad = preview.rows.filter((r) => r.errors.length);
  if (preview.missing.length || bad.length) throw new Error(`${f.name}: ${bad.length} rows would be left out, e.g. ${bad.slice(0, 2).map((r) => `line ${r.line}: ${r.errors.join(' ')}`).join(' | ')}${preview.missing.length ? `; no column for ${preview.missing.join(', ')}` : ''}`);
  const done = await call(`/console/v1/schools/${id}/import/commit`, { body: input, token: ct });
  if (done.run) {
    // A big file imports in the background: wait for it.
    for (;;) {
      await sleep(1000);
      const r = (await call(`/console/v1/schools/${id}/import`, { token: ct })).runs.find((x) => x.id === done.run.id);
      if (r?.status === 'done') break;
      if (r?.status === 'failed') throw new Error(`${f.name}: ${r.error}`);
    }
  }
  console.log(`  ${f.name}`);
}

// The principal signs in with the invite's temporary password and a code, sends the zips, then chooses the test password.
const temporary = /temporary password (\S+?)\.?\s/.exec(`${welcome.body} `)[1];
const { message: codeMsg, result: challenge } = await newMessage(s.slug, [principal.email, principal.phone], /sign-in code/, () =>
  call('/v1/auth/login', { body: { identifier: principal.email, password: temporary }, school: s.slug }));
// The principal runs the school, so their first sign-in adds an authenticator (its key is kept in .tangent-data).
const principalCode = fromApp(challenge) ? await authenticatorCode(`${API}|${s.slug}|${principal.email}`, challenge.challenge) : codeIn(codeMsg);
const { accessToken: pt } = await call('/v1/auth/verify', { body: { challengeId: challenge.challenge.challengeId, code: principalCode }, school: s.slug });
for (const f of files.filter((x) => x.upload)) {
  const bytes = Buffer.from(f.content);
  const { fileId, upload } = await call('/v1/files', { body: { kind: 'photo_zip', ownerId: 'school', name: f.name, mime: 'application/zip', bytes: bytes.length }, token: pt, school: s.slug });
  const put = await fetch(upload.url.startsWith('http') ? upload.url : `${API}${upload.url}`, { method: upload.method, headers: upload.headers, body: bytes });
  if (!put.ok) throw new Error(`${f.name}: the upload was refused (${put.status}).`);
  await call(`/v1/files/${fileId}/done`, { method: 'POST', token: pt, school: s.slug });
  await call('/v1/moving-in/photos', { body: { fileId }, token: pt, school: s.slug });
  for (;;) {
    await sleep(1000);
    const r = (await call('/v1/moving-in/photos', { token: pt, school: s.slug }))[0];
    if (r?.status === 'done') { console.log(`  ${f.name}: ${r.matched} of ${r.total} matched`); break; }
    if (r?.status === 'failed') throw new Error(`${f.name}: ${r.error}`);
  }
}
await call('/v1/auth/password', { body: { current: temporary, next: STAFF_PASSWORD }, token: pt, school: s.slug });
const { vicePrincipal, office, accountant, classTeacher, mathsTeacher, driver } = manifest.people;
for (const p of [vicePrincipal, office, accountant, classTeacher, mathsTeacher, driver]) await setPassword(s.slug, p);
console.log(`${s.name} has moved in (run ${run.id}): ${manifest.expect.students} students, ${manifest.expect.staff} staff. Staff a tester signs in as use TEST_PASSWORD; families sign in with a code from the console's Test inbox.`);
