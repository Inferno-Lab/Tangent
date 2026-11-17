/**
 * Languages (docs/one-shot-plan.md §3.5): every word a person reads comes from a catalogue, in any language, either
 * direction. One small engine for the web apps, the API's messages and PDFs: `{name}` fills a value,
 * `{n, plural, one {# book} other {# books}}` and `{x, select, a {…} other {…}}` choose by number or value (plural
 * categories from `Intl.PluralRules`, so every language counts its own way), and `{@student}` is the school's own word
 * (vocabulary, §3.6.7). No library.
 */

import { plural } from './dates.js';

export type Script = 'latin' | 'devanagari' | 'arabic' | 'bengali' | 'tamil' | 'telugu' | 'gujarati' | 'gurmukhi' | 'kannada' | 'malayalam' | 'odia'
  | 'sinhala' | 'thai' | 'cjk' | 'hangul' | 'cyrillic' | 'greek' | 'hebrew' | 'ethiopic' | 'khmer' | 'myanmar' | 'georgian' | 'armenian' | 'lao';

export interface Language {
  code: string;
  /** In English, for Tangent's own lists. */
  name: string;
  /** In itself, as its speakers pick it. */
  own: string;
  script: Script;
  dir: 'ltr' | 'rtl';
}

const L = (code: string, name: string, own: string, script: Script = 'latin', dir: 'ltr' | 'rtl' = 'ltr'): Language => ({ code, name, own, script, dir });

/** Every language a school may offer. A language with no catalogue yet shows English until it is translated. */
export const LANGUAGE_LIST: Language[] = [
  L('en', 'English', 'English'), L('hi', 'Hindi', 'हिन्दी', 'devanagari'), L('mr', 'Marathi', 'मराठी', 'devanagari'),
  L('ar', 'Arabic', 'العربية', 'arabic', 'rtl'), L('es', 'Spanish', 'Español'), L('fr', 'French', 'Français'),
  L('bn', 'Bengali', 'বাংলা', 'bengali'), L('ta', 'Tamil', 'தமிழ்', 'tamil'), L('te', 'Telugu', 'తెలుగు', 'telugu'), L('gu', 'Gujarati', 'ગુજરાતી', 'gujarati'),
  L('kn', 'Kannada', 'ಕನ್ನಡ', 'kannada'), L('ml', 'Malayalam', 'മലയാളം', 'malayalam'), L('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'gurmukhi'), L('or', 'Odia', 'ଓଡ଼ିଆ', 'odia'),
  L('ur', 'Urdu', 'اردو', 'arabic', 'rtl'), L('ne', 'Nepali', 'नेपाली', 'devanagari'), L('si', 'Sinhala', 'සිංහල', 'sinhala'),
  L('fa', 'Persian', 'فارسی', 'arabic', 'rtl'), L('he', 'Hebrew', 'עברית', 'hebrew', 'rtl'), L('tr', 'Turkish', 'Türkçe'),
  L('de', 'German', 'Deutsch'), L('it', 'Italian', 'Italiano'), L('pt', 'Portuguese', 'Português'), L('nl', 'Dutch', 'Nederlands'),
  L('pl', 'Polish', 'Polski'), L('ro', 'Romanian', 'Română'), L('sv', 'Swedish', 'Svenska'), L('el', 'Greek', 'Ελληνικά', 'greek'),
  L('ru', 'Russian', 'Русский', 'cyrillic'), L('uk', 'Ukrainian', 'Українська', 'cyrillic'),
  L('zh', 'Chinese', '中文', 'cjk'), L('ja', 'Japanese', '日本語', 'cjk'), L('ko', 'Korean', '한국어', 'hangul'),
  L('th', 'Thai', 'ไทย', 'thai'), L('vi', 'Vietnamese', 'Tiếng Việt'), L('id', 'Indonesian', 'Bahasa Indonesia'), L('ms', 'Malay', 'Bahasa Melayu'),
  L('fil', 'Filipino', 'Filipino'), L('sw', 'Swahili', 'Kiswahili'), L('am', 'Amharic', 'አማርኛ', 'ethiopic'), L('ha', 'Hausa', 'Hausa'),
  L('yo', 'Yoruba', 'Yorùbá'), L('zu', 'Zulu', 'isiZulu'), L('af', 'Afrikaans', 'Afrikaans'),
];

const BY_CODE = new Map(LANGUAGE_LIST.map((l) => [l.code, l]));

/** The Noto family that writes a language's script (Google Fonts), where Latin fonts do not; null for Latin, Cyrillic and Greek. */
export function scriptFont(code: string): string | null {
  const l = BY_CODE.get(code);
  if (!l) return null;
  if (l.script === 'cjk') return code === 'ja' ? 'Noto Sans JP' : 'Noto Sans SC';
  const fonts: Partial<Record<Script, string>> = {
    devanagari: 'Noto Sans Devanagari', arabic: code === 'ur' ? 'Noto Nastaliq Urdu' : 'Noto Sans Arabic', bengali: 'Noto Sans Bengali', tamil: 'Noto Sans Tamil',
    telugu: 'Noto Sans Telugu', gujarati: 'Noto Sans Gujarati', gurmukhi: 'Noto Sans Gurmukhi', kannada: 'Noto Sans Kannada', malayalam: 'Noto Sans Malayalam',
    odia: 'Noto Sans Oriya', sinhala: 'Noto Sans Sinhala', thai: 'Noto Sans Thai', hangul: 'Noto Sans KR', hebrew: 'Noto Sans Hebrew', ethiopic: 'Noto Sans Ethiopic',
    khmer: 'Noto Sans Khmer', myanmar: 'Noto Sans Myanmar', georgian: 'Noto Sans Georgian', armenian: 'Noto Sans Armenian', lao: 'Noto Sans Lao',
  };
  return fonts[l.script] ?? null;
}
export const isLanguage = (code: string): boolean => BY_CODE.has(code);
export const languageOf = (code: string): Language => BY_CODE.get(code) ?? BY_CODE.get('en')!;
export const languageDir = (code: string): 'ltr' | 'rtl' => languageOf(code).dir;
/** "Español (Spanish)": what a language picker shows. */
export const languageLabel = (code: string): string => { const l = languageOf(code); return l.own === l.name ? l.name : `${l.own} (${l.name})`; };

/** The words a school may rename (§3.6.7), with the English ones. Text says `{@student}`, `{@students}`, `{@Student}`. */
export const VOCAB_CONCEPTS = [
  { key: 'student', many: 'students', en: ['student', 'students'] },
  { key: 'guardian', many: 'guardians', en: ['parent', 'parents'] },
  { key: 'teacher', many: 'teachers', en: ['teacher', 'teachers'] },
  { key: 'class', many: 'classes', en: ['class', 'classes'] },
  { key: 'section', many: 'sections', en: ['section', 'sections'] },
  { key: 'house', many: 'houses', en: ['house', 'houses'] },
  { key: 'term', many: 'terms', en: ['term', 'terms'] },
  { key: 'period', many: 'periods', en: ['period', 'periods'] },
  { key: 'rollNumber', many: 'rollNumbers', en: ['roll number', 'roll numbers'] },
  { key: 'admissionNumber', many: 'admissionNumbers', en: ['admission number', 'admission numbers'] },
  { key: 'reportCard', many: 'reportCards', en: ['report card', 'report cards'] },
  { key: 'homework', many: 'homeworks', en: ['homework', 'homework'] },
  { key: 'principal', many: 'principals', en: ['principal', 'principals'] },
  { key: 'fees', many: 'feesMany', en: ['fees', 'fees'] },
] as const;
export type VocabConcept = (typeof VOCAB_CONCEPTS)[number]['key'];
/** One word, as the school writes it: singular and plural. */
export type Word = { one: string; many?: string };
/** The school's words per language: `{ en: { student: { one: 'Pupil' } } }`. */
export type Vocabulary = Record<string, Partial<Record<VocabConcept, Word>>>;

/** A catalogue: key → message. */
export type Catalogue = Record<string, string>;

/** The school's word for a concept in a language: its own, else the catalogue's (`vocab.student.one`), else English. */
export function wordsFor(lang: string, vocab: Vocabulary | undefined, cat: Catalogue = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of VOCAB_CONCEPTS) {
    const own = vocab?.[lang]?.[c.key];
    const one = own?.one?.trim() || cat[`vocab.${c.key}.one`] || c.en[0];
    // A school that wrote only the singular gets the catalogue's plural only when it kept the catalogue's singular.
    const many = own?.many?.trim() || (own?.one?.trim() ? pluralOf(own.one.trim(), lang) : cat[`vocab.${c.key}.many`] || c.en[1]);
    out[c.key] = one;
    out[c.many] = many;
  }
  return out;
}

// ponytail: only English gets an automatic plural; other languages ask for the plural on the Settings tab.
const pluralOf = (word: string, lang: string): string => (lang === 'en' ? plural(word) : word);

/** First letter up (`{@Student}`), or down mid-sentence unless the word is an acronym such as "UPN". */
function caseFor(word: string, upper: boolean, lang: string): string {
  if (!word) return word;
  const first = word[0]!, rest = word.slice(1);
  if (upper) return first.toLocaleUpperCase(lang) + rest;
  return rest && rest === rest.toLocaleUpperCase(lang) && rest !== rest.toLocaleLowerCase(lang) ? word : first.toLocaleLowerCase(lang) + rest;
}

const pluralRules = new Map<string, Intl.PluralRules>();
/** The plural category of a number in a language (zero, one, two, few, many, other). */
export function pluralCategory(lang: string, n: number): Intl.LDMLPluralRule {
  let r = pluralRules.get(lang);
  if (!r) { try { r = new Intl.PluralRules(lang); } catch { r = new Intl.PluralRules('en'); } pluralRules.set(lang, r); }
  return r.select(n);
}

export type Params = Record<string, string | number | null | undefined>;

/** Finds the `}` closing the brace that opens at `from`. */
function closing(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** `one {# book} other {# books}` → { one: '# book', other: '# books' }. */
function branches(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    const name = s.slice(i, open).trim();
    const end = closing(s, open);
    if (end < 0) break;
    out[name] = s.slice(open + 1, end);
    i = end + 1;
  }
  return out;
}

/** The values and school words a message uses (`{name}`, `{n, plural…}`, `{@student}`), whatever its branches say: a
 *  translation must use the same ones, though Arabic may have more plural branches than English. */
export function messageArgs(msg: string): string[] {
  const out = new Set<string>();
  const walk = (s: string): void => {
    for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i)) {
      const end = closing(s, i);
      if (end < 0) return;
      const body = s.slice(i + 1, end);
      const comma = body.indexOf(',');
      if (comma < 0) out.add(body.trim().toLowerCase());
      else {
        out.add(body.slice(0, comma).trim().toLowerCase());
        const rest = body.slice(comma + 1);
        for (const b of Object.values(branches(rest.slice(rest.indexOf(',') + 1)))) walk(b);
      }
      i = end + 1;
    }
  };
  walk(msg);
  return [...out].sort();
}

/** Fills one message: values, plurals, selects and the school's words. A missing value leaves its `{name}` showing. */
export function formatMessage(msg: string, params: Params = {}, lang = 'en', words: Record<string, string> = {}, num = (n: number) => String(n)): string {
  let out = '';
  let i = 0;
  while (i < msg.length) {
    const open = msg.indexOf('{', i);
    if (open < 0) { out += msg.slice(i); break; }
    out += msg.slice(i, open);
    const end = closing(msg, open);
    if (end < 0) { out += msg.slice(open); break; }
    const body = msg.slice(open + 1, end);
    const comma = body.indexOf(',');
    if (body.startsWith('@')) {
      const name = body.slice(1);
      const key = name[0]!.toLowerCase() + name.slice(1);
      out += key in words ? caseFor(words[key]!, name[0] !== name[0]!.toLowerCase(), lang) : `{${body}}`;
    } else if (comma < 0) {
      const v = params[body.trim()];
      out += v === undefined || v === null ? `{${body}}` : typeof v === 'number' ? num(v) : v;
    } else {
      const name = body.slice(0, comma).trim();
      const rest = body.slice(comma + 1);
      const c2 = rest.indexOf(',');
      const type = rest.slice(0, c2).trim();
      const opts = branches(rest.slice(c2 + 1));
      const v = params[name];
      if (type === 'plural') {
        const n = Number(v ?? 0);
        const pick = opts[`=${n}`] ?? opts[pluralCategory(lang, n)] ?? opts.other ?? '';
        out += formatMessage(pick.replace(/#/g, num(n)), params, lang, words, num);
      } else {
        out += formatMessage(opts[String(v)] ?? opts.other ?? '', params, lang, words, num);
      }
    }
    i = end + 1;
  }
  return out;
}

/** A translator for one person: their language's catalogue, English underneath, and the school's words. */
export function makeT(lang: string, cat: Catalogue, en: Catalogue, vocab?: Vocabulary): (key: string, params?: Params) => string {
  const words = wordsFor(lang, vocab, cat);
  const nf = new Intl.NumberFormat(lang);
  return (key, params) => {
    const own = cat[key];
    // A key missing in the person's language reads in English, with English words, rather than as a key.
    if (own !== undefined) return formatMessage(own, params, lang, words, (n) => nf.format(n));
    const msg = en[key];
    return msg === undefined ? key : formatMessage(msg, params, 'en', lang === 'en' ? words : wordsFor('en', vocab, en), (n) => nf.format(n));
  };
}

/**
 * How dates and numbers are written for a reader: the school's own locale when the reader's language is its language,
 * otherwise their language in the school's region ("ar" at a school in "AE" reads "ar-AE"), or just their language.
 */
export function readingLocale(lang: string, schoolLocale: string, country: string): string {
  if (schoolLocale.split('-')[0] === lang) return schoolLocale;
  const regional = `${lang}-${country}`;
  try { return Intl.DateTimeFormat.supportedLocalesOf([regional]).length ? regional : lang; } catch { return lang; }
}

/**
 * Text that lives in shared data and server code (setting labels, module names, error messages): the English is the key,
 * gettext-style, so it reads in the reader's language wherever it is shown. The web apps and the server each say where the
 * reader's language and its catalogue come from (`setTextSource`); without one, the English shows.
 */
type TextSource = () => { lang: string; cat: Catalogue; words?: Record<string, string> } | undefined;
let textSource: TextSource = () => undefined;
export function setTextSource(fn: TextSource): void {
  textSource = fn;
}
let englishWords: Record<string, string> | null = null;
export function tx(english: string, params?: Params): string {
  const s = textSource();
  if (!s) return params || english.includes('{@') ? formatMessage(english, params, 'en', (englishWords ??= wordsFor('en', undefined))) : english;
  const own = s.cat[english];
  // A text with no translation reads in English, with the school's English words.
  return formatMessage(own ?? english, params, own === undefined ? 'en' : s.lang, own === undefined && s.lang !== 'en' ? wordsFor('en', undefined) : s.words);
}

/** Fields of shared data that people read: these come back in the reader's language (`localized`). */
const TEXT_FIELDS = new Set(['label', 'name', 'help', 'blurb', 'description', 'hint', 'note', 'title', 'what', 'why', 'sub', 'stepLabel']);
const RAW = Symbol('raw');
const proxies = new WeakMap<object, object>();

/**
 * Shared data whose labels read in the reader's language: `label`, `help`… (and `[value, label]` options) are translated as
 * they are read, so every page that shows them is covered without each one asking. Keys, groups and values stay as they are.
 */
export function localized<T extends object>(data: T): T {
  const known = proxies.get(data);
  if (known) return known as T;
  const p = new Proxy(data, {
    get(target, prop, recv) {
      if (prop === RAW) return target;
      const v = Reflect.get(target, prop, recv) as unknown;
      if (typeof prop !== 'string') return v;
      if (typeof v === 'string') return TEXT_FIELDS.has(prop) ? tx(v) : v;
      if (prop === 'options' && Array.isArray(v) && v.every((o) => Array.isArray(o) && typeof o[1] === 'string')) return v.map(([value, label]: [string, string]) => [value, tx(label)]);
      return v && typeof v === 'object' ? localized(v as object) : v;
    },
  });
  proxies.set(data, p);
  return p as T;
}

/** A map from a key to its label (`{ present: 'Present' }`), read in the reader's language. */
export function localizedLabels<T extends Record<string, string>>(labels: T): T {
  return new Proxy(labels, { get: (target, prop, recv) => { const v = Reflect.get(target, prop, recv) as unknown; return prop === RAW ? target : typeof v === 'string' ? tx(v) : v; } });
}

/** The English underneath a localized table (for the catalogue tool and tests). */
export const rawOf = <T extends object>(data: T): T => ((data as Record<symbol, unknown>)[RAW] as T | undefined) ?? data;
