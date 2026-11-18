// Moves the visible English in admin, console and web-ui into language catalogues (docs/one-shot-plan.md §3.5.2): every
// text a person reads becomes t('area.key') with its English in <src>/i18n/en.json. Run once per area; running it again
// only picks up text added since. It reads with TypeScript's own parser and rewrites only what it is sure is shown:
//   JSX text, visible attributes (label, title, placeholder, data-tip…), the text of toasts and errors, visible object
//   fields (label, note, help…), and ternary branches inside JSX. Comparisons, keys, class names and paths are left alone.
// Usage: node tools/i18n-extract.mjs [--dry] [admin|console|ui]...
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const AREAS = {
  admin: { src: 'apps/admin/src', from: '@tangent/web-ui' },
  console: { src: 'apps/console/src', from: '@tangent/web-ui' },
  ui: { src: 'packages/web-ui/src', from: null },
};
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const picked = args.filter((a) => !a.startsWith('--'));

// Places a string is never shown text: attributes, object fields and calls that carry classes, styles, keys, paths and data.
const HIDDEN_ATTRS = new Set(['className', 'style', 'key', 'id', 'href', 'to', 'type', 'scene', 'kind', 'tone', 'icon', 'role', 'variant', 'size',
  'method', 'path', 'target', 'rel', 'src', 'autoComplete', 'inputMode', 'pattern', 'htmlFor', 'form', 'accept', 'transform', 'd', 'fill', 'stroke',
  'viewBox', 'mode', 'tab', 'status', 'align', 'as', 'lang', 'dir', 'tabIndex', 'colour', 'color', 'width', 'height', 'xmlns', 'preserveAspectRatio',
  'strokeLinecap', 'strokeLinejoin', 'textAnchor', 'dominantBaseline', 'fontFamily', 'clipPath', 'mask', 'filter', 'gradientTransform', 'download',
  'accessKey', 'enterKeyHint', 'spellCheck', 'wrap', 'shape', 'name', 'value', 'defaultValue', 'queryKey', 'cell', 'col', 'field', 'sort']);
// `name` and `value` are shown on a few components only.
const NAME_VALUE_OK = new Set(['Tile', 'Stat', 'KV', 'Kv', 'Row', 'Line', 'Fact', 'Metric', 'Meter', 'Chip', 'Pill', 'Badge']);
const CSS_PROP = /^(--|font|padding|margin|flex|border|grid|transform|background|color|colour|width|height|minWidth|maxWidth|minHeight|maxHeight|gap|rowGap|columnGap|transition|animation|boxShadow|inset|top|left|right|bottom|display|position|align|justify|overflow|opacity|letterSpacing|lineHeight|textAlign|textTransform|textDecoration|textOverflow|whiteSpace|wordBreak|zIndex|cursor|fill|stroke|outline|resize|placeItems|placeContent|aspectRatio|objectFit|filter|backdropFilter|clipPath|content|direction|verticalAlign|order|pointerEvents|userSelect|scrollbar|overscroll|contain|isolation|mixBlendMode|accentColor|caretColor|tableLayout|listStyle|counter|willChange|appearance|boxSizing|float|clear|visibility|translate|scale|rotate)/;
const HIDDEN_KEYS = new Set(['key', 'id', 'kind', 'type', 'scene', 'tone', 'icon', 'status', 'mode', 'tab', 'slug', 'path', 'href', 'to', 'field', 'column',
  'queryKey', 'module', 'feature', 'permission', 'perm', 'route', 'url', 'method', 'event', 'channel', 'variant', 'size', 'cls', 'className', 'class', 'd',
  'r', 'b', 'f', 'svg', 'shape', 'code', 'ext', 'mime', 'accept', 'pattern', 'format', 'locale', 'zone', 'currency', 'lang', 'dir', 'role', 'cell',
  'col', 'sort', 'order', 'testId']);
const HIDDEN_CALLS = new Set(['startsWith', 'endsWith', 'includes', 'split', 'join', 'replace', 'replaceAll', 'match', 'matchAll', 'test', 'exec',
  'querySelector', 'querySelectorAll', 'getItem', 'setItem', 'removeItem', 'has', 'invalidateQueries', 'navigate', 'nav', 'go', 'page', 'lazy', 'require',
  'fetch', 'encodeURIComponent', 'decodeURIComponent', 'padStart', 'padEnd', 'indexOf', 'lastIndexOf', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'Symbol', 'createContext', 'getPropertyValue', 'setProperty', 'matchMedia', 'createElement', 'getElementById', 'closest', 'localeCompare',
  'RegExp', 'Date', 'URL', 'URLSearchParams', 'append', 'postMessage', 'console', 'log', 'debug', 'info', 'error', 'assert', 'cls', 'cx', 'classNames',
  'useMedia', 'useQuery', 'setTab', 'setMode', 'setKind', 'setScene', 'setSort', 'setFilter', 'open', 'download', 'track', 'mark', 'Icon', 'icon', 'can',
  'hasKey', 'request', 'get', 'post', 'put', 'patch', 'del', 'delete', 'call', 'api', 'route', 'path', 'href', 'link', 'byId', 'parseFloat', 'parseInt',
  'Number', 'BigInt', 'atob', 'btoa', 'toFixed', 'toPrecision', 'localStorage', 'sessionStorage', 'emit', 'on', 'off', 'scrollTo', 'focus']);
/** Is this text worth a translator's time: letters, and either a space or a capital first letter. */
function prose(s) {
  const x = s.trim();
  if (!/[A-Za-z]{2,}/.test(x)) return false;
  if (/^(https?:|\/|\.|#|--|<|var\(|rgb|data:)/.test(x) || /^[a-z]+[./_-][a-z]\S*$/.test(x)) return false; // paths, urls, css, keys like fees.collect
  if (/^[a-z0-9]+([A-Z][a-z0-9]*)+$/.test(x) || /^[A-Z][a-z0-9]+([A-Z][a-z0-9]+)+$/.test(x)) return false; // camelCase and PascalCase names
  if (/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(x) && /\d/.test(x)) return false; // SVG paths
  if (/^[\w.-]+@[\w.-]+$/.test(x)) return false;
  return /\s/.test(x) || /^[A-Z][a-z]/.test(x) || /[.!?…:]$/.test(x);
}

function slug(text) {
  const w = text.toLowerCase().replace(/\{[^}]*\}/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return w.join('_') || 'text';
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'i18n' && f !== 'node_modules' && f !== 'illustrations') walk(p, out); }
    else if (/\.(tsx|ts)$/.test(f) && !/\.(test|spec|d)\.tsx?$/.test(f) && !['icons.ts', 'main.tsx', 'reportErrors.ts'].includes(f)) out.push(p);
  }
  return out;
}

const jsxName = (n) => { const t = n.tagName; return t && ts.isIdentifier(t) ? t.text : t && ts.isPropertyAccessExpression(t) ? t.name.text : ''; };

/** Why a string literal is not shown text, or '' when it may be. */
function hidden(node) {
  const p = node.parent;
  if (!p) return 'top';
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return 'module';
  if (ts.isPropertyAssignment(p) && p.name === node) return 'key';
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return 'index';
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return 'compare';
  if (ts.isCaseClause(p)) return 'case';
  if (ts.isTypeNode(p) || ts.isTypeReferenceNode(p)) return 'type';
  return '';
}

function contextOf(node) {
  // Climb through parentheses, ternaries, `??`, `||` and `&&` to the place the value goes.
  let n = node;
  while (n.parent && (ts.isParenthesizedExpression(n.parent) || (ts.isConditionalExpression(n.parent) && n.parent.condition !== n)
    || (ts.isBinaryExpression(n.parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.parent.operatorToken.kind) && n.parent.right === n)
    || ts.isAsExpression(n.parent))) n = n.parent;
  const p = n.parent;
  if (!p) return null;
  if (ts.isJsxAttribute(p)) return { kind: 'attr', name: p.name.getText(), tag: jsxName(p.parent.parent) };
  if (ts.isJsxExpression(p)) {
    if (ts.isJsxAttribute(p.parent)) return { kind: 'attr', name: p.parent.name.getText(), tag: jsxName(p.parent.parent.parent) };
    return { kind: 'child' };
  }
  if (ts.isPropertyAssignment(p) && p.initializer === n) return { kind: 'prop', name: p.name.getText().replace(/['"]/g, '') };
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) {
    const e = p.expression;
    const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : '';
    return { kind: 'call', name };
  }
  if (ts.isThrowStatement(p)) return { kind: 'call', name: 'Error' };
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return { kind: 'return' };
  if (ts.isArrayLiteralExpression(p)) {
    const q = contextOf(p);
    return q && (q.kind === 'prop' || q.kind === 'attr') ? { ...q, inArray: true } : { kind: 'array' };
  }
  // Inside a template's ${…}: it goes wherever the template goes (a class name, a message).
  if (ts.isTemplateSpan(p)) return contextOf(p.parent);
  return { kind: 'other' };
}

function visible(ctx) {
  if (!ctx) return false;
  if (ctx.kind === 'attr') return !(HIDDEN_ATTRS.has(ctx.name) && !((ctx.name === 'name' || ctx.name === 'value') && NAME_VALUE_OK.has(ctx.tag))) && !/^data-(?!tip)/.test(ctx.name) && !/^on[A-Z]/.test(ctx.name);
  if (ctx.kind === 'prop') return !HIDDEN_KEYS.has(ctx.name) && (!CSS_PROP.test(ctx.name) || /(Label|Text|Title|Hint|Note)$/.test(ctx.name));
  if (ctx.kind === 'call') return !HIDDEN_CALLS.has(ctx.name);
  return true;
}

/** A template literal as a message: `${n} copies` → "{n} copies" with params { n }. */
function templateMessage(node, src) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, params: [] };
  let text = node.head.text;
  const params = [];
  const used = new Set();
  for (const span of node.templateSpans) {
    const e = span.expression;
    let name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isCallExpression(e) && ts.isIdentifier(e.expression) ? e.expression.text : `p${params.length}`;
    if (!/^[A-Za-z_]\w*$/.test(name)) name = `p${params.length}`;
    while (used.has(name)) name = `${name}${params.length}`;
    used.add(name);
    params.push([name, e.getText(src)]);
    text += `{${name}}${span.literal.text}`;
  }
  return { text, params };
}

let fn = 't';
const call = (key, params) => (params.length
  ? `${fn}('${key}', { ${params.map(([n, e]) => (n === e ? n : `${n}: ${e}`)).join(', ')} })`
  : `${fn}('${key}')`);

/** Does the file already name something `t` (a parameter, a variable)? Then the translator is imported as `tr` there. */
function usesT(src) {
  let found = false;
  const look = (n) => {
    if (found) return;
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === 't') found = true;
    else ts.forEachChild(n, look);
  };
  look(src);
  return found;
}

// The school's own words (i18n.ts VOCAB_CONCEPTS): English text says {@student} where a school may say "pupil".
const VOCAB = [['roll numbers', 'rollNumbers'], ['roll number', 'rollNumber'], ['admission numbers', 'admissionNumbers'], ['admission number', 'admissionNumber'],
  ['report cards', 'reportCards'], ['report card', 'reportCard'], ['students', 'students'], ['student', 'student'], ['parents', 'guardians'], ['parent', 'guardian'],
  ['teachers', 'teachers'], ['teacher', 'teacher'], ['classes', 'classes'], ['class', 'class'], ['principals', 'principals'], ['principal', 'principal'],
  ['homework', 'homework'], ['fees', 'fees']];
function withWords(text) {
  let out = text;
  for (const [word, token] of VOCAB) {
    const cap = (w) => w[0].toUpperCase() + w.slice(1);
    out = out.replace(new RegExp(`(?<![@\\w{'-])(${word}|${cap(word)})(?![\\w}-])`, 'g'), (m) => `{@${m[0] === m[0].toUpperCase() ? cap(token) : token}}`);
  }
  return out;
}

let total = 0;
const skipped = [];
for (const [area, conf] of Object.entries(AREAS)) {
  if (picked.length && !picked.includes(area)) continue;
  const dir = path.join(ROOT, conf.src);
  const catFile = path.join(dir, 'i18n', 'en.json');
  const cat = existsSync(catFile) ? JSON.parse(readFileSync(catFile, 'utf8')) : {};
  const byText = new Map(Object.entries(cat).map(([k, v]) => [`${k.split('.').slice(0, 2).join('.')}|${v}`, k]));
  let areaCount = 0;
  for (const file of walk(dir)) {
    const code = readFileSync(file, 'utf8');
    const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const fileSlug = path.basename(file).replace(/\.(tsx|ts)$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const edits = [];
    fn = usesT(src) ? 'tr' : 't';
    const keyFor = (text) => {
      const scope = `${area}.${fileSlug}`;
      const known = byText.get(`${scope}|${text}`);
      if (known) return known;
      let key = `${scope}.${slug(text)}`;
      for (let i = 2; cat[key] !== undefined && cat[key] !== withWords(text); i++) key = `${scope}.${slug(text)}_${i}`;
      cat[key] = withWords(text);
      byText.set(`${scope}|${text}`, key);
      return key;
    };
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const raw = node.getText(src);
        const text = raw.replace(/\s+/g, ' ').trim();
        if (text && /[A-Za-z]{2,}/.test(text) && !/&[a-z#0-9]+;|[{}]/.test(text)) {
          const lead = /^[^\S\n]+\S/.test(raw) || (/^\s/.test(raw) && !/\n/.test(raw.slice(0, raw.search(/\S/)))) ? "{' '}" : '';
          const tailWs = raw.slice(raw.trimEnd().length);
          const trail = tailWs && !tailWs.includes('\n') ? "{' '}" : '';
          edits.push([node.getStart(src), node.getEnd(), `${lead}{${call(keyFor(text), [])}}${trail}`]);
        }
        return;
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const whole = ts.isTemplateExpression(node) ? templateMessage(node, src) : { text: node.text, params: [] };
        if (prose(whole.text.replace(/\{\w+\}/g, 'x')) && !hidden(node)) {
          const ctx = contextOf(node);
          if (visible(ctx)) {
            const rep = call(keyFor(whole.text), whole.params);
            const inAttr = ts.isJsxAttribute(node.parent);
            edits.push([node.getStart(src), node.getEnd(), inAttr ? `{${rep}}` : rep]);
            return;
          }
          skipped.push(`${path.relative(ROOT, file)}:${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1} ${ctx?.kind}:${ctx?.name ?? ''} ${whole.text.slice(0, 70)}`);
        }
        if (ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    if (!edits.length) continue;
    edits.sort((a, b) => b[0] - a[0]);
    let out = code;
    for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
    // The translator comes from web-ui (its own i18n file inside web-ui).
    if (!new RegExp(`\\bimport \\{[^}]*\\b${fn}\\b[^}]*\\} from`).test(out)) {
      const from = conf.from ?? `./${path.relative(path.dirname(file), path.join(dir, 'i18n')).replace(/\\/g, '/')}`.replace(/^\.\/\.\./, '..');
      const imports = [...out.matchAll(/^import [^;]+;\n/gm)];
      const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
      out = `${out.slice(0, at)}import { ${fn === 't' ? 't' : 't as tr'} } from '${from}';\n${out.slice(at)}`;
    }
    areaCount += edits.length;
    if (!dry) writeFileSync(file, out);
  }
  total += areaCount;
  console.log(`${area}: ${areaCount} texts moved, ${Object.keys(cat).length} keys`);
  if (!dry) {
    mkdirSync(path.dirname(catFile), { recursive: true });
    writeFileSync(catFile, `${JSON.stringify(Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
  }
}
writeFileSync(path.join(ROOT, '.i18n-skipped.txt'), skipped.join('\n'));
console.log(`${total} in all; ${skipped.length} prose-like strings left where they are (listed in .i18n-skipped.txt to check by hand)`);
