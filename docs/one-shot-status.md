# One-shot status

Where the plan in `docs/one-shot-plan.md` stands on branch `feat/adapt-one-shot` (not merged, not pushed). Kept current as
work lands; each line names the plan section. **Done** = built, tested at the fast-check level (types, the touched
package's tests, the rule tests). The full gate (section 9) has not run yet.

## Phase 1: Foundations (section 3)

| § | Item | State |
| --- | --- | --- |
| 3.1 | Settings ownership: owner per setting, Tangent locks and floors per school, school writes from the admin with audit and second person for risky ones, Settings tabs per module | Done |
| 3.2 | Starter packs: country (IN, GB, US, AE, generic) and curriculum layers, wizard summary, neutral defaults | Done; re-applying a pack's part to a live school from the console is not built |
| 3.3 | Country, time zone, locale, currency per school; dates on the school's clock; phones in E.164 per country | Done |
| 3.3.1 | Week starts any day | Done |
| 3.3.5 | Structured addresses in the country's parts and names, postal code checked | Done (students; staff and guardians keep one line) |
| 3.3.6 | Identity documents per country (Aadhaar, APAAR, PAN; UPN, ULN, NI; Emirates ID…) as the school's own fields with formats | Done |
| 3.3.7 | Given and family names, display order, names in a second script | **Not built** |
| 3.3.8 | Any number of terms; year starting any month | Terms were already the school's data; the app's June assumptions removed (gallery, leave). Reporting periods separate from terms: **not built** |
| 3.4 | Money in any currency with its decimals, exact (numeric) everywhere; payment methods the school's list | Done |
| 3.4.2 | Tax model for any country (GST, VAT, sales tax; inclusive or added at billing; parts) replacing GST settings | Done |
| 3.4.4 | Tangent's own prices with their currency | Price list currency named once (`PRICE_CURRENCY`, rupees today); prices in other currencies need the owner's price list (D13) |
| 3.4.5 | Regional payment, messaging and email providers (Stripe, PayPal, GoCardless, Telr, Vonage, Unifonic, SendGrid…) | **Not built** (Razorpay, Cashfree, Twilio, MSG91, Gupshup, Kaleyra, SES, SMTP, Resend exist) |
| 3.5 | Any language: catalogues for every surface, server text, app packs from the server, RTL, fonts per script, PDFs per script, messages per recipient language, translation store and console Languages page | Done |
| 3.5 | Translations drafted for hi, mr, ar, es, fr | Partly: app and admin nearly complete, shared texts and console about a third; the rest reads in English until drafted (console can draft through a translation provider once one is connected) |
| 3.5.4 | Translations of the school's own data (list items, field names, steps) | Done for lists, fields, workflow steps, templates; notices and subject names: **not built** |
| 3.6.1 | Workflow engine: steps per request kind, who takes each, amount conditions, time limits (remind, escalate, approve), app leave review through it | Done (leave, waivers, notices, admissions, photos, cancelled receipts); admissions stages still a fixed list |
| 3.6.2 | Template designer: receipts and report cards as blocks with placeholders, per-language wording, page sizes, preview | Done for receipts and report cards; letters, certificates, ID cards and the rest come with their modules |
| 3.6.3 | Custom fields on student and staff records, all kinds, in forms, record, import, template, export, app | Done; the form builder (application, consent, survey forms) is **not built** |
| 3.6.4 | Number series for receipts and admissions | Done; other documents' series come with their modules |
| 3.6.5 | School lists (one shape, one editor, per-language names, retire) | Done for genders, relationships, blood groups (plus earlier attendance marks, payment methods, categories, houses) |
| 3.6.6 | Grading schemes by year group and subject, points and GPA, descriptors, pass or fail | Done; rubrics, competencies, weighting and best-of-N rules are **not built** |
| 3.6.7 | Vocabulary per language, in server text too | Done |
| 3.6.8 | Import mapping remembered, list values read by name, custom-field columns | Done; value mapping editor and other systems' presets beyond the existing ones are **not built** |
| 3.7 | Privacy notice per country's law, consent and photo consent, student age of consent | Done; data region per school and breach deadlines: **not built** |
| 3.9 | Guards | Done: no literal text, catalogue keys, English chosen in code, CSS in catalogues, RTL, India only in the India pack, money exact, jobs on each school's clock. Not done: "every setting appears on an admin Settings tab" and "every module declares its blocks" checks |

## Phase 2: Modules to the standard (section 4)

Moved onto the foundations where the foundations touch them (students, staff, attendance marks, fees, tax, receipts,
report cards, approvals, gallery, library fines, transport fees, notices dates, events calendar, privacy, roles: the
school makes and changes its own roles within its plan unless Tangent holds them with `roles.schoolEdits`). Not done, by
module: dashboard roll classes as a personal preference; government reports tab; guardians' multiple households and
contact preferences per channel; admissions stages from the workflow engine and online
application; attendance sessions (AM/PM); timetable day cycles, A/B weeks, rooms; homework settings tab; exam types,
papers, remarks bank; fee structures by category with instalments, late-fee rules, reminder schedules; notice audiences
beyond classes and machine translation; chat rules per role pair; RSVP rules; library member and item types and scanning;
transport sessions and attendants; console billing in a contract currency.

## Phase 3: One-pass leftovers (section 5)

| Item | State |
| --- | --- |
| App: open, save, share receipts, report cards, homework and notice files; add events, homework and the timetable to the phone's calendar | Done (signed links, calendar files; no new plugin) |
| App: forgot password, change password, sign out everywhere | Done; change phone or email and a signed-in devices list: **not built** |
| App: privacy notice and consent | Done earlier; withdraw consent and data requests from the app: check |
| App: marks entry maximum, receipt numbers, student card number, library limit, grade colours, leave terms, gallery year, fake share and save buttons | Done |
| App: one upload path (photos, scans, camera) for every attachment; chat attachments | **Not built** (homework hand-in upload exists) |
| App: push registration and notification routing | Code exists from the one-pass; Firebase files need the owner |
| App: exam timetable screen, teacher roster, onboarding pages removal, offline caches, OTP resend from server | **Not built** |
| Server: zip of photos matched by admission number, thumbnails, scheduled reports, background imports, storage use, draft connections not routable | **Not checked in this pass** |
| Readiness: load script, runbooks, status page, store kit, billing | **Not built** |

## Phase 4: New modules (section 6)

**Not started.** About thirty modules (admissions completion, staff leave, curriculum, timetable generation, diary,
learning, online tests, accounting exports, HR and payroll, hostel, inventory, canteen, health, behaviour, special needs,
visitors, certificates and ID cards, activities and trips, houses and points, alumni, analytics, multi-campus, open API…).

## Gates (section 9)

Run on 17 and 18 November 2026 (everything on this branch at commit `e34365f`):

- Build and types: pass. Package tests: pass. API 133/133, console-api 70/70. Flutter analyze (no errors or
  warnings) and tests: pass. Browser flows: 55/55.
- UI audit, four widths, light and dark: clean (one page failed only on a network drop and was clean on a re-run).
  Right-to-left: clean after fixing the Fees total on phones.
- Scans: `scan-scroll` clean. `scan-fit` (42), `scan-gaps` (197) and `scan-cutoff` (79) still report findings; the
  ones checked are rolling-digit counters and names shortened with an ellipsis by design, or older than this branch
  (setup tables wider than a phone under Academic year, columns of unequal height). Not worked through one by one.
- App shots: parent and teacher, light and dark, look right.
- Fixed on the way: CSV and PDF errors masked as a 500; the console's Configuration card squeezed into one column
  (also on `main`); the template block picker too narrow; the reader-language header without a root element;
  `verify.sh` passing with no SDK.

## Needs the owner (section 10)

Translation provider key (to draft the remaining texts), price lists in other currencies, Firebase files for push, store
accounts, reviewing machine-drafted translations, and the decisions listed in section 10 of the plan.
