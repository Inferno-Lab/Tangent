// A fictional CBSE school in Bengaluru, mid-year, as the files a school brings when it moves to Tangent: exports from the
// systems schools use (a Fedena student list, an aSc Timetables XML file, a Koha MARC catalogue, a Google Contacts list, the
// fee register and attendance from the old ERP), spreadsheets with title rows above their headers, Tangent's own templates,
// zips of photos and report cards, and the circulars the office keeps. Every value is made up, from one seed, so a date
// always gives the same school. Nothing here writes to a database: the school is built by loading these files the way a
// school would (tools/dataset/load.mjs, the API tests' harness, or a person in the console). See docs/test-school.md.
import { crc32, deflateSync } from 'node:zlib';
import { toCsv, xlsx, zip } from '../../packages/db/dist/index.js';

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const at = (d) => Date.parse(`${d}T00:00:00Z`);
const add = (d, n) => iso(at(d) + n * DAY);
const weekday = (d) => new Date(at(d)).getUTCDay();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const ddmmyyyy = (d, sep = '/') => `${d.slice(8, 10)}${sep}${d.slice(5, 7)}${sep}${d.slice(0, 4)}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dMonY = (d) => `${Number(d.slice(8, 10))}-${MON[Number(d.slice(5, 7)) - 1]}-${d.slice(0, 4)}`;
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Names as a Bengaluru school's register has them: Kannada, Tamil, Telugu, Malayalam, Hindi, Marathi, Bengali, Muslim and
// Christian families, all in one city.
const GIRLS = ['Ananya', 'Bhoomika', 'Chaitra', 'Deeksha', 'Divya', 'Hamsa', 'Ishani', 'Kavya', 'Keerthana', 'Lavanya', 'Meghana', 'Nandini', 'Pooja', 'Prarthana', 'Rashmi', 'Sahana', 'Samhita', 'Shreya', 'Spoorthi', 'Tanvi',
  'Aishwarya', 'Harini', 'Janani', 'Nithya', 'Sowmya', 'Yamini', 'Akshara', 'Bhavya', 'Sindhu', 'Vaishnavi', 'Anagha', 'Gayathri', 'Nivedita', 'Aditi', 'Ira', 'Riya', 'Saanvi', 'Myra', 'Ayesha', 'Fathima',
  'Zoya', 'Sana', 'Hiba', 'Mariam', 'Sneha', 'Ankita', 'Riddhi', 'Trisha', 'Ahana', 'Shruti', 'Angel', 'Christina', 'Sharon', 'Nikita', 'Tara'];
const BOYS = ['Aditya', 'Bharath', 'Chirag', 'Darshan', 'Gagan', 'Harsha', 'Karthik', 'Manoj', 'Nikhil', 'Pranav', 'Rahul', 'Rakshith', 'Sandeep', 'Shashank', 'Sudeep', 'Tejas', 'Vinay', 'Yashas', 'Abhinav', 'Akash',
  'Arjun', 'Hari', 'Karthikeyan', 'Naveen', 'Pradeep', 'Saravanan', 'Srinivas', 'Vignesh', 'Anirudh', 'Rohit', 'Siddharth', 'Varun', 'Arnav', 'Ishaan', 'Kabir', 'Vivaan', 'Aryan', 'Faizan', 'Imran', 'Rehan',
  'Zaid', 'Ayaan', 'Sameer', 'Omkar', 'Soham', 'Arindam', 'Rishi', 'Joel', 'Kevin', 'Ryan', 'Aaron', 'Dhruv', 'Krish', 'Neel', 'Om'];
const SURNAMES = ['Gowda', 'Hegde', 'Shetty', 'Rao', 'Bhat', 'Kamath', 'Kulkarni', 'Patil', 'Reddy', 'Naidu', 'Iyer', 'Iyengar', 'Krishnan', 'Subramanian', 'Pillai', 'Nair', 'Menon', 'Sharma', 'Verma', 'Gupta',
  'Agarwal', 'Jain', 'Deshpande', 'Joshi', 'Banerjee', 'Chatterjee', 'Das', 'Khan', 'Ahmed', 'Sheikh', 'Siddiqui', 'D\'Souza', 'Fernandes', 'Thomas', 'Mathew', 'Prasad', 'Murthy', 'Shastry', 'Acharya', 'Kumar'];
const AREAS = ['Whitefield', 'Brookefield', 'Varthur', 'Marathahalli', 'Hoodi', 'Kadugodi', 'ITPL', 'Mahadevapura', 'KR Puram', 'Hope Farm'];
const ROUTES = ['Route 1 · Whitefield', 'Route 2 · Varthur', 'Route 3 · Marathahalli', 'Route 4 · KR Puram', 'Route 5 · Hoodi', 'Route 6 · Brookefield'];
const HOUSES = ['Kaveri', 'Ganga', 'Narmada', 'Godavari'];
const BLOOD = ['O+', 'O+', 'B+', 'B+', 'A+', 'A+', 'AB+', 'O-', 'B-', 'A-'];

/** The school's bell: eight lessons, a short break and lunch. aSc numbers only the lessons. */
const BELL = [[1, 'Period 1', '08:30', '09:10', 'period'], [2, 'Period 2', '09:10', '09:50', 'period'], [3, 'Period 3', '09:50', '10:30', 'period'], [4, 'Short break', '10:30', '10:45', 'break'],
  [5, 'Period 4', '10:45', '11:25', 'period'], [6, 'Period 5', '11:25', '12:05', 'period'], [7, 'Lunch', '12:05', '12:40', 'lunch'], [8, 'Period 6', '12:40', '13:20', 'period'],
  [9, 'Period 7', '13:20', '14:00', 'period'], [10, 'Period 8', '14:00', '14:40', 'period']];
const LESSONS = BELL.filter((b) => b[4] === 'period');

/** Periods a week by grade: Monday to Friday eight lessons, Saturday four, 44 in all. */
const PLAN = (g, section) => (g <= 5 ? { English: 8, Kannada: 5, Hindi: 5, Mathematics: 8, 'Environmental Studies': 7, 'Computer Science': 3, Art: 3, 'Physical Education': 3, Library: 2 }
  : g <= 8 ? { English: 7, Kannada: 5, Hindi: 5, Mathematics: 7, Science: 7, 'Social Science': 6, 'Computer Science': 3, 'Physical Education': 2, Art: 2 }
  : g <= 10 ? { English: 7, Kannada: 4, Hindi: 4, Mathematics: 8, Science: 8, 'Social Science': 7, 'Computer Science': 3, 'Physical Education': 3 }
  : { English: 6, Physics: 8, Chemistry: 8, Mathematics: 8, [section === 'A' ? 'Biology' : 'Computer Science']: 8, 'Physical Education': 3, Library: 3 });
/** What is examined: the plan without the activity periods. */
const EXAMINED = (g, section) => Object.keys(PLAN(g, section)).filter((s) => !['Art', 'Physical Education', 'Library'].includes(s));

/** Quarterly tuition by grade band (rupees). */
const TUITION = (g) => (g <= 5 ? 22500 : g <= 8 ? 24000 : g <= 10 ? 26500 : 29000);

export function generateSchool({ today = iso(Date.now()), seed = 20261120, perClass = 35 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const chance = (p) => rnd() < p;
  const Y = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const year = `${Y}-${pad((Y + 1) % 100)}`;
  const start = `${Y}-04-01`, end = `${Y + 1}-03-31`;
  const last = add(today, -1) < end ? add(today, -1) : end;
  const domain = 'sunrisevalley.example';
  const phone = (() => { let n = 4100; return () => `98450${pad(n++, 5)}`; })();
  // Phones as people write them in a register: with the country code, with the trunk 0, with a dash, or plain.
  const written = (p) => [`+91 ${p.slice(0, 5)} ${p.slice(5)}`, `0${p.slice(0, 5)} ${p.slice(5)}`, `${p.slice(0, 5)}-${p.slice(5)}`, p][Math.floor(rnd() * 4)];
  const mail = (first, lastName, n = '') => `${first}.${lastName}${n}`.toLowerCase().replace(/[^a-z.0-9]/g, '');

  // ── The calendar ────────────────────────────────────────────────────────────
  const holidays = [
    ['Summer vacation', `${Y}-05-01`, `${Y}-06-07`], ['Independence Day', `${Y}-08-15`, ''], ['Ganesha Chaturthi', `${Y}-09-14`, ''], ['Gandhi Jayanti', `${Y}-10-02`, ''],
    ['Dasara break', `${Y}-10-17`, `${Y}-10-25`], ['Kannada Rajyotsava', `${Y}-11-01`, ''], ['Deepavali break', `${Y}-11-07`, `${Y}-11-10`], ['Christmas break', `${Y}-12-24`, `${Y + 1}-01-01`],
    ['Republic Day', `${Y + 1}-01-26`, ''], ['Ugadi', `${Y + 1}-03-19`, ''],
  ];
  const closed = new Set(holidays.flatMap(([, from, to]) => { const out = []; for (let d = from; d <= (to || from); d = add(d, 1)) out.push(d); return out; }));
  const schoolDays = [];
  for (let d = start; d <= last; d = add(d, 1)) if (weekday(d) !== 0 && !closed.has(d)) schoolDays.push(d);

  // ── Staff ───────────────────────────────────────────────────────────────────
  const staff = [];
  const person = (girl) => ({ first: pick(girl ? GIRLS : BOYS), last: pick(SURNAMES) });
  const addStaff = (o) => { const p = o.p ?? person(chance(0.68)); const email = `${mail(p.first, p.last, staff.length)}@${domain}`; const x = { name: `${p.first} ${p.last}`, email, phone: phone(), joined: add(`${Y - 1 - Math.floor(rnd() * 12)}-06-01`, Math.floor(rnd() * 20)), subjects: [], classes: [], ...o, email: o.email ?? email }; staff.push(x); return x; };
  const principal = addStaff({ name: 'Dr. Meenakshi Raghavan', email: `principal@${domain}`, designation: 'Principal', department: 'Administration', role: 'Principal' });
  const vice = addStaff({ designation: 'Vice Principal', department: 'Administration', role: 'Principal' });
  const office = addStaff({ designation: 'Office Manager', department: 'Administration', role: 'Office staff' });
  addStaff({ designation: 'Front Office Executive', department: 'Administration', role: 'Office staff' });
  const accountant = addStaff({ designation: 'Accountant', department: 'Accounts', role: 'Accountant' });
  addStaff({ designation: 'Accounts Assistant', department: 'Accounts', role: 'Accountant' });
  addStaff({ designation: 'Librarian', department: 'Library', role: 'Office staff' });
  addStaff({ designation: 'Transport Coordinator', department: 'Transport', role: 'Office staff' });
  const drivers = [0, 1, 2, 3, 4, 5].map(() => addStaff({ p: person(false), designation: 'Driver', department: 'Transport' }));
  addStaff({ designation: 'Lab Assistant', department: 'Science' });

  // Classes 1 to 12, two sections each; 11 A reads Biology, 11 B Computer Science.
  const classes = [];
  for (let g = 1; g <= 12; g++) for (const sec of ['A', 'B']) classes.push({ name: `${g} ${sec}`, grade: g, section: sec, plan: PLAN(g, sec) });
  // Enough teachers per subject for about 30 lessons a week each.
  const load = {};
  for (const c of classes) for (const [sub, n] of Object.entries(c.plan)) load[sub] = (load[sub] ?? 0) + n;
  const teachersOf = {};
  for (const [sub, total] of Object.entries(load)) teachersOf[sub] = Array.from({ length: Math.ceil(total / 26) }, () => addStaff({ designation: sub === 'Physical Education' ? 'Physical Education Teacher' : 'Teacher', department: sub, role: 'Teacher', subjects: [sub] }));
  const teacherFor = {};
  for (const [sub, list] of Object.entries(teachersOf)) {
    let i = 0, used = 0;
    for (const c of classes) if (c.plan[sub]) {
      if (used + c.plan[sub] > Math.ceil(load[sub] / list.length) + 2 && i < list.length - 1) { i++; used = 0; }
      teacherFor[`${c.name}|${sub}`] = list[i];
      list[i].classes.push(c.name);
      used += c.plan[sub];
    }
  }
  // A class teacher teaches the class: the first of its teachers who is not yet one.
  const isClassTeacher = new Set();
  for (const c of classes) {
    const t = Object.keys(c.plan).map((sub) => teacherFor[`${c.name}|${sub}`]).find((x) => x && !isClassTeacher.has(x.email) && x.department !== 'Physical Education' && x.department !== 'Library');
    if (t) { isClassTeacher.add(t.email); c.teacher = t; }
  }

  // ── The timetable ───────────────────────────────────────────────────────────
  // Every lesson is an edge between its class and its teacher, and no class or teacher has more than 44 a week, so the edges
  // colour with 44 colours, one per period, with no class or teacher twice in a period (König's theorem; each clash is
  // undone by swapping two colours along the path it sits on). Periods are then dealt out in an order that spreads a subject
  // over the week.
  const everySlot = [];
  for (let d = 0; d < 6; d++) for (let p = 0; p < (d === 5 ? 4 : 8); p++) everySlot.push([d, p]);
  const room = (c, sub) => (sub === 'Computer Science' ? 'Computer Lab' : ['Physics', 'Chemistry', 'Biology'].includes(sub) ? `${sub} Lab` : sub === 'Physical Education' ? 'Playground' : sub === 'Library' ? 'Library' : `Room ${c.replace(' ', '')}`);
  const edges = classes.flatMap((c) => Object.entries(c.plan).flatMap(([sub, n]) => Array.from({ length: n }, () => ({ c: `c:${c.name}`, t: `t:${teacherFor[`${c.name}|${sub}`].email}`, cls: c.name, sub, colour: -1 }))));
  const K = everySlot.length;
  const at = new Map();
  const slotOf = (node) => { if (!at.has(node)) at.set(node, new Array(K).fill(null)); return at.get(node); };
  const free = (node) => slotOf(node).indexOf(null);
  for (const e of edges) {
    const a = free(e.c), b = free(e.t);
    if (a < 0 || b < 0) continue; // more than 44 lessons for one class or teacher (the plans never ask for it)
    if (slotOf(e.t)[a] !== null) {
      // Swap colours a and b along the path from the teacher that alternates a, b, a…, so a becomes free at the teacher.
      const path = [];
      for (let node = e.t, colour = a; ;) {
        const next = slotOf(node)[colour];
        if (!next) break;
        path.push(next);
        node = next.c === node ? next.t : next.c;
        colour = colour === a ? b : a;
      }
      for (const x of path) { slotOf(x.c)[x.colour] = null; slotOf(x.t)[x.colour] = null; }
      for (const x of path) { x.colour = x.colour === a ? b : a; slotOf(x.c)[x.colour] = x; slotOf(x.t)[x.colour] = x; }
    }
    e.colour = a;
    slotOf(e.c)[a] = e; slotOf(e.t)[a] = e;
  }
  // Colours to periods: day by day, so a class's lessons of one subject fall on different days where they can.
  const order = everySlot.map((_, i) => i).sort((x, y) => (x % 6) - (y % 6) || x - y);
  const slots = edges.filter((e) => e.colour >= 0).map((e) => {
    const [day, period] = everySlot[order[e.colour]];
    const t = teacherFor[`${e.cls}|${e.sub}`];
    return { cls: e.cls, day, period, sub: e.sub, teacher: t, room: room(e.cls, e.sub) };
  });
  const unplaced = edges.filter((e) => e.colour < 0).length;

  // ── Families and students ───────────────────────────────────────────────────
  const families = [];
  const students = [];
  const seats = Object.fromEntries(classes.map((c) => [c.name, 0]));
  const open = () => classes.filter((c) => seats[c.name] < perClass);
  let seq = 1;
  const admit = (fam, c, joined, extra = {}) => {
    const girl = chance(0.49);
    const first = pick(girl ? GIRLS : BOYS);
    const admYear = joined.slice(0, 4);
    const st = { adm: `SVS/${admYear}/${pad(seq++, 4)}`, first, last: fam.last, name: `${first} ${fam.last}`, girl, cls: c.name, grade: c.grade, section: c.section,
      dob: `${Y - 5 - c.grade}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`, blood: chance(0.07) ? '' : pick(BLOOD), house: pick(HOUSES), joined, family: fam,
      ability: 0.45 + rnd() * 0.5, attendance: chance(0.04) ? 0.78 : 0.9 + rnd() * 0.09, rider: chance(0.36), route: pick(ROUTES), status: 'active', ...extra };
    seats[c.name]++;
    fam.children.push(st);
    students.push(st);
    return st;
  };
  const newFamily = () => {
    const last = pick(SURNAMES);
    const fam = { last, father: `${pick(BOYS)} ${last}`, mother: `${pick(GIRLS)} ${last}`, fatherPhone: phone(), motherPhone: chance(0.8) ? phone() : '', email: '', area: pick(AREAS), children: [], staffWard: false, rte: false };
    if (chance(0.62)) fam.email = `${mail(fam.father.split(' ')[0], last)}${Math.floor(rnd() * 90 + 10)}@gmail.com`;
    families.push(fam);
    return fam;
  };
  // Whole classes, families of one, two or three children; most joined in earlier years, the youngest this April.
  while (open().length && students.length < classes.length * perClass - 14) {
    const fam = newFamily();
    const kids = chance(0.14) ? (chance(0.12) ? 3 : 2) : 1;
    for (let k = 0; k < kids && open().length; k++) {
      const c = pick(open());
      // Joined in some earlier year (in June, when the year then began), or this April.
      const joinYear = c.grade === 1 ? Y : Y - Math.floor(rnd() * c.grade);
      admit(fam, c, joinYear === Y ? `${Y}-04-02` : `${joinYear}-06-10`);
    }
  }
  // Joined this term (September and October) into the seats left.
  for (const c of open()) while (seats[c.name] < perClass) admit(newFamily(), c, add(`${Y}-09-01`, Math.floor(rnd() * 44)), { joinedMidYear: true });
  // Staff children pay half tuition; a few seats are under the Right to Education Act (no tuition or annual charges).
  for (const fam of families.slice(0, 9)) fam.staffWard = true;
  for (const fam of families.filter((f) => f.children.length === 1 && f.children[0].grade <= 3).slice(0, 12)) fam.rte = true;
  // Six families gave no phone at admission; their numbers come in from the class WhatsApp group (Google Contacts export).
  const phoneless = families.filter((f) => !f.staffWard && f.children.length === 1).slice(20, 26);
  // Left during the year, with a transfer certificate.
  const leavers = [];
  for (const c of classes.filter((_, i) => i % 3 === 1).slice(0, 8)) {
    const fam = newFamily();
    const st = admit(fam, c, `${Y - 2}-06-10`, { status: 'left', leftOn: add(`${Y}-08-01`, Math.floor(rnd() * 60)) });
    seats[c.name]--;
    leavers.push(st);
  }
  for (const c of classes) students.filter((x) => x.cls === c.name && x.status === 'active').sort((a, b) => a.name.localeCompare(b.name)).forEach((x, i) => { x.roll = i + 1; });
  leavers.forEach((x) => { x.roll = 0; });
  const enrolledOn = (st, d) => d >= st.joined && (!st.leftOn || d <= st.leftOn);

  // The people a tester signs in as.
  // The parent with two at the school has one in 8 A, the class teacher's class, listed first.
  const twoKids = families.find((f) => f.children.length === 2 && f.email && !f.rte && f.children.every((k) => k.status === 'active' && !k.joinedMidYear) && f.children.some((k) => k.cls === '8 A'));
  const oneKid = families.find((f) => f.children.length === 1 && f.email && f !== twoKids && f.children[0].status === 'active' && !f.children[0].joinedMidYear && f.children[0].grade >= 9 && !phoneless.includes(f));
  const classTeacher = classes.find((c) => c.name === '8 A').teacher;
  const maths = teachersOf.Mathematics[0];

  // ── Attendance, marks, fees ─────────────────────────────────────────────────
  const attendance = [['Attendance Date', 'Admn No', 'Attendance']];
  let marked = 0;
  for (const d of schoolDays) {
    // A cold going round school in the second half of August.
    const flu = d >= `${Y}-08-17` && d <= `${Y}-08-29` ? 0.06 : 0;
    for (const st of students) {
      if (!enrolledOn(st, d)) continue;
      const r = rnd();
      attendance.push([ddmmyyyy(d, '-'), st.adm, r < st.attendance - flu ? 'P' : r < st.attendance - flu + 0.015 ? 'L' : r < st.attendance - flu + 0.025 ? 'LV' : 'A']);
      marked++;
    }
  }
  const exams = [{ name: 'Periodic Test 1', from: `${Y}-07-13`, to: `${Y}-07-17`, max: 20 }, { name: 'Half-Yearly Examination', from: `${Y}-09-21`, to: `${Y}-10-03`, max: 80 }].filter((e) => e.to < today);
  const marks = [['Exam Name', 'Class', 'Subject', 'Admn No', 'Marks Obtained', 'Max Marks', 'starts_on', 'ends_on']];
  const scores = new Map();
  for (const e of exams) for (const st of students.filter((x) => x.status === 'active' && enrolledOn(x, e.from))) for (const sub of EXAMINED(st.grade, st.section)) {
    const absent = chance(0.012);
    const score = Math.max(0, Math.min(e.max, Math.round(e.max * (st.ability + (rnd() - 0.5) * 0.25))));
    scores.set(`${st.adm}|${e.name}|${sub}`, absent ? null : score);
    marks.push([e.name, st.cls, sub, st.adm, absent ? 'AB' : String(score), String(e.max), e.from, e.to]);
  }
  const quarters = [[`${Y}-04-10`, 'Q1'], [`${Y}-07-10`, 'Q2'], [`${Y}-10-10`, 'Q3'], [`${Y + 1}-01-10`, 'Q4']];
  const charges = (st) => {
    const out = [];
    const f = st.family;
    const sibling = f.children.filter((k) => k.status === 'active').sort((a, b) => b.grade - a.grade).indexOf(st) > 0;
    for (const [due, q] of quarters) {
      if (due > add(today, 30) || (st.joinedMidYear && due < st.joined.slice(0, 8) + '01') || (st.leftOn && due > st.leftOn)) continue;
      const amount = TUITION(st.grade);
      const waived = f.rte ? amount : f.staffWard ? amount / 2 : sibling ? amount / 10 : 0;
      out.push({ head: 'Tuition', title: `Tuition ${q} ${year}`, amount, due, waived });
      if (st.rider) out.push({ head: 'Transport', title: `Transport ${q} ${year}`, amount: 8500, due, waived: 0 });
    }
    if (!st.leftOn || st.leftOn > `${Y}-04-10`) out.push({ head: 'Annual charges', title: `Annual charges ${year}`, amount: 14000, due: st.joinedMidYear ? add(st.joined, 10) : `${Y}-04-10`, waived: f.rte ? 14000 : 0 });
    if (!st.joinedMidYear && `${Y}-07-15` <= add(today, 30) && (!st.leftOn || st.leftOn > `${Y}-07-15`)) out.push({ head: 'Activity', title: `Activity and excursion ${year}`, amount: 4500, due: `${Y}-07-15`, waived: 0 });
    return out;
  };
  const dues = [['admission_no', 'head', 'title', 'amount', 'due_on', 'waived']];
  const payments = [['Receipt No', 'Admn No', 'Particular', 'Amount Paid', 'Receipt Date', 'Payment Mode', 'Cheque No']];
  let receipt = 1, due = 0, paid = 0, waived = 0;
  const MODES = ['UPI', 'UPI', 'UPI', 'NEFT', 'NEFT', 'Cheque', 'Card', 'Cash'];
  for (const st of students) for (const ch of charges(st)) {
    dues.push([st.adm, ch.head, ch.title, String(ch.amount), ch.due, String(ch.waived)]);
    due += ch.amount; waived += ch.waived;
    const owed = ch.amount - ch.waived;
    if (owed <= 0 || ch.due > today) continue;
    // Most pay in full before or soon after the due date; the latest quarter is still coming in; a few pay in two parts.
    const recent = ch.due >= add(today, -45);
    const r = rnd();
    const share = r < (recent ? 0.62 : 0.93) ? 1 : r < (recent ? 0.72 : 0.97) ? 0.5 : 0;
    const days = Math.floor(rnd() * (share === 1 ? 25 : 10)) - 8;
    const parts = share === 1 && chance(0.04) ? [0.5, 0.5] : share ? [share] : [];
    for (const [i, part] of parts.entries()) {
      // A fee paid in two halves: the second about three weeks after the first.
      const on = add(ch.due, days + i * 20);
      if (on >= today) continue;
      const mode = pick(MODES);
      payments.push([`SVS/${pad(Y % 100)}-${pad((Y + 1) % 100)}/${pad(receipt++, 5)}`, st.adm, ch.title, `₹${Math.round(owed * part).toLocaleString('en-IN')}`, dMonY(on), mode, mode === 'Cheque' ? String(100000 + Math.floor(rnd() * 899999)) : mode === 'UPI' ? `UPI${Math.floor(rnd() * 1e11)}` : '']);
      paid += Math.round(owed * part);
    }
  }

  // ── Library ─────────────────────────────────────────────────────────────────
  const BOOKS = [['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography'], ['Malgudi Days', 'R. K. Narayan', 'Fiction'], ['Swami and Friends', 'R. K. Narayan', 'Fiction'], ['The Jungle Book', 'Rudyard Kipling', 'Fiction'],
    ['Panchatantra', 'Vishnu Sharma', 'Folk tales'], ['Tales from the Jataka', '', 'Folk tales'], ['The Room on the Roof', 'Ruskin Bond', 'Fiction'], ['The Blue Umbrella', 'Ruskin Bond', 'Fiction'],
    ['Grandma\'s Bag of Stories', 'Sudha Murty', 'Fiction'], ['How I Taught My Grandmother to Read', 'Sudha Murty', 'Fiction'], ['Ignited Minds', 'A. P. J. Abdul Kalam', 'Non-fiction'], ['The Story of My Experiments with Truth', 'M. K. Gandhi', 'Biography'],
    ['Discovery of India', 'Jawaharlal Nehru', 'History'], ['Alice\'s Adventures in Wonderland', 'Lewis Carroll', 'Fiction'], ['Treasure Island', 'Robert Louis Stevenson', 'Fiction'], ['Charlotte\'s Web', 'E. B. White', 'Fiction'],
    ['Matilda', 'Roald Dahl', 'Fiction'], ['The Diary of a Young Girl', 'Anne Frank', 'Biography'], ['A Brief History of Time', 'Stephen Hawking', 'Science'], ['The Little Prince', 'Antoine de Saint-Exupéry', 'Fiction'],
    ['Karvalo', 'K. P. Poornachandra Tejasvi', 'Kannada'], ['Malegalalli Madumagalu', 'Kuvempu', 'Kannada'], ['Chomana Dudi', 'K. Shivaram Karanth', 'Kannada'], ['Godan', 'Munshi Premchand', 'Hindi'], ['Idgah', 'Munshi Premchand', 'Hindi'],
    ['Oxford Student Atlas for India', 'Oxford University Press', 'Reference'], ['Oxford Advanced Learner\'s Dictionary', 'A. S. Hornby', 'Reference'], ['Children\'s Encyclopedia of Science', '', 'Reference']];
  for (let g = 1; g <= 12; g++) for (const sub of EXAMINED(g, 'A')) BOOKS.push([`${sub} textbook for Class ${g}`, 'NCERT', 'Textbook']);
  const isbn = () => { const d = `97893${pad(Math.floor(rnd() * 1e8), 8)}`; const c = (10 - [...d].reduce((n, x, i) => n + Number(x) * (i % 2 ? 3 : 1), 0) % 10) % 10; return `${d}${c}`; };
  let barcode = 1;
  const catalogue = BOOKS.map(([title, author, category]) => ({ title, author, category, isbn: category === 'Kannada' || category === 'Folk tales' ? '' : isbn(), shelf: `${category.slice(0, 3).toUpperCase()}-${1 + Math.floor(rnd() * 9)}`, type: category === 'Reference' ? 'REF' : 'BK', copies: Array.from({ length: category === 'Textbook' ? 3 : 1 + Math.floor(rnd() * 5) }, () => `SVSL${pad(barcode++, 5)}`) }));
  const loans = [['Admn No', 'Book Title', 'Return By', 'returned_on']];
  for (const st of students.filter((x) => x.status === 'active' && chance(0.16))) {
    const b = pick(catalogue.filter((x) => x.category !== 'Reference'));
    loans.push([st.adm, b.title, ddmmyyyy(add(today, Math.floor(rnd() * 24) - 12)), '']);
  }

  // ── Files ───────────────────────────────────────────────────────────────────
  const files = [];
  const put = (name, content, o) => files.push({ name, content, ...o });
  const titled = (title, note, rows) => [[title], [note], [], ...rows];
  put('01-academic-year.csv', toCsv([['label', 'starts_on', 'ends_on', 'current'], [year, start, end, 'yes']]), { kind: 'years', from: 'Tangent template' });
  put('02-terms.csv', toCsv([['year', 'name', 'starts_on', 'ends_on'], [year, 'Term 1', start, `${Y}-09-30`], [year, 'Term 2', `${Y}-10-01`, end]]), { kind: 'terms', from: 'Tangent template' });
  put('03-reporting-periods.csv', toCsv([['year', 'name', 'starts_on', 'ends_on'], ...[['Quarter 1', start, `${Y}-06-30`], ['Quarter 2', `${Y}-07-01`, `${Y}-09-30`], ['Quarter 3', `${Y}-10-01`, `${Y}-12-31`], ['Quarter 4', `${Y + 1}-01-01`, end]].map((r) => [year, ...r])]), { kind: 'reporting_periods', from: 'Tangent template' });
  put('04-holiday-list.xlsx', xlsx([{ name: 'Holidays', rows: titled(`Sunrise Valley School · Holiday list ${year}`, 'As approved by the management committee', [['Occasion', 'From Date', 'To Date'], ...holidays.map(([n, a, b]) => [n, ddmmyyyy(a), b ? ddmmyyyy(b) : ''])]) }]), { kind: 'holidays', from: 'The office’s spreadsheet, title rows above the headers' });
  put('05-subjects.csv', toCsv([['name', 'per_week'], ...Object.keys(load).map((sub) => [sub, String(Math.max(...classes.map((c) => c.plan[sub] ?? 0)))])]), { kind: 'subjects', from: 'Tangent template' });
  put('06-bell-timings.csv', toCsv([['number', 'label', 'starts_at', 'ends_at', 'kind'], ...BELL.map((b) => b.map(String))]), { kind: 'periods', from: 'Tangent template' });
  put('07-staff-register.xlsx', xlsx([{ name: 'Staff', rows: titled('Sunrise Valley School · Staff register', `As on ${ddmmyyyy(today, '-')}`, [['Employee Name', 'Email ID', 'Mobile No', 'Designation', 'Department', 'Date of Joining', 'Access Role', 'Subjects'],
    ...staff.map((t) => [t.name, t.email, written(t.phone), t.designation, t.department, ddmmyyyy(t.joined, '-'), t.role ?? '', t.subjects.join('; ')])]) }]), { kind: 'staff', from: 'HR register, title rows above the headers' });
  put('08-classes.csv', toCsv([['class', 'grade', 'section', 'class_teacher'], ...classes.map((c) => [c.name, String(c.grade), c.section, c.teacher?.email ?? ''])]), { kind: 'classes', from: 'Tangent template' });
  const active = students.filter((x) => x.status === 'active');
  put('09-students-fedena.csv', toCsv([['Admission no', 'First name', 'Middle name', 'Last name', 'Batch name', 'Roll number', 'Date of birth', 'Gender', 'Blood group', 'Admission date', 'Father name', 'Father mobile phone', 'Father email', 'Mother name', 'Mother mobile phone', 'House'],
    ...active.map((x) => { const f = x.family; const none = phoneless.includes(f); return [x.adm, x.first, '', x.last, `${x.grade}-${x.section}`, String(x.roll), ddmmyyyy(x.dob), x.girl ? 'Female' : 'Male', x.blood, ddmmyyyy(x.joined), f.father, none ? '' : written(f.fatherPhone), f.email, f.mother, none ? '' : f.motherPhone ? written(f.motherPhone) : '', x.house]; })]), { kind: 'students', from: 'Fedena student export' });
  put('10-students-left.csv', toCsv([['admission_no', 'name', 'class', 'roll_no', 'dob', 'admitted_on', 'status', 'guardian_name', 'guardian_phone', 'relation'],
    ...leavers.map((x) => [x.adm, x.name, x.cls, '', x.dob, x.joined, 'left', x.family.father, x.family.fatherPhone, 'Father'])]), { kind: 'students', from: 'Former students, Tangent template' });
  put('11-family-contacts.csv', toCsv([['Name', 'Given Name', 'Family Name', 'Group Membership', 'Phone 1 - Type', 'Phone 1 - Value'],
    ...phoneless.map((f) => [f.father, f.father.split(' ')[0], f.last, `* myContacts ::: Class ${f.children[0].cls} parents`, 'Mobile', `+91 ${f.fatherPhone.slice(0, 5)} ${f.fatherPhone.slice(5)}`])]), { kind: 'contacts', from: 'Google Contacts export of the class WhatsApp group' });
  const nextYear = `${Y + 1}-${pad((Y + 2) % 100)}`;
  put('12-admission-enquiries.csv', toCsv([['child_name', 'grade_sought', 'guardian_name', 'phone', 'email', 'source', 'stage', 'test_on', 'note'],
    ...Array.from({ length: 36 }, (_, i) => { const last = pick(SURNAMES); const stage = pick(['enquiry', 'enquiry', 'applied', 'applied', 'test', 'offer']); return [`${pick(chance(0.5) ? GIRLS : BOYS)} ${last}`, String(1 + (i % 9)), `${pick(BOYS)} ${last}`, phone(), chance(0.6) ? `${mail(pick(BOYS), last)}@gmail.com` : '', pick(['website', 'walk-in', 'referral', 'newspaper']), stage, stage === 'test' ? add(today, 10 + i) : '', `For ${nextYear}`]; })]), { kind: 'admissions', from: 'Tangent template' });
  put('13-fee-heads.csv', toCsv([['name', 'order', 'concession'], ['Tuition', '1', 'yes'], ['Annual charges', '2', 'no'], ['Activity', '3', 'no'], ['Transport', '4', 'no']]), { kind: 'fee_heads', from: 'Tangent template' });
  put('14-fee-structure.xlsx', xlsx([{ name: 'Fee structure', rows: titled(`Fee structure ${year}`, 'Amounts in rupees · Transport per quarter for students who take the bus', [['Grade', 'Fee Head', 'Particular', 'Fee Amount', 'Due Date'],
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap((g) => quarters.map(([d, q]) => [String(g), 'Tuition', `Tuition ${q} ${year}`, String(TUITION(g)), ddmmyyyy(d)])), ['', 'Annual charges', `Annual charges ${year}`, '14000', ddmmyyyy(`${Y}-04-10`)], ['', 'Activity', `Activity and excursion ${year}`, '4500', ddmmyyyy(`${Y}-07-15`)]]) }]), { kind: 'fee_structures', from: 'Accounts spreadsheet, title rows above the headers' });
  put('15-opening-dues.csv', toCsv(dues), { kind: 'fee_dues', from: 'Tangent template, reconciled with the old ledger' });
  put('16-fee-collection-register.csv', toCsv(payments), { kind: 'payments', from: 'The old ERP’s fee collection register' });
  put('17-attendance.csv', toCsv(attendance), { kind: 'attendance', from: 'The old ERP’s daily attendance export' });
  if (exams.length) put('18-marks.csv', toCsv(marks), { kind: 'marks', from: 'The old ERP’s marks export' });
  put('19-timetable-asc.xml', ascXml(classes, staff, slots), { kind: 'timetable', from: 'aSc Timetables 2012 XML export' });
  put('20-library-koha.mrc', marc(catalogue), { kind: 'library_books', from: 'Koha: Export catalog data (MARC)' });
  put('21-library-loans.csv', toCsv(loans), { kind: 'library_loans', from: 'Library register' });
  put('22-transport.csv', toCsv([['Admn No', 'Route Name'], ...active.filter((x) => x.rider).map((x) => [x.adm, x.route])]), { kind: 'transport', from: 'Transport coordinator’s sheet' });
  put('23-leave-balances.csv', toCsv([['email', 'type', 'days', 'year', 'note'], ...staff.filter((t) => t.role || t.department === 'Transport').flatMap((t) => [[t.email, 'Casual leave', String(12 - Math.floor(rnd() * 7)), '', 'From the old system'], [t.email, 'Sick leave', String(10 - Math.floor(rnd() * 4)), '', 'From the old system']])]), { kind: 'leave_balances', from: 'Tangent template' });
  put('24-pickup-people.csv', toCsv([['admission_no', 'name', 'relation', 'phone'], ...active.filter(() => chance(0.18)).map((x) => [x.adm, `${pick(BOYS)} ${x.last}`, pick(['Grandfather', 'Uncle', 'Aunt', 'Grandmother', 'Driver']), phone()])]), { kind: 'pickup_people', from: 'The gate register' });
  // Photos for most students: named by admission number (slashes as dashes), a few by the camera's own name.
  const photos = active.filter(() => chance(0.94)).map((x) => ({ name: `photos/${x.cls.replace(' ', '')}/${x.adm.replace(/\//g, '-')}.png`, content: png(['#c0392b', '#2471a3', '#1e8449', '#b7950b'][HOUSES.indexOf(x.house)]) }));
  for (let i = 0; i < 5; i++) photos.push({ name: `photos/unsorted/IMG_${2040 + i}.png`, content: png('#7f8c8d') });
  put('25-student-photos.zip', zip(photos), { kind: null, upload: 'photos', from: 'The photographer’s zip' });
  const cards = [];
  if (exams.length) for (const x of active.filter((y) => !y.joinedMidYear)) cards.push({ name: `${x.adm.replace(/\//g, '-')} Report card Term 1.pdf`, content: reportCard(x, exams, scores, schoolDays.filter((d) => d <= `${Y}-09-30` && enrolledOn(x, d)).length, year) });
  for (const x of leavers) cards.push({ name: `${x.adm.replace(/\//g, '-')} Transfer certificate.pdf`, content: pdf([`Sunrise Valley School, Whitefield, Bengaluru`, 'TRANSFER CERTIFICATE', '', `Name of the student: ${x.name}`, `Admission number: ${x.adm}`, `Class last studied: ${x.cls}`, `Date of birth: ${ddmmyyyy(x.dob)}`, `Date of leaving: ${ddmmyyyy(x.leftOn)}`, 'Reason: Parents moving to another city', 'Conduct: Good', '', 'Principal']) });
  put('26-report-cards.zip', zip(cards), { kind: null, upload: 'documents', from: 'The old ERP’s report cards and certificates' });
  const circular = (title, lines) => pdf(['Sunrise Valley School, Whitefield, Bengaluru', `Circular · ${dMonY(today)}`, '', title, '', ...lines, '', 'Principal']);
  put('circulars/parent-teacher-meeting.pdf', circular('Parent-teacher meeting', [`Dear parents, the Term 2 parent-teacher meeting is on ${dMonY(add(today, 9))} from 9:00 am to 1:00 pm.`, 'Please book a slot with your child’s class teacher in the app.']), { kind: null, from: 'For the rehearsal: post as a notice' });
  put('circulars/winter-break.pdf', circular('Christmas break', [`School is closed from ${dMonY(`${Y}-12-24`)} to ${dMonY(`${Y + 1}-01-01`)}.`, `Classes resume on ${dMonY(`${Y + 1}-01-02`)}.`]), { kind: null, from: 'For the rehearsal: post as a notice' });
  put('circulars/annual-day.pdf', circular('Annual Day', [`Our Annual Day is on ${dMonY(add(today, 23))} at 5:00 pm in the school auditorium.`, 'Parents are welcome. Please reply in the app.']), { kind: null, from: 'For the rehearsal: an event with replies' });
  put('circulars/term-2-date-sheet.pdf', circular('Term 2 examination date sheet', EXAMINED(8, 'A').map((sub, i) => `${dMonY(add(`${Y + 1}-02-23`, i))}: ${sub}`)), { kind: null, from: 'For the rehearsal: the Term 2 exam' });

  const who = (x) => ({ name: x.name, email: x.email, phone: x.phone ? `+91${x.phone}` : undefined });
  const manifest = {
    generatedFor: today, seed,
    school: { name: 'Sunrise Valley School', shortName: 'Sunrise Valley', slug: 'sunrise-valley', board: 'CBSE', address: 'Whitefield Main Road, Whitefield', city: 'Bengaluru', country: 'IN', timezone: 'Asia/Kolkata', locale: 'en-IN', currency: 'INR', language: 'en',
      color: '#1F6FB2', logoText: 'S', appName: 'Sunrise Valley', tagline: 'Learn. Lead. Serve.', contactName: principal.name, contactPhone: `+91 ${principal.phone}`, contactEmail: principal.email },
    // What Tangent sets for the school in the console before its files come in: the library keeps reference copies too, and
    // families, teachers and the bus drivers use the app.
    settings: { 'library.itemTypes': [{ key: 'book', name: 'Book' }, { key: 'reference', name: 'Reference' }], 'app.roles': ['parent', 'teacher', 'driver'] },
    modules: ['people', 'attendance', 'fees', 'notices', 'timetable', 'homework', 'events', 'exams', 'chat', 'transport', 'library', 'gallery', 'staffAttendance', 'diary', 'ptm', 'visitors', 'certificates'],
    // Each with the email and the phone (international form) their codes go to.
    people: {
      principal: who(principal),
      vicePrincipal: who(vice), office: who(office), accountant: who(accountant),
      classTeacher: { ...who(classTeacher), class: '8 A' }, mathsTeacher: { ...who(maths), classes: maths.classes },
      driver: { ...who(drivers[0]), route: ROUTES[0] },
      parentOfTwo: { name: twoKids.father, phone: `+91${twoKids.fatherPhone}`, email: twoKids.email, children: [...twoKids.children].sort((x, y) => Number(y.cls === '8 A') - Number(x.cls === '8 A')).map((k) => ({ name: k.name, admissionNo: k.adm, class: k.cls })) },
      parentOfOne: { name: oneKid.father, phone: `+91${oneKid.fatherPhone}`, email: oneKid.email, children: oneKid.children.map((k) => ({ name: k.name, admissionNo: k.adm, class: k.cls })) },
      student: { name: oneKid.children[0].name, admissionNo: oneKid.children[0].adm, class: oneKid.children[0].cls },
    },
    files: files.map(({ name, kind, upload, from }) => ({ name, kind, upload: upload ?? null, from })),
    expect: {
      students: active.length, left: leavers.length, joinedThisTerm: active.filter((x) => x.joinedMidYear).length, classes: classes.length, staff: staff.length, families: families.length,
      phoneless: phoneless.length, schoolDays: schoolDays.length, attendanceMarks: marked, exams: exams.map((e) => e.name), marks: marks.length - 1,
      dues: due, waived, paid, receipts: payments.length - 1, titles: catalogue.length, copies: catalogue.reduce((n, b) => n + b.copies.length, 0), loans: loans.length - 1,
      riders: active.filter((x) => x.rider).length, lessons: slots.length, unplacedLessons: unplaced, photos: photos.length - 5, reportCards: cards.length - leavers.length,
    },
  };
  return { manifest, files };
}

/** The timetable as aSc Timetables writes its 2012 XML export: periods, days, subjects, teachers, rooms, classes, lessons, cards. */
function ascXml(classes, staff, slots) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const subjects = [...new Set(slots.map((x) => x.sub))];
  const teachers = staff.filter((t) => slots.some((x) => x.teacher === t));
  const rooms = [...new Set(slots.map((x) => x.room))];
  const sid = (s) => `S${subjects.indexOf(s) + 1}`, tid = (t) => `T${teachers.indexOf(t) + 1}`, rid = (r) => `R${rooms.indexOf(r) + 1}`, cid = (c) => `C${classes.findIndex((x) => x.name === c) + 1}`;
  const lessons = new Map();
  for (const x of slots) { const k = `${x.cls}|${x.sub}`; if (!lessons.has(k)) lessons.set(k, { id: `L${lessons.size + 1}`, ...x, n: 0 }); lessons.get(k).n++; }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<timetable importtype="database" options="idprefix:SVS,daynumbering1">',
    '  <periods options="canadd,export:silent" columns="period,name,short,starttime,endtime">', ...LESSONS.map((b, i) => `    <period name="${i + 1}" short="${i + 1}" period="${i + 1}" starttime="${b[2]}" endtime="${b[3]}"/>`), '  </periods>',
    '  <daysdefs options="canadd,export:silent" columns="id,name,short,days">', ...WEEK.map((d, i) => `    <daysdef id="D${i + 1}" name="${d}" short="${d.slice(0, 2)}" days="${'0'.repeat(i)}1${'0'.repeat(5 - i)}"/>`), '  </daysdefs>',
    '  <subjects options="canadd,export:silent" columns="id,name,short">', ...subjects.map((x) => `    <subject id="${sid(x)}" name="${esc(x)}" short="${esc(x.slice(0, 3))}"/>`), '  </subjects>',
    '  <teachers options="canadd,export:silent" columns="id,name,short,email">', ...teachers.map((t) => `    <teacher id="${tid(t)}" name="${esc(t.name)}" short="${esc(t.name.split(' ').map((w) => w[0]).join(''))}" email="${esc(t.email)}"/>`), '  </teachers>',
    '  <classrooms options="canadd,export:silent" columns="id,name,short">', ...rooms.map((r) => `    <classroom id="${rid(r)}" name="${esc(r)}" short="${esc(r.replace(/\s/g, ''))}"/>`), '  </classrooms>',
    '  <classes options="canadd,export:silent" columns="id,name,short,teacherid">', ...classes.map((c) => `    <class id="${cid(c.name)}" name="${c.name}" short="${c.name.replace(' ', '')}" teacherid="${c.teacher ? tid(c.teacher) : ''}"/>`), '  </classes>',
    '  <lessons options="canadd,export:silent" columns="id,classids,subjectid,periodspercard,periodsperweek,teacherids,classroomids">',
    ...[...lessons.values()].map((l) => `    <lesson id="${l.id}" classids="${cid(l.cls)}" subjectid="${sid(l.sub)}" periodspercard="1" periodsperweek="${l.n}" teacherids="${tid(l.teacher)}" classroomids="${rid(l.room)}"/>`), '  </lessons>',
    '  <cards options="canadd,export:silent" columns="lessonid,period,days,classroomids">',
    ...slots.map((x) => `    <card lessonid="${lessons.get(`${x.cls}|${x.sub}`).id}" period="${x.period + 1}" days="${'0'.repeat(x.day)}1${'0'.repeat(5 - x.day)}" classroomids="${rid(x.room)}"/>`), '  </cards>', '</timetable>'];
  return `${lines.join('\n')}\n`;
}

/** A MARC 21 file (ISO 2709) the way Koha exports a catalogue: 245 title, 100 author, 020 ISBN, 650 subject, one 952 per copy. */
function marc(catalogue) {
  const records = catalogue.map((b) => {
    const fields = [['001', Buffer.from(b.copies[0])], ['008', Buffer.from(`261001s2026    ii            000 0 eng d`)]];
    const data = (ind, subs) => Buffer.from(`${ind}${subs.filter(([, v]) => v).map(([c, v]) => `\x1f${c}${v}`).join('')}`, 'utf8');
    if (b.isbn) fields.push(['020', data('  ', [['a', b.isbn]])]);
    if (b.author) fields.push(['100', data('1 ', [['a', `${b.author},`]])]);
    fields.push(['245', data('10', [['a', `${b.title} /`]])]);
    fields.push(['650', data(' 0', [['a', b.category]])]);
    for (const code of b.copies) fields.push(['952', data('  ', [['o', b.shelf], ['p', code], ['y', b.type]])]);
    const bodies = fields.map(([tag, buf]) => [tag, Buffer.concat([buf, Buffer.from([0x1e])])]);
    let offset = 0;
    const dir = bodies.map(([tag, buf]) => { const e = `${tag}${pad(buf.length, 4)}${pad(offset, 5)}`; offset += buf.length; return e; }).join('');
    const base = 24 + dir.length + 1;
    const total = base + offset + 1;
    const leader = `${pad(total, 5)}nam a22${pad(base, 5)} a 4500`;
    return Buffer.concat([Buffer.from(leader + dir, 'latin1'), Buffer.from([0x1e]), ...bodies.map(([, buf]) => buf), Buffer.from([0x1d])]);
  });
  return Buffer.concat(records);
}

/** A one-page PDF of plain text lines (Helvetica); the rupee sign is written as Rs. since the standard fonts lack it. */
function pdf(lines) {
  const text = lines.map((l) => `(${String(l).replace(/₹/g, 'Rs. ').replace(/[’‘]/g, "'").replace(/·/g, '-').replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '')}) Tj T*`).join('\n');
  const stream = `BT /F1 11 Tf 56 780 Td 16 TL\n${text}\nET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${pad(o, 10)} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function reportCard(st, exams, scores, days, year) {
  const rows = EXAMINED(st.grade, st.section).map((sub) => {
    const got = exams.map((e) => scores.get(`${st.adm}|${e.name}|${sub}`));
    const total = got.reduce((n, v) => n + (v ?? 0), 0);
    return `${sub.padEnd(24)} ${exams.map((e, i) => `${got[i] ?? 'AB'}/${e.max}`.padEnd(10)).join(' ')} ${total}/100`;
  });
  return pdf(['Sunrise Valley School, Whitefield, Bengaluru', `Report card · Term 1 · ${year}`, '', `Name: ${st.name}`, `Admission number: ${st.adm}`, `Class: ${st.cls}   Roll number: ${st.roll}`, `Days present in Term 1: about ${Math.round(days * st.attendance)} of ${days}`, '',
    `Subject                  ${exams.map((e) => e.name.padEnd(10).slice(0, 10)).join(' ')} Total`, ...rows, '', 'Class teacher’s remark: Works steadily; keep reading every day.']);
}

/** A 96 by 120 PNG of one colour (a stand-in for a student's photo). */
function png(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const w = 96, h = 120;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
