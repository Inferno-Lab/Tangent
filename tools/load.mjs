#!/usr/bin/env node
// Measures a running server the way a busy school morning uses it (docs/one-shot-plan.md §5.3.1): the admin's main reads, the
// app's reads, and many people at once. Fails when a target is missed or anything errors. Run against `tools/dev-reset.sh`, or
// a school loaded with a big test school (console → Migration → "Load a realistic test school", up to 3,000 students).
// Usage: node tools/load.mjs [--school greenfield] [--rounds 20] [--at-once 50]
//   API=http://localhost:4000   ADMIN_USER / ADMIN_PASS / PARENT_USER   targets: ADMIN_MS (1000), APP_MS (300) at the 95th percentile
const API = process.env.API ?? 'http://localhost:4000';
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const slug = arg('school', 'greenfield');
const rounds = Number(arg('rounds', '20'));
const atOnce = Number(arg('at-once', '50'));
const ADMIN_MS = Number(process.env.ADMIN_MS ?? 1000);
const APP_MS = Number(process.env.APP_MS ?? 300);
const h = { 'x-school': slug, 'content-type': 'application/json' };

async function signIn(identifier, password) {
  const r = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: h, body: JSON.stringify(password ? { identifier, password } : { identifier }) }).then((x) => x.json());
  if (r.step === 'done') return r.tokens.accessToken;
  const code = r.challenge?.demoCode ?? process.env.CODE ?? '424242';
  const v = await fetch(`${API}/v1/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challengeId: r.challenge.challengeId, code, client: 'mobile' }) }).then((x) => x.json());
  if (!v.accessToken) throw new Error(`Could not sign in ${identifier}: ${JSON.stringify(v).slice(0, 200)}`);
  return v.accessToken;
}
async function parentToken(identifier) {
  const r = await fetch(`${API}/v1/auth/code`, { method: 'POST', headers: h, body: JSON.stringify({ identifier, client: 'mobile' }) }).then((x) => x.json());
  const v = await fetch(`${API}/v1/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ challengeId: r.challengeId, code: r.demoCode ?? process.env.CODE ?? '424242', client: 'mobile' }) }).then((x) => x.json());
  if (!v.accessToken) throw new Error(`Could not sign in ${identifier}: ${JSON.stringify(v).slice(0, 200)}`);
  return v.accessToken;
}

const errors = [];
async function timed(token, path) {
  const t0 = performance.now();
  const r = await fetch(API + path, { headers: { ...h, authorization: `Bearer ${token}` } }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  const ms = performance.now() - t0;
  if (!r.ok) errors.push(`${path}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  else await r.arrayBuffer();
  return ms;
}
const p = (list, q) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0; };

const admin = await signIn(process.env.ADMIN_USER ?? 'neha.menon@greenfield.edu.in', process.env.ADMIN_PASS ?? 'nest2026');
const parent = await parentToken(process.env.PARENT_USER ?? 'priya.sharma@example.com');
const me = await fetch(`${API}/v1/f/me`, { headers: { ...h, authorization: `Bearer ${parent}` } }).then((x) => x.json());
const child = me.childIds?.[0];

const adminReads = ['/v1/dashboard', '/v1/students?page=1&limit=50', '/v1/fees/invoice-list?page=1&limit=25', '/v1/reports/attendance-class', '/v1/notices', '/v1/events', '/v1/config',
  // The one shot's modules: the front desk and the office's busiest pages.
  '/v1/staff-attendance', '/v1/diary', '/v1/visitors?view=today', '/v1/visitors/roll-call', '/v1/certificates', '/v1/meetings'];
const appReads = ['/v1/f/me', '/v1/f/notices', '/v1/f/events', '/v1/config', '/v1/f/meetings', '/v1/f/gate-pass', '/v1/f/certificates',
  ...(child ? [`/v1/f/students/${child}`, `/v1/f/students/${child}/attendance`, `/v1/f/students/${child}/fees`, `/v1/f/diary/student/${child}`] : [])];

const results = [];
for (const [who, token, reads, target] of [['admin', admin, adminReads, ADMIN_MS], ['app', parent, appReads, APP_MS]]) {
  for (const path of reads) {
    await timed(token, path); // the first read warms the cache
    const times = [];
    for (let i = 0; i < rounds; i++) times.push(await timed(token, path));
    results.push({ who, path, p50: p(times, 0.5), p95: p(times, 0.95), target });
  }
}
// Everyone at once: the morning when every class's register and every family's phone opens together.
const burst = [];
const started = performance.now();
await Promise.all(Array.from({ length: atOnce }, async (_, i) => { burst.push(await timed(i % 2 ? admin : parent, i % 2 ? '/v1/dashboard' : '/v1/f/notices')); }));
const wall = performance.now() - started;

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('who', 6)}${pad('read', 46)}${pad('p50 ms', 9)}${pad('p95 ms', 9)}target`);
let missed = 0;
for (const r of results) {
  const over = r.p95 > r.target;
  if (over) missed++;
  console.log(`${pad(r.who, 6)}${pad(r.path, 46)}${pad(r.p50.toFixed(0), 9)}${pad(r.p95.toFixed(0), 9)}${r.target}${over ? '  OVER' : ''}`);
}
console.log(`\n${atOnce} at once: done in ${wall.toFixed(0)} ms, p95 ${p(burst, 0.95).toFixed(0)} ms.`);
if (errors.length) console.log(`\n${errors.length} errors:\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}`);
if (missed || errors.length) {
  console.log(`\nFAILED: ${missed} reads over target, ${errors.length} errors.`);
  process.exit(1);
}
console.log('\nAll reads within target.');
