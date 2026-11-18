// International by default (docs/one-shot-plan.md §3.9.1): India is one country pack, not the shape of the code. Lists code
// that names India's currency, clock, locale, phone code, taxes, payment methods, boards or regulators outside the files that
// are about India on purpose. The rules test runs it; usage: node tools/guard-international.mjs (exits 1 when any are left).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIRS = ['apps/admin/src', 'apps/console/src', 'apps/api/src', 'apps/console-api/src', 'apps/server/src', 'packages', 'lib'];
const INDIA = /₹|\bINR\b|en-IN|en_IN|Asia\/Kolkata|\bIST\b|istToday|\+91\b|\bGST\b|\bUPI\b|\bCBSE\b|UDISE|\bDLT\b/;
// Files about India on purpose: its country pack and country data, the Indian payment and SMS providers (and the console's
// DLT tooling for them), readers of other Indian systems' exports, the Indian demo school, and old GST receipts.
const ALLOWED = [
  /^packages\/contracts\/src\/(packs|locale|phones|integrations)\.ts$/, /^packages\/integrations\/src\/providers\//, /^packages\/db\/src\/import\//,
  /^packages\/db\/src\/seed\//, /^apps\/console-api\/src\/ops\.ts$/, /^apps\/console\/src\/pages\/integrations\//, /\/i18n\//, /\.test\.tsx?$/, /\/test\//,
  /\/dist\//, /node_modules/, /\.g\.dart$/, /^packages\/db\/migrations\//,
];
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = path.join(d, f);
  return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(p)) : /\.(tsx?|dart|mjs)$/.test(f) ? [p] : [];
});
// A line (or the comment above it) may say why it names India: an old value kept readable, a feature only there.
const comment = (l) => /^\s*(\/\/|\/?\*|\/\/\/)/.test(l) || /india-pack:/.test(l);

export function indiaInCode() {
  const found = [];
  for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOWED.some((r) => r.test(rel))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => { if (INDIA.test(l) && !comment(l) && !/india-pack:/.test(lines[i - 1] ?? '')) found.push(`${rel}:${i + 1}  ${l.trim().slice(0, 120)}`); });
  }
  return found;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const left = indiaInCode();
  console.log(left.join('\n'));
  console.log(`${left.length} left`);
  process.exit(left.length ? 1 : 0);
}
