#!/usr/bin/env node
// The app-store kit for one school's app (docs/one-shot-plan.md §5.3.4): Apple's App Privacy answers, Google Play's Data safety
// answers, and the review notes with a demo account for the reviewers. Written from the one list below of what the app
// collects; change the list when the app changes, never the outputs by hand. The build workflow runs it per school.
// Usage: node tools/store-kit.mjs --school "Sunrise Valley School" [--out store] [--demo-user reviewer@example.org --demo-code 424242]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const school = arg('school', '');
if (!school) throw new Error('Name the school: --school "Sunrise Valley School".');
const out = path.resolve(arg('out', 'store'));
const demoUser = arg('demo-user', process.env.STORE_DEMO_USER ?? '');
const demoCode = arg('demo-code', process.env.STORE_DEMO_CODE ?? '');

// What the app collects, why, and whether it is tied to the person. Nothing is used for tracking or advertising, sold or
// shared with data brokers; everything goes only to the school's own server (and its providers, as processors).
const COLLECTED = [
  { what: 'Name', apple: 'Name', google: 'Personal info: Name', why: 'App functionality', linked: true, required: true, note: 'The account: a parent, student, teacher or bus driver of the school.' },
  { what: 'Email address', apple: 'Email Address', google: 'Personal info: Email address', why: 'App functionality', linked: true, required: false, note: 'Signing in and messages from the school.' },
  { what: 'Phone number', apple: 'Phone Number', google: 'Personal info: Phone number', why: 'App functionality', linked: true, required: true, note: 'Signing in with a code, and messages from the school.' },
  { what: 'Photos', apple: 'Photos or Videos', google: 'Photos and videos: Photos', why: 'App functionality', linked: true, required: false, note: 'Only photos the person chooses to send: homework, leave notes, chat, a profile photo.' },
  { what: 'Messages', apple: 'Other User Content', google: 'Messages: Other in-app messages', why: 'App functionality', linked: true, required: false, note: 'Conversations with the school.' },
  { what: 'Precise location', apple: 'Precise Location', google: 'Location: Precise location', why: 'App functionality', linked: true, required: false, note: 'Bus drivers only, and only while a trip runs, so families see the bus.' },
  { what: 'Crash logs', apple: 'Crash Data', google: 'App info and performance: Crash logs', why: 'App functionality', linked: false, required: false, note: 'The error and the app version, to fix crashes. No personal data.' },
  { what: 'Device ID (push token)', apple: 'Device ID', google: 'Device or other IDs', why: 'App functionality', linked: true, required: false, note: 'To deliver the school\'s notifications to this phone.' },
];

const apple = {
  school, tracking: false, trackingDomains: [],
  dataTypes: COLLECTED.map((c) => ({ type: c.apple, purposes: [c.why], linkedToUser: c.linked, usedForTracking: false })),
};
const google = [
  ['Data type', 'Collected', 'Shared', 'Ephemeral', 'Required', 'Purposes'],
  ...COLLECTED.map((c) => [c.google, 'Yes', 'No', 'No', c.required ? 'Required' : 'Optional', c.why]),
];
const csv = (rows) => rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
const notes = [
  `# Review notes: ${school}`,
  '',
  `This is ${school}'s own app, for its families, students and staff. Accounts are created by the school; there is no`,
  'public sign-up. Nothing is sold or used for advertising; data stays with the school.',
  '',
  '## Signing in for review',
  demoUser ? `Use **${demoUser}** and the code **${demoCode || '(sent to the reviewer account)'}** on the sign-in screen.` : 'Set --demo-user and --demo-code: the reviewer account the school made on its demo content.',
  '',
  '## What the app collects',
  ...COLLECTED.map((c) => `- **${c.what}** (${c.required ? 'needed' : 'optional'}): ${c.note}`),
  '',
  '## Permissions',
  '- Camera and photos: only when the person adds a photo (homework, leave, chat, profile).',
  '- Location: only for a bus driver while a trip runs; families never share theirs.',
  '- Notifications: the school\'s messages (attendance, fees, notices).',
  '',
  '## Account deletion',
  'Settings → Privacy → "Ask to delete it" sends a deletion request to the school, which answers it; Withdraw my consent stops',
  'the school using the data the law does not require it to keep.',
];

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'apple-app-privacy.json'), `${JSON.stringify(apple, null, 2)}\n`);
writeFileSync(path.join(out, 'google-data-safety.csv'), `${csv(google)}\r\n`);
writeFileSync(path.join(out, 'review-notes.md'), `${notes.join('\n')}\n`);
console.log(`Wrote the store kit for ${school} to ${out}: apple-app-privacy.json, google-data-safety.csv, review-notes.md`);
