import { describe, expect, it } from 'vitest';
import { formatMessage, languageDir, makeT, pluralCategory, wordsFor } from './i18n.js';

describe('messages in any language', () => {
  it('fills values, and leaves a missing one showing', () => {
    expect(formatMessage('Hello {name}, {missing}', { name: 'Sam' })).toBe('Hello Sam, {missing}');
  });

  it('counts the way each language does', () => {
    const msg = '{n, plural, =0 {No books} one {# book} other {# books}}';
    expect([0, 1, 2].map((n) => formatMessage(msg, { n }))).toEqual(['No books', '1 book', '2 books']);
    // Arabic has six plural forms: 3 is "few", 11 is "many".
    expect([pluralCategory('ar', 0), pluralCategory('ar', 2), pluralCategory('ar', 3), pluralCategory('ar', 11)]).toEqual(['zero', 'two', 'few', 'many']);
    const ar = '{n, plural, zero {لا كتب} one {كتاب واحد} two {كتابان} few {# كتب} many {# كتابًا} other {# كتاب}}';
    expect(formatMessage(ar, { n: 3 }, 'ar')).toBe('3 كتب');
  });

  it('chooses by value, and nests', () => {
    const msg = '{who, select, parent {Your child has {n, plural, one {# notice} other {# notices}}} other {You have {n} notices}}';
    expect(formatMessage(msg, { who: 'parent', n: 1 })).toBe('Your child has 1 notice');
    expect(formatMessage(msg, { who: 'teacher', n: 4 })).toBe('You have 4 notices');
  });

  it('uses the school’s own words, in the case the sentence needs', () => {
    const words = wordsFor('en', { en: { student: { one: 'Pupil' }, admissionNumber: { one: 'UPN' }, class: { one: 'Form', many: 'Forms' } } });
    expect(formatMessage('{@Students} in this {@class}: add a {@student} or check the {@admissionNumber}', {}, 'en', words))
      .toBe('Pupils in this form: add a pupil or check the UPN');
    expect(words.classes).toBe('Forms');
    expect(wordsFor('en', undefined).guardians).toBe('parents');
  });

  it('falls back to English for a key a language does not have yet, and to the key itself last', () => {
    const t = makeT('fr', { 'a.hi': 'Bonjour {name}' }, { 'a.hi': 'Hello {name}', 'a.bye': 'Goodbye' });
    expect([t('a.hi', { name: 'Léa' }), t('a.bye'), t('a.none')]).toEqual(['Bonjour Léa', 'Goodbye', 'a.none']);
    expect(makeT('de', {}, { n: '{n} items' })('n', { n: 12000 })).toBe('12.000 items');
  });

  it('knows which languages read right to left', () => {
    expect(['ar', 'ur', 'he', 'en', 'hi'].map(languageDir)).toEqual(['rtl', 'rtl', 'rtl', 'ltr', 'ltr']);
  });
});

describe('dates for a reader', () => {
  it('uses the school’s locale in its own language, the reader’s language in the school’s region otherwise', async () => {
    const { readingLocale } = await import('./i18n.js');
    expect([readingLocale('en', 'en-IN', 'IN'), readingLocale('ar', 'en-AE', 'AE'), readingLocale('hi', 'en-IN', 'IN')]).toEqual(['en-IN', 'ar-AE', 'hi-IN']);
  });
});

describe('shared data in the reader’s language', () => {
  it('translates labels, help and options as they are read, and leaves keys and values alone', async () => {
    const { localized, localizedLabels, rawOf, setTextSource, tx } = await import('./i18n.js');
    const data = localized({ 'a.b': { group: 'People', label: 'Houses', help: 'Up to {n}', options: [['x', 'Red']] as [string, string][] } });
    const labels = localizedLabels({ present: 'Present' });
    setTextSource(() => ({ lang: 'fr', cat: { Houses: 'Maisons', 'Up to {n}': 'Jusqu’à {n}', Red: 'Rouge', Present: 'Présent' } }));
    try {
      expect([data['a.b'].label, data['a.b'].group, data['a.b'].options[0], labels.present, tx('Up to {n}', { n: 3 })]).toEqual(['Maisons', 'People', ['x', 'Rouge'], 'Présent', 'Jusqu’à 3']);
      expect(rawOf(data)['a.b'].label).toBe('Houses');
      expect(tx('Not translated yet')).toBe('Not translated yet');
    } finally { setTextSource(() => undefined); }
  });
});
