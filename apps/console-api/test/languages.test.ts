import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness.js';

// Languages: a text is translated in the console, refused if it loses a {value}, and served to every app at once.
let h: Harness;
let t: string;

beforeAll(async () => {
  h = await startHarness();
  t = await h.signIn();
}, 240_000);
afterAll(async () => { await h?.close(); });

describe('languages', () => {
  it('shows every language’s progress, and lists what a language is missing beside its English', async () => {
    const all = (await h.c('GET', '/console/v1/languages', { token: t })).json;
    const fr = all.find((l: { code: string }) => l.code === 'fr');
    expect(fr.surfaces.admin.total).toBeGreaterThan(1000);
    expect(fr.surfaces.text.total).toBeGreaterThan(1000);
    const missing = (await h.c('GET', '/console/v1/languages/fr/text?filter=missing&q=no%20catalogue', { token: t })).json;
    expect(missing[0]).toMatchObject({ key: 'There is no catalogue for that.', english: 'There is no catalogue for that.', text: '', source: 'missing' });
  });

  it('refuses a translation that loses a value, and serves a good one to the apps and the server at once', async () => {
    const key = 'Same {columns} as line {line}.';
    const bad = await h.c('PUT', '/console/v1/languages/fr/text', { token: t, body: { key, text: 'Même colonnes que la ligne.', reviewed: true } });
    expect(bad.status).toBe(400);
    expect((await h.c('PUT', '/console/v1/languages/fr/text', { token: t, body: { key, text: 'Mêmes {columns} qu’à la ligne {line}.', reviewed: true } })).status).toBe(200);
    await h.c('PUT', '/console/v1/languages/fr/text', { token: t, body: { key: 'There is no catalogue for that.', text: 'Il n’y a pas de catalogue pour cela.', reviewed: false } });
    // The catalogue the admin loads, and the server's own words in the reader's language.
    expect((await h.s('GET', '/v1/i18n/text/fr')).json[key]).toBe('Mêmes {columns} qu’à la ligne {line}.');
    expect((await h.s('GET', '/v1/i18n/languages/text')).json).toEqual(['en', 'fr']);
    const res = await h.api.inject({ method: 'GET', url: '/v1/i18n/nope/fr', headers: { 'accept-language': 'fr-CA,fr;q=0.9' } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).message).toBe('Il n’y a pas de catalogue pour cela.');
    const progress = (await h.c('GET', '/console/v1/languages', { token: t })).json.find((l: { code: string }) => l.code === 'fr').surfaces.text;
    expect(progress).toMatchObject({ translated: 2, reviewed: 1 });
  });

  it('takes a translator’s sheet back, keeping only texts that keep their values', async () => {
    const sheet = (await h.c('GET', '/console/v1/languages/es/text/export', { token: t })).json.csv as string;
    // Excel's way: a byte-order mark and Windows line ends, so accents open right.
    expect(sheet.replace(/^﻿/, '').split(/\r?\n/)[0]).toBe('key,english,es,reviewed');
    const csv = ['key,english,es,reviewed', '"Same {columns} as line {line}.",x,"Mismas {columns} que la línea {line}.",yes', '"{column} is empty.",x,"Está vacío.",'].join('\n');
    expect((await h.c('POST', '/console/v1/languages/es/text/import', { token: t, body: { csv } })).json).toEqual({ saved: 1, refused: ['{column} is empty.'] });
  });

  it('asks for a translation provider before drafting', async () => {
    const r = await h.c('POST', '/console/v1/languages/fr/draft', { token: t, body: { surface: 'admin' } });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/Connect a translation provider/);
  });
});
