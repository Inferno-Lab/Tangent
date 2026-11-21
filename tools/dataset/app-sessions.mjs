#!/usr/bin/env node
// Signs the app's people in once, as the app does (client "mobile"; families with a code, staff with the password and a code,
// every code from the Test inbox), and writes their sessions for the app's tests: .tangent-data/app-sessions.json.
// The app's tests then share these sessions instead of each sending codes (five a person in fifteen minutes). Only the access
// token is kept: a refresh token shared by test files running side by side would be replayed, and the school ends all of them.
// Run after tools/dev-reset.sh and right before `flutter test` (an access token lasts fifteen minutes).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API, SCHOOL, familySignIn, manifest, staffSignIn } from './session.mjs';

const { people } = manifest();
const sessions = {
  api: API, school: SCHOOL, people,
  parent: await familySignIn(SCHOOL, people.parentOfTwo, 'mobile'),
  teacher: await staffSignIn(SCHOOL, people.classTeacher, { client: 'mobile', fresh: true }),
  driver: await staffSignIn(SCHOOL, people.driver, { client: 'mobile', fresh: true }),
  // The principal, for what a test needs the school's office to set up first (an open exam, a notice).
  admin: await staffSignIn(SCHOOL, people.principal),
};
const dir = fileURLToPath(new URL('../../.tangent-data/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}app-sessions.json`, JSON.stringify(sessions, null, 1));
console.log(`Signed in the parent, the class teacher, a driver and the principal of ${SCHOOL} for the app's tests.`);
