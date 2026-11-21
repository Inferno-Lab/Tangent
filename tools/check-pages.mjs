#!/usr/bin/env node
// Opens admin and console pages in parallel and reports console errors, failed API calls, sideways scrolling and anything
// clipped or outside the window (tools/lib/audit.mjs); with --scans, the layout scans on the same load (tools/lib/scans.mjs).
// Each page loads once per size and theme; several pages load at a time.
//
//   node tools/check-pages.mjs                 every page at 390 and 1440, light          (before a push)
//   node tools/check-pages.mjs --changed       only pages whose files changed since origin/main
//   node tools/check-pages.mjs --full          360, 390, 768 and 1440, light and dark     (CI; also `audit-ui.mjs`)
//   options: --only admin|console  --sizes 1440x900,390x844  --dark|--light|--both  --rtl  --workers 6
//            --scans gaps,fit,cutoff,scroll,tight|all (reported; they fail the run only with --strict)  --shots dir
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { auditPage } from './lib/audit.mjs';
import { adminPaths as pages, consolePaths } from './lib/pages.mjs';
import * as scans from './lib/scans.mjs';
import { SCHOOL, adminKey, consoleKey } from './dataset/session.mjs';

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const val = (n) => (has(n) ? args[args.indexOf(n) + 1] : undefined);
const full = has('--full');
const only = val('--only');
const shots = val('--shots');
const rtl = has('--rtl');
if (shots) mkdirSync(shots, { recursive: true });
const API = process.env.API ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN ?? 'http://127.0.0.1:5173';
const CONSOLE = process.env.CONSOLE ?? 'http://127.0.0.1:5174';
const slug = SCHOOL;
const SIZES = val('--sizes') ? val('--sizes').split(',').map((x) => x.split('x').map(Number))
  : full ? [[360, 740], [390, 844], [768, 1024], [1440, 900]] : [[390, 844], [1440, 900]];
const THEMES = has('--dark') ? [true] : has('--light') ? [false] : full || has('--both') ? [false, true] : [false];
const WORKERS = Number(val('--workers') ?? Math.max(2, Math.min(6, cpus().length - 1)));
const SCANS = val('--scans') === 'all' ? Object.keys(scans) : (val('--scans') ?? '').split(',').filter(Boolean);
for (const s of SCANS) if (!scans[s]) { console.error(`No scan called ${s}: ${Object.keys(scans).join(', ')}`); process.exit(2); }

/**
 * --changed: the pages a change can reach. A page's own folder (apps/admin/src/pages/fees) reaches the pages under its
 * address (/fees…); anything shared (an app's frame, packages, styles) reaches every page of that app, or of both.
 */
function changedScope() {
  const git = (a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };
  const files = [...new Set([...git(['diff', '--name-only', 'origin/main...HEAD']), ...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])];
  const scope = { admin: new Set(), console: new Set(), allAdmin: false, allConsole: false };
  for (const f of files) {
    if (/^packages\/(web-ui|contracts|config-engine|api-client)\//.test(f) || /^design\//.test(f)) { scope.allAdmin = scope.allConsole = true; continue; }
    const page = /^apps\/(admin|console)\/src\/pages\/([^/]+)\//.exec(f);
    if (page) { scope[page[1]].add(page[2]); continue; }
    if (/^apps\/admin\/src\//.test(f)) scope.allAdmin = true;
    if (/^apps\/console\/src\//.test(f)) scope.allConsole = true;
  }
  return scope;
}
// A page folder is matched by the first part of a page's address ("/fees/settings" → fees); a folder no address starts
// with (a shared part of pages) reaches every page of its app.
const reaches = (areas, all, path) => all || [...areas].some((a) => path.split('/')[1]?.startsWith(a.replace(/s$/, '')) || a.startsWith(path.split('/')[1] || '~'));

const jobs = [];
const sessions = [];
const scope = has('--changed') ? changedScope() : null;
if (only !== 'console') {
  const key = await adminKey();
  sessions.push(key);
  let paths = [...pages, '/design', '/apply', '/nope'];
  if (scope) {
    const known = new Set(paths.map((p) => p.split('/')[1]));
    const all = scope.allAdmin || [...scope.admin].some((a) => ![...known].some((k) => k && (k.startsWith(a.replace(/s$/, '')) || a.startsWith(k))));
    paths = paths.filter((p) => reaches(scope.admin, all, p));
  }
  for (const p of paths) jobs.push({ name: `admin${p || '/'}`, url: `${ADMIN}/s/${slug}${p}` });
}
if (only !== 'admin') {
  const c = await consoleKey();
  sessions.push(c.key);
  let paths = consolePaths(c.school);
  if (scope) {
    const known = new Set(paths.map((p) => p.split('/')[1]));
    const all = scope.allConsole || [...scope.console].some((a) => ![...known].some((k) => k && (k.startsWith(a.replace(/s$/, '')) || a.startsWith(k))));
    paths = paths.filter((p) => reaches(scope.console, all, p));
  }
  for (const p of paths) jobs.push({ name: `console${p}`, url: `${CONSOLE}${p}` });
}
if (!jobs.length) { console.log('No admin or console page is reached by this change.'); process.exit(0); }

const items = [];
for (const dark of THEMES) for (const size of SIZES) for (const j of jobs) items.push({ ...j, size, dark });
const started = Date.now();
console.log(`${jobs.length} pages × ${SIZES.length} sizes × ${THEMES.length} themes = ${items.length} loads on ${WORKERS} workers${SCANS.length ? `, with ${SCANS.join(', ')}` : ''}`);

const browser = await chromium.launch();
let problems = 0, scanned = 0, next = 0;
async function worker() {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  // Both apps' sign-ins are in place before any page script runs; a token refresh answers with the same token.
  await ctx.addInitScript((keys) => { try { for (const [k, v] of keys) localStorage.setItem(k, v); } catch {} }, sessions.map(([k, v]) => [k, v]));
  if (rtl) await ctx.addInitScript(() => { try { localStorage.setItem('tangent.language', JSON.stringify({ lang: 'ar', chosen: true })); } catch {} });
  await ctx.route(/\/auth\/refresh$/, (r) => r.fulfill({ json: { accessToken: (r.request().url().includes('/console/') ? sessions.at(-1) : sessions[0])[2], expiresInSeconds: 900 } }));
  const page = await ctx.newPage();
  let errors = [];
  let current = '';
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('response', (r) => { if ((r.status() >= 400 && r.status() !== 404) || (r.status() === 404 && !/\/nope/.test(current))) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').replace(ADMIN, '').replace(CONSOLE, '')}`); });
  while (next < items.length) {
    const it = items[next++];
    const [w, h] = it.size;
    errors = [];
    current = it.url;
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: it.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.goto(it.url, { waitUntil: 'networkidle' }).catch((e) => errors.push(`goto ${e.message}`));
    // Settled: no request in flight for half a second (networkidle), then a frame for late layout.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => undefined);
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })).catch(() => ({ sw: 0, cw: 0 }));
    const found = await auditPage(page).catch(() => []);
    if (over.sw > over.cw + 1) found.unshift(`page scrolls sideways: ${over.sw} > ${over.cw}`);
    const noted = [];
    for (const s of SCANS) for (const f of await page.evaluate(scans[s]).catch(() => [])) noted.push(`${s}: ${f}`);
    if (shots) await page.screenshot({ path: `${shots}/${it.name.replace(/[/]/g, '_')}-${w}-${it.dark ? 'dark' : 'light'}.png` });
    const all = [...errors.map((e) => `error: ${e.slice(0, 160)}`), ...found];
    if (all.length) problems++;
    if (noted.length) scanned++;
    if (all.length || noted.length) console.log(`${all.length ? '✗' : '·'} ${it.name} @${w} ${it.dark ? 'dark' : 'light'}\n   ${[...all, ...noted].join('\n   ')}`);
  }
  await ctx.close();
}
await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) }, worker));
await browser.close();
const secs = Math.round((Date.now() - started) / 1000);
console.log(`\n${problems ? `${problems} page views with problems` : 'All pages clean'}${SCANS.length ? `; ${scanned} with scan notes` : ''} (${items.length} loads in ${secs}s)`);
process.exit(problems || (has('--strict') && scanned) ? 1 : 0);
