@AGENTS.md

## Claude Code specifics

- Slash commands live in `.claude/commands/`; project permissions in `.claude/settings.json`. Personal overrides go in `.claude/settings.local.json` (git-ignored).
- Follow **How work ships** in AGENTS.md: branch names, atomic commits, `pnpm check` before every push, merge only on a green CI. Report what you did not check (a real device, other roles, dark mode).
- Do not run `dart fix`/`dart format` over the repo (or over files you barely touched): the code is hand-formatted at ~120 columns and the formatter rewraps at 80.
- Prefer the dedicated Read/Edit/Grep tools; shell is for `flutter`, `dart`, `git`, `adb`.
- Ponytail style (smallest complete change, no speculative abstractions) is the house style here.
- Platform work (admin, console, backend): read `docs/HANDOFF.md` before starting, design questions go to `docs/DESIGN.md` and `design/README.md`, what is planned and what is left is in `docs/one-shot-plan.md`. For a page, `node tools/check-pages.mjs --changed` and the flows it touches (`ONLY="…" node tools/e2e-flows.mjs`) while working; the full matrix is CI's. Commit trailer: `Co-Authored-By: Claude`.
- Windows shell traps: prefix `MSYS_NO_PATHCONV=1` when an env value starts with `/`; write big files with the Write tool, not heredocs; run `tools/dev-reset.sh` in the background.
