import { useEffect } from 'react';
import { languageDir, makeT, setTextSource, wordsFor, type Catalogue, type Params, type Vocabulary } from '@tangent/contracts';
import ui from './en.json';

/**
 * The one translator of the web apps (docs/one-shot-plan.md §3.5): `t('area.key', params)` reads the person's language,
 * English underneath, with the school's own words. English is bundled; another language loads before the pages do (each
 * app's main.tsx awaits `startLanguage()`), so labels kept in constants are right too, and a change reloads the page once.
 */
type Loader = (lang: string) => Promise<Catalogue>;

const english: Catalogue = { ...ui };
const loaders: Loader[] = [(lang) => import(`./${lang}.json`).then((m: { default: Catalogue }) => m.default)];
const SAVED = 'tangent.language';
let lang = 'en';
let words: Vocabulary | undefined;
let current = makeT('en', {}, english);
// Shared text (setting labels, module names, server-made lines): English is the key; packages/contracts/i18n holds the rest.
let text: { lang: string; cat: Catalogue; words: Record<string, string> } | undefined;
setTextSource(() => text);

export function t(key: string, params?: Params): string {
  return current(key, params);
}

/** An app's own English, and how to fetch its other languages (each app's `src/i18n/<lang>.json`). */
export function addCatalogue(en: Catalogue, load?: Loader): void {
  Object.assign(english, en);
  if (load) loaders.push(load);
  current = makeT(lang, {}, english, words);
}

/** Sets the language and the school's words; resolves once the catalogues are in. A language without one reads in English. */
export async function setLanguage(next: string, vocab?: Vocabulary): Promise<void> {
  const [own, shared] = next === 'en' ? [{}, {}] : await Promise.all([
    Promise.all(loaders.map((l) => l(next).catch(() => ({})))).then((parts) => Object.assign({}, ...parts) as Catalogue),
    import(`../../../contracts/i18n/${next}.json`).then((m: { default: Catalogue }) => m.default).catch(() => ({})),
  ]);
  lang = next;
  words = vocab;
  current = makeT(next, own, english, vocab);
  text = { lang: next, cat: shared, words: wordsFor(next, vocab, own) };
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = languageDir(next);
  }
}

/** The languages the web apps have catalogues for (the others read in English until translated). */
export const CATALOGUE_LANGUAGES = ['en'];

type Saved = { lang: string; vocab?: Vocabulary; chosen?: boolean };
const saved = (): Saved | null => {
  try { return JSON.parse(localStorage.getItem(SAVED) ?? 'null') as Saved | null; } catch { return null; }
};
const keep = (s: Saved): boolean => { try { localStorage.setItem(SAVED, JSON.stringify(s)); return true; } catch { return false; } };

/** The person picks a language (the sign-in page, their profile): it wins over the school's default on this browser. */
export function chooseLanguage(next: string): void {
  // ponytail: kept per browser; an account preference on the server comes with the people's-language step (plan §3.5.6).
  if (next !== lang && keep({ lang: next, vocab: words, chosen: true })) window.location.reload();
}

/** Before the pages load: the language this browser last read the school in (English the first time). */
export function startLanguage(): Promise<void> {
  const s = saved();
  return setLanguage(s?.lang ?? 'en', s?.vocab);
}

/**
 * Once the school (and the person) are known: their language and the school's words. When they differ from what the page was
 * drawn with, they are kept for next time and the page loads again in them.
 */
export function useLanguage(next: string | undefined, vocab: Vocabulary | undefined): void {
  const key = next ? JSON.stringify({ lang: next, vocab: vocab ?? {} }) : '';
  useEffect(() => {
    if (!next) return;
    const s = saved();
    const want = s?.chosen ? s.lang : next;
    if (want === lang && JSON.stringify(vocab ?? {}) === JSON.stringify(words ?? {})) return;
    // Without storage the page stays in the language it has, rather than reloading forever.
    if (keep({ lang: want, vocab, chosen: s?.chosen })) window.location.reload();
  }, [key]);
}

export const currentLanguage = (): string => lang;
