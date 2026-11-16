// Right-to-left (docs/one-shot-plan.md §3.5.7): every left and right in the web's styles becomes start and end, so a page
// reads the same way in Arabic as in English, mirrored. CSS files are rewritten by rule; TSX only inside objects that are
// clearly styles (a style={{…}} attribute, or an object typed or cast as CSSProperties). Centring (left: 50% with a
// translateX(-50%)) stays as it is: it is the same in both directions. Prints what it could not decide.
// Usage: node tools/rtl-logical.mjs [--dry]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dry = process.argv.includes('--dry');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(p)) : [p]; });
const left = [];

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS_RULES = [
  [/\bmargin-left\s*:/g, 'margin-inline-start:'], [/\bmargin-right\s*:/g, 'margin-inline-end:'],
  [/\bpadding-left\s*:/g, 'padding-inline-start:'], [/\bpadding-right\s*:/g, 'padding-inline-end:'],
  [/\bborder-left(-(?:width|style|color))?\s*:/g, 'border-inline-start$1:'], [/\bborder-right(-(?:width|style|color))?\s*:/g, 'border-inline-end$1:'],
  [/\bborder-top-left-radius\s*:/g, 'border-start-start-radius:'], [/\bborder-top-right-radius\s*:/g, 'border-start-end-radius:'],
  [/\bborder-bottom-left-radius\s*:/g, 'border-end-start-radius:'], [/\bborder-bottom-right-radius\s*:/g, 'border-end-end-radius:'],
  [/\btext-align\s*:\s*left\b/g, 'text-align:start'], [/\btext-align\s*:\s*right\b/g, 'text-align:end'],
  [/\bfloat\s*:\s*left\b/g, 'float:inline-start'], [/\bfloat\s*:\s*right\b/g, 'float:inline-end'],
];
function css(text, file) {
  // Declarations one by one, inside each rule body, so centring can be told apart.
  return text.replace(/\{([^{}]*)\}/g, (whole, body) => {
    let b = body;
    for (const [re, to] of CSS_RULES) b = b.replace(re, to);
    const centred = /translate(X)?\(\s*-50%/.test(b);
    b = b.replace(/(^|[;\s])left\s*:\s*([^;]+)/g, (m, pre, v) => (centred && /^50%/.test(v.trim()) ? m : `${pre}inset-inline-start:${v}`));
    b = b.replace(/(^|[;\s])right\s*:\s*([^;]+)/g, (m, pre, v) => (centred && /^50%/.test(v.trim()) ? m : `${pre}inset-inline-end:${v}`));
    // Four different sides in one shorthand: block (top, bottom) and inline (start = left, end = right) apart.
    b = b.replace(/(^|[;\s])(margin|padding|inset)\s*:\s*([^;!]+?)(\s*!important)?(?=;|$)/g, (m, pre, prop, v, imp = '') => {
      const parts = v.trim().split(/\s+/);
      if (parts.length !== 4 || parts[1] === parts[3] || /\(/.test(v)) return m;
      return `${pre}${prop}-block:${parts[0]} ${parts[2]}${imp};${prop}-inline:${parts[3]} ${parts[1]}${imp}`;
    });
    // Sideways motion runs the other way when the page reads right to left (--dir is -1 there, blocks.css).
    b = b.replace(/translateX\(\s*(?!-50%\s*\))(?!calc\([^)]*var\(--dir\))([^()]+)\)/g, (m, v) => (v.trim() === '0' ? m : `translateX(calc(${v.trim()} * var(--dir,1)))`));
    return `{${b}}`;
  });
}

// ── TSX style objects ──────────────────────────────────────────────────────
const PROPS = { marginLeft: 'marginInlineStart', marginRight: 'marginInlineEnd', paddingLeft: 'paddingInlineStart', paddingRight: 'paddingInlineEnd',
  borderLeft: 'borderInlineStart', borderRight: 'borderInlineEnd', borderLeftColor: 'borderInlineStartColor', borderRightColor: 'borderInlineEndColor',
  borderLeftWidth: 'borderInlineStartWidth', borderRightWidth: 'borderInlineEndWidth', left: 'insetInlineStart', right: 'insetInlineEnd',
  borderTopLeftRadius: 'borderStartStartRadius', borderTopRightRadius: 'borderStartEndRadius', borderBottomLeftRadius: 'borderEndStartRadius', borderBottomRightRadius: 'borderEndEndRadius' };
const isStyle = (o) => {
  const p = o.parent;
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && p.parent.name.getText() === 'style') return true;
  if ((ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) && /CSSProperties/.test(p.type.getText())) return true;
  if (ts.isVariableDeclaration(p) && p.type && /CSSProperties/.test(p.type.getText())) return true;
  if (ts.isPropertyAssignment(p) && p.name.getText() === 'style') return true;
  return false;
};
function tsx(text, file) {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n) && isStyle(n)) {
      const centred = n.properties.some((p) => ts.isPropertyAssignment(p) && p.name.getText() === 'transform' && /translate(X)?\(\s*-50%/.test(p.initializer.getText(src)));
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const name = p.name.getText(src).replace(/['"]/g, '');
        const v = p.initializer.getText(src);
        // A position measured at run time (getBoundingClientRect, offsetLeft) is physical: only fixed values turn round.
        const measured = (name === 'left' || name === 'right') && !ts.isNumericLiteral(p.initializer) && !ts.isStringLiteral(p.initializer) && !ts.isPrefixUnaryExpression(p.initializer);
        if (PROPS[name] && !measured && !(centred && /^['"`]?50%/.test(v))) edits.push([p.name.getStart(src), p.name.getEnd(), PROPS[name]]);
        if (name === 'textAlign' && /^['"](left|right)['"]$/.test(v)) edits.push([p.initializer.getStart(src), p.initializer.getEnd(), v.includes('left') ? "'start'" : "'end'"]);
        if (name === 'float' && /^['"](left|right)['"]$/.test(v)) edits.push([p.initializer.getStart(src), p.initializer.getEnd(), v.includes('left') ? "'inline-start'" : "'inline-end'"]);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  let out = text;
  for (const [s, e, r] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + r + out.slice(e);
  return out;
}

let changed = 0;
// The empty-state scenes come from the approved boards' HTML (design/hue/build.mjs writes them into web-ui): their style="".
for (const f of walk(path.join(ROOT, 'design/hue/src')).filter((f) => /Empty\w*\.html$/.test(f))) {
  const a = readFileSync(f, 'utf8');
  const b = a.replace(/style="([^"]*)"/g, (m, v) => `style="${css(`{${v}}`, f).slice(1, -1)}"`);
  if (a !== b) { changed++; if (!dry) writeFileSync(f, b); }
}
const cssFiles = [...walk(path.join(ROOT, 'packages/web-ui/src')), ...walk(path.join(ROOT, 'apps/admin/src')), ...walk(path.join(ROOT, 'apps/console/src')),
  ...['design/hue/base.css', 'design/hue/base2.css', 'design/hue/empty.css'].map((f) => path.join(ROOT, f))]
  .filter((f) => f.endsWith('.css') && !/hue(-parts)?\.css$/.test(f) || /design[\\/]hue/.test(f));
for (const f of cssFiles) {
  const a = readFileSync(f, 'utf8');
  const b = css(a, f);
  if (a !== b) { changed++; if (!dry) writeFileSync(f, b); }
}
for (const f of [...walk(path.join(ROOT, 'packages/web-ui/src')), ...walk(path.join(ROOT, 'apps/admin/src')), ...walk(path.join(ROOT, 'apps/console/src'))].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
  const a = readFileSync(f, 'utf8');
  const b = tsx(a, f);
  if (a !== b) { changed++; if (!dry) writeFileSync(f, b); }
}
console.log(`${changed} files ${dry ? 'would change' : 'changed'}`);
if (left.length) console.log(`Decide by hand:\n  ${left.join('\n  ')}`);
