import { readFileSync } from 'node:fs';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { isLanguage, type Catalogue } from '@tangent/contracts';
import { ApiError } from '@tangent/nest-kit';
import { catalogue, cataloguedLanguages, isSurface } from '@tangent/tenancy';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/guards.js';
import { NoTenant } from '../tenancy/tenant.js';

/**
 * A surface's words in a language (docs/one-shot-plan.md §3.5): the repository's catalogue with the translations kept on the
 * console's Languages page over it. The admin, the console and the app load a language from here, so a new language or a
 * corrected word needs no release. No sign-in: the sign-in page speaks the language too.
 */
@Controller('v1/i18n')
export class I18nController {
  /** The languages a surface has words in, for a language picker (English first). */
  @Public() @NoTenant() @Get('languages/:surface')
  languages(@Param('surface') surface: string): string[] {
    if (!isSurface(surface)) throw new ApiError('not_found', 'There is no catalogue for that.');
    return cataloguedLanguages(surface);
  }

  /** A script's Noto font (assets/fonts, SIL Open Font License), for the app to write a language it does not bundle. */
  @Public() @NoTenant() @Get('fonts/:file')
  font(@Param('file') file: string, @Res() reply: FastifyReply): void {
    if (!/^NotoSans[A-Za-z]+_(400Regular|700Bold)$/.test(file)) throw new ApiError('not_found', 'There is no such font.');
    let data: Buffer;
    try { data = readFileSync(new URL(`../../assets/fonts/${file}.ttf`, import.meta.url)); } catch { throw new ApiError('not_found', 'There is no such font.'); }
    void reply.header('cache-control', 'public, max-age=31536000, immutable').type('font/ttf').send(data);
  }

  @Public() @NoTenant() @Get(':surface/:lang')
  get(@Param('surface') surface: string, @Param('lang') lang: string, @Res({ passthrough: true }) reply: FastifyReply): Catalogue {
    if (!isSurface(surface) || !isLanguage(lang)) throw new ApiError('not_found', 'There is no catalogue for that.');
    const c = catalogue(surface, lang);
    void reply.header('cache-control', 'public, max-age=300').header('etag', `"${surface}-${lang}-${c.version}"`);
    return c.messages;
  }
}
