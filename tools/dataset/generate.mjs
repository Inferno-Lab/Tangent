#!/usr/bin/env node
// Writes the dataset's files to a folder, to load by hand in the console (school → Migration) and the admin (Moving in), the
// way a school's files arrive. manifest.json says what each file is, who the people to sign in as are, and what it all adds
// up to. Usage: node tools/dataset/generate.mjs [--out ./sunrise-valley] [--today 2026-11-20]   (build packages/db first)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateSchool } from './school.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const out = path.resolve(arg('out', './sunrise-valley'));
const { manifest, files } = generateSchool({ today: arg('today', undefined) });
for (const f of files) {
  mkdirSync(path.dirname(path.join(out, f.name)), { recursive: true });
  writeFileSync(path.join(out, f.name), f.content);
}
writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} files for ${manifest.school.name} to ${out}. Import them in their numbered order; manifest.json says what each one is.`);
