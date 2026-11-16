import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { pdf } from '../src/school/pdf.js';

// Documents print every family's name in its own script, embedding only the fonts a document uses.
describe('PDFs in any script', () => {
  it('prints Hindi, Arabic, Tamil, Thai and English names on one receipt', async () => {
    const out = await pdf([
      { text: 'Receipt', size: 18, bold: true },
      { text: 'आरव शर्मा', right: '₹1,200' }, { text: 'ليلى حداد', right: 'AED 450.00' }, { text: 'கவிதா', right: '£12.50' }, { text: 'สมชาย', right: '฿900' },
    ]);
    const doc = await PDFDocument.load(out);
    const fonts = doc.context.enumerateIndirectObjects().map(([, o]) => o).filter((o): o is PDFDict => o instanceof PDFDict && String(o.get(PDFName.of('Type'))) === '/Font')
      .map((o) => String(o.get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, '')).join(' ');
    for (const f of ['NotoSans-Regular', 'NotoSans-Bold', 'NotoSansDevanagari-Regular', 'NotoSansArabic-Regular', 'NotoSansTamil-Regular', 'NotoSansThai-Regular']) expect(fonts).toContain(f);
    expect(fonts).not.toContain('Bengali');
  });
});
