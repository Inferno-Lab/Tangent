import { describe, expect, it } from 'vitest';
import { checkCustom, customText, type FieldDef } from './fields.js';
import { COUNTRY_PACKS } from './packs.js';

describe('the school’s own fields', () => {
  const defs: FieldDef[] = [
    { key: 'diet', label: 'Diet', kind: 'choice', options: [{ key: 'veg', name: 'Vegetarian', names: { fr: 'Végétarien' } }] },
    { key: 'clubs', label: 'Clubs', kind: 'multi', options: [{ key: 'chess', name: 'Chess' }, { key: 'art', name: 'Art' }] },
    { key: 'pass', label: 'Bus pass', kind: 'yesno', required: true },
    { key: 'born', label: 'Born on', kind: 'date' },
  ];
  it('reads values as people type them and keeps them by key', () => {
    expect(checkCustom(defs, { diet: 'végétarien', clubs: 'Chess; art', pass: 'oui', born: '2014-02-03' }, true))
      .toEqual({ values: { diet: 'veg', clubs: ['chess', 'art'], pass: true, born: '2014-02-03' }, errors: {} });
  });
  it('names the field that is wrong, and asks for a needed one only on a new record', () => {
    expect(checkCustom(defs, { diet: 'Halal', born: '3 Feb' }, true).errors).toMatchObject({ diet: expect.any(String), born: expect.any(String), pass: expect.any(String) });
    expect(checkCustom(defs, { diet: 'veg' }, false).errors).toEqual({});
  });
  it('checks a country’s ID numbers by their format, whatever spaces and dashes are typed', () => {
    const ids = (COUNTRY_PACKS.AE!['fields.custom'] as { student: FieldDef[] }).student;
    expect(checkCustom(ids, { emirates_id: '784-1990-1234567-1' }, false).errors).toEqual({});
    expect(checkCustom(ids, { emirates_id: '123-4' }, false).errors.emirates_id).toMatch(/15 digits/);
  });
  it('writes a value back in the reader’s language', () => {
    expect(customText(defs[0]!, 'veg', 'fr')).toBe('Végétarien');
    expect(customText(defs[1]!, ['chess', 'art'])).toBe('Chess, Art');
  });
});
