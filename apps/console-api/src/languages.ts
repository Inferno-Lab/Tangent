import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { DraftRequest, I18N_SURFACES, LANGUAGE_LIST, TranslationPut, isLanguage, type DraftResult, type I18nSurface, type LanguageSummary, type TranslationRow } from '@tangent/contracts';
import { parseCsv, toCsv } from '@tangent/db';
import { keepsValues } from '@tangent/integrations';
import { ApiError, ZodPipe } from '@tangent/nest-kit';
import { catalogue, refreshTranslations, repoCatalogue } from '@tangent/tenancy';
import { z } from 'zod';
import { Db, Me, Needs, type ConsoleUser } from './core.js';
import { PlatformHub } from './platform-hub.js';

type Stored = { key: string; text: string; reviewed: boolean; source: string; updated_by: string };

/**
 * The console's Languages page (docs/one-shot-plan.md §3.5.9, D3): how far each language is on each surface, every text side
 * by side with its English, machine drafts through the Hub's translation connection, and a person's approval. A text keeps
 * its {values} or it is refused, so a translation can never break a page. Kept in the registry and served at once
 * (`/v1/i18n`), so a new language or a corrected word needs no release.
 */
@Injectable()
export class Languages {
  constructor(private readonly db: Db, private readonly platform: PlatformHub) {}

  private english(surface: I18nSurface): Record<string, string> {
    return repoCatalogue(surface, 'en');
  }

  private check(lang: string, surface: string): asserts surface is I18nSurface {
    if (!isLanguage(lang) || lang === 'en') throw new ApiError('validation', 'Choose a language other than English.');
    if (!(I18N_SURFACES as readonly string[]).includes(surface)) throw new ApiError('not_found', 'There is no such part of Tangent to translate.');
  }

  private async stored(lang: string, surface: I18nSurface): Promise<Map<string, Stored>> {
    const rows = (await this.db.pool.query<Stored>('select key, text, reviewed, source, updated_by from translations where lang = $1 and surface = $2', [lang, surface])).rows;
    return new Map(rows.map((r) => [r.key, r]));
  }

  async summary(): Promise<LanguageSummary[]> {
    const counts = (await this.db.pool.query<{ lang: string; surface: I18nSurface; reviewed: string }>(
      'select lang, surface, count(*) filter (where reviewed) reviewed from translations group by lang, surface')).rows;
    return LANGUAGE_LIST.filter((l) => l.code !== 'en').map((l) => ({
      code: l.code,
      surfaces: Object.fromEntries(I18N_SURFACES.map((s) => {
        const en = Object.keys(this.english(s));
        const have = catalogue(s, l.code).messages;
        return [s, { total: en.length, translated: en.filter((k) => have[k]?.trim()).length, reviewed: Number(counts.find((c) => c.lang === l.code && c.surface === s)?.reviewed ?? 0) }];
      })) as LanguageSummary['surfaces'],
    }));
  }

  async rows(lang: string, surface: string, filter: string, q: string): Promise<TranslationRow[]> {
    this.check(lang, surface);
    const kept = await this.stored(lang, surface);
    const file = repoCatalogue(surface, lang);
    const needle = q.trim().toLowerCase();
    return Object.entries(this.english(surface)).map(([key, english]): TranslationRow => {
      const s = kept.get(key);
      const text = s?.text ?? file[key] ?? '';
      return { key, english, text, reviewed: !!s?.reviewed, source: s ? (s.source === 'machine' ? 'machine' : 'person') : file[key] ? 'file' : 'missing', updatedBy: s?.updated_by ?? null };
    }).filter((r) => (filter === 'missing' ? !r.text : filter === 'review' ? !!r.text && !r.reviewed : true)
      && (!needle || `${r.key} ${r.english} ${r.text}`.toLowerCase().includes(needle))).slice(0, 500);
  }

  async put(me: ConsoleUser, lang: string, surface: string, key: string, body: TranslationPut): Promise<TranslationRow> {
    this.check(lang, surface);
    const english = this.english(surface)[key];
    if (english === undefined) throw new ApiError('not_found', 'English has no such text.');
    if (body.text.trim() && !keepsValues(english, body.text)) throw new ApiError('validation', 'Keep every {value} and {@word} exactly as in the English.', { fields: { text: 'Keep every {value} and {@word} exactly as in the English.' } });
    if (!body.text.trim()) await this.db.pool.query('delete from translations where lang = $1 and surface = $2 and key = $3', [lang, surface, key]);
    else await this.db.pool.query(
      `insert into translations (lang, surface, key, text, reviewed, source, updated_by) values ($1,$2,$3,$4,$5,'person',$6)
       on conflict (lang, surface, key) do update set text = excluded.text, reviewed = excluded.reviewed, source = 'person', updated_by = excluded.updated_by, updated_at = now()`,
      [lang, surface, key, body.text, body.reviewed, me.email]);
    await this.db.audit(me.email, 'language.text', 'translation', `${lang}/${surface}/${key}`, { reviewed: body.reviewed });
    await refreshTranslations(this.db.pool);
    return (await this.rows(lang, surface, 'all', key)).find((r) => r.key === key)!;
  }

  /** Machine drafts for the missing texts of one surface, a batch at a time; a draft that loses a {value} is left for a person. */
  async draft(me: ConsoleUser, lang: string, req: DraftRequest): Promise<DraftResult> {
    this.check(lang, req.surface);
    const conn = await this.platform.hub.platform('translation');
    if (!conn?.adapter.translate) throw new ApiError('validation', 'Connect a translation provider first: Integrations → Translation drafts (Claude, DeepL or Google).');
    const missing = (await this.rows(lang, req.surface, 'missing', '')).map((r) => [r.key, r.english] as const);
    const batch = missing.slice(0, req.limit);
    let drafted = 0;
    let skipped = 0;
    for (let i = 0; i < batch.length; i += 50) {
      const part = batch.slice(i, i + 50);
      const out = await conn.adapter.translate(conn.ctx, { texts: part.map(([, en]) => en), from: 'en', to: lang });
      for (const [j, [key, en]] of part.entries()) {
        const text = out[j] ?? '';
        if (!keepsValues(en, text)) { skipped++; continue; }
        await this.db.pool.query(
          `insert into translations (lang, surface, key, text, reviewed, source, updated_by) values ($1,$2,$3,$4,false,'machine',$5)
           on conflict (lang, surface, key) do nothing`, [lang, req.surface, key, text, me.email]);
        drafted++;
      }
    }
    await this.db.audit(me.email, 'language.draft', 'translation', `${lang}/${req.surface}`, { drafted, skipped });
    await refreshTranslations(this.db.pool);
    return { drafted, skipped, left: missing.length - drafted };
  }

  async exportCsv(lang: string, surface: string): Promise<string> {
    this.check(lang, surface);
    const rows = await this.rows(lang, surface, 'all', '');
    return toCsv([['key', 'english', lang, 'reviewed'], ...rows.map((r) => [r.key, r.english, r.text, r.reviewed ? 'yes' : ''])]);
  }

  /** A sheet back from a translator: the key, the English (ignored), the text and "yes" where it is approved. */
  async importCsv(me: ConsoleUser, lang: string, surface: string, csv: string): Promise<{ saved: number; refused: string[] }> {
    this.check(lang, surface);
    const en = this.english(surface);
    const [, ...rows] = parseCsv(csv);
    let saved = 0;
    const refused: string[] = [];
    for (const [key = '', , text = '', reviewed = ''] of rows) {
      if (!text.trim() || en[key] === undefined) continue;
      if (!keepsValues(en[key]!, text)) { refused.push(key); continue; }
      await this.db.pool.query(
        `insert into translations (lang, surface, key, text, reviewed, source, updated_by) values ($1,$2,$3,$4,$5,'person',$6)
         on conflict (lang, surface, key) do update set text = excluded.text, reviewed = excluded.reviewed, source = 'person', updated_by = excluded.updated_by, updated_at = now()`,
        [lang, surface, key, text, /^(yes|y|true|1)$/i.test(reviewed.trim()), me.email]);
      saved++;
    }
    await this.db.audit(me.email, 'language.import', 'translation', `${lang}/${surface}`, { saved, refused: refused.length });
    await refreshTranslations(this.db.pool);
    return { saved, refused: refused.slice(0, 50) };
  }
}

@Controller('console/v1/languages')
export class LanguagesController {
  constructor(private readonly languages: Languages) {}

  @Get() @Needs('schools.read')
  summary(): Promise<LanguageSummary[]> {
    return this.languages.summary();
  }

  @Get(':lang/:surface') @Needs('schools.read')
  rows(@Param('lang') lang: string, @Param('surface') surface: string, @Query('filter') filter = 'all', @Query('q') q = ''): Promise<TranslationRow[]> {
    return this.languages.rows(lang, surface, filter, q);
  }

  @Put(':lang/:surface') @Needs('languages.write')
  put(@Me() me: ConsoleUser, @Param('lang') lang: string, @Param('surface') surface: string, @Body(new ZodPipe(TranslationPut)) body: TranslationPut): Promise<TranslationRow> {
    return this.languages.put(me, lang, surface, body.key, body);
  }

  @Post(':lang/draft') @HttpCode(200) @Needs('languages.write')
  draft(@Me() me: ConsoleUser, @Param('lang') lang: string, @Body(new ZodPipe(DraftRequest)) body: DraftRequest): Promise<DraftResult> {
    return this.languages.draft(me, lang, body);
  }

  @Get(':lang/:surface/export') @Needs('schools.read')
  async exportCsv(@Param('lang') lang: string, @Param('surface') surface: string): Promise<{ csv: string }> {
    return { csv: await this.languages.exportCsv(lang, surface) };
  }

  @Post(':lang/:surface/import') @HttpCode(200) @Needs('languages.write')
  importCsv(@Me() me: ConsoleUser, @Param('lang') lang: string, @Param('surface') surface: string, @Body(new ZodPipe(z.object({ csv: z.string().max(5_000_000) }))) body: { csv: string }): Promise<{ saved: number; refused: string[] }> {
    return this.languages.importCsv(me, lang, surface, body.csv);
  }
}
