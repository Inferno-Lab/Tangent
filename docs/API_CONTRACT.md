# API contract

> **Status:** implemented. The school API serves these calls under the prefix `/v1/f` (for example `GET /v1/f/students/:id/fees`), scoped to the signed-in person, in the shapes below (`apps/api/src/school/family.controller.ts`, tests in `apps/api/test/family.test.ts`). The app's `ApiClient` adds the prefix, the `X-School` header and the token. Sign-in is the platform's own two steps, `POST /v1/auth/login` then `POST /v1/auth/verify`, not the `/auth/*` calls in the next section. Differences from the tables: leave requests, attendance marks and homework hand-ins are stored in the same tables the admin uses; gallery is empty; library lists loans only (reserve answers 409); transport has the route only; notifications are the messages the school sent to the person's phone (read and dismiss state is kept per person).

Each repository method maps to one REST call. `Remote*Repository` calls these paths through `RemoteDataSource` and `ApiClient` (`lib/core/network/api_client.dart`). A build without `SCHOOL` and `API_BASE_URL` keeps `AppConfig.useMockData` on and never touches the network; a build with them uses these calls.

JSON bodies and responses use the shapes in [APP_MODELS.md](APP_MODELS.md). Dates on the wire are ISO-8601. Enum fields use the JSON values listed there (`late`, not the Dart name `lateArrival`; `class`, not `klass`).

## Errors

Failures are a JSON object:

```json
{ "message": "errors.bad_login" }
```

The real server sends `{ "code", "message" }`, where `message` is a sentence for people (the client shows it as is) and `code` a machine word. HTTP status is 400 for validation, 401 for auth, 403 for a missing permission (or a module or feature the school's plan does not include), 404 for a missing id, 409 for a conflict, 423 for a locked account, 429 for too many requests (`retryAfter` in seconds, also the `retry-after` header) and 500 for anything else. `ApiClient` turns a non-2xx body into `AppException(message)` and a failed connection into `errors.network`.

## Auth

As built: `POST /v1/auth/login` `{ "identifier", "password", "client"? }` answers `{ "step": "otp", "challenge": { "challengeId", "maskedTo", "expiresInSeconds", "demoCode"? } }` (or the tokens when the school switched the code off). `client` is `web` or `mobile` (mobile if omitted). `POST /v1/auth/verify` `{ "challengeId", "code", "client"? }` answers `{ "accessToken", "expiresInSeconds", "user", "refreshToken"? }`.

Families have no password: `POST /v1/auth/code` `{ "identifier" }` (their phone) answers the same challenge, and `POST /v1/auth/verify` signs them in. One account is sent at most five codes (sign-in or reset, `POST /v1/auth/reset/start`) in fifteen minutes; the sixth answers 429. Staff signing in from the app (`client: "mobile"`) are refused with 403 when the school's `app.teachers` setting is off.

Before sign-in, `GET /v1/brand` (public) answers who the school is and its privacy notice: `{ "name", "shortName", "color", "logoText", "tagline", "language", "demoMode", "privacy": { "notice", "officerName", "officerEmail", "officerPhone" } }`. After sign-in, `GET /v1/config` is the school's resolved configuration: modules, features, `app` (`dock`, `home`, `quick`, already limited to modules the school has), `settings` (including `app.languages`, `privacy.consentRequired`, `privacy.photoConsent`) and `vocabulary`.

The phone app (`client: "mobile"`) gets `refreshToken` in the body, keeps both tokens in secure storage, and renews with `POST /v1/auth/refresh` `{ "refreshToken" }`. Each renewal returns a new refresh token; reusing an old one ends every session for that person and writes `auth.refresh_replayed`. Sessions last at most 30 days (14 idle).

The websites (`client: "web"`) keep the refresh token in an httpOnly cookie (`gd_rt_<slug>` locally, `__Secure-gd_rt_<slug>` in production, `Path=/v1/auth`, `SameSite=Strict`). The body has no refresh token. Refresh and logout send that cookie, an allowed `Origin`, and `x-csrf` matching the readable `gd_csrf` cookie. Web sessions last 7 days. `POST /v1/auth/logout-all` ends every session for that person.

Every later request sends `Authorization: Bearer <accessToken>` and `X-School: <slug>`. The access JWT is 15 minutes, bound to the school (`aud`), and carries `sid` and `ver` (`users.token_version`). A revoked session, a role change, deactivation, or logout-all is refused on the next request (cached about 30 seconds). The app then reads the person from `GET /v1/f/me`, which also carries `consentedAt` and `photoConsent`; a family consents once with `POST /v1/f/consent` `{ "photos"? }` (answers `{ "consentedAt", "photoConsent" }`; a second call changes nothing but the photo answer). The table below is the demo app's original shape; the mock still uses it.

## Pagination

Collection GETs accept `page` (default 1) and `pageSize` (default 50). The response is either the raw array the repositories parse today, or:

```json
{ "items": [], "page": 1, "pageSize": 50, "total": 0 }
```

Remote parsers currently expect the raw array (or a single object). When a backend starts paginating, unwrap `items` in that repository only.

## Auth repository

| Method | Call |
| --- | --- |
| `login` | `POST /auth/login` `{ "email", "password" }` → user |
| `loginWithOtp` | `POST /auth/otp` `{ "email", "otp" }` → user |

## Directory

| Method | Call |
| --- | --- |
| `student` | `GET /students/:id` → student |
| `studentsIn` | `GET /classes/:classId/students` → student[] |
| `schoolClass` | `GET /classes/:id` → class |
| `classesForTeacher` | `GET /teachers/:teacherId/classes` → class[] |
| `teacher` / `teacherOrNull` | `GET /teachers/:id` → teacher |
| `teachers` | `GET /teachers` → teacher[] |
| `school` | `GET /school` → school info |

## Academics

| Method | Call |
| --- | --- |
| `AttendanceRepository.forStudent` | `GET /students/:studentId/attendance` → attendance[] |
| `summary` | Derived on the client from `forStudent`. No extra route. |
| `todayForClass` | `GET /attendance/today?students=id,id` → `{ "stu_aarav": "present" }` |
| `markToday` | `POST /attendance` `{ "<studentId>": "present" }` |
| `TimetableRepository.forClass` | `GET /classes/:classId/timetable` → timetable[] |
| `HomeworkRepository.forClass` | `GET /classes/:classId/homework` → homework[] |
| `byId` | `GET /homework/:id` → homework |
| `submit` | `POST /homework/:id/submissions` `{ "studentId", "fileName" }` |
| `grade` | `POST /homework/:id/grades` `{ "studentId", "marks", "grade", "feedback" }` |
| `assign` | `POST /homework` → homework object |
| `ExamRepository.forClass` | `GET /classes/:classId/exams` → exam[] |
| `result` | `GET /results/:examId/:studentId` → result |
| `resultsFor` | `GET /students/:studentId/results` → result[] |
| `marksDraft` | `GET /classes/:classId/marks?subject=maths` → `{ "<studentId>": 91 }` |
| `saveMarks` | `POST /classes/:classId/marks` `{ "subject", "values" }` |

## Campus

| Method | Call |
| --- | --- |
| `FeeRepository.forStudent` | `GET /students/:studentId/fees` → fee account |
| `pay` | `POST /fees/:installmentId/order` `{ "studentId" }` → `{ "orderId", "url", "amount" }`; the app opens `url` (the provider's checkout) and asks `GET /orders/:orderId` → `{ "status": "created"\|"paid"\|"failed", "receipt" }` until it is paid. The old `POST /fees/:id/pay` answers 409 |
| receipt PDF | `GET /receipts/:paymentId/pdf`; report card `GET /results/:examId/:studentId/pdf` |
| open outside the app | `POST /receipts/:paymentId/link` or `POST /results/:examId/:studentId/link` → `{ "url" }`: a ten-minute signed link (`/hooks/doc/:token`) the phone opens in its browser to view, save or share the PDF, for the same children the app may read |
| phone's calendar | `POST /calendar/link` `{ "events": [{ "title", "start", "end"?, "details"?, "place"?, "alarmMinutes"? }] }` (at most two; `start` a day or a day and time on the school's clock) → `{ "url" }`; `POST /timetable/calendar-link` `{ "classId"? }` (a class's week, or the teacher's own) → `{ "url" }`. The link serves a calendar file (`text/calendar`) the phone opens in its calendar app; lessons repeat weekly until the term ends |
| file to open | `GET /v1/files/:id/url?download=1` → `{ "url" }` (homework and notice files carry `files: [{ "id", "name" }]`) |
| `NoticeRepository.all` | `GET /notices` → notice[] |
| `post` | `POST /notices` → notice object |
| `EventRepository.all` | `GET /events` → event[] |
| `rsvp` | `POST /events/:eventId/rsvp` `{ "userId", "status" }` |
| `ChatRepository.threadsFor` | `GET /users/:userId/threads` → thread[] |
| `messages` | `GET /threads/:threadId/messages` → message[] |
| `inbox` | `GET /users/:userId/threads` plus `GET /users/:userId/messages` → message[] |
| `send` | `POST /threads/:threadId/messages` `{ "senderId", "text" }` |
| `LibraryRepository.all` | `GET /library/books` → book[] |
| `reserve` | `POST /library/books/:bookId/reserve` `{ "studentId" }` → reservation |
| `renew` | `POST /library/books/:bookId/renew` `{}` (the child's open loan of that book) |
| `TransportRepository.forStudent` | `GET /students/:studentId/transport` → transport (stops with `reached`, the bus's ETA when it is live) |
| driver | `GET /bus/routes` (routes this staff member drives), `POST /bus/:routeId/position` `{ "lat", "lng" }` |
| `LeaveRepository.forStudent` | `GET /students/:studentId/leave` → leave[] |
| `apply` | `POST /leave` → leave object |
| `GalleryRepository.all` | `GET /gallery` → album[] (shared albums; photo `url`s last five minutes; photos with a child without photo consent are left out) |
| phones | `POST /devices` `{ "token", "platform", "appVersion"? }` after sign-in, `DELETE /devices/:token` at sign-out |
| files | `POST /v1/files` `{ "kind", "ownerId", "name", "mime", "bytes" }` → `{ "fileId", "upload": { "url", "method", "headers" } }`; PUT the bytes to `url`; `POST /v1/files/:id/done`. Homework hand-in: kind `homework_submission`, owner `<homeworkId>:<studentId>`, then `POST /homework/:id/submissions` `{ "studentId", "fileIds" }` |
| `NotificationRepository.forUser` | `GET /users/:userId/notifications` → notification[] |
| `dismiss` | `POST /notifications/:id/dismiss` `{}` |
| `markAllRead` | `POST /users/:userId/notifications/read` `{}` |
| `AssistantRepository.ask` | `POST /users/:userId/assistant` `{ "prompt", "history": [{ "role", "text" }] }` → `{ "text", "suggestions"?, "route"? }` |

## School life (`SchoolLifeRepository`)

Staff attendance and leave, the class diary, parent-teacher meetings, leave early and pick-up, invited visitors and certificates. Each answers 423 when the school does not have its module.

| Method | Call |
| --- | --- |
| `staffDay` | `GET /staff/me` → `{ today, closed, checkIn, checkOut, late, early, status, leave: { typeName, half }?, canCheckIn, why, window: { from, until, lateAfter }, needsPlace, balances: [{ type, name, allowance, carried, adjusted, used, pending, available? }], requests: [...], types: [{ key, name, halfDays }] }` (staff only) |
| `checkIn` / `checkOut` | `POST /staff/check-in` `{ lat?, lng?, accuracy? }` (location needed when `needsPlace`), `POST /staff/check-out` `{}` → the day again; 409 with the reason outside the window, on a closed day, on leave or too far away |
| `askLeave` / `withdrawLeave` | `POST /staff/leave` `{ type, from, to, halfDay: am\|pm\|null, reason }`; `POST /staff/leave/:id/withdraw` (only while it waits) |
| `diary` / `acknowledge` | `GET /diary/student/:studentId` → `[{ id, date, kind, kindName, subject, text, files, remark, by, acknowledged, needsAck }]`; `POST /diary/:id/ack` `{ studentId }` |
| teacher diary | `GET /diary/classes` → `{ classes: [{ classId, className, classTeacher, subjects }], kinds: [{ key, name }] }`; `GET /diary?classId=`; `POST /diary` `{ classId, date, kind, subjectId, text, fileIds, remarks: [{ studentId, text }] }`; `PUT/DELETE /diary/:id` |
| `meetings` / `book` / `cancelBooking` | `GET /meetings` → meetings with `children[].teachers[]` (`booked`, `slots`), `canBook`, `canCancel`; `POST /meetings/book` `{ slotId, studentId, mode? }`; `POST /meetings/slots/:id/cancel` |
| teacher meetings | `GET /meetings/mine`; `PATCH /meetings/slots/:id` `{ closed?, link? }` (closing a booked time cancels it and tells the family) |
| `gatePasses` | `GET /gate-pass` → `{ code, passes, people }` (parents); `POST /gate-pass` `{ studentId, leaveAt, reason, pickupId?, collector, returns }`; `POST /gate-pass/:id/consent` `{ yes }`; `POST /gate-pass/:id/cancel`; `POST /pickup-people` `{ studentIds, name, relation, phone }`; `DELETE /pickup-people/:id` |
| `invites` | `GET /visitors` → `{ visitors, purposes }` (staff); `POST /visitors` `{ name, phone, purpose, expectedOn }`; `POST /visitors/:id/cancel` |
| `certificates` | `GET /certificates` → `{ types: [{ key, name, fee }], certificates }` (parents); `POST /certificates` `{ type, studentId, purpose }`; `POST /certificates/:id/cancel`; `POST /certificates/:id/link` → `{ url }` (the issued PDF, ten minutes) |

## Plug-ins (not built)

These stay behind their own interfaces, so a screen never pretends to talk to a vendor.

**Push.** `PushGateway.register(token)` and `PushGateway.revoke()`. The server stores the device token on `POST /devices`. Tapping a push opens the `route` already stored on a notification. The in-app list remains `NotificationRepository`.

**Payments.** `PaymentGateway.checkout({ installmentId, method, amount })` returns `{ status, reference }`. `FeeRepository.pay` calls it, then `POST /fees/:installmentId/pay` with that reference. UPI, card, and net banking in the sheet are labels only until a gateway is chosen.

**Live GPS.** `BusTracker.watch(busNo)` is a stream of `{ lat, lng, heading, etaMinutes }`. `TransportRepository.forStudent` stays the snapshot (route, stops, driver). The painted map would subscribe to the stream instead of the mock `progress` animation.
