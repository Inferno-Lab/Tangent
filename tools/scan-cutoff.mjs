#!/usr/bin/env node
// Looks for what the eye catches and audit-ui does not: text cut by an ellipsis, boxes that hide their own content vertically,
// and scrollable areas whose scrollbar is hidden. Usage: node tools/scan-cutoff.mjs [--only admin|console] [--sizes 1280x720,1440x900]
import { chromium } from '@playwright/test';
import * as scans from './lib/scans.mjs';
import { consolePaths } from './lib/pages.mjs';
import { SCHOOL, adminKey, consoleKey } from './dataset/session.mjs';

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const only = val('--only');
const SIZES = (val('--sizes') ?? '1280x720,1440x900,768x1024,390x844').split(',').map((s) => s.split('x').map(Number));
const ADMIN = process.env.ADMIN ?? 'http://127.0.0.1:5173';
const CONSOLE = process.env.CONSOLE ?? 'http://127.0.0.1:5174';
const slug = SCHOOL;
const extra = (process.env.PATHS ?? '').split(',').filter(Boolean);


const jobs = [];
if (only !== 'console') {
  const key = await adminKey();
  for (const p of ['', '/students', '/timetable', '/settings', '/attendance', '/fees', '/notices', ...extra.filter((e) => e.startsWith('a:')).map((e) => e.slice(2))]) jobs.push({ name: `admin${p || '/'}`, url: `${ADMIN}/s/${slug}${p}`, key });
}
if (only !== 'admin') {
  const c = await consoleKey();
  for (const p of consolePaths(c.school)) jobs.push({ name: `console${p}`, url: `${CONSOLE}${p}`, key: c.key });
}

const scan = scans.cutoff;

const browser = await chromium.launch();
let n = 0;
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const j of jobs) {
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, j.key); if (j.key?.[2]) await ctx.route(/\/auth\/refresh$/, (r) => r.fulfill({ json: { accessToken: j.key[2], expiresInSeconds: 900 } }));
    await page.goto(j.url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(400);
    const found = await page.evaluate(scan);
    if (found.length) { n += found.length; console.log(`${j.name} @${w}x${h}\n   ${found.join('\n   ')}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${n} findings`);
