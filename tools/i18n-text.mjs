// Shared text in any language (docs/one-shot-plan.md §3.5): the English of setting labels, module names, import columns,
// server errors and form checks is its own key (contracts tx(), gettext-style). This tool
//   --fix   rewrites server errors made with values (`new ApiError('x', `Add ${name}…`)`) into tx('Add {name}…', { name })
//           so the message can be looked up whatever the value;
//   (always) lists every such English text in packages/contracts/i18n/en.json, the catalogue every language translates.
// Build contracts and config-engine first (it reads their dist). Usage: node tools/i18n-text.mjs [--fix]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as C from '../packages/contracts/dist/index.js';
import * as E from '../packages/config-engine/dist/index.js';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const fix = process.argv.includes('--fix');
const texts = new Set();
const add = (s) => { if (typeof s === 'string' && /[A-Za-z]{2,}/.test(s)) texts.add(s); };

// 1. The shared tables, as wrapped by localized(): every label-like field and option label.
const FIELDS = new Set(['label', 'name', 'help', 'blurb', 'description', 'hint', 'note', 'title', 'what', 'why', 'sub', 'stepLabel']);
const seen = new Set();
function walk(v, key) {
  v = v && typeof v === 'object' ? C.rawOf(v) : v;
  if (typeof v === 'string') { if (FIELDS.has(key)) add(v); return; }
  if (!v || typeof v !== 'object' || seen.has(v)) return;
  seen.add(v);
  if (key === 'options' && Array.isArray(v)) { for (const o of v) if (Array.isArray(o)) add(o[1]); return; }
  for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k);
}
for (const t of [C.SETTINGS_META, C.IMPORT_KINDS, C.SETUP_KINDS, C.INTEGRATION_PROVIDERS, C.MESSAGE_EVENTS, C.CURRICULA, C.PERMISSION_CATALOG, C.CONSOLE_ROLE_INFO,
  E.MODULES, E.ADMIN_PAGES, E.APP_CATALOG]) walk(t, '');
for (const r of [C.MARK_MEANING_LABELS, C.CATEGORY_TONE_LABELS, C.PAYMENT_KIND_LABELS, C.STEP_LABELS, C.ACTION_LABELS, C.CAPABILITY_LABELS, E.APP_ROLE_LABELS]) Object.values(C.rawOf(r)).forEach(add);
for (const g of [...C.SETTING_GROUPS, ...E.ADMIN_GROUPS]) add(g);

// 2. Server code and contracts: error messages, field problems, form checks (zod messages) and tx() calls.
const DIRS = ['apps/api/src', 'apps/console-api/src', 'packages/contracts/src', 'packages/config-engine/src', 'packages/db/src', 'packages/nest-kit/src',
  'packages/integrations/src', 'packages/tenancy/src', 'packages/security/src'];
const files = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(f) && !/\.(test|d)\.ts$/.test(f) ? [p] : []; });
const ERRORS = new Set(['ApiError', 'ImportError', 'notFound', 'forbidden', 'conflict', 'badRequest', 'BadRequestException', 'NotFoundException', 'ForbiddenException', 'ConflictException']);
const ZOD = new Set(['min', 'max', 'length', 'regex', 'email', 'url', 'refine', 'nonempty', 'int', 'positive', 'nonnegative', 'gte', 'lte', 'startsWith', 'endsWith', 'uuid']);
const calleeName = (e) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '');
let rewritten = 0;
for (const f of DIRS.flatMap((d) => files(path.join(ROOT, d)))) {
  const code = readFileSync(f, 'utf8');
  const src = ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true);
  const edits = [];
  const message = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      const params = [];
      for (const span of node.templateSpans) {
        const e = span.expression;
        let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : `p${params.length}`;
        while (params.some(([n]) => n === name)) name = `${name}${params.length}`;
        params.push([name, e.getText(src)]);
        text += `{${name}}${span.literal.text}`;
      }
      add(text);
      edits.push([node.getStart(src), node.getEnd(), `tx('${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}', { ${params.map(([n, e]) => (n === e ? n : `${n}: ${e}`)).join(', ')} })`]);
    }
  };
  const visit = (n) => {
    if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && n.arguments) {
      const name = calleeName(n.expression);
      if (ERRORS.has(name)) {
        const msg = name === 'ApiError' ? n.arguments[1] : n.arguments[0];
        if (msg) message(msg);
        // Field problems: `{ fields: { phone: 'Use a 10-digit…' } }`.
        for (const a of n.arguments) if (ts.isObjectLiteralExpression(a)) for (const p of a.properties) if (ts.isPropertyAssignment(p) && p.name.getText(src) === 'fields' && ts.isObjectLiteralExpression(p.initializer))
          for (const q of p.initializer.properties) if (ts.isPropertyAssignment(q)) message(q.initializer);
      } else if (name === 'tx' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) add(n.arguments[0].text);
      else if (ZOD.has(name)) for (const a of n.arguments) {
        if (ts.isStringLiteral(a) && /\s/.test(a.text)) add(a.text);
        if (ts.isObjectLiteralExpression(a)) for (const p of a.properties) if (ts.isPropertyAssignment(p) && /^(message|error)$/.test(p.name.getText(src)) && ts.isStringLiteral(p.initializer)) add(p.initializer.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  if (fix && edits.length) {
    let out = code;
    for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
    // tx comes from contracts (inside contracts, from its own i18n file).
    if (!/\btx\b[^;]*from '(@tangent\/contracts|\.\/i18n\.js)'/.test(out)) {
      const inContracts = f.includes(`${path.sep}contracts${path.sep}`);
      const from = inContracts ? './i18n.js' : '@tangent/contracts';
      const m = new RegExp(`^import \\{([^}]*)\\} from '${from.replace(/[./@]/g, (c) => `\\${c}`)}';`, 'm').exec(out);
      if (m && !/^import type/.test(m[0])) out = out.replace(m[0], `import {${m[1].replace(/,?\s*$/, '')}, tx } from '${from}';`);
      else { const imps = [...out.matchAll(/^import [^;]+;\r?\n/gm)]; const at = imps.length ? imps.at(-1).index + imps.at(-1)[0].length : 0; out = `${out.slice(0, at)}import { tx } from '${from}';\n${out.slice(at)}`; }
    }
    writeFileSync(f, out);
    rewritten += edits.length;
  }
}

const file = path.join(ROOT, 'packages/contracts/i18n/en.json');
const json = `${JSON.stringify(Object.fromEntries([...texts].sort().map((s) => [s, s])), null, 1)}\n`;
// --check (CI): fail when the catalogue is out of date, instead of writing it.
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== json) { console.error('packages/contracts/i18n/en.json is out of date: run node tools/i18n-text.mjs'); process.exit(1); }
  console.log('The shared-text catalogue is up to date.');
  process.exit(0);
}
writeFileSync(file, json);
console.log(`${texts.size} shared texts in packages/contracts/i18n/en.json${fix ? `; ${rewritten} server messages put in tx()` : ''}`);
