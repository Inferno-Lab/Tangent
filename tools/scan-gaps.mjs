#!/usr/bin/env node
// Looks for empty space: a hole under the last card, cards side by side with unequal heights, a card with a big blank inside,
// and content that stops short of the right edge. Usage: node tools/scan-gaps.mjs [--only admin|console] [--sizes 1440x900,1920x1080] [--dark]
import { chromium } from '@playwright/test';
import * as scans from './lib/scans.mjs';
import { adminPaths, consolePaths } from './lib/pages.mjs';
import { SCHOOL, adminKey, consoleKey } from './dataset/session.mjs';

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const only = val('--only');
const SIZES = (val('--sizes') ?? '1440x900,1920x1080,1280x720').split(',').map((s) => s.split('x').map(Number));
const ADMIN = process.env.ADMIN ?? 'http://127.0.0.1:5173';
const CONSOLE = process.env.CONSOLE ?? 'http://127.0.0.1:5174';
const slug = SCHOOL;


const jobs = [];
if (only !== 'console') {
  const key = await adminKey();
  for (const p of adminPaths) jobs.push({ name: `admin${p || '/'}`, url: `${ADMIN}/s/${slug}${p}`, key });
}
if (only !== 'admin') {
  const c = await consoleKey();
  for (const p of consolePaths(c.school)) jobs.push({ name: `console${p}`, url: `${CONSOLE}${p}`, key: c.key });
}

const scan = scans.gaps;

const browser = await chromium.launch();
let n = 0;
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', colorScheme: args.includes('--dark') ? 'dark' : 'light' });
  const page = await ctx.newPage();
  for (const j of jobs) {
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, j.key); if (j.key?.[2]) await ctx.route(/\/auth\/refresh$/, (r) => r.fulfill({ json: { accessToken: j.key[2], expiresInSeconds: 900 } }));
    await page.goto(j.url.split('?')[0], { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(500);
    const found = await page.evaluate(scan);
    if (found.length) { n += found.length; console.log(`${j.name} @${w}x${h}\n   ${found.join('\n   ')}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${n} gaps`);
process.exit(n ? 1 : 0);
