import 'regenerator-runtime/runtime.js';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import type { FastifyReply } from 'fastify';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * A4 PDFs of lines for receipts and report cards: the school's logo, its name, then the facts, over as many pages as they take.
 * Every script prints in its own Noto font (shaped by fontkit: Devanagari conjuncts, Arabic joining), so every family's name
 * and every currency print as written; a line that starts in Arabic or Hebrew is set from the right. The fonts are vendored in
 * assets/fonts (SIL Open Font License); only the ones a document uses are embedded.
 */
/** A line of a document. `page` starts a new page first; `qr` draws a QR code of that text at the right, beside the lines after it. */
export interface PdfLine { text: string; right?: string; size?: number; bold?: boolean; gap?: number; rule?: boolean; page?: boolean; qr?: string; align?: 'start' | 'center' | 'end' }
/** Page sizes in points (§3.6.2). */
const PAGES = { A4: [595, 842], Letter: [612, 792], A5: [420, 595] } as const;

const FONTS = new URL('../../assets/fonts/', import.meta.url);
/** Each script's letters and the Noto font that has them (Latin, Cyrillic and Greek are in Noto Sans itself). */
const SCRIPTS: { key: string; file: string; re: RegExp; rtl?: true }[] = [
  { key: 'deva', file: 'NotoSansDevanagari', re: /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/ },
  { key: 'arabic', file: 'NotoSansArabic', re: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/, rtl: true },
  { key: 'hebrew', file: 'NotoSansHebrew', re: /[\u0590-\u05FF\uFB1D-\uFB4F]/, rtl: true },
  { key: 'bengali', file: 'NotoSansBengali', re: /[\u0980-\u09FF]/ }, { key: 'gurmukhi', file: 'NotoSansGurmukhi', re: /[\u0A00-\u0A7F]/ },
  { key: 'gujarati', file: 'NotoSansGujarati', re: /[\u0A80-\u0AFF]/ }, { key: 'oriya', file: 'NotoSansOriya', re: /[\u0B00-\u0B7F]/ },
  { key: 'tamil', file: 'NotoSansTamil', re: /[\u0B80-\u0BFF]/ }, { key: 'telugu', file: 'NotoSansTelugu', re: /[\u0C00-\u0C7F]/ },
  { key: 'kannada', file: 'NotoSansKannada', re: /[\u0C80-\u0CFF]/ }, { key: 'malayalam', file: 'NotoSansMalayalam', re: /[\u0D00-\u0D7F]/ },
  { key: 'sinhala', file: 'NotoSansSinhala', re: /[\u0D80-\u0DFF]/ }, { key: 'thai', file: 'NotoSansThai', re: /[\u0E00-\u0E7F]/ },
  { key: 'lao', file: 'NotoSansLao', re: /[\u0E80-\u0EFF]/ }, { key: 'myanmar', file: 'NotoSansMyanmar', re: /[\u1000-\u109F]/ },
  { key: 'georgian', file: 'NotoSansGeorgian', re: /[\u10A0-\u10FF]/ }, { key: 'ethiopic', file: 'NotoSansEthiopic', re: /[\u1200-\u137F]/ },
  { key: 'khmer', file: 'NotoSansKhmer', re: /[\u1780-\u17FF]/ }, { key: 'armenian', file: 'NotoSansArmenian', re: /[\u0530-\u058F]/ },
];
const RTL = new Set(SCRIPTS.filter((s) => s.rtl).map((s) => s.key));
const files = new Map<string, Buffer>();
const fileOf = (name: string) => files.get(name) ?? files.set(name, readFileSync(new URL(`${name}.ttf`, FONTS))).get(name)!;
const scriptOf = (ch: string) => SCRIPTS.find((s) => s.re.test(ch))?.key ?? 'latin';

/** Runs of text in one script (spaces, digits and punctuation stay with the run they are in), each to get the font with its letters. */
function runs(text: string): { text: string; script: string }[] {
  const out: { text: string; script: string }[] = [];
  for (const ch of text) {
    const script = scriptOf(ch);
    const last = out[out.length - 1];
    if (last && (last.script === script || /[\s\d.,:;()/'"-]/.test(ch))) last.text += ch;
    else out.push({ text: ch, script });
  }
  return out;
}

const MARGIN = 50;

export async function pdf(lines: PdfLine[], opts: { logo?: Buffer | null; size?: keyof typeof PAGES } = {}): Promise<Buffer> {
  const [WIDTH, HEIGHT] = PAGES[opts.size ?? 'A4'];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Only the scripts this document has are embedded (each subset to the letters it uses).
  const all = lines.map((l) => `${l.text} ${l.right ?? ''}`).join(' ');
  const used = new Set(['latin', ...[...all].map(scriptOf)]);
  const f = new Map<string, PDFFont>();
  for (const key of used) {
    const base = key === 'latin' ? 'NotoSans' : SCRIPTS.find((s) => s.key === key)!.file;
    f.set(key, await doc.embedFont(fileOf(`${base}_400Regular`), { subset: true }));
    f.set(`${key}.b`, await doc.embedFont(fileOf(`${base}_700Bold`), { subset: true }));
  }
  const font = (script: string, bold?: boolean): PDFFont => f.get(bold ? `${script}.b` : script)!;
  const width = (text: string, size: number, bold?: boolean) => runs(text).reduce((w, r) => w + font(r.script, bold).widthOfTextAtSize(r.text, size), 0);
  // A line whose first letter is Arabic or Hebrew reads right to left: its runs go from the right edge leftwards (fontkit already
  // orders the letters inside each run). ponytail: one level of direction; a full bidi pass if mixed lines ever print wrong.
  const draw = (page: PDFPage, text: string, x: number, y: number, size: number, bold?: boolean, edge?: number) => {
    const rs = runs(text);
    const first = rs.find((r) => /\p{L}/u.test(r.text));
    if (first && RTL.has(first.script)) {
      let at = edge ?? x + width(text, size, bold);
      for (const r of rs) {
        at -= font(r.script, bold).widthOfTextAtSize(r.text, size);
        page.drawText(r.text, { x: at, y, size, font: font(r.script, bold), color: rgb(0.11, 0.11, 0.13) });
      }
      return;
    }
    for (const r of rs) {
      page.drawText(r.text, { x, y, size, font: font(r.script, bold), color: rgb(0.11, 0.11, 0.13) });
      x += font(r.script, bold).widthOfTextAtSize(r.text, size);
    }
  };
  // Words that do not fit beside the right-hand value wrap onto the next line.
  const wrap = (text: string, size: number, room: number, bold?: boolean): string[] => {
    const out: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && width(next, size, bold) > room) { out.push(cur); cur = word; } else cur = next;
    }
    return [...out, cur];
  };

  let page = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;
  if (opts.logo) {
    const img = await (opts.logo[0] === 0x89 ? doc.embedPng(opts.logo) : doc.embedJpg(opts.logo)).catch(() => null);
    if (img) {
      const s = 56 / Math.max(img.width, img.height);
      page.drawImage(img, { x: WIDTH - MARGIN - img.width * s, y: y - img.height * s + 8, width: img.width * s, height: img.height * s });
    }
  }
  for (const l of lines) {
    if (l.page && y < HEIGHT - MARGIN) { page = doc.addPage([WIDTH, HEIGHT]); y = HEIGHT - MARGIN; }
    if (l.qr) {
      // A QR code, 108 points wide, at the right margin from here down.
      const code = qrcode(0, 'M');
      code.addData(l.qr);
      code.make();
      const n = code.getModuleCount();
      const cell = 108 / n;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (code.isDark(r, c)) page.drawRectangle({ x: WIDTH - MARGIN - 108 + c * cell, y: y - 12 - (r + 1) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
      }
      continue;
    }
    const size = l.size ?? 11;
    const room = WIDTH - 2 * MARGIN - (l.right ? width(l.right, size, l.bold) + 16 : 0);
    const parts = l.rule ? [''] : wrap(l.text, size, room, l.bold);
    const need = (l.gap ?? Math.round(size * 1.5)) + (parts.length - 1) * size * 1.35;
    if (y - need < MARGIN) { page = doc.addPage([WIDTH, HEIGHT]); y = HEIGHT - MARGIN; }
    y -= l.gap ?? Math.round(size * 1.5);
    if (l.rule) { page.drawLine({ start: { x: MARGIN, y: y + size }, end: { x: WIDTH - MARGIN, y: y + size }, thickness: 0.6, color: rgb(0.7, 0.7, 0.74) }); continue; }
    // Centred or at the end, each wrapped line on its own; the default is the start of the line.
    const at = (p: string) => (l.align === 'center' ? (WIDTH - width(p, size, l.bold)) / 2 : l.align === 'end' ? WIDTH - MARGIN - width(p, size, l.bold) : MARGIN);
    parts.forEach((p, i) => draw(page, p, at(p), y - i * size * 1.35, size, l.bold));
    if (l.right) draw(page, l.right, WIDTH - MARGIN - width(l.right, size, l.bold), y, size, l.bold);
    y -= (parts.length - 1) * size * 1.35;
  }
  const pages = doc.getPages();
  if (pages.length > 1) pages.forEach((p, i) => p.drawText(`${i + 1} / ${pages.length}`, { x: WIDTH / 2 - 10, y: 24, size: 8, font: font('latin'), color: rgb(0.5, 0.5, 0.55) }));
  return Buffer.from(await doc.save());
}

/** Sends a document to the browser as a download with its own name. */
export const sendPdf = (reply: FastifyReply, doc: { name: string; data: Buffer }) => {
  void reply.type('application/pdf').header('content-disposition', `inline; filename="${doc.name.replace(/"/g, '')}"`).send(doc.data);
};
