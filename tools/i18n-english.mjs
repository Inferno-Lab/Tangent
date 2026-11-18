// Lists English that code writes straight onto the page, outside the catalogue: words picked by a condition
// (`n === 1 ? 'photo' : 'photos'`), words joined into a list (`.join(' and ')`), and English in template text.
// The rules test runs it; usage: node tools/i18n-english.mjs  (prints file:line and the code, exits 1 when any are left).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIRS = ['apps/admin/src', 'apps/console/src', 'packages/web-ui/src'];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === 'i18n' ? [] : walk(p)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
// Attributes and keys whose strings are code, not words.
const CODE = /^(className|cls|style|key|type|tone|icon|name|kind|mode|status|variant|size|role|align|dir|lang|id|htmlFor|href|to|path|decision|state|c|bg|fg|i|cell|k|v|value|scene|accept|inputMode|autoComplete|method|sort|field|data-[a-z-]+|aria-(live|current|sort|pressed|hidden))$/;
// English is a phrase (a space between words), a count's word (`n === 1 ? 'photo' : 'photos'`) or a small joining word;
// class names, CSS and product names are not.
const CSS = /var\(|minmax|shake|\dpx|^(top|bottom) (left|right)$|^(iPhone|TestFlight)$|^#|@|^\d/;
const words = (s, plural) => !CSS.test(s.trim()) && (!/^[a-z-]+(\s[a-z-]+)*\s*$/.test(s.trim()) && /[A-Za-z]{2,}/.test(s)
  || /^(it|them|is|are|and|or|both|s|es)$/.test(s.trim()) || plural && /^[a-z]{3,}$/.test(s.trim()) || /[A-Za-z]{2,} [A-Za-z]{2,}/.test(s));
const PHRASE = /[A-Za-z]{2,} [A-Za-z]{2,}/;

export function englishInCode() {
  const found = [];
  for (const file of DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const code = readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n) => `${path.relative(ROOT, file).replace(/\\/g, '/')}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`;
    const inCode = (n) => {
      for (let p = n.parent; p; p = p.parent) {
        if (ts.isJsxAttribute(p)) return CODE.test(p.name.getText(src));
        if (ts.isPropertyAssignment(p)) return CODE.test(p.name.getText(src).replace(/['"]/g, ''));
        if (ts.isCallExpression(p) || ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(src))) return true;
        if (ts.isJsxExpression(p) && ts.isJsxElement(p.parent) || ts.isJsxExpression(p) && ts.isJsxFragment(p.parent)) return false;
        if (ts.isBlock(p) || ts.isSourceFile(p)) return !PHRASE.test(n.getText(src)) && !/===\s*1 \?/.test(n.getText(src));
      }
      return true;
    };
    const visit = (n) => {
      if (ts.isConditionalExpression(n)) {
        for (const b of [n.whenTrue, n.whenFalse]) {
          const plural = /===\s*1$/.test(n.condition.getText(src));
          if ((ts.isStringLiteral(b) || ts.isNoSubstitutionTemplateLiteral(b)) && words(b.text, plural) && !inCode(n)) found.push(`${at(n)}  ${n.getText(src).slice(0, 110)}`);
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'join' && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && /[A-Za-z]/.test(n.arguments[0].text)) found.push(`${at(n)}  ${n.getText(src).slice(0, 110)}`);
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return [...new Set(found)];
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const left = englishInCode();
  console.log(left.join('\n'));
  console.log(`${left.length} left`);
  process.exit(left.length ? 1 : 0);
}
