# Tangent: the one-shot plan

**Status:** approved direction, not started. It starts **after the design system lands on `main`** (another agent is building it). Written 2026-11-12 on branch `plan/adapt-one-shot`.

This is the only plan. It replaces `docs/features-plan.md`, `docs/product-audit.md` and `docs/product-fix-plan.md` (removed; their open items are all below, and git history keeps the originals). `docs/product-map.md` stays as the map of where things live, with its rules 5 and 7 rewritten to match section 1.

It covers, in one branch and one merge:

1. **Settings ownership:** the school runs its own day from its admin; Tangent keeps only what is paid for, risky or technical; nothing has to be set up by the school (sections 1, 3.1, Appendix A).
2. **Adapting to every school:** shared building blocks so a school keeps its own steps, layouts, numbers, fields, lists, words and rules (section 3).
3. **International:** country, time zone, currency, tax, IDs, phones, calendars and statutory reports come from the school's country, never from India-shaped code (sections 3.3, 3.4, Appendix B).
4. **Any language:** every screen of admin, console and app, every message and every PDF in any language, right-to-left included (section 3.5).
5. **Fixing every existing module** to that standard (section 4).
6. **Everything left from the earlier one-pass** that does not need the owner (section 5, Appendix C).
7. **Every new module**, built now and switched on per school, except the rare ones built on request (sections 6 and 8).
8. **Guards** so none of this drifts back (section 3.9), and **gates** before the merge (section 9).

What needs the owner (accounts, files, decisions, reviews) is listed in section 10 and is not part of the build; nothing in the build waits for it.

---

## 0. How to run this plan

- **One branch** off `main` after the design system is merged, for example `feat/adapt-one-shot`. Atomic commits per step (Conventional Commits, trailer `Co-Authored-By: Claude`). Merge once, after section 9.
- **First hour:** read `AGENTS.md`, `docs/HANDOFF.md`, `docs/DESIGN.md`, `design/README.md`, the design system's own notes, this plan, and `docs/product-map.md`. Check that the design system's tokens support right-to-left (logical properties) and the font roles section 3.5 needs; if not, that is step 1.0.
- **Re-check every line against the code before building it.** This plan was written from the code on 2026-11-12; the design-system merge will move files. A line that is already true is ticked, not rebuilt.
- **Order** (each phase finishes before the next starts, because later phases build on earlier ones):
  1. Foundations (section 3): settings ownership, starter packs, locale and money, languages, the shared building blocks, guards.
  2. Existing modules moved onto the foundations (section 4).
  3. One-pass leftovers (section 5), done while each area is open in phase 2 where they overlap.
  4. New modules (section 6), in the order of section 6.0.
  5. Console and admin surfaces that edit the foundations (section 7), built alongside phase 1 where the foundation needs an editor to be usable.
  6. Demo schools per country and docs (section 8.5, 8.6).
  7. Gates (section 9), then the merge.
- **Parallel sessions:** phase 4 modules touch separate files and can run side by side (one writer per set of files; never two sessions on `assets/mock/*.json`, `en_redesign.dart`, `modules.ts`, `config.ts`, `settings-meta.ts` or the translation catalogues at once: those are merge hot-spots, so one session owns them and the others ask it).
- **Testing rhythm:** quick checks per change (the file's tests, typecheck of the touched package); full suites at the end of each phase and at section 9.
- **House style:** Ponytail (smallest complete change, no speculative abstraction), hand-formatted at about 120 columns, no repo-wide formatters, comments say why.

---

## 1. The standard every module meets

### 1.1 The rules (these replace "schools configure nothing")

1. **The school never changes how it works to fit Tangent.** Whatever differs between schools (a step, a layout, a number series, a field, a list, a word, a language, a currency, a calendar, a rule) is the school's data or a setting with a sensible default. It is never written in code.
2. **It works on day one.** A new school gets every setting, list, template and rule filled from a **starter pack** chosen by its country, curriculum and school type (section 3.2). The school only changes what is different for it. No screen ever asks a school to "finish setting up" before it can work.
3. **The school runs its own day, from its admin.** Every setting about how the school operates is **owned by the school** and edited on the page of the module it changes (Library → Settings), by staff whose role has the `settings.manage` permission for that module.
4. **Tangent keeps what is paid for, risky or technical**, in the console: plan, modules and features, limits, outside providers and live messaging, the app build (name, icon, colours, store listing), security minimums, data region, backups, legal minimums of retention.
5. **Tangent can change anything, for support, and can lock any single setting for a single school** (for example a school group that wants its fees fixed centrally). A locked setting shows in the admin as read-only with "Locked by Tangent" and the reason.
6. **Every change is recorded** (who, when, from what to what, why) and shows in both the admin's audit log and the console's history of that school. A risky setting needs a second person **in the school** (or in Tangent, for Tangent-owned ones).
7. **International by default.** India is one country pack, not the default shape of the code. Money, dates, times, numbers, phones, addresses, IDs, taxes, grades, calendars and statutory reports all come from the school's country and locale.
8. **Any language.** Every word a person reads in the admin, console, app, messages and PDFs comes from a language catalogue, in any number of languages, right-to-left included.
9. **One home** (product map rule 1), **settings live with the thing they change** (rule 6), **shared services have one home** (rule 8), **one name, one meaning** (rule 10) still hold.

### 1.2 Definition of done for a module (existing or new)

A module is done only when every line holds. `packages/config-engine/src/modules.test.ts` checks the ones code can check (marked ✓).

| # | The module… |
|---|---|
| 1 | ✓ is one record in `MODULES` (pages, tabs, app pieces per role, settings, permissions, messages, imports, approvals, dashboard pieces, reports, audit events, **plus the new lines below**) |
| 2 | ✓ declares every setting with an **owner** (`school` or `tangent`), a **default**, the **country packs** that change the default, and whether it is **risky** |
| 3 | ✓ declares its **lists** (categories, statuses, reasons, types) as school lists with defaults, never enums in code |
| 4 | ✓ declares its **workflows** (steps and approvals) on the steps engine, never fixed stages |
| 5 | ✓ declares its **documents** (anything printed or sent as a PDF) as templates on the template designer, with starter templates per pack |
| 6 | ✓ declares its **number series** (receipt, certificate, admission, ticket…) on the numbering engine |
| 7 | ✓ declares which **records take custom fields** (student, staff, enquiry, visitor, asset…) |
| 8 | ✓ declares the **words** it uses that a school may rename (vocabulary) |
| 9 | uses the school's **time zone, currency, locale and calendar** for every date, time, amount and week |
| 10 | ✓ has **every visible string in the language catalogues** (admin, console, app), and passes the right-to-left audit |
| 11 | has **import** for its data through the one import engine, with remembered column mapping (section 3.6.8) |
| 12 | has **empty states** for a brand-new school, **switched-off** behaviour (no trace when the module is off), **offline** behaviour in the app |
| 13 | has **demo data** in every demo school (section 8.5), for every weekday |
| 14 | has **messages** declared in `MESSAGE_EVENTS`, with wording per language and channel rules |
| 15 | has **reports** in the report library and **dashboard pieces** where useful |
| 16 | has **permissions** and the starting roles that get them (in the blueprint, not code) |
| 17 | has **audit events** for every change |
| 18 | has **API tests**, **e2e flows** for its main jobs, and **app screens** in the smoke test when it has app pieces |
| 19 | has **help text** on every setting and an entry in the help centre content (section 7.6) |

---

## 2. Decisions taken with defaults

The build does not wait on these. Each has a default the plan uses; the owner changes it before the build starts by editing this table.

| # | Question | Default used by this plan |
|---|---|---|
| D1 | Which country packs ship first (fully, with statutory reports and demo school)? | **India, United Kingdom, United States, United Arab Emirates** (covers lakh/crore and thousands grouping, GST, VAT and no tax, three calendars, left-to-right and right-to-left, Sunday and Monday week starts and different weekends). Every other country gets a **generic pack** (its currency, time zone, locale, phone code and week from standard data) and can be filled in later without code. |
| D2 | Which languages ship with full catalogues? | **English, Hindi, Marathi, Arabic, Spanish, French** as complete catalogues; **any other language** can be added from the console (machine draft, then review). |
| D3 | Translations: machine draft plus human review? | **Yes.** Drafts come from the Hub's `translation` capability (AI provider); a key is "reviewed" only after a person approves it in the console; unreviewed drafts are used but marked. |
| D4 | May a school create its own roles? | **Yes**, within the permissions its plan includes; Tangent's starting roles come from the blueprint; Tangent can lock roles for a school. |
| D5 | May a school switch app roles (students, drivers) on and off? | **Yes**, among the roles its plan includes. |
| D6 | May a school change its logo and logo letters? | **Yes** (admin, app inside, PDFs). The app icon and store listing change with the next app build, which Tangent runs. Brand colour and theme stay with Tangent (they are checked for contrast and design review). |
| D7 | Security settings? | Tangent sets the **floor** (two-step sign-in on, minimum password length, maximum session length); a school may **tighten** but never loosen. |
| D8 | Data retention? | School-owned and risky (second person), never below the country pack's legal minimum. |
| D9 | Message wording where a regulator fixes it (India DLT for SMS)? | School edits wording freely for push, email and WhatsApp-session messages; for DLT SMS and approved WhatsApp templates the wording must match an approved template, so an edit there opens a template request in the console (it cannot go live until approved). |
| D10 | Payroll statutory rules: which countries? | The packs of D1. Other countries get the payroll engine with configurable components and no statutory automation until their pack exists. |
| D11 | Accounting? | **Exports and two-way sync** (Tally, QuickBooks, Xero, Zoho Books) plus **expense claims and budgets** are built now; a **full general ledger** is built on request (section 8). |
| D12 | Statutory reports beyond D1 countries? | Built on request, per country (section 8). |
| D13 | Tangent's own billing currency? | Per contract: each school's plan is priced in a currency chosen in the console (default the school's currency). |

---

## 3. Phase 1: Foundations

### 3.1 Settings ownership

**Today:** 86 settings in `packages/contracts/src/config.ts` (`SchoolSettingsSchema`) and `settings-meta.ts` (`SETTINGS_META`). All are edited only in the console (`apps/console/src/pages/school/ConfigTab.tsx`); the admin shows a read-only "School profile" (`apps/admin/src/pages/profile/ProfilePage.tsx`). Four `*.schoolEdits` switches (`timetable`, `classes`, `calendar`, `feeStructures`) let a school edit some data behind a console switch. Several settings are enums that cap adaptation (Appendix A, "Change").

**Build:**

1. **`SettingMeta` gains** `owner: 'school' | 'tangent'`, `packs?: string[]` (packs that change the default), `minFrom?`/`maxFrom?` (a Tangent floor or ceiling a school setting must respect, for D7 and D8), and keeps `risky`. Every one of the 86 is tagged per Appendix A. `modules.test.ts` fails on a setting without an owner.
2. **Per-school locks.** Registry table `setting_locks (school_id, key, locked_by, reason, at)`; console action "Lock for this school" on any setting; the school API refuses a write to a locked key (`423 locked`, plain message). Locks also apply to whole school-data areas that today use `*.schoolEdits` (timetable, classes, calendar, fee structures): those four settings are **removed** and replaced by area locks.
3. **School-side writes.** New route `PUT /v1/settings` (school API) accepting only school-owned, unlocked keys, validated by the same `SchoolSettingsSchema` piece, needing `settings.manage` plus the module's own write permission; risky keys create an approval (second person in the school) instead of applying. Every write goes to the audit log with a "why" note (optional for the school, required for risky).
4. **Console writes keep working** for every key, with the same audit, and show "changed by the school" history next to Tangent's.
5. **Admin surfaces:** every module page gets a **Settings** tab (its own address, `/library/settings`), built from `SETTINGS_META` with the same field kinds the console uses (move the field renderers from `ConfigTab.tsx` into `packages/web-ui` so both apps share them). School-wide groups (identity, the app, privacy, messaging) live on **School profile** tabs, which become editable for school-owned keys. Read-only lines remain only for Tangent-owned or locked keys, each with its reason.
6. **Permissions:** `settings.manage` becomes a module-scoped permission (`library.settings`, `fees.settings`…), declared by each module; the starting "Principal" role gets all, "Office" gets the operational ones, "Accountant" gets fees.
7. **Product map rule 5 and 7** are rewritten (done in this branch) and `ProfilePage.tsx`'s header comment ("schools configure nothing") is corrected when the page is rebuilt.
8. **The app** reads settings as today (`/v1/config`), now including school-made changes within seconds (config cache invalidation on write, as the console write already does).

### 3.2 Starter packs (nothing to set up)

**Today:** the onboarding wizard (`apps/console/src/pages/onboarding/WizardPage.tsx`, `apps/console-api/src/wizard.ts`) collects name, board (`SCHOOL_BOARDS = CBSE, ICSE, State, IB, International, Other`), city and language; defaults are the schema defaults, which are Indian (A1–E grades, 33 % pass, GST 18 %, SAC 999293, UPI and net banking, ₹150,000 daily target, Monday week).

**Build:**

1. **Pack model** (registry, edited in the console under Blueprints → Starter packs): a pack is a named, versioned bundle of **setting values, school lists, grading schemes, term structure, weekly off days, week start, attendance marks and codes, payment methods, tax model, ID document types, number series formats, message wording per language, document templates, vocabulary, statutory report set, privacy notice text and legal minimums, holidays source**. Packs **layer**: `country` (India, UK, US, UAE, generic-<ISO>) → `curriculum` (CBSE, ICSE, state board, IB PYP/MYP/DP, Cambridge, GCSE/A level, US common core/AP, American, British, generic) → `school type` (primary, secondary, K-12, boarding, day) → the school's own changes on top.
2. **Wizard** asks country (searchable, ISO 3166), curriculum (filtered by country, "Other" allowed), school type, languages, time zone (prefilled from country), currency (prefilled), and shows a one-page summary of what the packs set ("Grades A*–9…, terms: 3, week starts Monday, VAT: exempt"). Every value can be changed later by the school. `SCHOOL_BOARDS` becomes the curriculum list from packs.
3. **Re-apply per area:** the console can re-apply a pack's part (for example "grading from IB DP") to a live school, with a preview of what changes and a second person.
4. **Packs to write now** (D1): India (with CBSE, ICSE, state board, IB, Cambridge), UK (GCSE/A level, IB, primary), US (common core with GPA and letter grades, AP, IB), UAE (British, American, IB, Indian curricula, Arabic and English, Monday week start with a Saturday–Sunday weekend, the Friday half day as a school setting), and the generic pack builder from standard data (currency, decimals, grouping, phone code, week start, weekend, date format per CLDR).
5. **Copy that assumes India goes into the India pack** (GST, SAC, UPI, net banking, DLT, lakh/crore grouping, Aadhaar, APAAR, UDISE+, RTE, PIN code, 80G receipts).

### 3.3 Locale, time zone, calendar, phones, addresses, IDs

**Today:** India time is hard-coded (`packages/contracts/src/dates.ts`: `IST_OFFSET_MS = 5.5 h`, `istToday()`), used in 38+ files across API, admin, console and seed (Appendix B). Week starts only `mon`/`sun`. Phones are typed free text with `+91` in seeds and samples; no country-aware validation. No country, time-zone, currency or locale setting exists.

**Build:**

1. **New school-owned settings** (identity group): `school.country` (ISO 3166-1), `school.timezone` (IANA), `school.locale` (BCP 47, drives date, time, number and list formatting), `school.currency` (ISO 4217, from the pack), `calendar.weekStarts` widened to **any day**, `calendar.weeklyOff` already any days (keep), `school.dateFormat` override (optional), `school.timeFormat` (12/24 h), `school.phoneCountry` (default calling code), `school.addressFormat` (from pack).
2. **Dates:** replace `IST_OFFSET_MS`/`istToday()` with `schoolToday(tz)`, `schoolNow(tz)`, `toSchoolDate(instant, tz)` in `packages/contracts/src/dates.ts` (using `Intl.DateTimeFormat` with `timeZone`; no new dependency). Every caller in Appendix B passes the school's zone (server: from the tenant's settings; admin/console: from the shell's school config; app: from `/v1/config`). Jobs that run "each morning" (reminders, absence alerts, attendance reminders, overdue fines, transport poll windows, notice publishing, scheduled reports) run per school at the school's local time. SQL that uses `now()::date` or `current_date` for "today" switches to the school's date passed in.
3. **Formatting:** one formatter per surface: `packages/web-ui` `fmt.date/time/number/money/list(locale, tz, currency)` and Flutter `core/utils/formatters.dart` (today `en_IN` and `₹` fixed) reading the school locale and currency; lakh/crore grouping only when the locale uses it (`en-IN`, `hi-IN`). The "₹18L" style short amounts on dashboards become locale-aware compact notation (`Intl.NumberFormat(..., { notation: 'compact' })`).
4. **Phones:** stored in E.164; input fields take the school's default country code and validate length per country (a small table from the packs, no library); sign-in by phone accepts local or international form. `maskPhone` keeps working.
5. **Addresses:** structured address (lines, city, region, postal code, country) with the pack's field labels and order ("PIN code", "Postcode", "ZIP code", "Emirate").
6. **Identity documents:** `people` records take **ID documents** as a list of `{type, number, issuedBy, expires}` with types from the pack (India: Aadhaar, APAAR, passport; UK: UPN, ULN; US: state student ID; UAE: Emirates ID, passport, visa) and per-type validation patterns from the pack. No ID type is in code.
7. **Names:** given and family name fields with the pack's display order (family name first where the locale does), plus optional names in a second script (Arabic and English, Devanagari and Latin), used on PDFs.
8. **Academic calendar:** terms are already the school's data (`year` module); extend to **any number of terms** with names, and **semesters, trimesters, quarters or custom** periods; reporting periods separate from terms; the academic year may start any month. The app's leave and gallery "June" assumptions go (Appendix C).

### 3.4 Money and tax

**Today:** amounts are integers in rupees; `₹` and `en-IN` in 41 files; `rupees()` in `apps/console/src/app/format.ts`; GST settings (`fees.gstin`, `fees.gstSac`, `fees.gstRatePct`, `fees.gstHeads`) and the "GST receipts" feature; payment methods enum `cash, upi, card, netbanking, cheque`; module prices `addOnPerStudentYear` in rupees; billing in rupees.

**Build:**

1. **Currency per school** (`school.currency`), stored once; amounts stored as integers in the currency's **minor unit** (paise, pence, cents, fils) with the number of decimals from ISO 4217. A migration multiplies existing rupee amounts by 100 and records the currency on every money table (`fees`, `invoices`, `payments`, `refunds`, `fines`, `library fines`, `trip fees`, `payroll`…). Money is never a float.
2. **Tax model** replaces the GST settings: `tax.registered` (bool), `tax.ids[]` (type and number, e.g. GSTIN, VAT number, TRN), `tax.rates[]` (name, percent, inclusive or exclusive), `tax.byFeeHead` (which head carries which rate, from the school's fee heads), `tax.codes` (SAC/HSN in India, none elsewhere), printed on receipts and invoices through the template designer. India's pack sets GST with SAC 999293 and inclusive pricing; UK sets "exempt"; UAE sets VAT 5 % registered or not; US sets none. The feature `fees.gstReceipts` becomes `fees.taxReceipts`.
3. **Payment methods** become a school list (name, kind: `cash | card | bank | cheque | wallet | online | other`) with pack defaults (India: cash, UPI, card, net banking, cheque, bank transfer; UK: cash, card, bank transfer, direct debit, cheque; UAE: cash, card, bank transfer, cheque; US: cash, check, card, ACH). The office records any of them; the app shows what the payment connection offers.
4. **Tangent's own prices** (`addOnPerStudentYear`, plan prices, billing invoices) carry their currency (D13); the console formats with it; `rupees()` is removed.
5. **Regional payment providers** through the Hub: add Stripe (cards, Apple Pay, Google Pay, ACH, SEPA, BACS), PayPal, Checkout.com or Telr/Network International for the UAE, GoCardless for UK direct debit, alongside Razorpay and Cashfree. Each is a `ProviderDef` plus an adapter (`docs/integrations.md`), with steps, field help and test mode. Messaging: Twilio (already), Vonage, MessageBird/Bird, Unifonic (Gulf), Infobip, plus WhatsApp Cloud API (already Meta). Email: add SendGrid, Mailgun, Postmark beside SES, SMTP and Resend. Maps: Google, Mapbox (already). Each region's pack lists the providers to suggest first.

### 3.5 Languages (any, both directions)

**Today:** admin, console and `packages/web-ui` have **no translation system**; every string is English in the TSX. The app has `lib/core/translations/` with `en`, `hi`, `mr` (Hindi and Marathi mostly fall back to English), fonts Anek Latin and Anek Devanagari only. `school.language` and `app.languages` are enums `en | hi | mr`; `LANGUAGES` lists three. PDFs embed Noto Sans and Noto Sans Devanagari only. Message templates have one wording; `message_log.language` exists but nothing chooses it. No right-to-left anywhere (0 matches for `rtl`/`Directionality`).

**Build:**

1. **Language list** in the registry: ISO 639 code, English name, own name, script, direction, plural rules (from CLDR, small table), font family, and `enabled` (Tangent) and `reviewed %` per surface. `LANGUAGES` in contracts becomes the read of that list; the enums go; `school.language` (default) and `app.languages` (offered) become lists from it.
2. **Web catalogues:** `packages/i18n` (new small package, no dependency): JSON catalogues per language and surface (`admin`, `console`, `web-ui`, `messages`, `pdf`), `t('area.key', params)` with ICU-style plurals and selects (a few dozen lines; no library), a React hook reading the person's language, and a test like the app's `translation_keys_test.dart` that fails on any literal key missing in `en`. **Every visible string in `apps/admin`, `apps/console` and `packages/web-ui` moves to keys** (one pass per page while section 4 has it open; a codemod lists the JSX text nodes to move).
3. **App catalogues:** keep `lib/core/translations/` as the built-in `en`, and load the other languages as **packs from the server** (`/v1/i18n/app/<lang>?v=`), cached on the phone, so a new language needs no app release. `trp`/`trn` keep working; plural rules per language replace the `_one` suffix trick.
4. **School-data translations:** names a school types (categories, fee heads, statuses, reasons, houses, subject names, notice titles where the school wants) can carry a translation per offered language; the admin shows a "Translations" sidebar on list editors; the app and messages pick the reader's language, falling back to the school's default.
5. **Messages per language:** `MESSAGE_EVENTS` default wording exists per language in the `messages` catalogue; the school's overrides (`templates.messages`) become `{key: {lang: text}}`; the Messenger sends each recipient's language (the person's preference, else the school's default); DLT and WhatsApp template ids are per language (D9).
6. **People's language:** every account has a preferred language (admin, console, app), defaulting to the school's; families can pick in the app; the office can set it on a guardian record.
7. **Right-to-left:** web uses `dir` on `<html>` from the language and **logical CSS properties** everywhere (`margin-inline-start`, `inset-inline-end`, `text-align: start`) — a scan replaces physical ones in `nest.css`, `blocks.css`, `pages.css` and inline styles; icons that point (chevrons, arrows, back) mirror; charts and timelines read right to left; numbers and phone numbers stay left to right inside RTL text (`<bdi>`). Flutter uses `Directionality` from the locale, `EdgeInsetsDirectional`, `AlignmentDirectional`, and mirrored icons (`matchTextDirection`). `tools/audit-ui.mjs` gains an `--rtl` pass (Arabic) checking overflow, clipping and mirrored layout.
8. **Fonts per script:** the design system's type roles map to a font per script (Latin, Devanagari, Arabic, Bengali, Tamil, Telugu, Gujarati, Gurmukhi, Kannada, Malayalam, CJK, Thai, Cyrillic and Greek through Noto): web loads only the scripts of the school's languages; the app bundles Latin, Devanagari and Arabic and downloads others on first use; PDFs embed the fonts of the scripts present on the page (`apps/api/src/school/pdf.ts` already uses pdf-lib + fontkit; add the Noto files under `apps/api/assets/fonts`).
9. **Translation workflow:** console page Languages: per language and surface, coverage, untranslated keys, machine drafts (Hub capability `translation`, AI provider), review queue, export/import XLIFF or CSV for outside translators. New keys added by developers arrive as English plus machine drafts; the gate requires reviewed drafts only for D2 languages.
10. **Dates and numbers in every language** come from the locale (`Intl` on the web, `intl` in Flutter): month and weekday names, digits (Arabic-Indic digits when the locale uses them), calendar systems stay Gregorian with the locale's names (Hijri display is a pack option for UAE: shown beside the Gregorian date on calendars and PDFs).

### 3.6 Shared building blocks

Each block is one service, one set of tables per school, one editor (admin for the school, console for Tangent), used by every module. A module never builds its own version.

#### 3.6.1 Steps and approvals (workflow engine)

- **Today:** fixed stage enums (`admissions.stages` = `applied | test | offer`), approvals queue with kinds per module, a single "second person" pattern, `approvals.notice` required/off.
- **Build:** a **workflow** is an ordered list of steps per process (`admissions`, `leave.student`, `leave.staff`, `concession`, `refund`, `notice`, `trip`, `gate-pass`, `certificate`, `purchase`, `expense`, `payroll-run`, `behaviour-incident`, `photo`, `data-request`…). Each step has a name (translated), who acts (a role, a named person, the class teacher, the head of a department, the requester's line manager), what it needs (a form, a file, a payment, a test score, a signature), a time limit and what happens when it runs out (remind, escalate, auto-approve), and the messages sent on entering and leaving it. Branches by condition (amount above X, grade in Y). Packs ship sensible workflows; the school edits them on the module's Settings tab with a simple step editor (add, rename, reorder, set who acts); the console sees and can lock them.
- **Runtime:** `workflow_runs`, `workflow_steps_done`, the approvals queue becomes the list of open steps for the signed-in person (already one Approvals page in admin; console has its own for Tangent-owned risky changes), app shows "Needs you" from it.

#### 3.6.2 Template designer (every printed or sent document)

- **Today:** receipt and report-card PDFs drawn in code (`pdf.ts`, `documents.service.ts`), family letters as one setting text, ID card fixed in the app.
- **Build:** a template is a page layout (A4, Letter, A5, ID-80, custom) of blocks: text with placeholders, the school's logo and header, fields, tables (marks, fee lines), images (photo, signature, stamp), QR and barcode, page breaks and repeat rules, per-language text. Data sources per document type declare their placeholders (`{student.name}`, `{receipt.number}`, `{marks[].subject}`…). Editor in the admin (drag, preview with real data, version, publish), starter templates per pack (CBSE report card, IB report, GCSE report, US report card with GPA, transfer certificate, bonafide, character, leaving certificate, receipt, invoice, fee statement, ID card front/back, admit card, hall ticket, admission letter, offer letter, payslip, experience letter, gate pass, visitor badge, library card, trip consent, donation receipt with the country's tax wording). Rendering through `pdf.ts` with the fonts of section 3.5.8. Bulk generation as a background job.

#### 3.6.3 Custom fields and form builder

- **Today:** fixed record fields; `students.required` limited to five enum fields.
- **Build:** per entity (`student`, `guardian`, `staff`, `enquiry`, `application`, `visitor`, `asset`, `book`, `vehicle`, `room`, `event`, `trip`, `incident`, `health record`…) the school adds fields: text, number, date, choice (from a list), multi-choice, yes/no, file, signature, phone, email, address, table; with required, visibility per role (field-level permissions), who may edit, shown in the app or not, translated labels. Stored as JSONB with a typed definition; searchable and filterable; included in imports, exports, reports and templates. `students.required` becomes the `required` flag on any field. The **form builder** uses the same field kinds to build forms (admission application, consent forms, surveys, data-update requests, trip forms, feedback), shareable by link or inside the app, with conditional sections and a workflow after submission.

#### 3.6.4 Number series

- **Today:** receipts only (`fees.receiptPrefix` with `{year}`, `fees.receiptStart`); IDs prefixed in app code (`GIS-`).
- **Build:** a series per document type (`receipt`, `invoice`, `admission`, `enquiry`, `application`, `certificate.<type>`, `ticket`, `gate-pass`, `visitor`, `asset`, `purchase-order`, `payslip`, `library-card`…): pattern with tokens `{yyyy} {yy} {ay}` (academic year like 2026-27) `{term} {class} {branch} {seq:5}`, reset rule (never, yearly, academic year), next number (so a school keeps its old numbering), gap-free allocation in one transaction. Editor on each module's Settings.

#### 3.6.5 School lists

- **Today:** lists are separate settings with special editors (categories with tones, houses, leave reasons, admission sources) or enums (attendance marks, payment methods, admission stages).
- **Build:** one **list** service: a list has items (key, name per language, colour/tone, icon, meaning for the system where needed, order, active), defaults from packs, editor shared by admin and console. Lists cover: notice categories, event categories, leave reasons (student, staff), admission sources, attendance marks (each with a meaning: present, absent, late, excused, holiday, not required, and a statutory code where the pack has one, like UK DfE codes), payment methods, fee heads, concession types, document types, ID types, incident types, visitor purposes, asset categories, complaint types, health conditions, relationships (mother, father, guardian, grandparent…), religions and categories only where the pack asks for them, blood groups, genders (school-editable, pack defaults include non-binary and "prefer not to say" where lawful).

#### 3.6.6 Grading and assessment schemes

- **Today:** one `grading.scale` of percentage bands (CBSE A1–E default) and one `grading.passPct`; rank on or off; exam max marks default.
- **Build:** schemes of types **percentage bands**, **points** (GPA 4.0/5.0 with weights for honours/AP), **numeric grades** (GCSE 9–1, IB 1–7), **letters with plus/minus**, **descriptors** (Emerging/Developing/Secure/Exceeding), **rubrics** (criteria × levels, IB MYP criteria A–D), **competencies** (NEP Holistic Progress Card), **pass/fail**. A school may have several schemes assigned per stage, class, subject or assessment type. Weighting of assessments into a term result, rounding rules, pass rules (per subject, aggregate, both), grace marks rules, best-of-N rules, rank and percentile options. Packs ship CBSE, ICSE, state-board, IB PYP/MYP/DP, Cambridge, GCSE, A level, US GPA, UAE MOE.

#### 3.6.7 Vocabulary

- **Today:** `vocab.student`, `vocab.students`, `vocab.class`, `vocab.classes`.
- **Build:** a word list per school and language for every renamable concept modules declare: student/pupil/learner, guardian/parent/carer, class/grade/year/form, section/division/homeroom/tutor group, house, term/semester/quarter, period/lesson/block, roll number/register number, admission number/student number/UPN, report card/report/transcript, homework/assignment, principal/head teacher/head of school, fees/tuition. With singular, plural and grammatical forms per language where needed. The web `t()` and Flutter `tr` substitute them.

#### 3.6.8 Import that fits the school's files

- **Today:** one import engine (`packages/db/src/import/`), templates per kind with `aliases`, dropdown options, undo of the newest import.
- **Build:** a **mapping step**: upload any CSV/XLSX, Tangent guesses each column from aliases (per language) and the data, the person confirms or changes the match and any value mapping ("M" → Male, "VIII" → 8, "Std 5" → class 5), and the mapping is **remembered** per school and kind, so next term's file imports in one step. **Presets** for exports of other school systems common in the D1 countries (named presets with their column names) as data, not code. Custom fields are import targets. Big files run as a background job (section 5.2).

### 3.7 Consent, privacy and law per country

- Privacy notice, officer, consent rules, data-rights request types, retention minimums, breach notice wording and deadlines, children's age of consent, photo consent defaults come from the **country pack** (India DPDP, UK GDPR and Children's Code, US FERPA and COPPA, UAE PDPL); the school edits its notice and officer; Tangent owns the legal minimums (D8).
- Data region: each school's database cell and storage bucket carry a region; the console refuses a move that breaks the pack's residency rule.

### 3.8 Settings and modules surfaces the foundations need

Built in phase 1 so the foundations are usable (section 7 lists the rest):

- Admin: module **Settings** tabs; School profile editable; list editor; workflow step editor; number series editor; custom fields editor; template designer; vocabulary; languages offered; import mapping.
- Console: setting locks; starter packs editor and re-apply; languages and translation review; country list; history that shows school changes.

### 3.9 Guards (tests that stop this coming back)

Add to the existing rule tests (`packages/web-ui/src/rules.test.ts`, `test/design_rules_test.dart`, `packages/config-engine/src/modules.test.ts`, `apps/api/test/plan.test.ts`):

1. No `₹`, `INR`, `en-IN`, `en_IN`, `Asia/Kolkata`, `IST`, `istToday`, `+91`, `GST`, `UPI`, `CBSE`, `UDISE`, `DLT` outside the India pack files, seeds of the Indian demo school and tests (allow-list by path).
2. No literal user-visible text in `apps/admin`, `apps/console`, `packages/web-ui` JSX (text nodes and `label=`/`title=`/`placeholder=`/`aria-label=` string literals) and in Flutter screens (already for `.tr`).
3. Every language catalogue key used exists in `en`; plural keys have every plural category the language needs.
4. No physical CSS direction properties (`margin-left`, `padding-right`, `left:`, `text-align: left/right`) in app styles, except a short allow-list (charts' axes).
5. Every setting has an owner; every school-owned setting appears on an admin Settings tab; every Tangent-owned one appears read-only where it applies.
6. Every module declares lists, workflows, templates, number series, custom-field entities and vocabulary lines (may be empty, never missing).
7. No `z.enum([...])` for a school-meaningful list in `config.ts` (allow-list for true system enums).
8. No money as a float; every money column has a currency (migration check).
9. Every scheduled job takes the school's time zone (a test runs jobs for a school in UTC−5 and one in UTC+4 and checks "today").
10. `tools/audit-ui.mjs --rtl` and `--locale` passes are part of the gate.

---

## 4. Phase 2: Every existing module, rebuilt to the standard

For each module: what is rigid or India-shaped today → what it becomes. Everything in section 1.2 applies on top. Admin and console pages repaired in the one-pass keep their structure; this phase changes where settings live, removes code-held school data, adds the blocks, translations and right-to-left.

### 4.1 School (profile, identity, year, dashboard, reports, approvals, audit)

- School profile: editable identity, address (structured), country, time zone, locale, currency, languages, logo (D6); Tangent-owned lines read-only with reasons.
- Academic year: any number of terms and reporting periods; year start any month; weekly off any days; week start any day; holidays from the pack's public-holiday source (one-click import per year) plus the school's own.
- Dashboard: amounts, dates, targets in the school's currency and locale; `dashboard.rollClasses` becomes a **personal preference** (`/v1/me/prefs`), not a school setting.
- Reports: every report formats by locale; the report library gains the new modules' reports; statutory reports move under a "Government" tab built from the country pack (section 6.32).
- Approvals: the open steps of every workflow (3.6.1).
- Audit: shows school and Tangent changes, with "why".

### 4.2 People (students, guardians, staff, admissions)

- Students: custom fields; ID documents from the pack; names in two scripts; structured address; relationships list; houses list; required fields any field; class and section names as the school writes them (no digit stripping anywhere); subject choices and electives (section 6.2); lifecycle (enrolled, on leave, withdrawn, transferred, graduated → alumni).
- Guardians: language preference; contact preferences per channel; multiple households (separated parents, both get messages and bills as the school decides).
- Staff: custom fields; departments and line managers (for workflows); employment details for HR (section 6.12).
- Admissions: stages from the workflow engine (any number, any names, each with its own form, documents, fee, test, interview); online application (section 6.1).
- Roles (D4): the school creates and edits roles within its plan's permissions; starting roles from the blueprint; `staff.schoolAssignsRoles` goes (the school always assigns, unless locked).

### 4.3 Attendance

- Marks from the attendance-mark list (any marks, each with a meaning and optional statutory code); half days and sessions (AM/PM) as the school counts them; period attendance as today.
- Goal, correction window, family alerts: school-owned settings on Attendance → Settings.
- Leave reasons: list per language; leave workflow from the engine.
- Weekday letters and first day from the locale and `calendar.weekStarts`.
- Persistent-absence thresholds (school-set) feed early warning (section 6.28).

### 4.4 Timetable

- Period structures per day and per section (different bell times on Friday, early dismissal days), any week length, rotating day cycles (Day 1–Day 6), A/B weeks.
- Rooms list and room booking; substitutions as today.
- School edits it (lock replaces `timetable.schoolEdits`).
- Automatic generation is built now (section 6.5).

### 4.5 Homework (and the diary in 6.7)

- Defaults (due days, marks, goal, who hands in, class progress shown) on Homework → Settings.
- Grading through the school's schemes (no `startsWith('A')`).
- Attachments real in the app (section 5).

### 4.6 Exams, results and report cards

- Assessment schemes and weighting (3.6.6); exam types list; papers with time, room and invigilator; marks entry per scheme kind (marks, grade, descriptor, rubric); lock after publish (kept); rank options.
- Report cards through the template designer, per pack and class group; remarks bank; multilingual report cards.
- Exam timetable, admit cards and seating (section 6.6).

### 4.7 Fees (invoices, receipts, online payments, refunds, concessions)

- Currency and minor units; tax model; payment methods list; fee heads list (exists) translated; fee structures by class, category, student group, with instalments and due dates; late-fee **rules** (percent or fixed, per day/week/month, grace days, cap, per head); reminders as a schedule (several, before and after due, per channel); refund and waiver workflows; receipt and invoice numbering from series; receipts and invoices from templates; daily target in currency.
- Online payments through regional providers (3.4.5); payment methods the provider offers shown in the app.
- Full scope of section 6.10 built here.

### 4.8 Notices

- Categories list (translated); approval workflow (replaces `approvals.notice`); audiences (whole school, stages, classes, sections, houses, roles, custom groups, individuals); schedule, pin, acknowledge (exists); translations of a notice into the school's languages (machine draft for the writer to check).

### 4.9 Messages (chat) and messaging

- Who may message whom: rules per role pair (school-owned), office hours, quick replies per role and language; attachments (section 5); translation of a message on request in the app (Hub `translation`).
- Message wording per language (3.5.5); quiet hours per school and per country norms; channel rules school-owned within the plan's SMS and WhatsApp allowance.

### 4.10 Events and calendar

- Categories list; RSVP rules; times in the school zone; add to the phone's calendar (section 5); trips move to section 6.25.

### 4.11 Gallery

- Consent rules per country pack; download rule school-owned; reports to the office (exists); albums per year from the school's calendar (no June).

### 4.12 Library

- Rules on Library → Settings (loan days per member type, renewals, maximum loans per member type, fines as a rule in the school currency, fines added to fees or paid at the desk); member types list; item types list (book, laptop, camera, kit); barcode and ISBN scan in the app and on the admin with a phone camera; reading records; library card from a template.

### 4.13 Transport

- "Bus is near" minutes and who families call on Transport → Settings; trips per session (morning, afternoon, late bus, activity bus); attendants; fleet maintenance (section 6.14); maps from the maps connection with dark style; distances in km or miles by locale.

### 4.14 Privacy and data rights

- Country pack drives notice wording, consent types, request types and time limits; the school owns notice and officer; retention per D8.

### 4.15 Moving in and imports

- Mapping step and presets (3.6.8); photos and documents from a zip matched by admission number (section 5.2); background jobs.

### 4.16 Console

- Wizard (3.2), packs, locks, languages, history of school changes, prices with currency (D13), billing in the contract currency, regional providers in the Hub, data region per school, statutory pack per school; `rupees()` and `en-IN` removed; console UI itself translated (catalogue `console`).

### 4.17 The app (every screen)

- Every string from catalogues; RTL; locale formatting; currency from the school; dates in the school zone; school lists and words everywhere; every open row of Appendix C fixed.

---

## 5. Phase 3: What is left from the earlier one-pass (no owner input)

### 5.1 App (Flutter) — from the product audit's app section, still open on 2026-11-12

Full list with each item's verdict in **Appendix C**. In short:

1. **Files everywhere:** one upload path in the app (pick photo or file, camera, scanned pages merged into one PDF, progress, retry, size and type limits from `/v1/config`), used by homework hand-in and teacher attachments, leave attachments, chat attachments (replace `chat.attach_soon`), profile photo (with office approval when the school asks), notices and events attachments (teacher side).
2. **Open, share, save:** open any attachment in the app (PDF and image viewer), share sheet with the real file or link, save to the phone; receipts and report cards as PDF from the server; timetable and events **to the phone's calendar** (replace the Google Calendar web template in `lib/core/utils/calendar.dart`).
3. **Account:** forgot password on sign-in (server `auth.reset` exists); Profile → Account: change password, phone and email (confirmed by a code), signed-in devices with sign-out.
4. **Privacy in the app:** change photo consent, withdraw consent, ask for a copy or deletion (server routes exist); privacy notice and officer from `/v1/config` (today `AppConfig.privacyNotice` is set at runtime from the profile service; move to the config model and drop the static).
5. **Push:** register the phone after sign-in (`/v1/me/devices`), open the right screen from a notification, notification settings per message event on the account; Firebase files come from the console's mobile build (section 10); the code is complete and compiled in, switched on by the files' presence.
6. **Screens:** exam timetable screen per child (papers already in the API); teacher class roster and student profile (API exists); teacher timetable tab with substitutions; teacher marks entry picks the exam and its maximum (no `maxMarks = 20`); teacher home subject from the timetable (no `?? 'maths'`); receipts with the server's number (no `GIS/` in `receipt_view.dart`); profile ID from the admission number (no `GIS-` in `profile_view.dart`); library limits from the rules (no `limit = 3`); grade colours from the scheme; leave terms from the school calendar (no fixed halves); remove onboarding pages (`onboarding_view.dart`) and merge welcomes into one per role; remove gallery favourite; `BigNumber` moved to `core/widgets` with a type role; home "₹" glyph and notification "₹" glyph from the currency; offline cache of the school profile and a queue for error reports (the two `shortcut:` comments); teacher homework draft saved on the server; OTP resend time from the server's answer.
7. **The student demo card** on demo builds (never on school builds).
8. **Every app screen** passes RTL, three locales and the empty-data run.

### 5.2 Server and admin pieces

1. Photos and documents from a zip, matched by admission number (Moving in, background job).
2. Image thumbnails (small copies for lists and the gallery) generated on upload, stored beside the original.
3. Scheduled reports: any report, any filters, weekly or monthly, to chosen people by email, in their language and time zone.
4. Large imports and exports as background jobs with progress and "done" notification.
5. Storage use measured nightly per school (console and billing).
6. Finding a school by phone number in a shared app (built, behind a console switch defaulting off until the owner decides; D-item in section 10).
7. The console must not route messages to a connection that is still a **draft** (found 2026-11-12): only tested connections are routable.
8. Remaining `ponytail:` ceilings stay as written (shared payment connection refund lookup, hub cache time, one FCM request per token, payment polling until the live stream replaces it).

### 5.3 Readiness work that needs no owner input

From the old plan's "readiness for real schools", the parts code can do now:

1. **Load:** a load script (`tools/load.mjs`) that generates a 3,000-student school and fifty schools (`tools/generate-school.mjs`), then measures admin pages (target under 1 s), app API reads (under 300 ms from cache) and every school's morning attendance at once without errors; run locally in the gate and on staging once it exists.
2. **Runbooks** in `docs/runbooks/`: restore a school, rotate a secret, switch a provider that is down, move a school between cells, answer a data-rights request, handle a breach (with the pack's deadlines).
3. **Incident process and status page:** incidents recorded in the console (exists for health), a public status page per region generated from health checks.
4. **Store listing kit:** privacy labels per platform generated from what the app collects, review notes, and a demo school account for reviewers (the build workflow fills them; the accounts are the owner's, section 10).
5. **Billing from the console** matching each school's plan, add-ons and use (SMS, storage), in the contract currency (D13).

### 5.4 Checks skipped at the end of the one-pass (now part of section 9)

The four-width and dark audit, the scans (`scan-gaps`, `scan-fit`, `scan-scroll`, `scan-cutoff`), app shots for every role in light and dark, one browser flow per module switched off, the `/new-admin-page` and `/new-screen` commands starting from the module definition.

---

## 6. Phase 4: New modules (built now, switched on per school)

### 6.0 Order and shape

Build in this order (each needs the ones before): **6.2 SIS gaps → 6.1 Admissions → 6.3 Staff attendance → 6.12 HR and payroll → 6.6 Exams completion → 6.4 Curriculum → 6.7 Diary → 6.9 Online tests → 6.8 Learning → 6.10 Fees completion → 6.39 Scholarships → 6.11 Accounting exports and expenses → 6.24 Certificates and IDs → 6.23 Visitors and gate → 6.38 Front office → 6.25 Activities and trips → 6.26 Houses and achievements → 6.18 Health → 6.19 Behaviour and safeguarding → 6.20 Learning support → 6.36 Helpdesk → 6.37 Surveys → 6.21 Communication completion → 6.15 Hostel → 6.16 Inventory and assets → 6.17 Canteen → 6.14 Transport completion → 6.13 Library completion → 6.5 Timetable generation → 6.27 Alumni → 6.41 Careers → 6.42 Fundraising → 6.40 Staff collaboration → 6.29 Groups and multi-campus → 6.30 Sign-in and access → 6.31 Integrations and open API → 6.32 Government reporting → 6.28 Analytics → 6.34 AI.**

Every module below meets section 1.2 and lists only what is specific to it. "Admin" is the menu group (product map §3.2), "App" the roles that get pieces. "Adapts" names its lists, workflows, templates, series, custom-field entities and settings (all school-owned unless marked G).

### 6.1 Admissions, enquiries and enrolment (module 1, extends `people.admissions`)

- **Build:** enquiry capture from a web form embeddable on the school's site (and a hosted page), walk-in and phone logging, enquiry register, lead sources, follow-up tasks and reminders to staff, automated follow-up messages (sequence per source), campus visit and open-day booking with slots, online application (form builder) with document upload and verification, application fee online, entrance test and interview scheduling with scores, selection decisions with published results, waitlist with automatic offers, seats and capacity per grade and section, offer letters and acceptance with deposit, enrolment contract and e-signature, conversion to student with guardians and app invites (exists), re-enrolment for next year (intent, deposit, data update), withdrawal requests, sibling detection, pipeline and conversion reports, year-on-year comparison.
- **Adapts:** workflow `admissions` (any stages); lists: sources, enquiry statuses, document types; templates: offer letter, admission letter, receipt; series: enquiry, application, admission number; custom fields: enquiry, application.
- **Admin:** People → Admissions (tabs: Enquiries, Applications, Visits, Seats, Re-enrolment, Reports). **App:** none for families before enrolment (the public form is a web page); staff get follow-up reminders.

### 6.2 Student records completion (module 2)

- **Build:** custom fields (3.6.3); photo history; subject combinations and electives with rules (choose 2 of 5, capacity per option, prerequisites) and an options window for families and students in the app; credits; transcripts and academic history across years; lifecycle states with dates; mid-year joining and leaving; data-update requests from the app into a workflow; sibling linkage; lockers; seating charts per class; volunteer and service hours; alerts on a record (medical, SEN, behaviour, custody) shown to the roles that may see them.
- **Adapts:** custom fields: student, guardian; lists: relationships, lifecycle reasons, electives groups; workflow `data-update`.
- **Admin:** People → Students (tabs added: Options, Lockers, Seating). **App:** family and student: choose options, update details, see alerts meant for them.

### 6.3 Staff attendance and leave (module 3)

- **Build:** daily staff attendance (office marks, self check-in in the teacher app with optional geofence and time window, or devices on request: section 8), late and early marks, leave types and balances with accrual rules, leave applications and approvals (workflow), half days, cover requests to the timetable, attendance and leave reports, payroll link.
- **Adapts:** lists: leave types, attendance marks for staff; workflow `leave.staff`; settings: check-in window, geofence radius, accrual rules, carry-forward, year for balances.
- **Admin:** Teach → Attendance (tab Staff) and People → Staff (tab Leave). **App:** teacher: check in, apply for leave, balances; approver: approve.

### 6.4 Curriculum, syllabus and lesson plans (module 4)

- **Build:** syllabus per class and subject (units, topics, outcomes, standards), annual and weekly planners, lesson plans with resources and approval, coverage tracking against the timetable, outcomes and standards mapping (pack sets: CBSE learning outcomes, NEP stages and competencies, IB ATL, UK national curriculum, US Common Core), shared resource bank with tags, reflections after a lesson, department scope and sequence, coverage reports.
- **Adapts:** lists: resource types, standard sets (pack); workflow `lesson-plan` approval; templates: planner print.
- **Admin:** Teach → Curriculum. **App:** teacher: today's plan, mark covered; families: optional "what my child learns this week".

### 6.5 Timetable generation (module 5)

- **Build:** automatic generation from requirements (periods per subject per class, teacher availability and load limits, rooms and their kinds, fixed periods, consecutive periods, split classes and electives blocks, teacher preferences), conflict report, partial regeneration, compare versions, swap tool, room booking, personal timetables (exists), "where is this person now" lookup, calendar overlays.
- **Adapts:** settings: load limits, max consecutive, preferred free periods; lists: room kinds.
- **Admin:** Teach → Timetable (tab Generate, Rooms). **App:** teacher and student: personal timetable (exists), where-is lookup for staff.

### 6.6 Exams, gradebook and report cards completion (module 6)

- **Build:** assessment schemes (3.6.6); gradebook per teacher with weighting; exam timetable (date sheet) with clash check; admit cards and hall tickets (templates); seating plans per room with roll-number rules; invigilation duties; marks entry by scheme kind; moderation and verification step (workflow); remarks bank (per subject and level, translated); report card designer (templates) with board starter layouts; NEP Holistic Progress Card (India pack: competencies, self and peer assessment, parent inputs); interim and end-of-term reports; transcripts; result analysis (subject, class, teacher, trend, outliers); revaluation requests (workflow); external exam entries (board exam candidates, fees).
- **Adapts:** lists: exam types, remarks; workflows: `marks-verify`, `revaluation`; templates: admit card, report card, transcript, mark sheet; series: hall ticket.
- **Admin:** Teach → Exams (tabs: Exams, Timetable, Seating, Gradebook, Report cards, Analysis). **App:** family and student: exam timetable, admit card, results, report card PDF; teacher: marks entry, gradebook.

### 6.7 Digital diary and classwork (module 7)

- **Build:** daily diary per class (what was done in class, what to bring, remarks per student), classwork records, holiday homework feeds, voice notes (recorded in the app, stored as files), acknowledgement by families, worksheets and notes distribution.
- **Adapts:** lists: diary entry kinds; settings: who writes (class teacher or every subject teacher), acknowledgement required.
- **Admin:** Teach → Homework (tab Diary). **App:** teacher writes; family and student read and acknowledge.

### 6.8 Learning (study material, courses and online classes) (module 8)

- **Build:** courses per class and subject with lessons (text, files, video links or uploads, quizzes from 6.9), progress tracking, discussion per lesson, offline download in the app, rule-based enrolment (by class, option group), live classes as links through Hub providers (Google Meet, Zoom, Microsoft Teams) with attendance from the provider where available, recordings linked, LTI 1.3 launch for outside tools (Hub capability `lms`), import from Moodle/Google Classroom where an API exists.
- **Adapts:** lists: content types; settings: who publishes, offline download allowed.
- **Admin:** Teach → Learning. **App:** student and family: courses, lessons, live class join; teacher: publish, see progress.

### 6.9 Online tests and question banks (module 9)

- **Build:** question bank per subject and topic (MCQ single/multi, true/false, fill the blank, match, short and long answer, numeric with tolerance, file answer), tagging by outcome and difficulty, tests with sections, timing, randomised order and question pools, auto-marking for objective items, teacher marking for descriptive ones with rubrics, results into the gradebook, practice mode, anti-cheating basics (full screen request, tab-switch log, IP and time records), accessibility (extra time per student), analytics per question.
- **Adapts:** lists: question tags; settings: show answers after, attempts allowed.
- **Admin:** Teach → Exams (tab Online tests). **App:** student (or family on a child's behalf when students do not sign in): take tests; teacher: create and mark.

### 6.10 Fees completion (module 10)

- **Build:** fee structures by class, category, student group, route, hostel, activity; instalment plans with due dates; bulk invoicing per term; ad-hoc and one-off fees; advance payments and credit balances; sibling and category concessions as rules; scholarships (6.39); fines as rules; reminders as schedules; multiple bank accounts with settlement per fee head (trusts); "no dues" clearance before certificates; parent statements; payment plans; refund and waiver workflows; reconciliation (exists) per provider; convenience fees per method; fee import; e-invoicing hook per country pack (Malaysia MyInvois, India e-invoice where applicable — pack data, built when a pack needs it).
- **Adapts:** lists: fee heads, concession types, payment methods; workflows: `concession`, `refund`, `waiver`; templates: receipt, invoice, statement, no-dues; series: receipt, invoice; tax model (3.4.2).
- **Admin:** Money → Fees (tabs: Overview, Invoices, Receipts, Structures, Concessions, Online payments, Settings). **App:** family: dues, pay, receipts, statements, payment plans.

### 6.11 Accounting exports, expenses and budgets (module 11; full ledger on request)

- **Build:** exports and two-way sync of fee collections, refunds and expenses to Tally, QuickBooks, Xero, Zoho Books (Hub capability `accounting`, one adapter each, mapping fee heads to ledger accounts), expense claims with receipts and approval (workflow), petty cash, budgets per department with budget versus actual, vendor list, purchase requests linked to inventory (6.16), audit-ready reports.
- **Adapts:** lists: expense categories, cost centres; workflow `expense`, `purchase`; series: voucher.
- **Admin:** Money → Accounts. **App:** staff: submit an expense claim with a photo.

### 6.12 HR and payroll (module 12)

- **Build:** staff records (qualifications, experience, documents with expiry alerts, contracts), departments and reporting lines, recruitment (job posts on a hosted page, applications through the form builder, interview stages, offer, conversion to staff), onboarding checklists, payroll (salary structures with components, attendance- and leave-linked pay, arrears, loans and advances, statutory deductions per pack: India PF, ESI, PT, TDS; UK PAYE, NI, pension auto-enrolment; US federal and state withholding through a payroll provider integration where needed; UAE WPS file), payslips (templates) and bank files, appraisals with goals and reviews, professional development hours, staff exit with experience letter.
- **Adapts:** lists: departments, designations, document types, salary components; workflows: `recruitment`, `appraisal`, `payroll-run` (second person), `exit`; templates: offer letter, payslip, experience letter; series: employee number, payslip.
- **Admin:** People → Staff (tabs: Records, Recruitment, Payroll, Appraisals, Leave). **App:** teacher and staff: payslips, leave, documents, appraisal self-review.

### 6.13 Library completion (module 13)

Covered in 4.12 plus: OPAC search for families and students in the app, digital library (PDF and e-book links), reading challenges, library fines into fees (setting), inventory audit with phone scanning.

### 6.14 Transport completion (module 14)

Covered in 4.13 plus: fleet maintenance (service schedules, fuel logs, documents and expiries such as insurance and fitness), exception alerts (child not boarded, route deviation, long halt, breakdown), stop requests and change requests from families (workflow), transport fee by route or distance, transport attendance reports, GPS trackers through the generic poll provider (exists).

### 6.15 Hostel and boarding (module 15)

- **Build:** hostels, floors, rooms and beds; allocation and transfers; roommate preferences; in and out logs with parent alerts; leave from the hostel (workflow with parent consent); visitors for boarders; meal plans and mess menus; hostel and mess fees through Fees; incidents and health links; roll calls at night.
- **Adapts:** lists: room types, meal plans; workflows: `hostel-leave`; templates: hostel ID, out-pass; series: out-pass.
- **Admin:** Campus → Hostel. **App:** family: approve outings, see in/out; warden (staff role): roll call.

### 6.16 Inventory, assets and school store (module 16)

- **Build:** items and stock per store, stock in and out, reorder levels, vendors, purchase requests and orders (workflow), goods received, asset register with tags (QR or barcode labels from templates), assignments to rooms and people, depreciation methods per pack, asset audits by phone scan, school shop for uniforms and books with orders from the app and payment through fees, textbook distribution records.
- **Adapts:** lists: item categories, units, stores, depreciation methods; workflows: `purchase`; templates: asset label, purchase order; series: PO, asset tag.
- **Admin:** Campus → Inventory. **App:** family: shop orders; staff: request items.

### 6.17 Canteen and meals (software; cashless hardware on request) (module 17)

- **Build:** menus by day and week, meal plans and subscriptions, pre-orders from the app with cut-off times, allergens from health records, lunch billing through fees, a simple point-of-sale screen in the admin for canteen staff (search student, record a sale against a prepaid balance), prepaid balance top-up through the payment provider, daily spend limits and low-balance alerts, reports.
- **Adapts:** lists: meal types, dietary tags; settings: cut-off time, spend limits.
- **Admin:** Campus → Canteen. **App:** family: menu, pre-order, top-up, spend; student: menu.

### 6.18 Health and infirmary (module 18)

- **Build:** health records (conditions, allergies, medications, immunisations with schedules per pack, insurance, doctor contacts, consents), infirmary visits with treatment and parent notification, medication administration log, care plans (file plus fields), health checks and growth records, alerts on the student record and in trips and canteen, parent updates through a data-update workflow.
- **Adapts:** lists: conditions, visit reasons, immunisation schedule (pack); custom fields: health record; templates: medical summary, visit note.
- **Admin:** Care → Health. **App:** family: update health info, see visits; nurse (staff role) on phone: log a visit.

### 6.19 Behaviour, wellbeing and safeguarding (module 19)

- **Build:** positive and negative records with school-defined types, severities and points; house points from behaviour (6.26); actions (detention, exclusion, suspension) with workflows; parent notification rules; wellbeing check-ins (student mood in the app), concerns logging with restricted visibility (safeguarding leads only), chronologies, referrals to outside agencies, interventions and their outcomes, dashboards.
- **Adapts:** lists: incident types, severities, actions, intervention types; workflows: `behaviour-incident`, `safeguarding-concern` (restricted); templates: incident letter.
- **Admin:** Care → Behaviour and Care → Safeguarding (restricted page). **App:** teacher: log quickly; family: see what the school shares; student: check-ins.

### 6.20 Learning support and special needs (module 20)

- **Build:** needs register (types from the pack: IEP and 504 for US, EHCP and SEN support for UK, inclusive education categories for India and UAE), individual plans with goals, accommodations and reviews, accommodations applied to exams and online tests (extra time), provision mapping, progress notes, meetings with families and outside professionals, restricted visibility.
- **Adapts:** lists: need types, provisions; workflows: `plan-review`; templates: plan document.
- **Admin:** Care → Learning support. **App:** family: see the plan and goals the school shares.

### 6.21 Communication completion (module 21)

- **Build:** parent-teacher meeting booking (slots per teacher, online or in person, reminders, video links), newsletters (rich layout through templates, email and in-app), message wall or daily bulletin, groups from classes, activities, houses, forms or hand-picked, translation of incoming and outgoing messages on request, delivery and read reports per notice, emergency broadcast (all channels at once, bypassing quiet hours, needs a second person).
- **Adapts:** lists: group types; workflow `emergency` (second person); templates: newsletter.
- **Admin:** Reach → Notices / Messages (tabs: Meetings, Newsletters, Groups). **App:** family: book meetings; teacher: set slots.

### 6.22 Apps (module 22)

Covered by section 5.1, every module's app pieces, and the student and driver roles (exist).

### 6.23 Visitors, gate pass and pick-up (module 23)

- **Build:** visitor log at the front desk (admin on a tablet), pre-registered visitors invited by staff with a QR pass, ID photo and document capture, host notification, badges (templates), sign-out; student gate passes (leaving early) with parent consent and approvals (workflow); authorised pick-up persons per student with photos; pick-up verification (code or QR from the parent's app); late arrivals register; emergency roll call of everyone on site (students present, staff checked in, visitors signed in).
- **Adapts:** lists: visitor purposes, ID types (pack); workflows: `gate-pass`, `visitor-approval`; templates: visitor badge, gate pass; series: visitor, gate pass.
- **Admin:** Campus → Visitors. **App:** family: pick-up QR, authorise pick-up persons, request early leave; staff: invite a visitor.

### 6.24 Certificates and ID cards (module 24)

- **Build:** certificate types (transfer or leaving, bonafide or enrolment, character, study, conduct, migration, sports, participation, custom) from templates with series, requests from families or staff (workflow, fee if the school charges, no-dues check), issue register, verification page by QR (public, shows only that the certificate is genuine), ID cards for students and staff from templates with photo, bulk printing to PDF, digital ID in the app (exists) from the same template.
- **Adapts:** lists: certificate types; workflow `certificate`; templates; series per type.
- **Admin:** People → Students (action) and People → Certificates (register). **App:** family: request a certificate, download issued ones.

### 6.25 Activities, clubs, trips and consent (module 25)

- **Build:** activities and clubs with schedules, capacity, sign-up (first come, choices ranked, manual), fees, attendance registers, coaches; trips with itinerary, risk assessment documents, staff ratios, approvals (workflow), consent forms (form builder) with medical info pulled from health, payments through fees, packing lists, live updates during the trip; one place for parents to consent and pay.
- **Adapts:** lists: activity categories; workflows: `trip`; templates: consent form, trip letter.
- **Admin:** Reach → Events (tabs: Activities, Trips). **App:** family: sign up, consent, pay; student: my activities.

### 6.26 Houses, points, sports and achievements (module 26)

- **Build:** houses (exists as list) with points from behaviour, activities and competitions, leaderboards; sports teams, fixtures, results, sports day events; co-curricular records and achievements with certificates; badges; showcase of achievements in the app.
- **Adapts:** lists: point reasons, sports, achievement levels; templates: certificate.
- **Admin:** Teach → Activities (or Reach, per product map). **App:** everyone: house standings, achievements.

### 6.27 Alumni (module 27)

- **Build:** graduation turns a student into an alumnus with consent to stay in touch, alumni profiles they update, directory with privacy, events and reunions, newsletters, mentoring offers, donations link to 6.42.
- **Adapts:** custom fields: alumnus.
- **Admin:** People → Alumni. **App:** alumni sign-in role (new `alumni` app role, off by default).

### 6.28 Analytics, scheduled reports and report builder (module 28)

- **Build:** scheduled reports (5.2.3), report builder (pick a data set, columns, filters, grouping, charts, save, share with roles), exports to Excel and CSV, dashboard per role, early-warning indicators (attendance, results, behaviour, fees together), data-quality dashboard (missing fields, duplicate guardians), read-only analytics feed for BI tools (a signed CSV/JSON endpoint per dataset).
- **Admin:** Home → Reports and Dashboard.

### 6.29 Groups and multi-campus (module 29)

- **Build:** a group (trust, chain) above schools with its own sign-in: dashboard across schools, consolidated reports, central notices, shared templates, packs and settings pushed to member schools (with locks, 3.1.2), fee settlement per school, staff who work in several schools, students moving between schools.
- **Where:** a third web surface `apps/group` built from `packages/web-ui`, or a group mode of the admin (decide at build time by the smaller change; the plan's preference is a group mode of the admin with a school switcher).

### 6.30 Sign-in and access (module 30)

- **Build:** single sign-on with Google Workspace and Microsoft Entra (Hub capability `identity`), passkeys, field-level permissions (custom fields and sensitive fields per role), session and device lists, school-created roles (D4).

### 6.31 Integrations and open API (module 31)

- **Build:** documented REST API with API keys per school and scopes, outgoing webhooks (exist) for every event, OneRoster export and REST, Google Classroom and Microsoft Teams class sync, LTI 1.3 (6.8), accounting sync (6.11), calendar feeds (iCal per person), Zapier-style generic webhooks.
- **Console:** API keys and usage per school; **Admin:** School → Integrations (the school's own keys within what Tangent allows).

### 6.32 Government and statutory reporting (module 32)

- **Build:** a **statutory pack framework**: each country pack lists report definitions (fields, validations, file format, deadlines) built on the report builder's data sets, with a validation run that lists problems to fix before export. Ship: India (UDISE+ export, APAAR ID fields and bulk validation, RTE quota seats and reimbursement claim, CBSE affiliation and SAR data), UK (School Census, Workforce Census, DfE attendance codes), UAE (KHDA/ADEK/MOE student data exports as published), US (per-state reporting on request: section 8).
- **Admin:** Home → Reports (tab Government).

### 6.33 Security, privacy and backups (module 33)

Covered by 3.7 and existing work; add: data export of a whole school in an open format (exists as zip; add a documented layout), deletion within the pack's time limit at contract end (workflow with second person), per-school audit export.

### 6.34 AI inside modules (module 34)

- **Build** through the Hub's `ai` capability (provider: Anthropic Claude by default, configurable): report-card comment drafts from marks and remarks bank (teacher edits), notice and message translation drafts, lesson plan and quiz drafts from the syllabus, insights on the dashboard (attendance dips, fee risk, admissions bottlenecks) in plain words, ask-the-data assistant for staff with role-limited answers, enquiry scoring in admissions. Every AI feature is a feature switch per school, logs its prompts and answers for audit, never sends data the role cannot see, and never acts without a person confirming.

### 6.35 Documents and form builder (module 35)

- **Build:** form builder (3.6.3) as a page; document library per school (policies, handbooks) with versions and read receipts; documents on records with expiry alerts; e-signatures (draw or type, signer's name, time and IP, a sealed PDF) for consents, contracts and certificates; links to Google Drive and OneDrive through the Hub.
- **Admin:** School → Forms and documents.

### 6.36 Helpdesk, complaints and requests (module 36)

- **Build:** tickets from families and staff (app and email), categories and owners, service levels and escalation (workflow), internal notes, satisfaction after closing, grievances with confidentiality and a statutory timeline where the pack requires one, reports.
- **Adapts:** lists: categories; workflow `ticket`; series: ticket.
- **Admin:** Reach → Helpdesk. **App:** family and staff: raise and follow a ticket.

### 6.37 Surveys and polls (module 37)

- **Build:** surveys from the form builder to any audience, anonymous or named, scheduled, reminders, results with charts and export, quick polls in notices, student wellbeing surveys feeding 6.19.
- **Admin:** Reach → Surveys. **App:** everyone: answer.

### 6.38 Front office (module 38)

- **Build:** call register, postal in and out (dispatch) register, enquiry register (from 6.1), front desk view joining visitors, gate passes and calls.
- **Admin:** Campus → Front office (or inside Visitors, decided by the product map rule 3).

### 6.39 Scholarships, financial aid and quota seats (module 39)

- **Build:** scholarship schemes with criteria, applications (form builder) and awards (workflow), financial aid assessment (income bands as the school sets them), awards applied to invoices, renewals each year, sponsor reports; India pack: RTE seats and reimbursement claims; other packs: their quota schemes as data.
- **Admin:** Money → Fees (tab Scholarships). **App:** family: apply, see awards.

### 6.40 Staff collaboration (module 40)

- **Build:** staff tasks with owners and due dates, department discussions, staff notices (existing notices to staff audiences), shared files per department.
- **Admin:** Reach → Messages (tab Staff). **App:** teacher: tasks.

### 6.41 Careers and university guidance (module 41)

- **Build:** career interests and assessments, university and college lists, application tracking with deadlines, recommendation letters written together by teachers, counselling notes, alumni mentors (6.27), outcomes reports.
- **Admin:** Care → Careers. **App:** student and family: applications and deadlines.

### 6.42 Fundraising and donations (module 42)

- **Build:** campaigns, donations online through the payment provider, pledges, donors linked to households and alumni, donation receipts from templates with the country's tax wording (India 80G, UK Gift Aid declaration, US 501(c)(3) acknowledgement), reports.
- **Admin:** Money → Fundraising. **App:** family and alumni: donate.

---

## 7. Phase 5: Console and admin surfaces

1. **Console:** Blueprints → Starter packs (edit, version, preview, re-apply per area with a second person); Schools → a school → Configuration shows owner, lock, last change (school or Tangent) per setting; Languages (coverage, review, drafts, import/export); Countries (pack per country, legal minimums, providers suggested); Prices with currency; Billing in the contract currency; Hub providers per region.
2. **Admin:** every module's Settings tab; School profile editable; list, workflow, number series, custom field, vocabulary editors; template designer; import mapping; language picker per person; school roles editor (D4).
3. **Commands:** `/new-admin-page` and `/new-screen` start from the module definition and add the module's Settings tab, translations, RTL check and demo data.
4. **Help:** every setting's help line, every page's help panel content in the catalogues, a help centre built from the same content (section 7.6).
5. **Product map** updated with the new pages' homes (section 6 lists each module's group).
6. **Help centre content:** short articles per module, translated, linked from each page's help panel.

---

## 8. What is built only when a school asks

These are rare, tied to particular hardware or vendors, or need a regulator's process per country. Each has a one-line entry in the console's "Planned" list so sales can promise it with a lead time.

| Item | Why it waits |
|---|---|
| Biometric, RFID and face-recognition devices (attendance, gate, canteen, library) | Vendor-specific hardware and SDKs; built for the device a school buys |
| GPS hardware vendors beyond the generic tracker poll (exists) | Each vendor's API differs |
| Cashless canteen with RFID/NFC cards and POS hardware | Hardware and stored-value rules per country (the software wallet in 6.17 is built now) |
| Full general ledger and double-entry accounting | Schools keep their accounting system; exports and sync are built now (6.11) |
| Voice calls and IVR | Telephony rules and costs per country |
| Campus floor tracking, CCTV, panic buttons | Hardware |
| Statutory reports of countries outside D1 (US states, Australia NCCD, others) | Each regulator's format; added as a pack when a school in that place signs |
| US district lottery and school choice; Medicaid billing | US district and health-billing specific |
| Self-hosting by a school | Operations model, not product |
| App centre for third-party apps | Needs partners first; the open API is built now (6.31) |

---

## 8.5 Demo schools (one per D1 pack)

Built with `tools/generate-school.mjs` and `packages/db/src/seed/` from packs, every module with data on every weekday:

| School | Country, curriculum | Languages | Shows |
|---|---|---|---|
| Greenfield International School (exists) | India, CBSE | English, Hindi, Marathi | GST, UPI, lakh grouping, NEP card, UDISE+ |
| A UK school | United Kingdom, GCSE/A level | English | VAT exempt, GBP, DfE codes, School Census, three terms |
| A US school | United States, US grades with GPA | English, Spanish | USD, letter grades and GPA, semesters, Sunday week start |
| A UAE school | United Arab Emirates, British curriculum | Arabic (RTL), English | AED, VAT 5 %, Hijri beside Gregorian, Sat–Sun weekend |

Names, places and examples are international and neutral in designs and docs (owner rule: never Indian examples by default); each demo school uses names fitting its country. The app's mock data (`assets/mock/*.json`) gains the same four schools behind `--dart-define=DEMO_SCHOOL=`.

## 8.6 Docs to update in the same branch

`AGENTS.md` (the new rules: ownership, packs, locale, i18n, RTL, blocks, guards; replace "schools configure nothing"), `CLAUDE.md` pointers, `docs/HANDOFF.md` (a section for this pass; §9 "what is left" points here), `docs/DESIGN.md` (RTL and scripts), `docs/design-system.md` (Flutter RTL and fonts), `docs/architecture.md`, `docs/adding-a-feature.md` (start from the module definition and section 1.2), `docs/API_CONTRACT.md` (new routes), `docs/MOCK_SCHEMA.md`, `docs/integrations.md` (regional providers, `translation`, `identity`, `accounting`, `lms` capabilities), `docs/product-map.md` (homes of new pages), `README.md`. This plan is then marked done and kept as the record.

---

## 9. Gates before the merge

1. `tool/verify.sh` (Flutter analyze and all tests), `pnpm typecheck && pnpm test`.
2. `node tools/audit-ui.mjs` at four widths, light and dark, **plus `--rtl` (Arabic) and `--locale` for each D1 demo school**.
3. `node tools/e2e-flows.mjs` against every demo school (re-run `tools/dev-reset.sh` first), plus **one flow per module switched off** (no trace), plus flows for: a school editing a setting, a locked setting refusing, a risky setting asking a second person, re-applying a pack, adding a language and seeing it in admin and app, a workflow with three steps and an escalation, a template edited and printed, a custom field added and imported.
4. The scans: `scan-gaps`, `scan-fit`, `scan-scroll`, `scan-cutoff`.
5. App shots (`test/tool/shoot_test.dart`) for every role, light and dark, LTR and RTL, each demo school, small phone, phone and tablet; `EMPTY_DATA=true` run.
6. The guard tests of 3.9 green; `modules.test.ts` green with the new declarations.
7. A live run of the app against each demo school (`test/live_api_test.dart` with `LIVE_API`).
8. Speed judged on a **release** build on a low-cost Android phone over a slow network (Home and lists from cache under 300 ms, no jank on scroll), and the load script of 5.3.1.
9. Nothing pretends: a scan for buttons whose handler only shows a toast or does nothing (`tools/scan-dead.mjs`, new) finds none.
10. Report to the owner: what was built, what was not checked (real devices, real providers), and the list of section 10.

---

## 10. Needs the owner (not part of the build)

| Item | What it unblocks |
|---|---|
| SMS provider per country; India needs DLT registration of the company, sender IDs and every template (weeks) | Sign-in codes by text; texts to families |
| WhatsApp business provider and approved templates per language | WhatsApp messages |
| Email sending domain (SPF, DKIM) and a provider | Email to inboxes |
| Payment provider accounts per region (Razorpay/Cashfree for India, Stripe or local for others), test then live | Real online payments |
| Firebase project files (Android, iPhone) | Push notifications on phones |
| Storage bucket (S3-compatible) per data region, and a virus-scanner host | Real file storage and scanning |
| App-links domain | Links that open the app |
| Hosting per data region with point-in-time recovery, and a staging service | Production and rehearsal |
| Alert webhook (Slack/Discord) | Errors reach the team |
| Apple developer account, a Mac build runner, iPhone icon per school | iPhone builds |
| Google Play developer account and upload key | Android store releases |
| Prices per plan and currency; which plan includes which module | Billing and plans |
| Logo, fonts and brand art (after the design system) | The final look |
| Reviewers for each language's translations (D2) | Reviewed translations |
| One app for every school, or one app per school; finding a school by phone number (privacy) | Store listing and school finder |
| Switching messaging to live | Real families get real messages |
| AI provider key (Anthropic) for the `ai` and `translation` capabilities | AI drafts and translation drafts |
| Accounts for Google Workspace and Microsoft Entra apps (SSO), Zoom/Meet/Teams (live classes), accounting systems' developer apps | SSO, live classes, accounting sync |
| Real samples: report cards, certificates, receipts, payslips from schools in the D1 countries | Starter templates that match real ones |
| Design review of pages without canvas boards | Sign-off of the look |
| A penetration test and security certification | Readiness for real schools |
| Pilot schools | One friendly school moved in and watched daily for four weeks (messages delivered, payments reconciled, errors, support requests), then three more |
| Support response times per plan | The support promise sold with each plan |

---

## Appendix A. The 86 settings: owner and change

Owner: **S** school (admin, module's Settings tab), **G** Tangent (console), **S/G** school within a Tangent floor or ceiling. "Change" lists what this plan does to the setting beyond the owner tag.

| Setting | Owner | Where in the admin | Change |
|---|---|---|---|
| `school.name` | S | School profile → Identity | — (store name changes with the next app build) |
| `school.shortName` | S | School profile → Identity | — |
| `school.tagline` | S | School profile → Identity | translated per language |
| `school.place` | S | School profile → Identity | derived from the structured address by default |
| `school.phone` | S | School profile → Identity | E.164, country-aware input |
| `school.email` | S | School profile → Identity | — |
| `school.address` | S | School profile → Identity | becomes a structured address (3.3.5) |
| `school.language` | S | School profile → Languages | any enabled language (enum removed) |
| `brand.logoText` | S | School profile → Identity | D6 |
| `brand.logoFileId` | S | School profile → Identity | D6; app icon via the next build |
| `brand.color` | G | read-only | contrast checked; design review |
| `theme.colors` | G | read-only | — |
| `app.roles` | S/G | School profile → The app | within the plan's roles (D5) |
| `app.layout` | S | School profile → The app | — |
| `app.languages` | S | School profile → Languages | any enabled language (enum removed) |
| `security.twoFactor` | S/G | School profile → Sign-in | school may turn on, not off below Tangent's floor (D7) |
| `security.passwordMinLength` | S/G | School profile → Sign-in | ≥ Tangent's minimum |
| `security.webSessionDays` | S/G | School profile → Sign-in | ≤ Tangent's maximum |
| `security.appSessionDays` | S/G | School profile → Sign-in | ≤ Tangent's maximum |
| `privacy.notice` | S | School profile → Privacy | per language; pack starter text |
| `privacy.officerName` | S | School profile → Privacy | — |
| `privacy.officerEmail` | S | School profile → Privacy | — |
| `privacy.officerPhone` | S | School profile → Privacy | E.164 |
| `privacy.retentionMonths` | S/G | School profile → Privacy | risky (second person); ≥ pack's legal minimum (D8) |
| `privacy.photoConsent` | S/G | School profile → Privacy | pack may force on |
| `privacy.consentRequired` | S/G | School profile → Privacy | pack may force on |
| `notify.rules` | S | School profile → Messaging | within the plan's SMS/WhatsApp allowance |
| `notify.quietFrom` | S | School profile → Messaging | school time zone |
| `notify.quietTo` | S | School profile → Messaging | school time zone |
| `templates.messages` | S | School profile → Messaging | per language; DLT/WhatsApp-template wording goes through a template request (D9) |
| `classes.schoolEdits` | — | — | **removed**; replaced by an area lock (3.1.2) |
| `calendar.weeklyOff` | S | Academic year → Settings | — |
| `calendar.weekStarts` | S | Academic year → Settings | any day (enum widened) |
| `calendar.schoolEdits` | — | — | **removed**; area lock |
| `dashboard.rollClasses` | personal | Dashboard (per person) | moved to `/v1/me/prefs` |
| `vocab.student` | S | School profile → Words | joins the vocabulary block (3.6.7), per language |
| `vocab.students` | S | School profile → Words | same |
| `vocab.class` | S | School profile → Words | same |
| `vocab.classes` | S | School profile → Words | same |
| `letters.family` | S | Students → On the app → Settings | becomes a template (3.6.2), per language |
| `letters.student` | S | Students → On the app → Settings | same |
| `students.required` | S | Students → Settings | becomes the `required` flag on any field incl. custom (3.6.3) |
| `people.houses` | S | Students → Settings (Houses) | becomes a school list (3.6.5), translated |
| `admissions.sources` | S | Admissions → Settings | school list |
| `admissions.stages` | S | Admissions → Settings | becomes the `admissions` workflow (3.6.1); enum removed |
| `staff.schoolAssignsRoles` | — | — | **removed**; the school manages roles (D4) unless locked |
| `attendance.notifyParents` | S | Attendance → Settings | — |
| `attendance.lockAfterDays` | S | Attendance → Settings | — |
| `attendance.goalPct` | S | Attendance → Settings | — |
| `attendance.statuses` | S | Attendance → Settings | becomes the attendance-marks list with meanings and codes; enum removed |
| `leave.reasons` | S | Attendance → Settings | school list, translated |
| `timetable.schoolEdits` | — | — | **removed**; area lock |
| `homework.goalPct` | S | Homework → Settings | — |
| `homework.showClassProgress` | S | Homework → Settings | — |
| `homework.defaultDueDays` | S | Homework → Settings | — |
| `homework.defaultMarks` | S | Homework → Settings | per scheme kind |
| `homework.handedInBy` | S | Homework → Settings | — |
| `exams.defaultMaxMarks` | S | Exams → Settings | per scheme kind |
| `exams.leadDays` | S | Exams → Settings | — |
| `results.showRank` | S | Exams → Settings | joins rank options of the scheme |
| `grading.scale` | S | Exams → Settings (Schemes) | becomes assessment schemes (3.6.6); pack defaults |
| `grading.passPct` | S | Exams → Settings (Schemes) | part of each scheme's pass rules |
| `fees.receiptPrefix` | S | Fees → Settings (Numbers) | becomes the `receipt` number series (3.6.4) |
| `fees.receiptStart` | S | Fees → Settings (Numbers) | same |
| `fees.receiptNote` | S | Fees → Settings | part of the receipt template |
| `fees.paymentMethods` | S | Fees → Settings | school list with kinds; enum removed; pack defaults |
| `fees.lateFeePct` | S | Fees → Settings (Rules) | becomes late-fee rules (percent or fixed, period, grace, cap) |
| `fees.remindDaysBefore` | S | Fees → Settings (Reminders) | becomes a reminder schedule |
| `fees.gstin` | S | Fees → Settings (Tax) | becomes `tax.ids` (India pack: GSTIN) |
| `fees.gstSac` | S | Fees → Settings (Tax) | becomes `tax.codes` (India pack) |
| `fees.gstRatePct` | S | Fees → Settings (Tax) | becomes `tax.rates` |
| `fees.gstHeads` | S | Fees → Settings (Tax) | becomes `tax.byFeeHead` |
| `fees.refundApprovalAbove` | S | Fees → Settings | school currency; risky |
| `fees.dailyTarget` | S | Fees → Settings | school currency |
| `feeStructures.schoolEdits` | — | — | **removed**; area lock |
| `approvals.notice` | S | Notices → Settings | becomes the `notice` workflow |
| `notices.categories` | S | Notices → Settings | school list, translated |
| `events.categories` | S | Events → Settings | school list, translated |
| `events.showGoing` | S | Events → Settings | — |
| `library.loanDays` | S | Library → Settings | per member type |
| `library.finePerDay` | S | Library → Settings | fine rule in school currency |
| `library.maxRenewals` | S | Library → Settings | — |
| `library.maxLoans` | S | Library → Settings | per member type |
| `library.staffMaxLoans` | S | Library → Settings | merged into per member type |
| `transport.nearMinutes` | S | Transport → Settings | — |
| `transport.familyCalls` | S | Transport → Settings | — |

**New settings this plan adds** (all school-owned unless marked): `school.country` (S, set at onboarding; change is risky), `school.timezone`, `school.locale`, `school.currency` (S at onboarding; change is risky and needs Tangent because it converts money), `school.dateFormat`, `school.timeFormat`, `school.phoneCountry`, `school.addressFormat`, `tax.*` (3.4.2), the new modules' settings (section 6), and Tangent floors `security.floor.*`, `privacy.retentionMinMonths` (G, from the pack).

Count: 86 today → **70 school-owned**, **8 school-owned within a Tangent floor or ceiling**, **2 Tangent-owned** (brand colour, theme), **1 personal preference**, **5 removed** (four `*.schoolEdits`, `staff.schoolAssignsRoles`). Several school-owned ones also grow into a richer block (lists, workflow, number series, schemes, tax model) as the Change column says.

## Appendix B. Where India is written into the code (2026-11-12)

Found by scanning `apps`, `packages`, `lib`, `tools` (tests and generated files excluded). Every file below is touched in phase 2; the guard tests of 3.9 keep them clean.

**Currency and Indian number formatting** (`₹`, `en-IN`, `en_IN`, lakh/crore, `INR`), 60+ files: admin `app/kit.tsx`, `design/DesignPage.tsx`, `pages/approvals/ApprovalList.tsx`, `audit/AuditPage.tsx`, `dashboard/dashboard.view.tsx`, `dashboard/DashboardPage.tsx`, `events/EventsPage.tsx`, `fees/CollectFee.tsx`, `fees/FeesPage.tsx`, `fees/InvoiceSheet.tsx`, `fees/InvoicesPage.tsx`, `fees/OnlinePaymentsPage.tsx`, `gallery/GalleryPage.tsx`, `library/LibraryPage.tsx`, `messages/MessagesPage.tsx`, `notices/NoticesPage.tsx`, `phone/PhoneDashboard.tsx`, `privacy/PrivacyPage.tsx`, `profile/ProfilePage.tsx`, `reports/ReportsPage.tsx`, `status/StatusBoard.tsx`, `students/StudentDialogs.tsx`, `students/students.view.tsx`, `students/StudentsPage.tsx`, `timetable/TimetablePage.tsx`, `transport/TransportPage.tsx`, `year/SetupSections.tsx`, `year/YearPage.tsx`; api `school/approvals.service.ts`, `documents.service.ts`, `fees.service.ts`, `hooks.controller.ts`, `notices.service.ts`, `office.service.ts`, `payments.service.ts`, `pdf.ts`, `transport.service.ts`; console `app/format.ts` (`rupees()`), `app/ThemeEditor.tsx`, `pages/fleet/FleetPage.tsx`, `health/HealthPage.tsx`, `modules/ModulesPage.tsx`, `school/PlanTab.tsx`, `school/SchoolPage.tsx`; console-api `migration.ts`, `ops.ts`, `provisioning/drivers.ts`, `wizard.ts`; packages `contracts/src/dates.ts`, `integrations.ts`, `settings-meta.ts`, `db/src/import/kinds.ts`, `db/src/seed/greenfield.ts`, `integrations/src/providers/payments.ts`, `web-ui/src/login/useLogin.ts`; app `core/utils/formatters.dart`, `features/dashboard/widgets/home_cards.dart`, `library/views/library_view.dart`, `notifications/views/notifications_view.dart`; tools `e2e-flows.mjs`, `generate-school.mjs`.

**India time** (`IST_OFFSET_MS`, `istToday`, `Asia/Kolkata`, `IST`), 41 files: admin `admissions/AdmissionsPage.tsx`, `approvals/ApprovalList.tsx`, `audit/AuditPage.tsx`, `events/EventsPage.tsx`, `exams/ExamsPage.tsx`, `gallery/GalleryPage.tsx`, `homework/HomeworkPage.tsx`, `notices/NoticesPage.tsx`, `privacy/PrivacyPage.tsx`, `students/StudentDialogs.tsx`, `students/StudentRecord.tsx`, `students/StudentsPage.tsx`, `timetable/TimetablePage.tsx`, `year/YearPage.tsx`; api `school/attendance.service.ts`, `dashboard.service.ts`, `documents.service.ts`, `family.service.ts`, `fees.service.ts`, `hub.service.ts`, `learning.service.ts`, `library.service.ts`, `modules.controllers.ts`, `notices.service.ts`, `office.service.ts`, `payments.service.ts`, `students.service.ts`, `transport.service.ts`, `year.service.ts`; console `billing/BillingPage.tsx`, `compliance/CompliancePage.tsx`; console-api `policy.ts`, `schools.ts`; packages `config-engine/src/modules.ts`, `contracts/src/config.ts`, `contracts/src/dates.ts`, `db/src/import/kinds.ts`, `db/src/seed/greenfield.ts`, `db/src/seed/modules.ts`, `web-ui/src/fields.tsx`.

**Indian tax, payments, boards and messaging rules** (`GST`, `UPI`, `netbanking`, `CBSE`, `ICSE`, `UDISE`, `DLT`), 32 files: admin `design/DesignPage.tsx`, `fees/CollectFee.tsx`; api `school/dashboard.service.ts`, `documents.service.ts`, `family.controller.ts`, `fees.service.ts`, `hooks.controller.ts`, `payments.service.ts`; console `integrations/IntegrationsPage.tsx`, `onboarding/WizardPage.tsx`, `school/ConfigTab.tsx`, `school/SchoolPage.tsx`; console-api `ops.ts`; packages `config-engine/src/modules.ts`, `contracts/src/config.ts`, `console.ts` (`SCHOOL_BOARDS`), `import.ts`, `integrations.ts`, `school.ts`, `settings-meta.ts`, `db/migrations/registry/0000_amazing_morph.sql` (never edited: a new migration changes what it set), `db/src/import/kinds.ts`, `import/sample.ts`, `registry/schema.ts`, `seed/greenfield.ts`, `integrations/src/hub.ts`, `providers/sms.ts`; app `core/translations/app_translations.dart`, `en_redesign.dart`, `data/repositories/assistant_repository.dart`, `features/fees/views/fees_view.dart`, `pay_sheet.dart`, `receipt_view.dart`.

**Indian phone numbers** (`+91`): console-api `ops.ts`; `db/src/import/sample.ts`; `db/src/seed/greenfield.ts`, `seed/modules.ts`; app `en_redesign.dart`; tools `e2e-flows.mjs`, `provision-demo.mjs`.

**Languages fixed to English, Hindi, Marathi:** `contracts/src/config.ts` (`school.language`, `app.languages` enums), `contracts/src/settings-meta.ts` (`LANGUAGES`), `lib/core/translations/app_translations.dart`, `lib/core/theme/app_typography.dart` (Anek Latin and Devanagari only), `apps/api/assets/fonts` (Noto Latin and Devanagari only).

**Indian demo content in shared places** (names, cities): seeds and samples are rewritten per demo school (8.5); designs and docs use neutral international examples.

## Appendix C. App items from the product audit still open on 2026-11-12

Checked against the code on 2026-11-12. **Done in the one-pass** (not repeated): roles switched from the console; student branch; driver role and trips; teacher dock and quick actions from config; live updates (chat, typing, read, notifications, bus); notices acknowledge and read on the server; chat delete and report; leave withdraw and reasons from the school; notification undo; homework returned with note and resubmit rules; exam papers in the family API; teacher roster API; transport call rules; library rules on the server; privacy notice from the profile service at runtime.

**Open** (each is built in phase 3 or the module's phase-2 pass; check each again at the start):

| Area | Item | Verdict |
|---|---|---|
| Whole app | Module check on every entry point (dock, tiles, rows, notification taps, search) | hidden when off |
| Whole app | Forgot password | add (server `auth.reset` exists) |
| Whole app | Change password, phone, email; signed-in devices | add under Profile → Account |
| Whole app | Real files everywhere (homework scan, attach, chat attach "soon", profile photo) | one upload path (5.1.1) |
| Whole app | Real share, save, download (receipt, results, homework, notices, gallery, timetable) | real (5.1.2) |
| Whole app | Push notifications | register, open the right screen (5.1.5) |
| Whole app | Exam timetable screen | add |
| Whole app | Teacher class roster and student profile screens | add (API exists) |
| Whole app | Teacher timetable tab with substitutions | add |
| Whole app | Edit and delete what you created (homework, notices) with "tell families" | add where the API allows (it does) |
| Whole app | Consent and data rights in Settings → Privacy | add |
| Whole app | Privacy notice and officer as config, not `AppConfig` statics | move |
| Whole app | School data in code (categories, houses, grading, terms, library limit, receipt number, ID prefix, address, languages) | all from config (see rows below) |
| Whole app | Offline: cached school profile; queued error reports | add (two `shortcut:` comments) |
| Whole app | Failed config load is silent | retry, then a plain banner |
| Shell | Consent asked of every role the school asks | per role setting |
| Sign-in | Onboarding pages (`onboarding_view.dart`) | remove |
| Sign-in | OTP resend fixed at 30 s | from the server's answer |
| Sign-in | Demo card on school builds | demo content only |
| Sign-in | Welcome per role, "seen" on the account | merge |
| Home | One visible search button | fix |
| Home | Bell badge only for unread | fix |
| Home | Profile capsule duplicate | remove |
| Home | Children strip: one stamp, tap switches the child first | fix |
| Home | "Both children" label | count-aware |
| Home | Quiet-child match by first name | by ID |
| Home | Due "See all" opens what it lists | fix |
| Home | Exam card opens the exam timetable | fix |
| Home | Category colours from the school's list | fix |
| Home | Empty Home art | add |
| Home | `BigNumber` in a view with `fontSize:` | move to `core/widgets`, type role |
| Home | `₹` glyph on the dues card | currency from the school |
| Academics | Records rows from modules; "Ask teacher" hidden when chat is off; subject card affordance | fix |
| Attendance | Page title; weekday letters from locale and week start; school's marks; "Explain" module check; "Ask for notes" opens the class teacher; unmarked day line | fix |
| Timetable | Add to the phone's calendar; day picker under the title; off days greyed; week switcher; substitutions marked | fix |
| Homework | Reminder bell (local notification), real share and attachment; grade colour from the scheme (`startsWith('A')`); scan to one PDF uploaded | fix |
| Results | Report card PDF download; chart from 0; "out of" per subject; grade tone from the scheme; every subject with remark; picker contrast on art | fix |
| Fees | "Pay now" hidden without online payment; methods from the connection; provider's word for the method; failure reason and retry; "Remind me early" merged into notification settings; receipt number from the server (`GIS/` in `receipt_view.dart`); school address from the profile; "Receipt" title on old receipts; share and save the server PDF | fix |
| Notices | Category badges from the school's list, translated; pinned carousel; real share and attachment; exam time from the exam timetable | fix |
| Chat | Avatar colour from role or subject; new chat opens an existing thread; call button only where allowed with office hours; quick replies per role; real attachments | fix |
| Events | Day list for two events; category colours; one time format; RSVP only when asked, children and adults; remove invented "gates open"; phone calendar; venue as written with directions; share | fix |
| Leave | Terms from the school calendar (fixed halves in `leave_controller.dart`); real attachment; child picker; half day; weekday letters from locale | fix |
| Library | Book fair from an event category flag; limits from rules (`limit = 3`); renew until due unless reserved; "available now" filter; ISBN scan; fines, history, reservations, cancel; staff borrowing; number grouping from locale (`en_IN`) | fix |
| Transport | Real map from the maps connection, dark style; "Live" only when running and fresh; recentre works; the child's own stop; morning/afternoon trips and per-child bus; "not running today"; boarded and dropped from the driver's marks | fix (check which the one-pass already did) |
| Gallery | Year start from the calendar; real share and save within the school's rule; remove favourite; report goes to the office; photo consent respected; a route per photo | fix |
| Notifications | Type map and `₹` glyph from the message list and currency; tap guarded when the module is off; times by locale; link to notification settings | fix |
| Search | Scopes from modules (books, receipts added); people by module and role; class name as written; dates by locale; event tile colour from category | fix |
| Profile | Houses from the list; ID from the admission number (`GIS-`); academic year from the calendar; class name as written; photo uploaded with approval; remove "Around school" tiles; all guardians, "Ask office to correct" | fix |
| Settings, About, Help | Languages from the school; Display and Notifications split, saved on the account; Privacy and Terms links; Help: office thread by ID, FAQs from the console, contacts from the profile; developer screen only on debug and demo | fix |
| Teacher | Home bell badge; profile capsule; "Needs you" rows open items; leave approve with note, undo, stays open; class card subjects from the timetable (`?? 'maths'`); period attendance for teachers without a class; mark attendance date within the window, houses from data, translated letters, holiday guard, approved leave prefilled, re-submit edits; assign homework draft on the server, real upload, date picker, ungraded option, subject from the class; marks entry picks the exam and its maximum (`maxMarks = 20`), lock after publish; post notice audiences and pinning by permission, categories from the list, attachments, schedule, edit, delete; grading real sort, the submitted file shown, mark starts empty, school scheme, return for redo, regrade | fix (check which the one-pass already did on the server side and wire the app) |
