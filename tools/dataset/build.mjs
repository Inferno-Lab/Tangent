// Builds a school's database from the dataset's files the way Tangent's onboarding moves a school in: a new, empty school
// (the starter pack and its principal), then every file through the import engine in the dataset's order. A file with a row
// the import leaves out stops the build with that row's problems, so the dataset and the engine never drift apart quietly.
// Used in-process by the API tests' harness; tools/dataset/load.mjs does the same through the console's HTTP API.
import { commitImport, previewImport } from '../../packages/db/dist/index.js';
import { seedSchool } from '../../packages/db/dist/seed/index.js';
import { schoolContext } from '../../packages/tenancy/dist/index.js';
import { generateSchool } from './school.mjs';

/** A file as the console sends it: CSV and XML as text, anything else (an .xlsx, a MARC file) as a data URL. */
export const asUpload = (f) => (typeof f.content === 'string' ? f.content : `data:application/octet-stream;base64,${Buffer.from(f.content).toString('base64')}`);

/** Imports one file; throws with the first problems when any row would be left out. */
export async function importFile(pool, f, by = 'Onboarding') {
  const input = { kind: f.kind, csv: asUpload(f), fileName: f.name };
  const preview = await previewImport(pool, input);
  const bad = preview.rows.filter((r) => r.errors.length);
  if (preview.missing.length || bad.length) {
    const unmatched = Object.entries(preview.unmatched).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.slice(0, 5).join(', ')}`);
    throw new Error(`${f.name} (${f.kind}): ${preview.missing.length ? `no column for ${preview.missing.join(', ')}; ` : ''}${bad.length} rows left out, e.g. ${bad.slice(0, 3).map((r) => `line ${r.line}: ${r.errors.join(' ')}`).join(' | ')}${unmatched.length ? `; values not in the list: ${unmatched.join('; ')}` : ''}`);
  }
  return commitImport(pool, input, by);
}

/** A new school from the dataset, in an empty, migrated database. `passwordHash` is the principal's (an invite sets it later). */
export async function buildSchool(pool, { today, passwordHash = '!', curriculum = 'CBSE' } = {}) {
  const { manifest, files } = generateSchool({ today });
  const s = manifest.school;
  const p = manifest.people.principal;
  await seedSchool(pool, {
    school: { name: s.name, shortName: s.shortName, tagline: s.tagline, place: `${s.board} · ${s.city}`, phone: s.contactPhone, email: s.contactEmail, address: `${s.address}, ${s.city}`, color: s.color, logoText: s.logoText, language: s.language, country: s.country, timezone: s.timezone, locale: s.locale, currency: s.currency },
    admin: { name: p.name, email: p.email, phone: p.phone, passwordHash }, modules: manifest.modules, data: 'import', curriculum, today,
  });
  for (const [key, value] of Object.entries(manifest.settings)) {
    await pool.query("insert into settings (key, value, updated_by) values ($1, $2, 'Onboarding') on conflict (key) do update set value = excluded.value", [key, JSON.stringify(value)]);
  }
  // In the school's own context, as a request is: its country reads local phone numbers, its zone and money its dates and amounts.
  await schoolContext.run({ zone: s.timezone, locale: s.locale, currency: s.currency, country: s.country }, async () => {
    for (const f of files.filter((x) => x.kind)) await importFile(pool, f);
  });
  return manifest;
}
