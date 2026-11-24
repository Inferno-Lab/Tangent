# Tangent

Tangent is a school platform with four parts that work together:

| Part | What it is | Where |
| --- | --- | --- |
| **School admin** | The website a school's office and principal use: dashboard, students, attendance, fees, notices, timetable, its classes and calendar, moving in, and the school's own settings on each module's page. | `apps/admin` |
| **Console** | Tangent's own control room: onboard a school, set its modules, configuration and roles, move its data in, roll out releases, watch health and backups, give support, bill, manage the team. | `apps/console` |
| **Backend** | Two NestJS APIs (one for schools, one for the console) in one process, with a PostgreSQL database per school. | `apps/api`, `apps/console-api`, `apps/server`, `packages/*` |
| **Mobile app** | A Flutter app for parents and teachers, and for students and bus drivers where the school turns them on ("Chalk & Glass" look). Built for a school (`SCHOOL` and `API_BASE_URL`), it signs in for real and reads that school's data through the family API (`/v1/f/*`); every build is for a school. | `lib/`, `android/`, `ios/` |

Start here depending on who you are:

- **New developer or coding agent:** [`AGENTS.md`](AGENTS.md) (rules and commands), then [`docs/HANDOFF.md`](docs/HANDOFF.md) (what was built, why, what is left and how to do it).
- **Want to see it running on the internet:** [`docs/deploy-free-test.md`](docs/deploy-free-test.md). The current test deployment is `https://tangent.onrender.com` (admin at `/`, console at `/console/`).
- **The design:** the concept is [`docs/DESIGN.md`](docs/DESIGN.md) and the approved boards are in [`design/`](design/README.md). Everything left and planned, in one place: [`docs/one-shot-plan.md`](docs/one-shot-plan.md).

## How it fits together

```
 Browser: school admin (React)  ─┐                          ┌─ one PostgreSQL database per school
 Browser: console (React)       ─┼─►  apps/server  ─────────┤
 Phone: Flutter app             ─┘   (NestJS, Fastify)      └─ one registry database (the list of schools)
                                      ├─ school API   /v1/*          (tenant chosen by the X-School header)
                                      ├─ console API  /console/v1/*  (Tangent staff only)
                                      └─ serves the admin at / and the console at /console/
```

- **One database per school.** The *registry* database lists schools and holds each school's sealed connection string. A request to `/v1/...` names its school in the `X-School` header; the server looks the school up, opens (or reuses) a connection pool to that school's database and answers from it.
- **Everything configurable lives in data; the school runs its own day.** A school's modules, features, plan limits, settings and locks are layered (platform defaults, plan, school settings, platform locks) and resolved by `packages/config-engine`. The school changes its own settings in the admin (a risky one waits for a second person); Tangent keeps the modules, the plan, the look and the switches that lock an area of the school's data, and can change or lock any setting from the console (with history, rollback and a second approver for risky ones). The school's own data (timetable, classes, terms, holidays, fee structures) stays with the school while the console allows it.
- **Default deny.** Every school route declares the module or feature it belongs to, or says it is core; `apps/api/test/plan.test.ts` fails on any route that does not.
- **Onboarding is a recipe.** The console's wizard collects the school's details, then a *blueprint* (a versioned list of seven steps: database, keys and storage, migrations and defaults, domain, first admin, app build profile, store checklist) creates the school. Each step is retryable and logged. Where it runs (`local`, `free-test`, `aws-cell`) only changes which driver does the step.
- **Risky console actions need a second person** (erase, suspend, push plan changes, run migrations...). Support staff can open a school's admin read-only for 30 minutes with a signed token; the school API refuses every write from it.

## Run it on your computer

Needs Node 24 and pnpm 10 (`corepack enable`). No Docker: a throwaway PostgreSQL is started from an npm package.

```bash
pnpm install
pnpm build                          # once, builds the shared packages
bash tools/dev-reset.sh &           # starts PostgreSQL (port 54329) and the server (4000), and moves Sunrise Valley in from its files; a few minutes
pnpm --filter @tangent/admin dev    # http://localhost:5173/s/sunrise-valley
pnpm --filter @tangent/console dev  # http://localhost:5174
```

There is no demo school and no sample content. The test school is **Sunrise Valley School**, moved in from the files its old
systems wrote ([`docs/test-school.md`](docs/test-school.md): what is in it, where each file comes from, who signs in as whom).

| Where | Address | Credentials |
| --- | --- | --- |
| Console | `http://localhost:5174` | `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` from `.env`, then `DEMO_CODE` (local only) |
| School admin | `http://localhost:5173/s/sunrise-valley` | `principal@sunrisevalley.example` and `TEST_PASSWORD` from `.env`, then the code from the console's Test inbox |
| Phone app | a build with `SCHOOL=sunrise-valley API_BASE_URL=http://10.0.2.2:4000` | a parent's phone (in `.tangent-data/manifest.json`), then the code from the Test inbox |

Every school code is real and random. On a local or test track it lands in the console's **Test inbox** (Integrations → Test inbox).
On the hosted test track (`https://tangent.onrender.com`) the console uses `BOOTSTRAP_PASSWORD` from Render's Environment page and an authenticator app (added at the first sign-in).

In sandbox mode texts and emails land in the console's **Test inbox**, except to the addresses on its allow-list. Email goes out for real through a Brevo (or SES, SMTP, Resend…) connection, phone notifications through Firebase Cloud Messaging, both set in the console's Integrations with no change to the code ([`docs/integrations.md`](docs/integrations.md) has the steps). A real SMS provider (with DLT registration) is the step that lets families without email sign in from anywhere.

Operations: every school is backed up daily and a weekly restore drill puts one back into a scratch database (console → Health). Add an Alerts connection (Slack, Discord or e-mail) under the console's Integrations to hear about new errors, a school not answering, a failed backup or drill.

## Check that nothing is broken

```bash
pnpm typecheck && pnpm test         # types and the unit and API tests (the API tests start a real PostgreSQL)
node tools/check-pages.mjs --full   # every page, 4 widths, light and dark: errors, overflow, clipped text (CI runs this)
node tools/check-pages.mjs --scans all   # adds the layout scans: cut-off text, gaps, fit, scrolling, tight spacing, alignment,
                                         #   long lists and empty states (--popups also opens each page's drawers and dialogs)
node tools/e2e-flows.mjs            # 60 click-through flows in a real browser (run after dev-reset; it changes the school's data)
node tools/e2e-onboard.mjs          # onboards a new empty school through the wizard and screenshots every page
tool/verify.sh                      # Flutter analyzer and tests
```

The page checks and flows look for the admin and console at `127.0.0.1`; if your dev servers listen on `localhost` only (IPv6), run them with `ADMIN=http://localhost:5173 CONSOLE=http://localhost:5174`.

`tools/shot.mjs <url> out.png [width] [height] [--dark] [--console] [--audit] [--do '[...]']` takes one screenshot while signed in, which is how pages are looked at without a window.

## Repository map

```
apps/
  admin/          React school admin (Vite, TanStack Router and Query)
  console/        React console
  api/            school API (NestJS 11 on Fastify)
  console-api/    console API: wizard, provisioning drivers, releases, approvals, health, billing
  server/         runs both APIs in one process and serves the two web apps
packages/
  contracts/      zod schemas and types shared by every app (the API's language)
  config-engine/  modules, plans, layered settings, locks
  db/             reviewed SQL migrations (the schema), the registry's row types, migrator, backups and restore, the import engine, a new school's starter seed, dev PostgreSQL
  security/       scrypt passwords, AES-GCM sealing, JWT
  tenancy/        registry lookup and bounded pool manager
  nest-kit/       shared Nest pieces (errors, validation pipe, exception filter, error reports, alerts, rate limits)
  api-client/     typed HTTP client with token refresh
  web-ui/         the "Nest" design language as React: CSS, shell, sidebar, dialogs, forms, illustrations
design/hue/       Tangent Hue: the approved boards, spec and every empty state (source of truth for how it must look)
lib/              Flutter app (see AGENTS.md for its rules)
tools/            page checks, end-to-end flows, screenshots, the test school's dataset and generators
docs/             architecture, deployment, status and the hand-off guide
render.yaml       the free test deployment (one Render web service)
.github/          CI and the mobile build workflow
```

## Deploying

The free test track is one Render web service plus a free Neon database: [`docs/deploy-free-test.md`](docs/deploy-free-test.md). `render.yaml` describes it, so connecting the repository is enough. Pushing or merging to `main` redeploys it.

## The Flutter app

The app (parents and teachers; Chalk & Glass) lives at the repository root. Every build talks to a school: it refuses to start without `SCHOOL` and `API_BASE_URL`. How to run it, its architecture and rules are in [`AGENTS.md`](AGENTS.md); machine setup is in [`docs/dev-environment.md`](docs/dev-environment.md). In short:

```bash
flutter pub get
flutter run --dart-define=SCHOOL=sunrise-valley --dart-define=API_BASE_URL=http://10.0.2.2:4000   # the local test school (an Android emulator reaches the computer at 10.0.2.2)
```

Families sign in with their phone and the code from the Test inbox; staff with `TEST_PASSWORD` and a code. Students and drivers sign in once the console turns their role on and the admin invites them.
