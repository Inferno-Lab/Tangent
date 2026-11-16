import { useEffect } from 'react';
import { languageDir, makeT, scriptFont, setTextSource, wordsFor, type Catalogue, type Params, type Vocabulary } from '@tangent/contracts';
import ui from './en.json';

/**
 * The one translator of the web apps (docs/one-shot-plan.md §3.5): `t('area.key', params)` reads the person's language,
 * English underneath, with the school's own words. English is bundled; another language comes from the API (`/v1/i18n`, the
 * repository's catalogues with the console's Languages page over them) before the pages load (each app's main.tsx awaits
 * `startLanguage()`), so labels kept in constants are right too, and a change reloads the page once.
 */
const english: Catalogue = { ...ui };
let api = '';
let surface = '';
const SAVED = 'tangent.language';
let lang = 'en';
let words: Vocabulary | undefined;
let current = makeT('en', {}, english);
// Shared text (setting labels, module names, server-made lines): English is the key.
let text: { lang: string; cat: Catalogue; words: Record<string, string> } | undefined;
setTextSource(() => text);

export function t(key: string, params?: Params): string {
  return current(key, params);
}

/** An app's own English, its surface (admin, console) and where the API is. */
export function configureLanguages(o: { en: Catalogue; surface: string; api: string }): void {
  Object.assign(english, o.en);
  surface = o.surface;
  api = o.api.replace(/\/$/, '');
  current = makeT(lang, {}, english, words);
}

const fetchCatalogue = (s: string, l: string): Promise<Catalogue> =>
  fetch(`${api}/v1/i18n/${s}/${l}`).then((r) => (r.ok ? (r.json() as Promise<Catalogue>) : {})).catch(() => ({}));

/** Sets the language and the school's words; resolves once the catalogues are in. A language without one reads in English. */
export async function setLanguage(next: string, vocab?: Vocabulary): Promise<void> {
  const [own, shared] = next === 'en' ? [{}, {}] : await Promise.all([
    Promise.all([fetchCatalogue(surface, next), fetchCatalogue('ui', next)]).then(([a, b]) => ({ ...b, ...a })),
    fetchCatalogue('text', next),
  ]);
  lang = next;
  words = vocab;
  current = makeT(next, own, english, vocab);
  text = { lang: next, cat: shared, words: wordsFor(next, vocab, own) };
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    document.documentElement.dir = languageDir(next);
    loadScriptFont(next);
  }
}

/** The font that writes the language's script, loaded from Google Fonts like the design's own, and put first in the stacks (--fs). */
function loadScriptFont(code: string): void {
  const family = scriptFont(code);
  if (!family || family === 'Noto Sans Devanagari') return;
  const href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;500;600;700&display=swap`;
  if (!document.querySelector(`link[href="${href}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }
  document.documentElement.style.setProperty('--fs', `'${family}','Noto Sans Devanagari'`);
}

/** The languages this app has words in (English always), for the sign-in page's picker. */
export const catalogueLanguages = (): Promise<string[]> =>
  fetch(`${api}/v1/i18n/languages/${surface}`).then((r) => (r.ok ? (r.json() as Promise<string[]>) : ['en'])).catch(() => ['en']);

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

/** "A, B and C" in the reader's language; `or` gives "A or B". */
export const listOf = (items: string[], or = false): string => new Intl.ListFormat(lang, { type: or ? 'disjunction' : 'conjunction' }).format(items);
/** A weekday as settings keep it ('saturday') in the reader's language. */
export function dayOf(day: string): string {
  const i = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day.toLowerCase());
  return i < 0 ? day : new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 15 + i)));
}
