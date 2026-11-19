#!/usr/bin/env node
// The checks a change must pass before it leaves the machine (.githooks/pre-push runs this; `pnpm check` runs it by hand).
// It checks only what the change reaches, so a small change is checked in a minute or two:
//   always                 the naming rules (tools/check-git.mjs) and the former product name
//   TypeScript changed     typecheck and tests of the changed packages and everything that uses them (turbo), the shared-text
//                          catalogue, the migrations
//   the app changed        dart analyze (errors and warnings) and flutter test
//   admin/console changed  the pages it reaches (tools/check-pages.mjs --changed) when the local server is running
// CI runs everything on every pull request; this is so it is green the first time.
import { execFileSync, spawnSync } from 'node:child_process';

const base = process.env.CHECK_BASE ?? 'origin/main';
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } };
const files = [...new Set([...git('diff', '--name-only', `${base}...HEAD`), ...git('diff', '--name-only', 'HEAD')])];
const any = (re) => files.some((f) => re.test(f));
const started = Date.now();
const steps = [];

function run(name, cmd, args, opts = {}) {
  const t = Date.now();
  process.stdout.write(`▸ ${name}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  const secs = Math.round((Date.now() - t) / 1000);
  steps.push(`${r.status === 0 ? '✓' : '✗'} ${name} (${secs}s)`);
  if (r.status !== 0) {
    console.error(`\n${steps.join('\n')}\n\n✗ ${name} failed. Fix it and push again; CI would fail the same way.`);
    process.exit(1);
  }
}

run('naming rules', 'node', ['tools/check-git.mjs', '--base', base]);
run('former product name', 'node', ['tools/check-name.mjs']);
if (any(/^packages\/db\/migrations\//)) run('migrations', 'node', ['tools/check-migrations.mjs', base]);

if (any(/^(apps|packages|tools)\/|^(package\.json|pnpm-lock\.yaml|turbo\.json|tsconfig[^/]*\.json)$/)) {
  // `...[base]`: the packages changed since main and every package that depends on them.
  run('typecheck of what changed', 'pnpm', ['exec', 'turbo', 'run', 'typecheck', `--filter=...[${base}]`, '--output-logs=errors-only']);
  // One package's tests at a time (each runs its own files in parallel): all at once overloaded the machine and timed out.
  run('tests of what changed', 'pnpm', ['exec', 'turbo', 'run', 'test', `--filter=...[${base}]`, '--concurrency=1', '--output-logs=errors-only']);
  if (any(/^(packages|apps\/(admin|console)\/src)\//)) run('shared-text catalogue', 'node', ['tools/i18n-text.mjs', '--check']);
}

if (any(/^(lib|test|assets|packages\/phosphor_flutter)\/|^pubspec\.(yaml|lock)$|^analysis_options\.yaml$/)) {
  if (spawnSync('dart', ['--version'], { shell: process.platform === 'win32' }).status !== 0) {
    console.error('The app changed but dart and flutter are not on PATH: add the Flutter SDK (docs/dev-environment.md) and push again.');
    process.exit(1);
  }
  const t = Date.now();
  process.stdout.write('▸ dart analyze\n');
  const out = spawnSync('dart', ['analyze', 'lib', 'test'], { encoding: 'utf8', shell: process.platform === 'win32' }).stdout ?? '';
  const bad = out.split('\n').filter((l) => /^\s*(error|warning) -/.test(l));
  steps.push(`${bad.length ? '✗' : '✓'} dart analyze (${Math.round((Date.now() - t) / 1000)}s)`);
  if (bad.length) { console.error(`${bad.join('\n')}\n\n✗ dart analyze found errors or warnings.`); process.exit(1); }
  run('flutter test', 'flutter', ['test']);
}

if (any(/^(apps\/(admin|console)\/src|packages\/(web-ui|contracts|config-engine|api-client))\//)) {
  const up = await fetch(`${process.env.API ?? 'http://localhost:4000'}/health`).then((r) => r.ok).catch(() => false);
  if (up) run('pages this change reaches', 'node', ['tools/check-pages.mjs', '--changed']);
  else steps.push('· pages: no local server (bash tools/dev-reset.sh starts one); CI checks every page');
}

console.log(`\n${steps.join('\n')}\n\nReady to push (${Math.round((Date.now() - started) / 1000)}s).`);
