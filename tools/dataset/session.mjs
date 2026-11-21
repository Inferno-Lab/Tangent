// Signs people of a running Tangent in the way they really do: the console with its password and its fixed test-track code,
// staff with a password and the code that lands in the Test inbox, families with a code alone. Sessions are kept for a few
// minutes in .tangent-data/sessions.json, so the tools that run one after another (page checks, flows) stay under the
// school's limit of five codes a person in fifteen minutes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const API = (process.env.API ?? 'http://localhost:4000').replace(/\/$/, '');
/** The password the dataset's staff are given once the school has moved in (tools/dataset/load.mjs). */
export const STAFF_PASSWORD = process.env.TEST_PASSWORD ?? 'sunrise-valley-26';
export const CONSOLE_LOGIN = { email: process.env.BOOTSTRAP_EMAIL ?? 'kaushal@tangent.app', password: process.env.BOOTSTRAP_PASSWORD ?? 'nest2026', code: process.env.DEMO_CODE ?? '424242' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const DATA = fileURLToPath(new URL('../../.tangent-data/', import.meta.url));
const CACHE = `${DATA}sessions.json`;
/** The school the tools work on: the dataset's, unless SCHOOL names another. */
export const SCHOOL = process.env.SCHOOL ?? 'sunrise-valley';
const KEEP_MS = 10 * 60_000;

export async function call(path, { method, body, token, school } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(school ? { 'x-school': school } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method ?? (body ? 'POST' : 'GET')} ${path}: ${json.message ?? res.status}`);
  return json;
}

const cached = () => { try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return {}; } };
/** A session kept from an earlier run, while it is young and the server still takes it (a flow may have signed it out). */
async function remember(key, make, still) {
  const all = cached();
  const hit = all[key];
  if (hit && Date.now() - hit.at < KEEP_MS && (await still(hit.session).then(() => true, () => false))) return hit.session;
  const session = await make();
  mkdirSync(DATA, { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ ...cached(), [key]: { at: Date.now(), session } }));
  return session;
}

let consoleSession;
/** The console's session: `{ accessToken, user }`. */
export async function consoleSignIn() {
  consoleSession ??= remember(`${API}|console|${CONSOLE_LOGIN.email}`, async () => {
    const step = await call('/console/v1/auth/login', { body: { identifier: CONSOLE_LOGIN.email, password: CONSOLE_LOGIN.password } });
    const done = await call('/console/v1/auth/verify', { body: { challengeId: step.challenge.challengeId, code: CONSOLE_LOGIN.code } });
    return { accessToken: done.accessToken, user: done.user };
  }, (c) => call('/console/v1/cells', { token: c.accessToken }));
  return consoleSession;
}

const norm = (x) => x.toLowerCase().replace(/[\s-]/g, '');
/** Runs `send`, then waits for the new Test inbox message to any of `to` that matches, and returns it. */
export async function newMessage(slug, to, match, send) {
  const { accessToken } = await consoleSignIn();
  const list = () => call(`/console/v1/sandbox?school=${encodeURIComponent(slug)}`, { token: accessToken });
  const seen = new Set((await list()).map((m) => m.id));
  const result = await send();
  const mine = new Set(to.filter(Boolean).map(norm));
  for (let i = 0; i < 40; i++) {
    const found = (await list()).find((m) => !seen.has(m.id) && mine.has(norm(m.to)) && match.test(m.body));
    if (found) return { message: found, result };
    await sleep(250);
  }
  throw new Error(`No message to ${to.join(' or ')} reached the Test inbox.`);
}
export const codeIn = (m) => /\b(\d{6})\b/.exec(m.body)[1];

/** A staff member's session: the password, then the code from the Test inbox. `person` is `{ email, phone }`; `fresh` signs in anew. */
export async function staffSignIn(slug, person, { password = STAFF_PASSWORD, client, fresh = false } = {}) {
  const make = async () => {
    const { message, result } = await newMessage(slug, [person.email, person.phone], /sign-in code/, () =>
      call('/v1/auth/login', { body: { identifier: person.email, password, ...(client ? { client } : {}) }, school: slug }));
    if (result.step === 'done') return { accessToken: result.tokens.accessToken, user: result.tokens.user };
    const t = await call('/v1/auth/verify', { body: { challengeId: result.challenge.challengeId, code: codeIn(message), ...(client ? { client } : {}) }, school: slug });
    return { accessToken: t.accessToken, user: t.user };
  };
  return fresh ? make() : remember(`${API}|${slug}|${person.email}|${client ?? 'web'}`, make, (x) => call('/v1/me', { token: x.accessToken, school: slug }));
}

/** A parent's or student's session: a code to their phone or email, from the Test inbox. */
export async function familySignIn(slug, person, client = 'mobile') {
  const identifier = person.phone ?? person.email;
  return remember(`${API}|${slug}|${identifier}|${client}`, async () => {
    const { message, result } = await newMessage(slug, [person.email, person.phone], /sign-in code/, () => call('/v1/auth/code', { body: { identifier }, school: slug }));
    const t = await call('/v1/auth/verify', { body: { challengeId: result.challengeId ?? result.challenge?.challengeId, code: codeIn(message), client }, school: slug });
    return { accessToken: t.accessToken, user: t.user };
  }, (x) => call('/v1/f/me', { token: x.accessToken, school: slug }));
}

/** Gives a staff member a password through "Forgot it?", with the code from the Test inbox. */
export async function setPassword(slug, person, password = STAFF_PASSWORD) {
  const { message, result } = await newMessage(slug, [person.email, person.phone], /new password/, () => call('/v1/auth/reset/start', { body: { identifier: person.email }, school: slug }));
  await call('/v1/auth/reset/finish', { body: { challengeId: result.challengeId, code: codeIn(message), password }, school: slug });
}

/** What tools/dataset/load.mjs moved in: the school, its people and its totals (written beside the local database). */
export function manifest() {
  try { return JSON.parse(readFileSync(`${DATA}manifest.json`, 'utf8')); } catch { throw new Error('No school has moved in here yet: run tools/dev-reset.sh (or node tools/dataset/load.mjs).'); }
}
export const saveManifest = (m) => { mkdirSync(DATA, { recursive: true }); writeFileSync(`${DATA}manifest.json`, JSON.stringify(m, null, 1)); };

/** The principal's admin session as the admin keeps it in the browser: [storage key, stored user, access token]. */
export async function adminKey(slug = SCHOOL, person = manifest().people.principal) {
  const t = await staffSignIn(slug, person);
  return [`tangent.admin.${slug}`, JSON.stringify({ user: t.user }), t.accessToken];
}
/** The console's session as the console keeps it, and the school's id there. */
export async function consoleKey(slug = SCHOOL) {
  const t = await consoleSignIn();
  const list = await call('/console/v1/schools', { token: t.accessToken });
  return { key: ['tangent.console', JSON.stringify({ user: t.user }), t.accessToken], school: list.find((s) => s.slug === slug)?.id };
}
