import { useEffect } from 'react';
import { languageDir, makeT, type Catalogue, type Params, type Vocabulary } from '@tangent/contracts';
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
  const own = next === 'en' ? {} : Object.assign({}, ...(await Promise.all(loaders.map((l) => l(next).catch(() => ({})))))) as Catalogue;
  lang = next;
  words = vocab;
  current = makeT(next, own, english, vocab);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = languageDir(next);
  }
}

const saved = (): { lang: string; vocab?: Vocabulary } | null => {
  try { return JSON.parse(localStorage.getItem(SAVED) ?? 'null') as { lang: string; vocab?: Vocabulary } | null; } catch { return null; }
};

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
    if (!key || key === JSON.stringify({ lang, vocab: words ?? {} })) return;
    try { localStorage.setItem(SAVED, key); } catch { return; } // ponytail: without storage the page stays in the language it has, rather than reloading forever.
    window.location.reload();
  }, [key]);
}

export const currentLanguage = (): string => lang;
