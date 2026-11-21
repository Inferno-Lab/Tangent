@AGENTS.md

## Claude Code specifics

- Slash commands live in `.claude/commands/`; project permissions and the hook that reads AGENTS.md's **Work in depth** before every prompt in `.claude/settings.json`. Personal overrides go in `.claude/settings.local.json` (git-ignored).
- Follow **How work ships** in AGENTS.md: branch names, atomic commits, `pnpm check` before every push, merge only on a green CI.
- Prefer the dedicated Read/Edit/Grep tools; shell is for `flutter`, `dart`, `git`, `adb`.
- Ponytail style (smallest complete change, no speculative abstractions) is the house style here; it shortens the change, never the tracing **Work in depth** asks for.
- Platform work (admin, console, backend): read `docs/HANDOFF.md` before starting; design questions go to `docs/DESIGN.md` and `design/README.md`; what is planned and not built is in `docs/one-shot-plan.md` and `docs/one-shot-status.md`. For a page, `node tools/check-pages.mjs --changed` and the flows it touches (`ONLY="…" node tools/e2e-flows.mjs`) while working; the full matrix is CI's. Commit trailer: `Co-Authored-By: Claude`.
- Windows shell traps: prefix `MSYS_NO_PATHCONV=1` when an env value starts with `/`; write big files with the Write tool, not heredocs; run `tools/dev-reset.sh` in the background; the dev servers listen on `localhost`, not `127.0.0.1` (`ADMIN=http://localhost:5173 CONSOLE=http://localhost:5174` for the page checks).
