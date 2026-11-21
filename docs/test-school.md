# The test school: Sunrise Valley School

Tangent has no demo school and no sample content. Everything is tested against **Sunrise Valley School**: a CBSE school in
Whitefield, Bengaluru, in the middle of its year. It is moved in the way a real school moves in. It starts as a new, empty
school, and then its own files go in through the one import engine. The files look the way the systems schools use really
write them.

The dataset is generated: `tools/dataset/school.mjs`. It is generated for **today**, so the school is always mid-year: its
attendance runs from 1 April to yesterday, and its fees are billed up to this quarter. The same seed gives the same school.

## What is in it

| | |
| --- | --- |
| Students | 840 in 24 classes (1 A to 12 B), 14 who joined this term, 8 who have left (with transfer certificates) |
| Families | about 650; both parents for most, a few with no phone, sibling, staff-ward and RTE concessions |
| Staff | 62: principal, vice principal, office, accounts, 47 teachers, librarian, transport, 6 drivers |
| Calendar | April to March, the Karnataka holidays and the term breaks; school Monday to Saturday |
| Attendance | every school day since April (present, late, leave, absent), a cold going round in August |
| Exams | Periodic Test 1 and the Half-Yearly Examination, published, with marks |
| Fees | quarterly tuition by grade band, annual and activity charges, transport; paid on time, late, in two halves, or not yet |
| Timetable | an aSc week of 1,056 lessons, no clashes |
| Library | about 100 titles (NCERT textbooks among them) from Koha, with loans |
| Files | photos and report cards in two zips, four circulars as PDFs |

## The files, and where each comes from

| File | Kind | Written as |
| --- | --- | --- |
| `01-academic-year.csv` to `03-reporting-periods.csv` | year, terms, reporting periods | Tangent's templates |
| `04-holiday-list.xlsx` | holidays | an office spreadsheet with title rows above the header |
| `05-subjects.csv`, `06-bell-timings.csv` | subjects, the bell | Tangent's templates |
| `07-staff-register.xlsx` | staff | an HR register with title rows |
| `08-classes.csv` | classes and class teachers | Tangent's template |
| `09-students-fedena.csv` | students and both parents | a Fedena student export (dd/mm/yyyy, "9-B", phones written every way) |
| `10-students-left.csv` | former students | Tangent's template |
| `11-family-contacts.csv` | family phones and emails | a Google Contacts export |
| `12-admission-enquiries.csv` | admissions | Tangent's template |
| `13-fee-heads.csv` to `16-fee-collection-register.csv` | fee heads, structure (xlsx), opening dues, receipts | the old ERP's reports |
| `17-attendance.csv` | attendance | the old ERP (P, L, LV, A; dd-mm-yyyy) |
| `18-marks.csv` | marks | the old ERP |
| `19-timetable-asc.xml` | timetable | an aSc Timetables XML export |
| `20-library-koha.mrc` | library catalogue | a Koha MARC 21 export (ISO 2709) |
| `21-library-loans.csv` to `24-pickup-people.csv` | loans, transport, leave balances, pick-up people | registers |
| `25-student-photos.zip` | photos | a folder of `<admission no>.jpg`; 5 that match no one, on purpose |
| `26-report-cards.zip` | report cards and certificates | the old ERP's PDFs, named by admission number |
| `circulars/*.pdf` | notices and events to post by hand | the principal's circulars |

`node tools/dataset/generate.mjs --out ./sunrise-valley` writes them all to a folder, with `manifest.json` (the totals and
who is who), to open them or to move them in by hand through the console.

## Loading it

- **Locally:** `bash tools/dev-reset.sh` starts PostgreSQL and the server, then runs `tools/dataset/load.mjs`. That script
  goes through the console: the new-school wizard, the configuration, every file through Migration, then the principal's
  first sign-in and the two zips. It takes a few minutes.
- **Server tests:** `apps/api/test/harness.ts` builds the school once a run with `tools/dataset/build.mjs` (the same files
  through the import engine, in-process) and copies it for each test file.
- **App tests:** they read the school `dev-reset` loaded. `node tools/dataset/app-sessions.mjs` signs the app's people in
  once, and then `flutter test` runs (tools/pre-push.mjs and `tool/verify.sh` do both).

## Signing in

The school's codes are always real and random. On a local or test track they land in the console's **Test inbox**
(Console → Integrations → Test inbox, while messages are in sandbox mode), and the tools read them from there (`tools/dataset/session.mjs`).

| Who | Sign in with |
| --- | --- |
| Console | `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` from `.env`, then the console's own test-track code `DEMO_CODE` |
| Principal | `principal@sunrisevalley.example` and `TEST_PASSWORD` from `.env`, then the code in the Test inbox |
| Other staff | the vice principal, office, accountant, the class teacher of 8 A, a maths teacher and a driver: their emails are in `.tangent-data/manifest.json` (`people`), with `TEST_PASSWORD` |
| Families | the parent's phone (in the manifest: `parentOfTwo`, `parentOfOne`), then the code in the Test inbox; families have no password |

Five codes a person in fifteen minutes is the school's limit. The tools keep a session for ten minutes in
`.tangent-data/sessions.json`, so running them one after another stays well under it.

## Changing it

Change `tools/dataset/school.mjs`. A file it writes has to import with no row left out: `build.mjs` stops on the first
problem. Then run `bash tools/dev-reset.sh`. The server tests rebuild the school on their next run. When a real school's
file does not import, the importer gets better (`packages/db/src/import`). The dataset is not bent to fit.
