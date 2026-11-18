import { describe, expect, it } from 'vitest';
import { AdmissionStages, DEFAULT_ADMISSION_STAGES, gradeChoices, stageName } from './admissions.js';

describe('a school’s own admission stages', () => {
  it('reads a list saved before stages were its own, and keeps the start and the end for itself', () => {
    expect(AdmissionStages.parse(['applied', 'offer']).map((s) => s.key)).toEqual(['applied', 'offer']);
    expect(AdmissionStages.parse(['offer'])[0]).toMatchObject(DEFAULT_ADMISSION_STAGES[2]!);
    expect(AdmissionStages.safeParse([{ key: 'enrolled', name: 'Done' }]).success).toBe(false);
    expect(AdmissionStages.safeParse([{ key: 'visit', name: 'Visit' }, { key: 'visit', name: 'Again' }]).success).toBe(false);
    expect(stageName([{ ...DEFAULT_ADMISSION_STAGES[0]!, names: { fr: 'Dossier reçu' } }], 'applied', 'fr')).toBe('Dossier reçu');
  });
  it('names grades the school’s way, from its classes', () => {
    expect(gradeChoices([{ grade: 8, name: '8 A', section: 'A' }, { grade: 8, name: '8 B', section: 'B' }, { grade: -1, name: 'Nursery Rose', section: 'Rose' }]))
      .toEqual([{ value: -1, name: 'Nursery' }, { value: 8, name: '8' }]);
  });
});
