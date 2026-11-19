#!/usr/bin/env node
// The repository's naming rules, checked before a push (.githooks/pre-push) and on every pull request (CI):
//   a branch is <type>/<topic>: a Conventional Commits type, then two to six lowercase words joined by hyphens
//     (fix/fee-receipt-rounding, feat/staff-leave-balances, ci/parallel-page-checks);
//   every commit since main is a Conventional Commit: <type>(<area>): <what changed>, in the imperative, under 100 characters.
// Usage: node tools/check-git.mjs [--branch name] [--base origin/main]
import { execFileSync } from 'node:child_process';

const TYPES = ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'chore', 'ci', 'build', 'style', 'revert'];
const args = process.argv.slice(2);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

// Words that describe the session, not the work (the names that made the history unreadable: one-shot, polish-pass, alive,
// owner-review-17). A branch says what changes: fix/leave-sheet-keyboard, not fix/round-2.
const VAGUE = ['shot', 'pass', 'alive', 'wip', 'misc', 'stuff', 'temp', 'tmp', 'final', 'attempt', 'try', 'yolo', 'magic', 'owner', 'review', 'round', 'batch', 'things', 'changes', 'updates', 'fixes', 'new', 'latest', 'test1', 'v2'];

export const BRANCH = new RegExp(`^(${TYPES.join('|')})/[a-z0-9]+(-[a-z0-9]+){1,5}$`);
export const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+(/[a-z0-9-]+)?\\))?!?: \\S.{2,}$`);

const problems = [];
const branch = val('--branch') ?? process.env.GITHUB_HEAD_REF ?? git('rev-parse', '--abbrev-ref', 'HEAD');
// main itself, and branches GitHub's own bots open, follow their own rules.
if (branch !== 'main' && branch !== 'HEAD' && !/^(dependabot|renovate)\//.test(branch)) {
  if (!BRANCH.test(branch)) {
    problems.push(`Branch “${branch}” is not <type>/<topic>. Use one of ${TYPES.join(', ')}, a slash, then two to six lowercase words joined by hyphens that say what the work is (fix/fee-receipt-rounding). Rename it: git branch -m <new-name>`);
  } else if (branch.split('/')[1].split('-').some((w) => VAGUE.includes(w) || /^\d+$/.test(w))) {
    problems.push(`Branch “${branch}” names the session, not the work (${VAGUE.slice(0, 8).join(', ')}… and bare numbers are not allowed). Say what changes: fix/leave-sheet-keyboard.`);
  } else if (branch.length > 50) {
    problems.push(`Branch “${branch}” is ${branch.length} characters; keep it under 50.`);
  }
}

const base = val('--base') ?? 'origin/main';
let commits = [];
try {
  commits = git('log', '--no-merges', '--format=%h%x09%s', `${base}..HEAD`).split('\n').filter(Boolean);
} catch {
  // No base to compare with (a shallow clone): nothing to check.
}
for (const line of commits) {
  const [sha, subject = ''] = line.split('\t');
  if (!SUBJECT.test(subject)) problems.push(`Commit ${sha} “${subject}” is not a Conventional Commit: <type>(<area>): <what changed> (fix(fees): round receipts to the currency's decimals).`);
  else if (subject.length > 100) problems.push(`Commit ${sha} has a ${subject.length}-character subject; keep it under 100 and put the rest in the body.`);
  else if (/^(\w+)(\(.*\))?!?: (wip|update|changes|fix|stuff|misc|tmp)\b/i.test(subject)) problems.push(`Commit ${sha} “${subject}” does not say what changed.`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Branch ${branch} and ${commits.length} commit${commits.length === 1 ? '' : 's'} follow the naming rules.`);
