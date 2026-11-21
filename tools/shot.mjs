#!/usr/bin/env node
// Takes a screenshot of a page in headless Chromium, signed in to a school or the console.
// Usage: node tools/shot.mjs <url> <out.png> [width] [height] [--dark] [--school slug] [--console] [--full] [--audit] [--do '[{"click":"text=Modules"},{"fill":["sel","text"]},{"wait":300}]']
import { chromium } from '@playwright/test';
import { auditPage } from './lib/audit.mjs';
import { SCHOOL, adminKey, consoleKey } from './dataset/session.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const [url, out, w = '1440', h = '900'] = args.filter((a, i) => !a.startsWith('--') && !['--school', '--do', '--wait'].includes(args[i - 1]));
const slug = val('--school') ?? SCHOOL;

async function tokens() {
  const [key, value, token] = flag('--console') ? (await consoleKey(slug)).key : await adminKey(slug);
  return { key, value, token };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, colorScheme: flag('--dark') ? 'dark' : 'light', reducedMotion: flag('--motion') ? 'no-preference' : 'reduce' });
if (!flag('--anon')) {
  const t = await tokens();
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [t.key, t.value]);
  await ctx.route(/\/auth\/refresh$/, (r) => r.fulfill({ json: { accessToken: t.token, expiresInSeconds: 900 } }));
}
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(val('--wait') ?? 1200));
for (const a of JSON.parse(val('--do') ?? '[]')) {
  if (a.click) await page.locator(a.click).first().click();
  else if (a.fill) await page.locator(a.fill[0]).first().fill(a.fill[1]);
  else if (a.press) await page.keyboard.press(a.press);
  await page.waitForTimeout(a.wait ?? 400);
}
const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
let audit = [];
if (flag('--audit')) audit = await auditPage(page);
await page.screenshot({ path: out, fullPage: flag('--full') });
console.log(JSON.stringify({ out, overflowX: overflow.sw > overflow.cw + 1 ? overflow : false, errors, ...(audit.length ? { audit } : {}) }));
await browser.close();
