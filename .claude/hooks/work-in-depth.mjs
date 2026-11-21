// UserPromptSubmit hook: puts AGENTS.md's "Work in depth" section in front of every prompt, so its rule is read on every task.
import { readFileSync } from 'node:fs';
const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const section = agents.match(/^## Work in depth[\s\S]*?(?=\n## )/m)?.[0];
process.stdout.write(section ?? 'AGENTS.md has lost its "Work in depth" section; restore it before doing anything else.');
