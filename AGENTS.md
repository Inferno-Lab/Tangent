# Tangent — guide for coding agents and new developers

Tangent is a school platform: a TypeScript backend, a school admin, a console and the Flutter school app (parents, teachers, and students and bus drivers where the school turns them on from the console) in one design system, **Tangent Hue** (`design/hue/`). Admin and console wear it in the **Nest look** (the owner's choice, 14 November 2026): Hue's layouts, parts, icons and empty states, with Nest's warm neutral surfaces, Manrope and Bricolage Grotesque, pill controls, 24px cards, spot illustrations and motion. The Flutter app is always built for a school (`SCHOOL` and `API_BASE_URL`): it signs in and reads the school's data through the family API (`/v1/f/*`, see `docs/API_CONTRACT.md`). Read this file first. It is the single source of truth: `CLAUDE.md` only points here.

Work reaches `main` only through a pull request whose CI is green (see **How work ships** below); the Render test deployment builds from `main`, so a change reaches `https://tangent.onrender.com` only after it is merged. Tangent Hue replaced the older Chalk & Glass (app) and Nest (admin, console) looks; `redesign/chalk-glass` and `apple_glass` remain on GitHub as history.

## Work in depth (every task, whatever its size)

- Before changing anything, find everything the task reaches: read the code it touches and follow the real flow end to end; find every caller, every copy and sibling of that code, and every other place where the same cause or pattern lives.
- Fix the cause once, where all of those meet, and cover every place it shows, not only the one you were shown.
- Cover every state the work can be in: the ones that go wrong as well as the one that goes right, and everyone and every setting it behaves differently for.
- Check each place you changed. Work that covers only the instance in front of you is unfinished: never report it as done. Say plainly what you could not check.
- The size or wording of a request never sets the depth: a short ask gets the same tracing as a long one.

Enforced: Claude Code reads this section before every prompt (`.claude/settings.json`), and a pull request fails CI unless its description says what the change reaches and what was not checked (`.github/pull_request_template.md`, `tools/check-git.mjs`).

## The platform (admin, console, backend) lives next to the app

This repository is also a TypeScript monorepo: `apps/admin` (school admin), `apps/console` (Tangent control room), `apps/api` + `apps/console-api` + `apps/server` (NestJS backend, one PostgreSQL database per school), `packages/*` (contracts, config engine, db, security, tenancy, api-client, web-ui, integrations, nest-kit). **Read [`docs/HANDOFF.md`](docs/HANDOFF.md) first for anything outside `lib/`**: what exists, why it is built that way, how to run and verify it, how it is deployed (`https://tangent.onrender.com`). What is planned and not built yet is in [`docs/one-shot-plan.md`](docs/one-shot-plan.md) and [`docs/one-shot-status.md`](docs/one-shot-status.md). The look of admin and console is in [`docs/DESIGN.md`](docs/DESIGN.md) and the approved boards in [`design/`](design/README.md); both follow [`design/hue/README.md`](design/hue/README.md).

Platform commands (Node 24, pnpm 10):

```bash
pnpm install && pnpm build          # once (also turns on the pre-push hook)
pnpm check                          # what a push runs: the checks for what changed since main (tools/pre-push.mjs)
pnpm typecheck && pnpm test         # every package (API tests share one PostgreSQL and copy ready-made databases)
bash tools/dev-reset.sh &           # local PostgreSQL + server + Sunrise Valley, moved in from its files (run in the background)
pnpm --filter @tangent/admin dev    # http://localhost:5173/s/sunrise-valley
pnpm --filter @tangent/console dev  # http://localhost:5174
node tools/check-pages.mjs          # every page at 390 and 1440, in parallel: errors, overflow, clipping (--changed: what changed;
                                    #   --full: 4 widths × light/dark, as CI; --scans all: gaps, fit, cutoff, scroll, tight, align, long, empty;
                                    #   --popups: also opens each page's drawers and dialogs and checks inside them)
node tools/e2e-flows.mjs            # 60 browser flows (re-run dev-reset first; it changes data; ONLY="text" runs some)
```

### Platform rules that have bitten us

**Settings and data**
- **The school runs its own day; Tangent keeps what is paid for, risky or technical.** Every setting is the school's, edited in the admin on the page of the module it changes (`PATCH /v1/settings`; a risky one waits for a second person in Approvals), except `TANGENT_SETTINGS` in `packages/contracts/src/settings-meta.ts` (the look, the country and currency, and the `*.schoolEdits` switches that lock an area of the school's data). Tangent can change or lock any setting from the console, and a lock on a `TIGHTEN` setting is a floor the school may only make stricter.
- A new setting goes into `SchoolSettingsSchema` and `SETTINGS_META` (the admin and the console render it with no new screen) and is marked `notUsedYet` until something acts on it.
- Every school API route declares its module or feature with `@RequireModule('fees')` / `@RequireModule('fees.onlinePayment')` or says `@Core()` (default deny; `apps/api/test/plan.test.ts` fails otherwise); a new module or feature goes into `MODULES` in `config-engine` first.
- A module's data comes in through the one import engine (its kind in `IMPORT_KINDS`, an `Impl` in `packages/db/src/import/kinds.ts`, HANDOFF §15), never a separate importer; a column with fixed values lists them in `options` (the template's dropdown) and checks against the same constant.
- Never edit an applied SQL migration: add a new file (CI checks). The migrations are the schema; there is no ORM schema to keep in step for a school's database.

**Build and shell**
- Declare build-time env in `turbo.json`; `apps/server` imports the API packages from `dist/` (rebuild after changing them).
- The menu, search and dock are mounted once by each app's signed-in layout (`app/Layout.tsx`): a page renders in `PageScope` and reads the shell with `useShellChrome()`, never `Shell` or `useChrome`.

**Pages** (`packages/web-ui/src/rules.test.ts` fails on each of these)
- Build only from `@tangent/web-ui` parts (the owner reviews design, so a page without a canvas board has nothing else): `Select` (never a bare `<select>`), `Menu`/`MenuButton`/`Pop` for anything that opens from a button, `Dialog`, `Panel`, `ToastSlot`, `Segmented`, the fields (`DateField`, `TimeField`, `MonthField`, `NumberField`, `ColourField`, `Checkbox`, `FilePick`: no browser widgets), `data-tip` for every tooltip (never `title=`), `data-even`/`data-even-scroll` on side-by-side columns (`EvenRows`). Shared controls belong in `packages/web-ui/src/blocks.css` (`pages.css` only loads on pages built with `Page`); check new CSS class names against `nest.css`.
- **Every colour is a token the console can change**: no hex, `rgb()` or `white` in a page (`var(--ink)`, `var(--on-deep)`, `color-mix(in srgb,var(--on-deep) 14%,transparent)`…); every colour comes from the school's one hue through `packages/contracts/src/hue.ts` (after changing it run `node tools/gen-hue.mjs`). Type, radii and spacing come from the Hue scales (`design/hue/base.css`); boarded pages render the board's parts (`hue-parts.css`, inside `.hb`); icons come from `<Icon>`.
- **Everything that can be empty has an animated empty state**: `<EmptyState scene>` for a page or tab, `<EmptyNote>` inside a card, `<EmptyCard>` for a card of its own; never a bare line of text saying "No …"; check it on a brand-new school. A page or tab with nothing in it gets its own scene (a new module draws one on a board in `design/hue/src/EmptyAdmin*.html`, `node design/hue/build.mjs`) and a page icon in `design/hue/icon-map.mjs`, never the dashboard grid.
- A welcome or tip that is not an empty list can be closed (`onClose`) and stays closed (`tips.hidden`). Toasts are timed by `useToast()` and every one closes itself (an error after 8 s).
- A list that can grow past about 25 rows scrolls inside its card (`.lscroll`) or shows a page at a time (`useMore`); a server-paged list keeps Newer/Older under it. A table row (`.rw`) has a fixed height, so a wrapping row needs `height:auto`. Never stretch a card to fill space.
- A popup locks the page under it and its scrim dims without a blur (a blur repaints the page on every scroll). Wrap a conditionally shown overlay in `<Presence>` so it fades out. Time every motion with `--t1/2/3` (120/200/300 ms), never a literal duration.
- Every field, select and button is 42px tall, so a row of them lines up; a select in a row fits its longest choice (`SelectField fit`).
- Check the pages a change reaches (`node tools/check-pages.mjs --changed`, with `--scans cutoff` for text that is cut off) and the flows it touches.

**Third parties and background work**
- **Every third party goes through the Integrations Hub** (`packages/integrations`, `docs/integrations.md`): send messages with `Messenger.send`/`notify` (never insert into `sandbox_messages` or call a provider directly), reach storage, payments and maps with `hub.resolve(capability, schoolId, slug)`, and add a provider as a `ProviderDef` plus an adapter.
- Background work per school is a `job_queue` kind (`enqueue`, a handler registered with `HubService.handle`).

## Commands

```bash
flutter pub get
tool/verify.sh                     # analyze + every app test (the ones tagged `school` read the local school; pnpm check runs them)
flutter test test/some_test.dart   # one file
flutter run --dart-define=SCHOOL=sunrise-valley --dart-define=API_BASE_URL=http://10.0.2.2:4000   # the local test school
flutter run --dart-define=ASSISTANT=true    # turns on the (planned) assistant feature flag
flutter build apk --release --target-platform android-arm64,android-arm
```

Headless screenshots (no emulator needed; they look the same as on a device, since glass is a solid fill):

```bash
flutter test test/tool/shoot_test.dart --dart-define=SHOOT_DIR=D:/out --dart-define=SHOOT_ROLE=parent
#   SHOOT_ROLE=parent|teacher|guest   SHOOT_DARK=true   SHOOT_W=390 SHOOT_H=844   (reads the local school: dev-reset, then app-sessions)
#   SHOOT_POPUPS=true: also opens every sheet, dialog and toast by its real button, and shoots each again with a keyboard up
```

Release builds come from the console's build workflow (`.github/workflows/mobile-build.yml`), which sets `SCHOOL` and `API_BASE_URL`; a build without both refuses to start. See `docs/dev-environment.md` for machine setup and build pitfalls.

## Architecture in one screen

```
View (GetView/StatelessWidget)  →  Controller (GetxController + Loadable)  →  Repository  →  RemoteDataSource → ApiClient
```

- `lib/core/` shared infrastructure: `bindings/` (DI), `config/app_config.dart` (flags), `routes/`, `services/` (auth, storage, theme, session bus), `theme/`, `translations/`, `utils/`, `widgets/` (design system).
- `lib/data/` `models/`, `repositories/` (one class per area that calls the family API; `AssistantRepository` alone is an interface, the seam for a model provider), `datasources/`.
- `lib/features/<feature>/` `views/` and `controllers/` (and `widgets/` when a feature has reusable pieces). A view never talks to a repository; a controller never builds widgets.
- `InitialBinding` registers every repository; the tests' harness (`test/support/harness.dart`) does the same against the local school.
- Live updates (chat, notifications, the bus) come from one SSE stream, `core/services/live_stream.dart` (`GET /v1/f/stream`); a controller mixes in `LiveListen` instead of polling. The driver's phone shares the bus position (`geolocator`).
- `Loadable` gives a controller `state` (loading/success/empty/error), `run(...)`, and auto-reload when the `SessionBus` bumps (after a write, or a push) or the active child changes.
- Barrels: `core/widgets/ui.dart` re-exports `ui/*`; `teacher_tools_view.dart` re-exports the teacher screens. Import the barrel, put code in the part.

Details: `docs/architecture.md`. How to add a screen, a repository, or an AI feature: `docs/adding-a-feature.md`. Design rules and tokens: `docs/design-system.md`. HTTP shapes: `docs/API_CONTRACT.md`.

## Rules that have bitten us (follow them)

1. **Translations.** All user-visible text goes through keys in `lib/core/translations/` (`'area.key'.tr`). Parameters use **`.trp({'name': value})`**, never `.trParams` (GetX replaces key prefixes, so `@n` eats `@name`). Every other language falls back to English; add `en` first. `test/translation_keys_test.dart` fails on any literal key that is missing. Keys passed as widget parameters (`emptyTitle: 'x.y'`) are translated inside the widget, so they are not checked: double-check them.
2. **Never run repo-wide `dart fix --apply` or `dart format .`, and do not run `dart format` on a file you only touched in a few lines.** The code is hand-formatted to about 120 columns; the formatter's default is 80, so it rewraps whole files and buries your change in noise (it rewrote unrelated files and broke types once). Match the surrounding style by hand. Remove unused imports in the files you touched only.
3. **No empty screens.** Every list or collection screen must handle the "brand-new school" case with `ViewStateView(emptyArt:, emptyTitle:, emptyBody:, emptyHint:, emptyActions:)` and an `EmptyArt` illustration, in friendly copy that says what will appear and what the user can do. Check on a brand-new school (the console's new-school wizard, started empty).
4. **Glass is a solid floating surface, for floating controls only** (dock, top icon buttons, pills, sheets, toast, bottom action bars). It blurs and refracts nothing: a filled, shadowed surface (paper on the page, brand ink with `onPigment`), so it costs nothing to scroll and reads the same in every theme. Never put a glass block behind page content such as a header, a card, or a greeting; never nest one `Glass` inside another or inside an `Opacity`/fade. Use `Glass`, `GlassIconButton`, `GlassSegmented`, `GlassSwitch`, `GlassSlider` from `core/widgets/`; do not draw your own. Text on it is ink, white only with `onPigment: true` (on colourful art). **Never cover content with page-coloured fade bands** near floating controls (in dark themes they read as black shadows; only the thin status-bar scrim in `PageFrame` is allowed). Check floating controls over colourful art, scrolled, and in **dark mode** (the owner uses dark).
5. **Layout traps we hit**: `Container(alignment:)` expands to fill its parent. A `Row` without `crossAxisAlignment: stretch` gives a 0-height `ColoredBox`. A `Column` in a loose-height parent needs `mainAxisSize: min`. A `Column` with default centre alignment will float a shrink-wrapped child to the middle (use `stretch`). `Obx` with no observable read inside throws. Labels next to chips need `Expanded`/`Flexible` plus a gap and `ellipsis`.
6. **There is no dummy data.** Everything runs against Sunrise Valley School, a mid-year school moved in from the files its old systems wrote (`docs/test-school.md`, `tools/dataset`). A screen is checked on its real records and on a brand-new school's empty ones; the app's tests read the local school (`bash tools/dev-reset.sh`, then `node tools/dataset/app-sessions.mjs`). Do not add artificial delays.
7. **Do not add dependencies for a few lines of code.** `phosphor_flutter` is vendored under `packages/` on purpose.
8. **Sign-out** goes through `AuthService.signOut()` (clears the session, navigates to login first, then clears state). Do not clear state before navigating.
9. **Overlays need a Material.** Anything mounted above the Navigator (toasts) must sit in a `Material(type: MaterialType.transparency)` or its text gets the debug double underline.
10. **Screens that reorder after an action** must hold their position until the next load (the featured event card swapped to another event on the first RSVP, hiding the answer). Pin the choice in the controller.
11. **Any day of the week must work.** The test school is open Monday to Saturday with its own holidays (`weeklyOffDays` in `core/utils/schedule.dart`); never assume "today" has lectures, and a test never depends on the day it runs. Filters go under the page title, not in a bottom bar.
12. **GetX controller lifetime.** A controller registered with `Get.lazyPut` is deleted when the route that created it is popped. A screen that is both a tab and a pushed route (Fees, Notices, Homework, Events...) then threw "FeesController not found" and rendered blank in release (Home → Pay → back → Fees tab). Every `lazyPut` in `app_pages.dart` uses `fenix: true` so a deleted controller is rebuilt on the next `Get.find`; keep it that way for new routes. Verify any new tab/route pair by opening it both ways on a device.
13. **Pull to refresh** goes through `PageFrame(onRefresh:)` or, on a page that draws its own frame (Home), `PullToRefresh`: one whole circle in the empty centre of the top row. Search opens from its button in Home's header, never from a pull.
14. **Performance**: tabs are lazy (`LazyIndexedStack`); keep per-screen glass to the few floating controls; avoid animating layout; `Rise` stagger is capped. Release builds are what you judge speed on, not debug.
15. **The design system is enforced** (`test/design_rules_test.dart`, `docs/design-system.md`): colours from `context.app` / `AppColors` / `AppPalette` (the school's hue from the console, never `Color(0x…)` in a screen), text from a role (`context.type.<role>` or `AppText.<role>`, never `hueText()`, `fontSize:` or `fontWeight:` in a screen), timing from `AppMotion` and the curve tokens, radii and spacing on their scales, taps through `Pressable`. Counts use `'key'.trn(n)` with a `_one` key for the singular.

## Conventions

- Dart: `very_good_analysis` (see `analysis_options.yaml`). `dart analyze lib test` must show no errors or warnings. Prefer small, focused files; a view file over ~500 lines should be split by screen or sheet.
- Controllers live in `controllers/`, never inside a view file. Shared helpers that two files need become public and move next to the controller or into `core/utils`.
- Comments say *why*, one line. Mark a deliberate limit with `// shortcut: <the limit>, <when to upgrade>`.
- Visual changes: look at them (a headless shot at minimum). Light, dark, AMOLED; small phone (360×640), phone (390×844), tablet (≥ 840 wide).
- Test accounts: no demo accounts exist. Sunrise Valley's staff sign in with `TEST_PASSWORD` and the code from the console's Test inbox; families with their phone and that code (`docs/test-school.md`, people in `.tangent-data/manifest.json`). Students and drivers sign in only when the console turns their role on (`app.roles`); the admin invites them (Students → On the app; a staff member set as a route's driver).

## Where things are

| I want to… | Look at |
| --- | --- |
| change colours, type, spacing | `core/theme/` (`tokens.dart`, `app_colors.dart`, `app_typography.dart`) |
| add or edit copy | `core/translations/en_redesign.dart` (redesign copy), `app_translations.dart` |
| add a route | `core/routes/app_routes.dart` + `app_pages.dart` (and a `Binding` if the controller is not on the shell) |
| add test content | `tools/dataset/school.mjs` (`docs/test-school.md`) |
| toggle a feature | `core/config/app_config.dart` |
| change glass | `core/widgets/glass.dart` (a solid fill) |
| change the frame (deep header, sheet) | `core/widgets/page.dart` (`PageFrame`), `dock.dart` |
| make an empty state | `core/widgets/states.dart`, `empty_kit.dart` |
| see all the building blocks | design-system screen (Settings → About → long-press the version row) |

## How work ships (every agent and every developer)

These rules are checked by tools, not by memory: `tools/check-git.mjs` and `tools/pre-push.mjs` before a push, CI on the pull
request, and GitHub's branch rule on `main`.

- **One branch per piece of work**, cut from the latest `main`, named `<type>/<topic>`: the type is a Conventional Commits type
  (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`, `build`, `style`, `revert`); the topic is two to six lowercase
  words that say what changes: `fix/leave-sheet-keyboard`, `feat/staff-leave-balances`, `ci/parallel-page-checks`. Never a
  session, a person, a round or a number (`one-shot`, `polish-pass`, `owner-review-17`, `design/alive`). Delete it once merged.
- **Commit atomically and regularly**: each self-contained step (a fix, a refactor, a test, a doc) is committed as soon as it
  works, not saved up for one commit at the end. A commit is a Conventional Commit, `<type>(<area>): <what changed>` in the
  imperative, under 100 characters, with the why in its body. Refactors apart from behaviour changes. A generated file (the text
  catalogues, `assets/i18n/en.json`) goes in the same commit as the source that changes it.
- **Checks come in three tiers.** While working: the narrowest check for what you touched (one test file, `ONLY="…"` flows,
  `node tools/check-pages.mjs --changed`). Before every push: `pnpm check`, which the pre-push hook runs; it checks only what the
  change reaches (minutes, not the hour the full suite used to take). On the pull request: CI runs everything, five jobs side
  by side. CI confirms; it is not where you find out whether something works.
- **Push only what passed `pnpm check`.** `git push --no-verify` is for a docs-only change when the checks cannot run, never to
  get a red change out. Nothing is pushed to `main`: every change is a pull request.
- **The pull request says what the change reaches and what was not checked** (its template's sections; CI fails without them).
- **Merge only on a green `CI passed`**, never while a check is red or still running. When `main` turns red, fixing it comes
  before any other work.
- **A flaky check is a bug**, fixed or removed the day it shows, never retried until it passes. Flows find an element by role
  with `exact: true` or inside its dialog; tests never depend on row order or on today's date and time.
- **Do the work you report.** Say what you checked and what you did not (a real device, other roles, other themes), with the
  numbers the tools printed.
- **A cleanup never removes or moves what is planned.** Code, settings, flags, docs and notes that stand for a feature not built
  yet stay where they are; only what is dead (nothing uses it and nothing plans it) goes.

## Working with agents on this repo

- Start from this file; open `docs/` only for the area you touch.
- Slash commands in `.claude/commands/`: `/verify`, `/audit-ui`, `/shoot`, `/new-screen`, `/new-repository`, `/new-admin-page`, `/new-ai-feature`.
- Parallel sessions: one writer per set of files; use a worktree per session. Never edit `tools/dataset/school.mjs` and `en_redesign.dart` from two sessions at once (merge hot-spots).
