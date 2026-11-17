import type { SettingKey } from './config.js';
import { COUNTRIES, LOCALES, ZONES } from './locale.js';
import { localized, LANGUAGE_LIST, languageLabel } from './i18n.js';

const regionName = (c: string): string => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c;
  } catch {
    return c;
  }
};

/** How the console edits a setting. The console builds its Configuration forms from this list, so a new setting needs no new screen. */
export type SettingKind =
  | 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'color' | 'time' | 'date' | 'language'
  | 'multi' | 'appRoles' | 'appLayout' | 'notifyRules' | 'templates' | 'classes' | 'logo'
  | 'houses' | 'categories' | 'strings' | 'gradingScale' | 'paymentMethods' | 'attendanceMarks' | 'vocabulary' | 'list' | 'customFields' | 'workflows' | 'taxSplit' | 'addressFormat' | 'gradingSchemes' | 'documentTemplates' | 'admissionStages' | 'timetableCycle' | 'weights' | 'lateRule' | 'reminderDays';

export interface SettingMeta {
  /** One of the school-wide groups, or the key of the module that owns the setting (config-engine's MODULES lists it there too). */
  group: SchoolWideGroup | (string & {});
  label: string;
  help?: string;
  kind: SettingKind;
  options?: [value: string, label: string][];
  min?: number;
  max?: number;
  /** A change needs a second person's approval (in the console for Tangent, in the school's Approvals for the school). */
  risky?: true;
  /** Saved, but nothing acts on it yet: the console hides it unless asked (AGENTS.md: a new setting is marked until it is used). */
  notUsedYet?: true;
}

/**
 * Who changes a setting (docs/one-shot-plan.md §1). The school runs its own day, so every setting is the school's (edited in
 * the admin on the page of the module it changes) except these: the look Tangent builds the app with, and the switches that
 * lock a whole area of the school's data. Tangent can still change any setting for support, and lock one for one school.
 */
export const TANGENT_SETTINGS: readonly SettingKey[] = [
  'brand.color', 'school.country', 'school.currency', 'classes.schoolEdits', 'calendar.schoolEdits', 'timetable.schoolEdits', 'feeStructures.schoolEdits', 'staff.schoolAssignsRoles', 'roles.schoolEdits',
];
export const settingOwner = (key: string): 'school' | 'tangent' => ((TANGENT_SETTINGS as readonly string[]).includes(key) ? 'tangent' : 'school');

/**
 * Settings where a value Tangent locks is a floor, not a fixed value: the school may only make them stricter (a longer
 * password, a shorter sign-in, keeping records longer, asking for consent). `min`: the school's number may not go below
 * Tangent's; `max`: not above; `on`: once Tangent turns it on, the school cannot turn it off.
 */
export const TIGHTEN: Partial<Record<SettingKey, 'min' | 'max' | 'on'>> = {
  'security.twoFactor': 'on', 'security.passwordMinLength': 'min', 'security.webSessionDays': 'max', 'security.appSessionDays': 'max',
  'privacy.retentionMonths': 'min', 'privacy.photoConsent': 'on', 'privacy.consentRequired': 'on', 'privacy.consentAge': 'min',
};

/** Settings that belong to the whole school rather than one module (docs/product-map.md §5). */
export const SETTING_GROUPS = ['School identity', 'Look', 'The app', 'Sign-in and security', 'Privacy', 'Messaging'] as const;
export type SchoolWideGroup = (typeof SETTING_GROUPS)[number];

/** The languages the apps and messages come in: the one list every page offers. */
export const LANGUAGES: [string, string][] = LANGUAGE_LIST.map((l) => [l.code, languageLabel(l.code)]);

export const SETTINGS_META: Record<SettingKey, SettingMeta> = localized({
  'school.name': { group: 'School identity', label: 'School name', kind: 'text', help: 'On the sign-in pages, the app, receipts and report cards.' },
  'school.shortName': { group: 'School identity', label: 'Short name', kind: 'text', help: 'Where space is tight: the app’s header, messages.' },
  'school.tagline': { group: 'School identity', label: 'Tagline', kind: 'text' },
  'school.place': { group: 'School identity', label: 'Town or city', kind: 'text' },
  'school.phone': { group: 'School identity', label: 'Office phone', kind: 'text', help: 'The app’s Help and the transport page call it.' },
  'school.email': { group: 'School identity', label: 'Office email', kind: 'text', help: 'The app’s Help writes to it.' },
  'school.address': { group: 'School identity', label: 'Address', kind: 'textarea', help: 'On receipts, report cards and the app’s Help.' },
  'school.language': { group: 'School identity', label: 'Default language', kind: 'language', options: LANGUAGES },
  'school.country': { group: 'School identity', label: 'Country', kind: 'enum', options: COUNTRIES.map((c) => [c, regionName(c)]), help: 'Sets the rules that follow the country: tax, IDs, phone numbers, holidays and reports to the government.' },
  'school.timezone': { group: 'School identity', label: 'Time zone', kind: 'enum', options: ZONES.map((z) => [z, z.replace(/_/g, ' ')]), help: 'The school’s “today”: attendance, due dates, reminders and every time shown.' },
  'school.locale': { group: 'School identity', label: 'How dates and numbers are written', kind: 'enum', options: LOCALES, help: 'For example 1,50,000 or 150,000, and 14 Oct or Oct 14.' },
  'school.currency': { group: 'School identity', label: 'Currency', kind: 'text', help: 'Fees, fines and receipts. Changing it does not convert amounts already recorded, so Tangent changes it.' },
  'brand.logoText': { group: 'School identity', label: 'Logo letters', kind: 'text', help: 'One or two letters, until a logo image is uploaded.' },
  'brand.logoFileId': { group: 'School identity', label: 'Logo image', kind: 'logo', help: 'A square PNG or JPEG. Shown in the admin menu, on the sign-in pages, receipts and the app.' },
  'brand.color': { group: 'Look', label: 'Brand colour', kind: 'color', help: 'Every colour of the school’s admin, sign-in pages and app is worked out from this colour’s hue (Tangent Hue), in light, dark and AMOLED. Any colour reads well: the contrast is checked for every hue.' },
  'app.roles': { group: 'The app', label: 'Who uses the app', kind: 'appRoles', help: 'A role that is off cannot sign in to the app and is told to ask the school. Staff always have the admin.' },
  'app.layout': { group: 'The app', label: 'What each role sees', kind: 'appLayout', help: 'For each role: up to four bottom tabs (Profile is always added last), the Home cards and the quick buttons, in order. Only what the school’s modules offer that role can be chosen.' },
  'app.languages': { group: 'The app', label: 'Languages offered', kind: 'multi', options: LANGUAGES, help: 'The app’s language choices. Someone who picked one taken away gets the school’s default.' },
  'security.twoFactor': { group: 'Sign-in and security', label: 'Staff confirm sign-in with a code', kind: 'bool', risky: true, help: 'Turning this off weakens every staff account.' },
  'security.passwordMinLength': { group: 'Sign-in and security', label: 'Shortest password allowed', kind: 'number', min: 8, max: 64 },
  'security.webSessionDays': { group: 'Sign-in and security', label: 'Admin sign-in lasts (days)', kind: 'number', min: 1, max: 30 },
  'security.appSessionDays': { group: 'Sign-in and security', label: 'App sign-in lasts (days)', kind: 'number', min: 1, max: 90 },
  'documents.templates': { group: 'School identity', label: 'Printed documents', kind: 'documentTemplates', help: 'The layout and wording of receipts and report cards: blocks in order, with {placeholders} the document fills, in each of the school’s languages. Preview shows it with real data.' },
  'privacy.notice': { group: 'Privacy', label: 'Privacy notice', kind: 'textarea', help: 'Shown in the app (Settings → Privacy, and when someone is asked to consent) and behind “Privacy” on the school’s sign-in page.' },
  'privacy.officerName': { group: 'Privacy', label: 'Grievance officer', kind: 'text', help: 'Shown with the privacy notice.' },
  'privacy.officerEmail': { group: 'Privacy', label: 'Grievance officer’s email', kind: 'text' },
  'privacy.officerPhone': { group: 'Privacy', label: 'Grievance officer’s phone', kind: 'text' },
  'privacy.retentionMonths': { group: 'Privacy', label: 'Keep records of students who left for (months)', kind: 'number', min: 12, max: 120, risky: true, help: 'After this, a leaver’s records are listed for erasure; erasing needs a second person in the console.' },
  'privacy.photoConsent': { group: 'Privacy', label: 'Ask for photo consent', kind: 'bool', help: 'The consent step in the app also asks whether the school may share photos of the child. Families can change the answer in the app at any time.' },
  'privacy.consentAge': { group: 'Privacy', label: 'Students agree for themselves from age', kind: 'number', min: 10, max: 21, help: 'Set from the country’s law. A younger student is covered by their family’s consent; from this age a student signing in to the app is asked too.' },
  'privacy.consentRequired': { group: 'Privacy', label: 'People must consent before using the app', kind: 'bool', help: 'The app shows the privacy notice once after sign-in and records the consent; Moving in counts who has consented.' },
  'notify.rules': { group: 'Messaging', label: 'Which message goes where', kind: 'notifyRules' },
  'notify.quietFrom': { group: 'Messaging', label: 'Quiet hours start', kind: 'time', help: 'Only urgent messages (absence, the bus) go out in quiet hours.' },
  'notify.quietTo': { group: 'Messaging', label: 'Quiet hours end', kind: 'time' },
  'templates.messages': { group: 'Messaging', label: 'Wording of each message', kind: 'templates' },

  // School (the academic year)
  'workflows.steps': { group: 'school', label: 'Steps for each kind of request', kind: 'workflows', help: 'Who decides each request, in order. A kind with one step is decided by anyone allowed to; add a step for a second person, a step only above an amount, and what happens when a step waits too long.' },
  'roles.schoolEdits': { group: 'school', label: 'The school makes and changes its own roles', kind: 'bool', help: 'Off: only Tangent changes the school’s roles. Either way, only permissions the plan includes can be given.' },
  'classes.schoolEdits': { group: 'school', label: 'The school may edit its classes, subjects and periods', kind: 'bool', help: 'Off: only Tangent changes them (Data, or the school asks).' },
  'calendar.weeklyOff': { group: 'school', label: 'Closed every week on', kind: 'multi', options: [['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday']], help: 'Attendance, the dashboard, fee charts and the app’s calendars skip these days. Holidays are added under Academic year.' },
  'calendar.weekStarts': { group: 'school', label: 'Weeks start on', kind: 'enum', options: [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']], help: 'The first column of every week grid in the admin and the app.' },
  'calendar.schoolEdits': { group: 'school', label: 'The school may edit its terms and holidays', kind: 'bool', help: 'Off: only Tangent changes them.' },
  'dashboard.rollClasses': { group: 'school', label: 'Classes on the dashboard’s roll-call card', kind: 'classes', max: 8 },

  // People
  'vocab.words': { group: 'people', label: 'The school’s words', kind: 'vocabulary', help: 'What the school calls a student, a parent, a class, a term… in each language it uses. Every page, the app and messages use them. Leave a word empty to keep the usual one.' },
  'letters.family': { group: 'people', label: 'Letter to families about the app', kind: 'textarea', help: 'Printed for each family from Students → On the app, with a code that opens the app. Use {school}, {student}, {class}, {guardian}, {phoneEnd} and {link}.' },
  'letters.student': { group: 'people', label: 'Letter to students about the app', kind: 'textarea', help: 'Printed for each student when the school uses the app for students. Use {school}, {student}, {class} and {link}.' },
  'students.required': { group: 'people', label: 'Fields the office must fill for a student', kind: 'multi', options: [['gender', 'Gender'], ['house', 'House'], ['admissionNo', 'Admission number'], ['bloodGroup', 'Blood group'], ['address', 'Address']], help: 'Name, class, date of birth and a guardian are always needed. These become required too when adding or editing a student. Without a required admission number, a new student takes the next in the school’s series.' },
  'people.admissionNumber': { group: 'people', label: 'Admission numbers', kind: 'text', help: 'For a new student when none is typed in. {yyyy}/{seq:4} gives 2026/0001; ADM-{ay}-{seq} gives ADM-2026-27-1. Tokens: {yyyy} {yy} {mm} {ay} {seq}.' },
  'people.admissionStart': { group: 'people', label: 'First admission number', kind: 'number', min: 1, max: 99_999_999 },
  'fields.custom': { group: 'people', label: 'The school’s own fields', kind: 'customFields', help: 'Fields the school keeps beyond Tangent’s own, on student and staff records: they appear on the forms and the record, in the import and its template. Removing a field hides it; what was written stays.' },
  'people.nameOrder': { group: 'people', label: 'Name order', kind: 'enum', options: [['given-family', 'Given name, then family name'], ['family-given', 'Family name, then given name']], help: 'How a student’s full name is made from the given and family names the office enters.' },
  'people.addressFormat': { group: 'people', label: 'How addresses are written', kind: 'addressFormat', help: 'The parts of an address the forms ask for, in order, under the names people know (PIN code, Postcode, ZIP code). Set from the school’s country.' },
  'lists.genders': { group: 'people', label: 'Genders', kind: 'list', max: 40, help: 'What the office can choose on a student’s record and in an import. Retire one rather than remove it, so records that use it keep their word.' },
  'lists.relationships': { group: 'people', label: 'How guardians are related', kind: 'list', max: 40, help: 'Mother, grandparent, carer…: chosen on each guardian of a student.' },
  'lists.bloodGroups': { group: 'people', label: 'Blood groups', kind: 'list', max: 40 },
  'people.houses': { group: 'people', label: 'Houses', kind: 'houses', max: 12, help: 'The school’s houses and their colours, if it has them: on student profiles, the roll-call grid and the app. Students are put in a house by import or on their profile.' },
  'admissions.sources': { group: 'people', label: 'Where enquiries come from', kind: 'strings', max: 16, help: 'The choices on a new enquiry, and how Admissions counts them.' },
  'admissions.stages': { group: 'people', label: 'Admission stages', kind: 'admissionStages', help: 'The steps between an enquiry and enrolment, in order, each with what it needs: a day (a test or an interview), a score, documents to collect, and whether the family is told. Enquiry, Enrolled and Declined are always there.' },
  'admissions.onlineForm': { group: 'people', label: 'Families can apply online', kind: 'bool', help: 'A page on the school’s address where a family applies; the application lands in the first stage, with how they found the school as “Website”.' },
  'staff.schoolAssignsRoles': { group: 'people', label: 'The school may put its staff into roles', kind: 'bool', help: 'Off: only Tangent puts people into roles.' },

  // Attendance
  'attendance.notifyParents': { group: 'attendance', label: 'Tell families when a child is absent or late', kind: 'bool' },
  'timetable.cycle': { group: 'timetable', label: 'How the timetable repeats', kind: 'timetableCycle', help: 'Every week, two alternating weeks (A and B), or a cycle of school days (Day 1 to Day 6) that moves on only on days the school is open. Changing it keeps each lesson on the day with the same number.' },
  'exams.types': { group: 'exams', label: 'Kinds of exam', kind: 'list', max: 12, help: 'Chosen when an exam is made; the year’s result weighs each kind as set below.' },
  'exams.weights': { group: 'exams', label: 'How much each kind counts in the year’s result', kind: 'weights', help: 'A number for each kind of exam (they need not add up to 100). A kind left out counts nothing; none at all: every exam counts the same.' },
  'exams.remarks': { group: 'exams', label: 'Remarks to pick from', kind: 'list', max: 60, help: 'Short remarks a teacher can pick for a student’s report card (they can still write their own). Each can be written in the school’s other languages.' },
  'results.rankWithin': { group: 'exams', label: 'Rank students within', kind: 'enum', options: [['class', 'Their class'], ['year', 'Their year group (every class sitting the exam)']], help: 'Where ranks are shown at all is the setting above.' },
  'attendance.registers': { group: 'attendance', label: 'Registers a day', kind: 'enum', options: [['day', 'One roll call a day'], ['ampm', 'A morning and an afternoon register']], help: 'With two, each half is marked on its own and counted as a session; screens that show one mark a day put the two together.' },
  'attendance.pmFrom': { group: 'attendance', label: 'The afternoon register starts at', kind: 'time', help: 'With two registers a day, the teachers’ app marks the morning one before this time and the afternoon one after it.' },
  'attendance.lockAfterDays': { group: 'attendance', label: 'Attendance can be corrected for this many days', kind: 'number', min: 0, max: 30, help: 'In the admin and in the teachers’ app; after that, only someone allowed to approve can change it.' },
  'attendance.persistentPct': { group: 'attendance', label: 'Persistent absence below', kind: 'number', min: 50, max: 100, help: 'A student present for less than this share of the year’s registers (leave counted as absence) is on the Persistent absence report.' },
  'attendance.goalPct': { group: 'attendance', label: 'Attendance goal (%)', kind: 'number', min: 50, max: 100, help: 'The dashboard and reports measure against it.' },
  'attendance.statuses': { group: 'attendance', label: 'Marks the school uses', kind: 'attendanceMarks', max: 20, help: 'Each with the name and letter the register uses, and what it means for attendance figures. Approved leave is filled in with the first mark that means authorised absence.' },
  'leave.reasons': { group: 'attendance', label: 'Reasons families give for leave', kind: 'list', max: 12, help: 'Offered in the app when a family asks for leave, each in the family’s language where the school names it.' },

  // Timetable
  'timetable.schoolEdits': { group: 'timetable', label: 'The school may edit its own timetable', kind: 'bool', help: 'Off: the timetable is locked and only Tangent changes it. Covering an absent teacher for a day is always allowed.' },

  // Homework
  'homework.goalPct': { group: 'homework', label: 'Homework on time goal (%)', kind: 'number', min: 50, max: 100 },
  'homework.showClassProgress': { group: 'homework', label: 'Families see how many classmates have handed in', kind: 'bool' },
  'homework.defaultDueDays': { group: 'homework', label: 'New homework is due after', kind: 'number', min: 1, max: 30, help: 'Days after it is set, as the date a teacher starts from.' },
  'homework.defaultMarks': { group: 'homework', label: 'New marked homework is out of', kind: 'number', min: 1, max: 100, help: 'The marks a teacher starts from; they can change it.' },
  'homework.handedInBy': { group: 'homework', label: 'Who hands homework in from the app', kind: 'enum', options: [['either', 'The student or a parent'], ['student', 'The student only'], ['parent', 'A parent only']], help: 'Students hand in only when students use the app.' },

  // Exams and results
  'exams.defaultMaxMarks': { group: 'exams', label: 'A new paper is out of', kind: 'number', min: 1, max: 200, help: 'The marks a new exam paper starts from; each paper can be changed.' },
  'exams.leadDays': { group: 'exams', label: 'A new exam starts after', kind: 'number', min: 0, max: 120, help: 'Days from today, as the first day a new exam starts from.' },
  'results.showRank': { group: 'exams', label: 'Families see the class rank', kind: 'bool' },
  'grading.scale': { group: 'exams', label: 'Grading scale', kind: 'gradingScale', max: 12, help: 'Each grade from the lowest percentage that earns it, highest first. Results, report cards, homework grades and the app use it.' },
  'grading.passPct': { group: 'exams', label: 'Pass mark (%)', kind: 'number', min: 0, max: 100 },
  'grading.schemes': { group: 'exams', label: 'Other grading schemes', kind: 'gradingSchemes', help: 'Where some year groups or subjects are graded differently: grades with points for a GPA, descriptors, or pass and fail. A mark uses the scheme for its subject and year group, else the scale above.' },

  // Fees
  'fees.receiptPrefix': { group: 'fees', label: 'Receipt numbers', kind: 'text', help: 'A pattern: {yyyy} the year, {yy} its last two digits, {mm} the month, {ay} the academic year, {seq} the running number ({seq:5} pads it to 5 digits). RCPT-{yyyy}-{seq:5} gives RCPT-2026-00001; the numbers start again when the year changes.' },
  'fees.receiptStart': { group: 'fees', label: 'First receipt number', kind: 'number', min: 1, max: 99_999_999, help: 'For a school arriving from another system: the series carries on after its highest number either way.' },
  'fees.receiptNote': { group: 'fees', label: 'Printed on receipts', kind: 'textarea', help: 'Under the school’s name and address on every receipt: the trust, its registration or tax number.' },
  'fees.paymentMethods': { group: 'fees', label: 'How the office records payments', kind: 'paymentMethods', max: 16, help: 'Each with the name the office uses and what kind of money it is.' },
  'fees.lateFeePct': { group: 'fees', label: 'Late fee (%)', kind: 'number', min: 0, max: 25, help: 'Charged once a month on each overdue invoice while the school has Late fines. 0 charges nothing.' },
  'fees.lateRule': { group: 'fees', label: 'Late fee rule', kind: 'lateRule', help: 'A percentage of what is still owed, or a fixed amount, charged once or every day, week or month an invoice stays unpaid after the grace days, up to a cap. Without a rule, the late fee above is charged once a month.' },
  'fees.reminderDays': { group: 'fees', label: 'Reminder days', kind: 'reminderDays', help: 'Days from the due date when families are reminded: minus before it, plus after it (a reminder after the due date says it is overdue). Without any, families are reminded the days before set above.' },
  'fees.categories': { group: 'fees', label: 'Fee categories', kind: 'list', max: 20, help: 'Groups of students who pay differently (staff children, scholarships, boarders). A student is put in one on their record; a fee structure for a category takes the place of the everyone fee of that head for them.' },
  'fees.remindDaysBefore': { group: 'fees', label: 'Remind families this many days before a due date', kind: 'number', min: 0, max: 30, help: 'Sent each morning while the school has Fee reminders, once per invoice per day.' },
  'tax.name': { group: 'fees', label: 'What the tax is called', kind: 'text', help: 'VAT, GST, sales tax: printed on tax receipts.' }, // india-pack: examples from several countries
  'tax.number': { group: 'fees', label: 'The school’s tax registration', kind: 'text', help: 'Printed on receipts with the tax lines while the school has tax receipts. Receipts carry no tax until it is filled in.' },
  'tax.numberLabel': { group: 'fees', label: 'What the registration is called', kind: 'text', help: 'GSTIN, VAT number, TRN…' },
  'tax.code': { group: 'fees', label: 'Service code', kind: 'text', help: 'Where the country asks for one on receipts (a SAC in India).' },
  'tax.codeLabel': { group: 'fees', label: 'What the service code is called', kind: 'text' },
  'tax.ratePct': { group: 'fees', label: 'Tax rate (%)', kind: 'number', min: 0, max: 50 },
  'tax.inclusive': { group: 'fees', label: 'Fees include the tax', kind: 'bool', help: 'On: the receipt shows the tax inside each fee. Off: the tax is added on top of the fee when it is billed.' },
  'tax.split': { group: 'fees', label: 'Parts of the tax on a receipt', kind: 'taxSplit', help: 'Where a country shows the tax in parts (central and state GST in India), each part and its share. Empty: one line.' }, // india-pack: an example
  'tax.heads': { group: 'fees', label: 'Fee heads that carry tax', kind: 'multi', help: 'From the school’s own fee heads.' },
  'fees.refundApprovalAbove': { group: 'fees', label: 'Refunds above this need a second person (in the school’s currency)', kind: 'number', min: 0, max: 10_000_000 },
  'fees.dailyTarget': { group: 'fees', label: 'Daily fee collection target (in the school’s currency)', kind: 'number', min: 0, max: 100_000_000, help: 'The dashboard measures each day’s collection against it.' },
  'feeStructures.schoolEdits': { group: 'fees', label: 'The school may edit its fee heads and fee structures', kind: 'bool', help: 'Off: only Tangent changes what each grade pays. Who approves a fee waiver is whoever’s role may waive fees (Roles).' },

  // Notices
  'approvals.notice': { group: 'notices', label: 'Notices need approval before they go out', kind: 'enum', options: [['required', 'Yes, unless written by someone allowed to publish'], ['off', 'No']] },
  'notices.categories': { group: 'notices', label: 'Notice categories', kind: 'categories', max: 16, help: 'The same list for the people who write notices and the people who read them.' },

  // Events
  'events.categories': { group: 'events', label: 'Event categories', kind: 'categories', max: 16 },
  'events.showGoing': { group: 'events', label: 'Families see how many are going', kind: 'bool' },

  // Library
  'library.loanDays': { group: 'library', label: 'Loan (days)', kind: 'number', min: 1, max: 60 },
  'library.finePerDay': { group: 'library', label: 'Fine per late day (in the school’s currency)', kind: 'number', min: 0, max: 100 },
  'library.maxRenewals': { group: 'library', label: 'Renewals per loan', kind: 'number', min: 0, max: 5, help: 'A book someone is waiting for cannot be renewed.' },
  'library.maxLoans': { group: 'library', label: 'Books a student may have out', kind: 'number', min: 1, max: 20 },
  'library.staffMaxLoans': { group: 'library', label: 'Books a member of staff may have out', kind: 'number', min: 1, max: 50 },

  // Transport
  'transport.nearMinutes': { group: 'transport', label: 'Tell families the bus is near (minutes away)', kind: 'number', min: 2, max: 30 },
  'transport.familyCalls': { group: 'transport', label: 'Families call about the bus', kind: 'enum', options: [['office', 'The office'], ['attendant', 'The bus attendant'], ['none', 'Nobody: messages only']], help: 'Never the driver, who is driving.' },
});
