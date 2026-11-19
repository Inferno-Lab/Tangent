# One-shot status

Where the plan in `docs/one-shot-plan.md` stands on branch `feat/adapt-one-shot` (not merged, not pushed). **Done** =
built, with its server tests where it has a server side, and checked by the full gate below. "Known gap" = a limit that
is written down, not a half-built screen.

## Phase 1: Foundations (section 3)

| § | Item | State |
| --- | --- | --- |
| 3.1 | Settings ownership: owner per setting, Tangent locks and floors per school, the school's writes from the admin with audit and a second person for risky ones, Settings tabs per module | Done |
| 3.2 | Starter packs: country (IN, GB, US, AE, generic) and curriculum layers, wizard summary, neutral defaults; re-applying part of a pack to a live school from the console (second person) | Done |
| 3.3 | Country, time zone, locale, currency per school; dates on the school's clock; phones in E.164 per country; weeks starting any day | Done |
| 3.3.5–3.3.7 | Structured addresses per country, identity documents per country as the school's own fields, given and family names with display order and a second script | Done |
| 3.3.8 | Any number of terms, years starting any month, reporting periods apart from terms (imported, carried over at year end, chosen in reports); public holidays from the Hub (Nager.Date, Calendarific) | Done |
| 3.4 | Money exact in any currency's decimals; payment methods the school's list; tax for any country | Done |
| 3.4.4 | Contracts with their own billing currency and rate; data residency checked when a school moves | Done; Tangent's own price list stays in one currency until the owner gives others (D13) |
| 3.4.5 | Regional providers: Stripe, PayPal, GoCardless, Checkout.com, Vonage, Unifonic, SendGrid, Mailgun, Postmark (besides Razorpay, Cashfree, Twilio, MSG91, Gupshup, Kaleyra, SES, SMTP, Resend), suggested by country | Done; each needs the school's own account and keys |
| 3.5 | Any language: catalogues for every surface, server text, app packs from the server, RTL, fonts per script, PDFs per script, messages per recipient language, translation store | Done; drafts for hi, mr, ar, es, fr partly done (needs a translation provider key to finish) |
| 3.5.4 | Translations of the school's own data (lists, fields, steps, templates) | Done; notices and subject names: known gap |
| 3.6.1 | Workflow engine for every request kind (leave, staff leave, waivers, notices, admissions, photos, cancelled receipts, gate passes, certificates, invited visitors) | Done |
| 3.6.2 | Template designer: receipts, report cards, certificates, ID cards, visitor badges, gate passes; photo and QR blocks; card-size pages | Done |
| 3.6.3 | Custom fields (student, staff, visitor) and the form builder (consent, surveys; in the app, by link, answers downloaded) | Done |
| 3.6.4 | Number series: receipts, admissions, certificates (and per certificate type), visitor badges, gate passes | Done |
| 3.6.5 | School lists everywhere a module needs one | Done |
| 3.6.6 | Grading schemes, rubrics, best of N, rounding | Done |
| 3.6.7 | Vocabulary per language | Done |
| 3.6.8 | Import mapping remembered, value mapping, background imports for big files | Done |
| 3.7 | Privacy notice per country, consent and photo consent, data requests from the app with a downloadable copy of a family's data, runbooks for breaches and data rights | Done; the breach clock is a fixed 72 hours (known gap) |
| 3.9 | Guards: catalogue keys, English in code, RTL, India only in the India pack, money exact, jobs on each school's clock, every setting on an admin page, every module declares its building blocks | Done |

## Phase 2: Modules to the standard (section 4)

Done: people (households, names, leaving, line managers), admissions (the school's stages, online application),
attendance (morning and afternoon registers, persistent absence, own roll classes), timetable (A/B weeks, day cycles,
rooms with bookings, a day's own bell times), exams (kinds, invigilators, graded subjects, remarks, year rank, weighted
year result, rubrics, best of N), fees (categories, late-fee rules, reminder schedules), notices (targets by year group,
house and role), chat (rules per role pair), events (RSVP closing day, adults, capacity), library (item and member types,
fines with grace and cap, scanning), transport (trips a day, attendants, near-stop alerts once a trip), roles (the
school's own), reports (sent by themselves on a schedule).

## Phase 3: One-pass leftovers (section 5)

| Item | State |
| --- | --- |
| App: open, save, share documents; add to the phone's calendar | Done |
| App: forgot and change password, sign out everywhere, change phone or email by code, signed-in devices | Done |
| App: privacy answers, photo consent, data requests and withdrawing consent | Done |
| App: one upload path for attachments, chat photos | Done |
| App: exam timetable, a teacher's class list, the school's forms, no first-run pages, offline start with the school's look, crash reports queued offline, code resend wait from the server | Done |
| App: push registration and routing | Code done; Firebase files need the owner |
| Server: photo zip matched by admission number, photo thumbnails, scheduled reports, background imports, draft connections not routable | Done; storage use is measured when asked, not nightly (known gap) |
| Readiness: load script (`tools/load.mjs`), runbooks (`docs/runbooks/`), store kit per school (`tools/store-kit.mjs`, kept by the build workflow) | Done; the store's reviewer account is typed into the kit by hand (known gap) |

## Phase 4: New modules (section 6), the five chosen

Each module is one record in `MODULES` with its settings, lists, workflow, templates, series, permissions and messages;
its own migrations, server routes behind `@RequireModule`, admin page, app screens, sample content, demo seed for every
school day, and server tests of the paths that go wrong (`apps/api/test/five-modules.test.ts`).

| § | Module | What it does |
| --- | --- | --- |
| 6.3 | Staff attendance and leave (`staffAttendance`) | Office marks with the school's staff marks; check-in from the app inside a time window, near the school where it sets a place and radius, late and early marks; leave types with days, monthly accrual, carry-over, half days and pay; leave through the `staff_leave` steps, balance checked when asked and again when approved; office-recorded leave; cancelling; balance adjustments and opening balances by import; the month per person for payroll (CSV); lessons to cover on the day's register. Admin: People → Staff attendance. App: My day, check-in card on staff's Home |
| 6.7 | Class diary (`diary`) | Entries by kind (the school's list) for a day, per subject or the whole class, with attachments and remarks for one child that only that family reads; who writes (class teacher or every teacher of the class); families acknowledge, the teacher sees who has. Admin: Teach → Diary. App: Diary for families (tab, card, profile) and teachers |
| 6.21 | Parent-teacher meetings (`ptm`) | A day, its hours, slot length and gaps, in person, online or either, which classes' families book and which teachers (or each class teacher); slots made per teacher; one booking per child per teacher, never two at once for one family, until booking closes; hours locked once booked; teachers close times (cancelling a booking, the family told) and give links; office books and cancels; a reminder the day before. Admin: Reach → Meetings. App: Meetings for families and teachers |
| 6.23 | Visitors, gate pass and pick-up (`visitors`) | Sign-in with badge numbers, ID document, photo and custom fields, host told, badge PDF, sign-out; invitations with a pass code (staff invites can need approval: `visitor` steps); gate passes asked by families or by the school (the family agrees first), approved through `gate_pass` steps, numbered, printed, let out only when approved; people named to collect a child, the family's code for the day, pick-up recorded and the family told; late arrivals (turning an absent mark into late); the emergency roll call on screen and printed. Admin: Campus → Visitors. App: Leave early and pick-up for parents, Visitors for staff |
| 6.24 | Certificates and ID cards (`certificates`) | Types in the school's words with placeholders, own series, fee (an invoice on the family's fees), no-dues check (fees and library), families allowed or not; requests through `certificate` steps; the words kept as issued; issue register (PDF), revoke; a public page from each certificate's QR code that says genuine or revoked; ID cards for classes, chosen students or staff at card size with photo and QR. Admin: People → Certificates, and from a student's record. App: Certificates for parents |

Known gaps in these modules: voice notes in the diary (needs a recording plugin); a QR to scan at the gate (the code is
typed); video meeting links made by a Hub provider (links are pasted); devices for staff attendance (fingerprint or card
readers, section 8); a dashboard card for staff today and visitors on site (the dashboard's board has fixed slots); the
other twenty-five modules of section 6, by the owner's choice.

## Gates (section 9)

Last full run, 19 November 2026, on `fix/one-shot-gate` (after the one shot was merged):

- Build and types: pass. Package tests: security 8, api-client 7, config-engine 25, tenancy 1, contracts 46,
  integrations 11, web-ui 25, db 35. Console API 73/73. API 186/187 in the full run; the one failure (a meetings test that depended on row order) fixed and its file re-run twice, 14/14.
- App: `tool/verify.sh` pass (analyze clean, 55 tests); screenshots of the new screens checked, parent and teacher,
  light and dark.
- Browser flows: 60/60. UI audit, every page, four widths, light and dark: clean. Right-to-left audit: clean.
- Load (`tools/load.mjs`, the five modules' reads included): every read within target (admin p95 under 210 ms against
  1000 ms, app p95 under 62 ms against 300 ms).
- Scans: `scan-scroll` and `scan-fit` clean. `scan-gaps` and `scan-cutoff` report what is so by design: space under the
  last card of a short list (cards are never stretched), the settings column's fixed reading width, counters whose
  rolling digits sit inside a mask, long names shortened with an ellipsis; and findings on pages older than the one shot
  (reports' side list, the console's school page). The ones in the one shot's own pages were fixed.
- Fixed by this run: reports timing out right after a seed or an import (the tables' statistics were stale; they are
  refreshed now), the load script's invoice address, the roll call's columns, block names cut on a phone, and a
  meetings test that depended on row order.

## Needs the owner (section 10)

Translation provider key (to draft the remaining texts), price lists in other currencies, Firebase files for push, store
accounts and the reviewer's account, providers' accounts and keys, reviewing machine-drafted translations, and the
decisions listed in section 10 of the plan.
