#!/usr/bin/env node
// Looks for spacing that is too tight: a line of text (a heading, a label, a help line) flush against the card, field or table
// above or below it. Usage: node tools/scan-tight.mjs [--only admin|console] [--sizes 1440x900,390x844]
import { chromium } from '@playwright/test';
import { adminPaths, consolePaths } from './lib/pages.mjs';

const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const only = val('--only');
const SIZES = (val('--sizes') ?? '1440x900,390x844').split(',').map((s) => s.split('x').map(Number));
const API = process.env.API ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN ?? 'http://127.0.0.1:5173';
const CONSOLE = process.env.CONSOLE ?? 'http://127.0.0.1:5174';
const slug = process.env.SCHOOL ?? 'greenfield';

const post = async (path, body, headers = {}) => (await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })).json();
async function adminKey() {
  const h = { 'x-school': slug };
  const a = await post('/v1/auth/login', { identifier: 'neha.menon@greenfield.edu.in', password: 'nest2026' }, h);
  const t = await post('/v1/auth/verify', { challengeId: a.challenge.challengeId, code: '424242' }, h);
  return [`tangent.admin.${slug}`, JSON.stringify({ user: t.user }), t.accessToken];
}
async function consoleKey() {
  const a = await post('/console/v1/auth/login', { identifier: 'kaushal@tangent.app', password: 'nest2026' });
  const t = await post('/console/v1/auth/verify', { challengeId: a.challenge.challengeId, code: '424242' });
  const list = await (await fetch(`${API}/console/v1/schools`, { headers: { authorization: `Bearer ${t.accessToken}` } })).json();
  return { key: ['tangent.console', JSON.stringify({ user: t.user }), t.accessToken], school: list.find((s) => s.slug === slug)?.id };
}

const jobs = [];
if (only !== 'console') {
  const key = await adminKey();
  for (const p of adminPaths) jobs.push({ name: `admin${p || '/'}`, url: `${ADMIN}/s/${slug}${p}`, key });
}
if (only !== 'admin') {
  const c = await consoleKey();
  for (const p of consolePaths(c.school)) jobs.push({ name: `console${p}`, url: `${CONSOLE}${p}`, key: c.key });
}

const scan = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height > 0 && r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'absolute' && cs.position !== 'fixed'; };
  const boxed = (el) => {
    if (el.matches('table,.tbl,.fld,.inp,input,textarea,.sel,.ch')) return true;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    return (!!bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopLeftRadius) >= 8);
  };
  const texty = (el) => !boxed(el) && !el.querySelector('input,textarea,table,button,.fld,.inp') && (el.textContent ?? '').trim().length > 2 && /^(H[1-6]|P|SMALL|LABEL|SPAN|B|DIV)$/.test(el.tagName);
  const main = document.querySelector('.mn') ?? document.body;
  for (const p of [main, ...main.querySelectorAll('*')]) {
    const cs = getComputedStyle(p);
    const column = cs.display === 'block' || (cs.display.includes('flex') && cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
    if (!column || p.closest('.popm,.sxp,.toast,.rw,button,a,.chip,label')) continue;
    const kids = [...p.children].filter(shown);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1], b = kids[i];
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      // one below the other, overlapping sideways
      if (rb.top < ra.bottom - 2 || rb.left >= ra.right || rb.right <= ra.left) continue;
      const gap = Math.round(rb.top - ra.bottom);
      if (gap >= 6) continue;
      if ((texty(a) && boxed(b)) || (boxed(a) && texty(b))) out.push(`${gap}px between ${nm(a)} “${(a.textContent ?? '').trim().slice(0, 30)}” and ${nm(b)}`);
    }
  }
  return [...new Set(out)];
};

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
console.log(`\n${n} tight spots`);
process.exit(n ? 1 : 0);
