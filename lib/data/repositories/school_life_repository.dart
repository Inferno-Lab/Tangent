
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/school_life.dart';

/// Staff attendance and leave, the class diary, parent-teacher meetings, gate passes and pick-up, invited visitors and
/// certificates: the five modules of the one shot, for every role that uses them.
abstract class SchoolLifeRepository {
  Future<MyStaffDay> staffDay();
  Future<MyStaffDay> checkIn({double? lat, double? lng, double? accuracy});
  Future<MyStaffDay> checkOut();
  Future<void> askLeave({required String type, required String from, required String to, String? halfDay, String reason = ''});
  Future<void> withdrawLeave(String id);

  Future<List<DiaryEntry>> diary(String studentId);
  Future<void> acknowledge(String entryId, String studentId);
  /// The classes this teacher writes for, and the school's kinds of entry.
  Future<({List<DiaryClass> classes, List<Named> kinds})> diaryClasses();
  Future<List<DiaryEntry>> classDiary(String classId);
  Future<void> writeDiary({required String classId, required String date, required String kind, required String text, String? subjectId});
  Future<void> removeDiary(String id);

  Future<List<FamilyMeeting>> meetings();
  Future<void> book({required String slotId, required String studentId, String? mode});
  Future<void> cancelBooking(String slotId);
  Future<List<TeacherMeeting>> myMeetings();
  Future<void> setSlot(String slotId, {bool? closed, String? link});

  Future<GatePassView> gatePasses();
  Future<void> askGatePass({required String studentId, required DateTime leaveAt, required String reason, String? pickupId, String collector = ''});
  Future<void> answerGatePass(String id, {required bool yes});
  Future<void> cancelGatePass(String id);
  Future<void> addPickupPerson({required List<String> studentIds, required String name, required String relation, String phone = ''});
  Future<void> removePickupPerson(String id);

  Future<({List<Invite> invites, List<Named> purposes})> invites();
  Future<void> invite({required String name, required String phone, required String purpose, required String expectedOn});
  Future<void> cancelInvite(String id);

  Future<CertificatesView> certificates();
  Future<void> requestCertificate({required String type, required String studentId, String purpose = ''});
  Future<void> cancelCertificate(String id);
}

/// The school's server (the family API).
class RemoteSchoolLifeRepository implements SchoolLifeRepository {
  RemoteSchoolLifeRepository(this._r);

  final RemoteDataSource _r;

  Map<String, dynamic> _map(Object? j) => Map<String, dynamic>.from(j! as Map);
  List<Map<String, dynamic>> _list(Object? j) => [for (final x in j! as List) Map<String, dynamic>.from(x as Map)];

  @override
  Future<MyStaffDay> staffDay() async => MyStaffDay.fromJson(_map(await _r.get('/staff/me')));

  @override
  Future<MyStaffDay> checkIn({double? lat, double? lng, double? accuracy}) async =>
      MyStaffDay.fromJson(_map(await _r.post('/staff/check-in', {'lat': ?lat, 'lng': ?lng, 'accuracy': ?accuracy})));

  @override
  Future<MyStaffDay> checkOut() async => MyStaffDay.fromJson(_map(await _r.post('/staff/check-out', const {})));

  @override
  Future<void> askLeave({required String type, required String from, required String to, String? halfDay, String reason = ''}) =>
      _r.post('/staff/leave', {'type': type, 'from': from, 'to': to, 'halfDay': halfDay, 'reason': reason});

  @override
  Future<void> withdrawLeave(String id) => _r.post('/staff/leave/$id/withdraw', const {});

  @override
  Future<List<DiaryEntry>> diary(String studentId) async => [for (final e in _list(await _r.get('/diary/student/$studentId'))) DiaryEntry.fromJson(e)];

  @override
  Future<void> acknowledge(String entryId, String studentId) => _r.post('/diary/$entryId/ack', {'studentId': studentId});

  @override
  Future<({List<DiaryClass> classes, List<Named> kinds})> diaryClasses() async {
    final j = _map(await _r.get('/diary/classes'));
    return (classes: [for (final c in _list(j['classes'])) DiaryClass.fromJson(c)], kinds: [for (final k in _list(j['kinds'])) (key: '${k['key']}', name: '${k['name']}')]);
  }

  @override
  Future<List<DiaryEntry>> classDiary(String classId) async => [for (final e in _list(await _r.get('/diary', query: {'classId': classId}))) DiaryEntry.fromJson(e)];

  @override
  Future<void> writeDiary({required String classId, required String date, required String kind, required String text, String? subjectId}) =>
      _r.post('/diary', {'classId': classId, 'date': date, 'kind': kind, 'subjectId': subjectId, 'text': text, 'fileIds': const <String>[], 'remarks': const <Object>[]});

  @override
  Future<void> removeDiary(String id) => _r.delete('/diary/$id');

  @override
  Future<List<FamilyMeeting>> meetings() async => [for (final m in _list(await _r.get('/meetings'))) FamilyMeeting.fromJson(m)];

  @override
  Future<void> book({required String slotId, required String studentId, String? mode}) => _r.post('/meetings/book', {'slotId': slotId, 'studentId': studentId, 'mode': ?mode});

  @override
  Future<void> cancelBooking(String slotId) => _r.post('/meetings/slots/$slotId/cancel', const {});

  @override
  Future<List<TeacherMeeting>> myMeetings() async => [for (final m in _list(await _r.get('/meetings/mine'))) TeacherMeeting.fromJson(m)];

  @override
  Future<void> setSlot(String slotId, {bool? closed, String? link}) => _r.patch('/meetings/slots/$slotId', {'closed': ?closed, 'link': ?link});

  @override
  Future<GatePassView> gatePasses() async => GatePassView.fromJson(_map(await _r.get('/gate-pass')));

  @override
  Future<void> askGatePass({required String studentId, required DateTime leaveAt, required String reason, String? pickupId, String collector = ''}) =>
      _r.post('/gate-pass', {'studentId': studentId, 'leaveAt': leaveAt.toUtc().toIso8601String(), 'reason': reason, 'pickupId': pickupId, 'collector': collector, 'returns': false});

  @override
  Future<void> answerGatePass(String id, {required bool yes}) => _r.post('/gate-pass/$id/consent', {'yes': yes});

  @override
  Future<void> cancelGatePass(String id) => _r.post('/gate-pass/$id/cancel', const {});

  @override
  Future<void> addPickupPerson({required List<String> studentIds, required String name, required String relation, String phone = ''}) =>
      _r.post('/pickup-people', {'studentIds': studentIds, 'name': name, 'relation': relation, 'phone': phone});

  @override
  Future<void> removePickupPerson(String id) => _r.delete('/pickup-people/$id');

  @override
  Future<({List<Invite> invites, List<Named> purposes})> invites() async {
    final j = _map(await _r.get('/visitors'));
    return (invites: [for (final v in _list(j['visitors'])) Invite.fromJson(v)], purposes: [for (final p in _list(j['purposes'])) (key: '${p['key']}', name: '${p['name']}')]);
  }

  @override
  Future<void> invite({required String name, required String phone, required String purpose, required String expectedOn}) =>
      _r.post('/visitors', {'name': name, 'phone': phone, 'purpose': purpose, 'expectedOn': expectedOn});

  @override
  Future<void> cancelInvite(String id) => _r.post('/visitors/$id/cancel', const {});

  @override
  Future<CertificatesView> certificates() async => CertificatesView.fromJson(_map(await _r.get('/certificates')));

  @override
  Future<void> requestCertificate({required String type, required String studentId, String purpose = ''}) => _r.post('/certificates', {'type': type, 'studentId': studentId, 'purpose': purpose});

  @override
  Future<void> cancelCertificate(String id) => _r.post('/certificates/$id/cancel', const {});
}
