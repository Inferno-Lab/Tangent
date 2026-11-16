// Turns English chosen in code into plural messages (docs/one-shot-plan.md §3.5): a call such as
//   t('admin.fees_page.sent', { sent: r.sent, p1: r.sent === 1 ? 'family' : 'families' })   with "Sent to {sent} {p1}."
// becomes t('admin.fees_page.sent', { sent: r.sent })                                       with "Sent to {sent} {sent, plural, one {family} other {families}}."
// so every language picks its own form. Other English chosen in code is listed to fix by hand. Usage: node tools/i18n-plurals.mjs [--dry]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dry = process.argv.includes('--dry');
const AREAS = [['apps/admin/src', 'apps/admin/src/i18n/en.json'], ['apps/console/src', 'apps/console/src/i18n/en.json'], ['packages/web-ui/src', 'packages/web-ui/src/i18n/en.json']];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === 'i18n' ? [] : walk(p)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
const lit = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);
let fixed = 0;
const left = [];

for (const [dir, catFile] of AREAS) {
  const cat = JSON.parse(readFileSync(path.join(ROOT, catFile), 'utf8'));
  for (const file of walk(path.join(ROOT, dir))) {
    const code = readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edits = [];
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(t|tr)$/.test(n.expression.text) && n.arguments.length === 2 && ts.isStringLiteral(n.arguments[0]) && ts.isObjectLiteralExpression(n.arguments[1])) {
        const key = n.arguments[0].text;
        const obj = n.arguments[1];
        const props = obj.properties.filter(ts.isPropertyAssignment).map((p) => ({ p, name: p.name.getText(src), value: p.initializer }));
        const shorthands = obj.properties.filter(ts.isShorthandPropertyAssignment).map((p) => ({ name: p.name.text, text: p.name.text }));
        for (const { p, name, value } of props) {
          if (!ts.isConditionalExpression(value)) continue;
          const one = lit(value.whenTrue);
          const other = lit(value.whenFalse);
          if (one === null || other === null || !/[A-Za-z]/.test(one + other)) continue;
          const c = value.condition;
          const plural = ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && c.right.getText(src) === '1';
          if (!plural || cat[key] === undefined || !cat[key].includes(`{${name}}`)) { left.push(`${path.relative(ROOT, file)}:${src.getLineAndCharacterOfPosition(p.getStart(src)).line + 1}  ${key}  ${name}: ${value.getText(src).slice(0, 90)}`); continue; }
          const countText = c.left.getText(src);
          const same = props.find((x) => x.value.getText(src) === countText) ?? shorthands.find((x) => x.text === countText);
          const countName = same?.name ?? 'n';
          cat[key] = cat[key].replace(`{${name}}`, `{${countName}, plural, one {${one}} other {${other}}}`);
          // Drop the English param; add the count when no other param carries it.
          const start = p.getFullStart();
          let end = p.getEnd();
          const after = code.slice(end).match(/^\s*,/);
          if (after) end += after[0].length;
          edits.push([start, end, same ? '' : ` n: ${countText},`]);
          fixed++;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
    if (!edits.length) continue;
    let out = code;
    for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
    out = out.replace(/\{\s*,/g, '{').replace(/,\s*\}/g, ' }').replace(/\{\s{2,}/g, '{ ');
    if (!dry) writeFileSync(file, out);
  }
  if (!dry) writeFileSync(path.join(ROOT, catFile), `${JSON.stringify(Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
}
console.log(`${fixed} plurals moved into their messages`);
if (left.length) console.log(`English chosen in code, to fix by hand:\n  ${left.join('\n  ')}`);
