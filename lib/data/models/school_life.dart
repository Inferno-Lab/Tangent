// The five modules of the one shot as the app reads them: staff attendance and leave, the class diary, parent-teacher
// meetings, gate passes and pick-up (with invited visitors), and certificates. Shapes follow the family API (/v1/f/*).

typedef Named = ({String key, String name});

DateTime? _time(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v)?.toLocal() : null;
List<Map<String, dynamic>> _list(Object? v) => [for (final x in (v as List? ?? const [])) Map<String, dynamic>.from(x as Map)];

class LeaveBalanceRow {
  const LeaveBalanceRow({required this.type, required this.name, required this.available, required this.used, required this.pending});

  factory LeaveBalanceRow.fromJson(Map<String, dynamic> j) => LeaveBalanceRow(
    type: j['type'] as String,
    name: j['name'] as String? ?? '',
    available: (j['available'] as num?)?.toDouble(),
    used: (j['used'] as num? ?? 0).toDouble(),
    pending: (j['pending'] as num? ?? 0).toDouble(),
  );

  final String type;
  final String name;

  /// Null when the type keeps no balance (unpaid leave).
  final double? available;
  final double used;
  final double pending;
}

class StaffLeaveRequest {
  const StaffLeaveRequest({required this.id, required this.typeName, required this.from, required this.to, required this.halfDay, required this.days, required this.status, required this.reason, required this.note});

  factory StaffLeaveRequest.fromJson(Map<String, dynamic> j) => StaffLeaveRequest(
    id: j['id'] as String,
    typeName: j['typeName'] as String? ?? '',
    from: j['from'] as String,
    to: j['to'] as String,
    halfDay: j['halfDay'] as String?,
    days: (j['days'] as num? ?? 0).toDouble(),
    status: j['status'] as String? ?? 'pending',
    reason: j['reason'] as String? ?? '',
    note: j['decisionNote'] as String? ?? '',
  );

  final String id;
  final String typeName;
  final String from;
  final String to;
  final String? halfDay;
  final double days;
  final String status;
  final String reason;
  final String note;
}

/// A member of staff's own day: checked in or not (and why not now), their leave balances and requests.
class MyStaffDay {
  const MyStaffDay({
    required this.closed, required this.checkIn, required this.checkOut, required this.late, required this.early, required this.leave, required this.canCheckIn,
    required this.why, required this.opens, required this.closes, required this.needsPlace, required this.balances, required this.requests, required this.types,
  });

  factory MyStaffDay.fromJson(Map<String, dynamic> j) {
    final w = Map<String, dynamic>.from(j['window'] as Map? ?? const {});
    final l = j['leave'] as Map?;
    return MyStaffDay(
      closed: j['closed'] == true,
      checkIn: _time(j['checkIn']),
      checkOut: _time(j['checkOut']),
      late: j['late'] == true,
      early: j['early'] == true,
      leave: l == null ? null : (name: '${l['typeName']}', half: l['half'] as String?),
      canCheckIn: j['canCheckIn'] == true,
      why: j['why'] as String? ?? '',
      opens: w['from'] as String? ?? '',
      closes: w['until'] as String? ?? '',
      needsPlace: j['needsPlace'] == true,
      balances: [for (final b in _list(j['balances'])) LeaveBalanceRow.fromJson(b)],
      requests: [for (final r in _list(j['requests'])) StaffLeaveRequest.fromJson(r)],
      types: [for (final t in _list(j['types'])) (key: '${t['key']}', name: '${t['name']}', halfDays: t['halfDays'] == true)],
    );
  }

  final bool closed;
  final DateTime? checkIn;
  final DateTime? checkOut;
  final bool late;
  final bool early;
  final ({String name, String? half})? leave;
  final bool canCheckIn;
  final String why;
  final String opens;
  final String closes;
  final bool needsPlace;
  final List<LeaveBalanceRow> balances;
  final List<StaffLeaveRequest> requests;
  final List<({String key, String name, bool halfDays})> types;
}

/// A diary entry: a family reads its child's remark only; a teacher sees how many families acknowledged.
class DiaryEntry {
  const DiaryEntry({
    required this.id, required this.date, required this.kindName, required this.subject, required this.text, required this.files, required this.remark, required this.by,
    required this.acknowledged, required this.needsAck, this.className = '', this.acks = 0, this.families = 0, this.byId = '',
  });

  factory DiaryEntry.fromJson(Map<String, dynamic> j) => DiaryEntry(
    id: j['id'] as String,
    date: j['date'] as String,
    kindName: j['kindName'] as String? ?? '',
    subject: (j['subject'] ?? j['subjectName']) as String?,
    text: j['text'] as String? ?? '',
    files: [for (final f in _list(j['files'])) (key: '${f['id']}', name: '${f['name']}')],
    remark: j['remark'] as String?,
    by: j['by'] as String? ?? '',
    acknowledged: j['acknowledged'] == true,
    needsAck: j['needsAck'] == true,
    className: j['className'] as String? ?? '',
    acks: (j['acks'] as num? ?? 0).toInt(),
    families: (j['families'] as num? ?? 0).toInt(),
    byId: j['byId'] as String? ?? '',
  );

  final String id;
  final String date;
  final String kindName;
  final String? subject;
  final String text;
  final List<Named> files;
  final String? remark;
  final String by;
  final bool acknowledged;
  final bool needsAck;
  final String className;
  final int acks;
  final int families;
  final String byId;
}

/// A class a teacher writes the diary for, with the subjects they teach in it (none: the class teacher writes for all).
class DiaryClass {
  const DiaryClass({required this.id, required this.name, required this.classTeacher, required this.subjects});

  factory DiaryClass.fromJson(Map<String, dynamic> j) => DiaryClass(
    id: j['classId'] as String,
    name: j['className'] as String? ?? '',
    classTeacher: j['classTeacher'] == true,
    subjects: [for (final s in _list(j['subjects'])) (key: '${s['id']}', name: '${s['name']}')],
  );

  final String id;
  final String name;
  final bool classTeacher;
  final List<Named> subjects;
}

class MeetingSlot {
  const MeetingSlot({required this.id, required this.startsAt, required this.endsAt, required this.state, required this.studentName, required this.mode, required this.link});

  factory MeetingSlot.fromJson(Map<String, dynamic> j) => MeetingSlot(
    id: j['id'] as String,
    startsAt: _time(j['startsAt'])!,
    endsAt: _time(j['endsAt'])!,
    state: j['state'] as String? ?? 'open',
    studentName: j['studentName'] as String?,
    mode: j['mode'] as String?,
    link: j['link'] as String? ?? '',
  );

  final String id;
  final DateTime startsAt;
  final DateTime endsAt;

  /// open, booked or closed.
  final String state;
  final String? studentName;
  final String? mode;
  final String link;
}

class MeetingTeacher {
  const MeetingTeacher({required this.id, required this.name, required this.booked, required this.slots});

  factory MeetingTeacher.fromJson(Map<String, dynamic> j) => MeetingTeacher(
    id: j['teacherId'] as String,
    name: j['name'] as String? ?? '',
    booked: j['booked'] is Map ? MeetingSlot.fromJson(Map<String, dynamic>.from(j['booked'] as Map)) : null,
    slots: [for (final s in _list(j['slots'])) MeetingSlot.fromJson(s)],
  );

  final String id;
  final String name;
  final MeetingSlot? booked;
  final List<MeetingSlot> slots;
}

/// A meeting day as a family sees it: for each child, the child's teachers there and their free times.
class FamilyMeeting {
  const FamilyMeeting({required this.id, required this.title, required this.date, required this.mode, required this.place, required this.canBook, required this.canCancel, required this.children});

  factory FamilyMeeting.fromJson(Map<String, dynamic> j) => FamilyMeeting(
    id: j['id'] as String,
    title: j['title'] as String? ?? '',
    date: j['date'] as String,
    mode: j['mode'] as String? ?? 'inPerson',
    place: j['place'] as String? ?? '',
    canBook: j['canBook'] == true,
    canCancel: j['canCancel'] == true,
    children: [
      for (final c in _list(j['children'])) (studentId: '${c['studentId']}', name: '${c['name']}', teachers: [for (final t in _list(c['teachers'])) MeetingTeacher.fromJson(t)]),
    ],
  );

  final String id;
  final String title;
  final String date;
  final String mode;
  final String place;
  final bool canBook;
  final bool canCancel;
  final List<({String studentId, String name, List<MeetingTeacher> teachers})> children;
}

/// A meeting day as a teacher sees it: their own times, booked or not.
class TeacherMeeting {
  const TeacherMeeting({required this.id, required this.title, required this.date, required this.mode, required this.place, required this.slots});

  factory TeacherMeeting.fromJson(Map<String, dynamic> j) => TeacherMeeting(
    id: j['id'] as String,
    title: j['title'] as String? ?? '',
    date: j['date'] as String,
    mode: j['mode'] as String? ?? 'inPerson',
    place: j['place'] as String? ?? '',
    slots: [for (final s in _list(j['slots'])) MeetingSlot.fromJson(s)],
  );

  final String id;
  final String title;
  final String date;
  final String mode;
  final String place;
  final List<MeetingSlot> slots;
}

class GatePass {
  const GatePass({required this.id, required this.number, required this.studentId, required this.studentName, required this.leaveAt, required this.reason, required this.collector, required this.state});

  factory GatePass.fromJson(Map<String, dynamic> j) => GatePass(
    id: j['id'] as String,
    number: j['number'] as String?,
    studentId: j['studentId'] as String,
    studentName: j['studentName'] as String? ?? '',
    leaveAt: _time(j['leaveAt'])!,
    reason: j['reason'] as String? ?? '',
    collector: j['collector'] as String? ?? '',
    state: j['state'] as String? ?? 'pending',
  );

  final String id;
  final String? number;
  final String studentId;
  final String studentName;
  final DateTime leaveAt;
  final String reason;
  final String collector;

  /// consent (the school asks the family), pending, approved, rejected, left or cancelled.
  final String state;
}

class PickupPerson {
  const PickupPerson({required this.id, required this.studentId, required this.name, required this.relation, required this.phone});

  factory PickupPerson.fromJson(Map<String, dynamic> j) =>
      PickupPerson(id: j['id'] as String, studentId: j['studentId'] as String, name: j['name'] as String? ?? '', relation: j['relation'] as String? ?? '', phone: j['phone'] as String? ?? '');

  final String id;
  final String studentId;
  final String name;
  final String relation;
  final String phone;
}

/// The family's early-leave passes, the day's pick-up code and who they named to collect their children.
class GatePassView {
  const GatePassView({required this.code, required this.passes, required this.people});

  factory GatePassView.fromJson(Map<String, dynamic> j) => GatePassView(
    code: j['code'] as String?,
    passes: [for (final p in _list(j['passes'])) GatePass.fromJson(p)],
    people: [for (final p in _list(j['people'])) PickupPerson.fromJson(p)],
  );

  final String? code;
  final List<GatePass> passes;
  final List<PickupPerson> people;
}

class Invite {
  const Invite({required this.id, required this.name, required this.purposeName, required this.expectedOn, required this.state, required this.code});

  factory Invite.fromJson(Map<String, dynamic> j) => Invite(
    id: j['id'] as String,
    name: j['name'] as String? ?? '',
    purposeName: j['purposeName'] as String? ?? '',
    expectedOn: j['expectedOn'] as String?,
    state: j['state'] as String? ?? 'invited',
    code: j['code'] as String?,
  );

  final String id;
  final String name;
  final String purposeName;
  final String? expectedOn;

  /// pending (waiting for approval), invited, in, out, cancelled or declined.
  final String state;
  final String? code;
}

class CertificateItem {
  const CertificateItem({required this.id, required this.typeName, required this.studentName, required this.number, required this.state, required this.feeDue, required this.purpose});

  factory CertificateItem.fromJson(Map<String, dynamic> j) => CertificateItem(
    id: j['id'] as String,
    typeName: j['typeName'] as String? ?? '',
    studentName: j['studentName'] as String? ?? '',
    number: j['number'] as String?,
    state: j['state'] as String? ?? 'pending',
    feeDue: (j['feeDue'] as num? ?? 0).toDouble(),
    purpose: j['purpose'] as String? ?? '',
  );

  final String id;
  final String typeName;
  final String studentName;
  final String? number;

  /// pending, issued, rejected, cancelled or revoked.
  final String state;
  final double feeDue;
  final String purpose;
}

class CertificatesView {
  const CertificatesView({required this.types, required this.certificates});

  factory CertificatesView.fromJson(Map<String, dynamic> j) => CertificatesView(
    types: [for (final t in _list(j['types'])) (key: '${t['key']}', name: '${t['name']}', fee: (t['fee'] as num? ?? 0).toDouble())],
    certificates: [for (final c in _list(j['certificates'])) CertificateItem.fromJson(c)],
  );

  final List<({String key, String name, double fee})> types;
  final List<CertificateItem> certificates;
}
