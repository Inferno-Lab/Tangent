import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { call } from '../http.js';
import type { Adapter, TranslateInput } from '../types.js';

/**
 * Machine drafts of the catalogues (docs/one-shot-plan.md §3.5.9, D3): a person reviews each one in the console before it
 * counts as reviewed. Every provider must keep {values}, {@words} and plural/select structure exactly; a draft that changes
 * them is dropped (`keepsValues`), so a broken placeholder never reaches a page.
 */

/** The {value} and {@word} names of a message, in order: a translation must have the same set. */
export const valuesOf = (s: string): string => [...s.matchAll(/\{(@?\w+)/g)].map((m) => m[1]!.toLowerCase()).filter((x) => !/^(one|other|few|many|two|zero)$/.test(x)).sort().join(',');
export const keepsValues = (english: string, draft: string): boolean => !!draft.trim() && valuesOf(english) === valuesOf(draft);

const Drafts = z.object({ translations: z.array(z.object({ id: z.number().int(), text: z.string() })) });

const prompt = (t: TranslateInput) => [
  `Translate these user-interface texts of a school-management product from English into the language with code "${t.to}".`,
  'Schools, parents, teachers and office staff read them. Use the plain, friendly words the people of that language use at school.',
  'Keep every {name} placeholder and every {@word} exactly as written, untranslated, and keep plural/select messages in the same {n, plural, ...} shape with the plural categories that language needs.',
  'Keep product and brand names (Tangent, WhatsApp, UPI) as they are. Return one translation for every id.',
  t.glossary && Object.keys(t.glossary).length ? `Use these words: ${Object.entries(t.glossary).map(([en, own]) => `"${en}" = "${own}"`).join('; ')}.` : '',
  '',
  ...t.texts.map((text, id) => `${id}\t${text.replace(/\n/g, '\\n')}`),
].filter((l) => l !== '').join('\n');

export const anthropic: Adapter = {
  async translate(c, t) {
    const client = new Anthropic({ apiKey: c.secrets.apiKey });
    const res = await client.beta.messages.create({
      model: String(c.settings.model ?? '') || 'claude-opus-5-5',
      max_tokens: 64_000,
      // A declined request re-runs on the model Anthropic recommends for that case, instead of returning nothing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: zodOutputFormat(Drafts) },
      messages: [{ role: 'user', content: prompt(t) }],
    }, { timeout: 600_000 });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this batch; it stays in English until a person translates it.');
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = Drafts.safeParse(JSON.parse(text || '{}'));
    if (!parsed.success) throw new Error('Claude answered in an unexpected shape; try the batch again.');
    const out = t.texts.map(() => '');
    for (const d of parsed.data.translations) if (d.id >= 0 && d.id < out.length) out[d.id] = d.text.replace(/\\n/g, '\n');
    return out;
  },
  async test(c) {
    try {
      const [fr] = await anthropic.translate!(c, { texts: ['Attendance is marked for {class}.'], from: 'en', to: 'fr' });
      return keepsValues('Attendance is marked for {class}.', fr ?? '') ? { ok: true, detail: `French: ${fr}` } : { ok: false, detail: `The draft lost its placeholder: ${fr}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },
};

// Machine translators keep marked-up parts as they are: placeholders travel inside a tag they leave alone.
const shield = (s: string) => s.replace(/\{[^{}]*\}/g, (m) => `<x>${m}</x>`);
const unshield = (s: string) => s.replace(/<x>([\s\S]*?)<\/x>/g, '$1');

export const deepl: Adapter = {
  async translate(c, t) {
    const host = String(c.secrets.apiKey ?? '').endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const r = await call(`${host}/v2/translate`, {
      method: 'POST', headers: { authorization: `DeepL-Auth-Key ${c.secrets.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: t.texts.map(shield), source_lang: 'EN', target_lang: t.to.toUpperCase(), tag_handling: 'xml', ignore_tags: ['x'], preserve_formatting: true }),
    });
    if (r.status >= 300) throw new Error(`DeepL: ${r.json?.message ?? r.status}`);
    return (r.json?.translations ?? []).map((x: { text: string }) => unshield(x.text));
  },
  async test(c) {
    try { return { ok: true, detail: `French: ${(await deepl.translate!(c, { texts: ['Good morning, {name}.'], from: 'en', to: 'fr' }))[0]}` }; } catch (e) { return { ok: false, detail: (e as Error).message }; }
  },
};

export const googleTranslate: Adapter = {
  async translate(c, t) {
    const r = await call(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(c.secrets.apiKey ?? '')}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: t.texts.map((s) => shield(s).replace(/<x>/g, '<span translate="no">').replace(/<\/x>/g, '</span>')), source: 'en', target: t.to, format: 'html' }),
    });
    if (r.status >= 300) throw new Error(`Google Translate: ${r.json?.error?.message ?? r.status}`);
    return (r.json?.data?.translations ?? []).map((x: { translatedText: string }) => x.translatedText.replace(/<span translate="no">([\s\S]*?)<\/span>/g, '$1')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  },
  async test(c) {
    try { return { ok: true, detail: `French: ${(await googleTranslate.translate!(c, { texts: ['Good morning, {name}.'], from: 'en', to: 'fr' }))[0]}` }; } catch (e) { return { ok: false, detail: (e as Error).message }; }
  },
};
