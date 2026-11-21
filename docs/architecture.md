# Architecture

## Layers and what each may know

| Layer | Lives in | May use | Must not |
| --- | --- | --- | --- |
| View | `features/*/views`, `core/widgets` | its controller, design-system widgets, `.tr` | call a repository, hold business logic |
| Controller | `features/*/controllers` | repositories, services, `Loadable` | build widgets, read `BuildContext` (toasts and routes go through helpers) |
| Repository | `data/repositories` | a data source | know about GetX state or widgets |
| Data source | `data/datasources` | `ApiClient` | be called from a controller |

Each repository file holds the **interface** and the **Remote** adapter for one area (`academic`, `campus`, `directory`, `auth`, `assistant`). Controllers depend on the interface; the tests run the same Remote adapters against the local test school.

## Data flow of a screen

1. A route in `app_pages.dart` creates the controller (a `Binding`, or the shell binding for tab screens).
2. `Loadable.onInit` calls `load()`; `run(...)` flips `state` between loading, success, empty and error. `isEmpty:` decides when the empty design shows.
3. The view reads `controller.state` in an `Obx` and hands it to `ViewStateView`.
4. A write (pay, send, submit) goes through the repository and bumps `SessionBus.revision`, and every open `Loadable` controller reloads itself; a push or a live event does the same.
5. Changing the active child (`AuthService.activeStudentId`) reloads them as well.

## Dependency injection

`lib/core/bindings/initial_binding.dart` registers repositories lazily (`fenix: true`, so they rebuild after a `Get.delete`). Every repository is its Remote adapter. Tests build their own graph in `test/support/harness.dart` (`bootLive` against the local school, `bootApp` for widgets that read nothing).

## Feature switches

`AppConfig` is the only place for them: `assistantEnabled` (compile-time, `--dart-define=ASSISTANT=true`). A school build profile can change per-school values (name, tagline, logo). Anything user-facing that is unfinished sits behind a flag until its screen and backend exist.

## Roles

`UserRole` is student, parent or teacher. The shell (`features/shell`) picks tabs by role: families get Home / Academics / Fees / Chat / Profile; teachers get Home / Classes / Notices / Chat / Profile. Chat threads are stored from the family's side; `threadForMe` swaps the title for the person it names.

## Navigation

GetX named routes (`AppRoutes`). Tab switching from inside a screen: `ShellController.showTab(ShellController.chatTab)`. Sign-out: `AuthService.signOut()`.

## Platform pieces

- `Glass` (`core/widgets/glass.dart`) is a solid floating surface. See `docs/design-system.md` → Glass.
- Android: adaptive icon, Android 12 splash styles in `values-v31`, `kotlin.incremental=false` in `gradle.properties` (cross-drive builds).

## The platform around the app

This file describes the Flutter app. The rest of the repository is a TypeScript platform: school admin (`apps/admin`), console (`apps/console`), school API and console API (`apps/api`, `apps/console-api`) run together by `apps/server`, and shared packages. How it is built and why: `docs/HANDOFF.md`; the look: `docs/DESIGN.md`; every feature and what is planned: `docs/one-shot-plan.md`.

```
 admin (React)  ─┐
 console (React) ┼─►  apps/server ─►  school API (/v1, tenant by X-School)  ─►  one PostgreSQL database per school
 Flutter app    ─┘                ─►  console API (/console/v1)             ─►  registry database (schools, plans, runs, releases)
```

How the app meets it: every build has the dart-defines `SCHOOL` and `API_BASE_URL` (`AppConfig.assertSchool` refuses to start without them), and `InitialBinding` registers the Remote adapters. They call the family API (`/v1/f/*`, `docs/API_CONTRACT.md`) through `lib/core/network/api_client.dart`, which adds `X-School`, the bearer token and one token renewal on a 401. Sign-in is the platform's password then code (`RemoteAuthRepository`, `OtpRequired`). `SchoolProfileService` also replaces `AppConfig.schoolName` and `schoolTagline` with the school's own from `GET /v1/brand`.
