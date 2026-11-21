# The app's data shapes

The JSON the family API (`/v1/f/*`) answers and the app's models (`lib/data/models`) read: field names, enum values and how a
few values are worked out on the phone. The app has no data of its own; everything comes from the school
(`docs/API_CONTRACT.md` for the routes, `docs/test-school.md` for the school the tests read).

## Computed fee status

`Installment.paid` is stored. The badge is not. `moneyStatus` returns:

- `paid` when `paid` is true
- `overdue` when unpaid and the due date is before today
- `due` when unpaid and the due date is today or within 21 days
- `upcoming` otherwise

## Enums (JSON values)

- Role: `student`, `parent`, `teacher`
- Attendance: `present`, `absent`, `late`, `holiday`
- Period kind: `class`, `break`, `recess`
- Homework status: `pending`, `submitted`, `graded`
- Exam status: `upcoming`, `completed`
- Leave: `pending`, `approved`, `rejected`
- RSVP: `going`, `maybe`, `cant`

## Relationships

- `users.studentId` → `students.id`
- `users.teacherId` → `teachers.id`
- `users.childIds[]` → `students.id`
- `students.classId` → `classes.id`
- `classes.classTeacherId` → class teacher
- `attendance.studentId` → `students.id`
- `timetable.classId` → `classes.id`; each period's `teacherId` → `teachers.id`
- `homework.classId` → `classes.id`; `submissions[].studentId` → `students.id`
- `exams.classId` → `classes.id`
- `results.examId` + `results.studentId`
- `fees.studentId` → `students.id`; `installments[].id` is the payment key
- `events.rsvps[].userId` → `users.id`
- `chat_threads.participantIds[]` → `users.id`; `messages.threadId` → `chat_threads.id`
- `library_books.borrowedBy` → `students.id` when borrowed
- `transport.studentId` → `students.id`
- `leave_requests.studentId` → `students.id`
- `notifications.userId` → `users.id`; `route` is an in-app path

## Field notes

**User:** `id`, `role`, `name`, `email`, `phone`, `avatarUrl`, `password`, `childIds`, optional `studentId`, optional `teacherId`.

**Student:** `id`, `userId`, `name`, `classId`, `rollNo`, `dob`, `bloodGroup`, `house`, `avatarUrl`, `guardianName`, `guardianPhone`, `address`, and optional `fields` (the school's own fields it shows in the app, label → value; `{}` when none).

**Class:** `id`, `name`, `section`, `classTeacherId`, `room`, `studentIds`.

**Teacher:** `id`, optional `userId`, `name`, `subject`, `email`, `phone`, `avatarUrl`, `classIds`.

**Attendance day:** `studentId`, `date`, `status`.

**Timetable day:** `classId`, `day` (`mon`…`sat`), `periods[]` of `id`, `subject`, optional `teacherId`, `start`, `end`, `room`, `kind`.

**Homework:** `id`, `classId`, `subject`, `title`, `description`, `assignedOn`, `dueOn`, `teacherId`, `maxMarks`, `attachments[]`, `submissions[]` (`studentId`, `status`, optional `submittedAt`, `fileName`, `marks`, `grade`, `feedback`).

**Exam:** `id`, `name`, `classId`, `startDate`, `endDate`, `status`, `subjects[]`.

**Result:** `id`, `examId`, `studentId`, `overallPercent`, `grade`, `rank`, `totalStudents`, `subjects[]` (`subject`, `marks`, `maxMarks`, `grade`), `trend[]` (`label`, `percent`).

**Fee account:** `studentId`, `academicYear`, `installments[]` (`id`, `title`, `amount`, `dueDate`, `paid`, optional `paidOn`, `method`, `reference`).

**Notice:** `id`, `title`, `body`, `category` (`academic`, `exams`, `sports`, `fees`, `holiday`, `general`), `audience`, `pinned`, `date`, `author`, `attachments[]`.

**Event:** `id`, `title`, `description`, `date`, `time`, `venue`, `category`, `imageUrl`, `rsvps[]` (`userId`, `status`).

**Chat thread:** `id`, `title`, `subtitle`, `avatarUrl`, `participantIds[]`, `online`.

**Message:** `id`, `threadId`, `senderId`, `text`, `sentAt`, `read`.

**Library book:** `id`, `title`, `author`, `category`, `isbn`, `available`, `coverUrl`, optional `borrowedBy`, `dueDate`.

**Transport:** `studentId`, `routeName`, `busNumber`, `etaMinutes`, `progress`, `driver` (`name`, `phone`, `avatarUrl`), `stops[]` (`name`, `time`, `reached`).

**Leave:** `id`, `studentId`, `from`, `to`, `reason`, `status`, `appliedOn`, optional `reviewedBy`, `reviewNote`.

**Gallery album:** `id`, `title`, `date`, `blurb`, `photos[]` (`id`, `url`, `caption`).

**Notification:** `id`, `userId`, `title`, `body`, `type`, `date`, `read`, `route`.

**School:** `name`, `tagline`, `address`, `phone`, `email`, `website`, `principal`, `founded`, `officeHours`, `about`.

Avatars and gallery photos are network URLs (`pravatar.cc`, `picsum.photos`). The UI falls back to initials if the device is offline.
