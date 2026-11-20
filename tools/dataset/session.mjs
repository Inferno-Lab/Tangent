// Signs people of a running Tangent in the way they really do: the console with its password and its fixed test-track code,
// staff with a password and the code that lands in the Test inbox, families with a code alone. Sessions are kept for a few
// minutes in .tangent-data/sessions.json, so the tools that run one after another (page checks, flows) stay under the
// school's limit of five codes a person in fifteen minutes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const API = (process.env.API ?? 'http://localhost:4000').replace(/\/$/, '');
/** The password the dataset's staff are given once the school has moved in (tools/dataset/load.mjs). */
export const STAFF_PASSWORD = process.env.TEST_PASSWORD ?? 'sunrise-valley-26';
const CONSOLE = { email: process.env.BOOTSTRAP_EMAIL ?? 'kaushal@tangent.app', password: process.env.BOOTSTRAP_PASSWORD ?? 'nest2026', code: process.env.DEMO_CODE ?? '424242' };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const CACHE = '.tangent-data/sessions.json';
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
async function remember(key, make) {
  const all = cached();
  const hit = all[key];
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.session;
  const session = await make();
  mkdirSync('.tangent-data', { recursive: true });
  writeFileSync(CACHE, JSON.stringify({ ...cached(), [key]: { at: Date.now(), session } }));
  return session;
}

let consoleSession;
/** The console's session: `{ accessToken, user }`. */
export async function consoleSignIn() {
  consoleSession ??= remember(`${API}|console|${CONSOLE.email}`, async () => {
    const step = await call('/console/v1/auth/login', { body: { identifier: CONSOLE.email, password: CONSOLE.password } });
    const done = await call('/console/v1/auth/verify', { body: { challengeId: step.challenge.challengeId, code: CONSOLE.code } });
    return { accessToken: done.accessToken, user: done.user };
  });
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

/** A staff member's session: the password, then the code from the Test inbox. `person` is `{ email, phone }`. */
export async function staffSignIn(slug, person, password = STAFF_PASSWORD, client) {
  return remember(`${API}|${slug}|${person.email}|${client ?? 'web'}`, async () => {
    const { message, result } = await newMessage(slug, [person.email, person.phone], /sign-in code/, () =>
      call('/v1/auth/login', { body: { identifier: person.email, password, ...(client ? { client } : {}) }, school: slug }));
    if (result.step === 'done') return { accessToken: result.tokens.accessToken, user: result.tokens.user };
    const t = await call('/v1/auth/verify', { body: { challengeId: result.challenge.challengeId, code: codeIn(message), ...(client ? { client } : {}) }, school: slug });
    return { accessToken: t.accessToken, user: t.user };
  });
}

/** A parent's or student's session: a code to their phone or email, from the Test inbox. */
export async function familySignIn(slug, person, client = 'mobile') {
  const identifier = person.phone ?? person.email;
  return remember(`${API}|${slug}|${identifier}|${client}`, async () => {
    const { message, result } = await newMessage(slug, [person.email, person.phone], /sign-in code/, () => call('/v1/auth/code', { body: { identifier }, school: slug }));
    const t = await call('/v1/auth/verify', { body: { challengeId: result.challengeId ?? result.challenge?.challengeId, code: codeIn(message), client }, school: slug });
    return { accessToken: t.accessToken, user: t.user };
  });
}

/** Gives a staff member a password through "Forgot it?", with the code from the Test inbox. */
export async function setPassword(slug, person, password = STAFF_PASSWORD) {
  const { message, result } = await newMessage(slug, [person.email, person.phone], /new password/, () => call('/v1/auth/reset/start', { body: { identifier: person.email }, school: slug }));
  await call('/v1/auth/reset/finish', { body: { challengeId: result.challengeId, code: codeIn(message), password }, school: slug });
}
