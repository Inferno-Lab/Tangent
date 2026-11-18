import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/date_seed.dart';
import 'package:tangent/data/datasources/mock_json_datasource.dart';
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

/// Sample content: one demo state read from assets/mock/school_life.json, changed in memory as the person acts.
class MockSchoolLifeRepository implements SchoolLifeRepository {
  MockSchoolLifeRepository(this._ds);

  final MockJsonDataSource _ds;
  Map<String, dynamic>? _s;

  Future<Map<String, dynamic>> _state() async {
    if (_s != null) return _s!;
    final raw = await rootBundle.loadString('assets/mock/school_life.json');
    return _s = Map<String, dynamic>.from(DateSeed.resolve(jsonDecode(raw)) as Map);
  }

  Future<T> _read<T>(T Function(Map<String, dynamic> s) fn) async {
    final s = await _state();
    return _ds.guard(() => fn(s));
  }

  Future<void> _write(void Function(Map<String, dynamic> s) fn) async {
    final s = await _state();
    await _ds.guard(() => fn(s));
    _ds.bump();
  }

  List<dynamic> _l(Map<String, dynamic> s, String k) => s[k] as List<dynamic>;
  Map<String, dynamic> _m(Map<String, dynamic> s, String k) => Map<String, dynamic>.from(s[k] as Map);
  String _now() => Clock.now().toUtc().toIso8601String();

  @override
  Future<MyStaffDay> staffDay() => _read((s) => MyStaffDay.fromJson(_m(s, 'staff')));

  @override
  Future<MyStaffDay> checkIn({double? lat, double? lng, double? accuracy}) async {
    await _write((s) => (s['staff'] as Map)..['checkIn'] = _now()..['canCheckIn'] = false);
    return staffDay();
  }

  @override
  Future<MyStaffDay> checkOut() async {
    await _write((s) {
      final staff = s['staff'] as Map;
      if (staff['checkIn'] == null) throw const AppException('staff.check_in_first');
      staff['checkOut'] = _now();
    });
    return staffDay();
  }

  @override
  Future<void> askLeave({required String type, required String from, required String to, String? halfDay, String reason = ''}) => _write((s) {
    final staff = s['staff'] as Map;
    final name = [for (final t in staff['types'] as List) if ((t as Map)['key'] == type) t['name']].firstOrNull ?? type;
    final days = halfDay != null ? 0.5 : DateTime.parse(to).difference(DateTime.parse(from)).inDays + 1.0;
    (staff['requests'] as List).insert(0, {'id': _ds.nextId('apr'), 'typeName': name, 'from': from, 'to': halfDay != null ? from : to, 'halfDay': halfDay, 'days': days, 'status': 'pending', 'reason': reason});
  });

  @override
  Future<void> withdrawLeave(String id) => _write((s) {
    for (final r in (s['staff'] as Map)['requests'] as List) {
      if ((r as Map)['id'] == id) r['status'] = 'withdrawn';
    }
  });

  @override
  Future<List<DiaryEntry>> diary(String studentId) =>
      _read((s) => [for (final e in _l(s, 'diary')) if ((e as Map)['studentId'] == studentId) DiaryEntry.fromJson(Map<String, dynamic>.from(e))]);

  @override
  Future<void> acknowledge(String entryId, String studentId) => _write((s) {
    for (final e in _l(s, 'diary')) {
      if ((e as Map)['id'] == entryId && e['studentId'] == studentId) {
        e
          ..['acknowledged'] = true
          ..['needsAck'] = false;
      }
    }
  });

  @override
  Future<({List<DiaryClass> classes, List<Named> kinds})> diaryClasses() => _read((s) => (
    classes: [for (final c in _l(s, 'diaryClasses')) DiaryClass.fromJson(Map<String, dynamic>.from(c as Map))],
    kinds: [for (final k in _l(s, 'diaryKinds')) (key: '${(k as Map)['key']}', name: '${k['name']}')],
  ));

  @override
  Future<List<DiaryEntry>> classDiary(String classId) =>
      _read((s) => [for (final e in _l(s, 'classDiary')) if ((e as Map)['classId'] == classId) DiaryEntry.fromJson(Map<String, dynamic>.from(e))]);

  @override
  Future<void> writeDiary({required String classId, required String date, required String kind, required String text, String? subjectId}) => _write((s) {
    final kinds = _l(s, 'diaryKinds');
    final kindName = [for (final k in kinds) if ((k as Map)['key'] == kind) k['name']].firstOrNull ?? kind;
    final cls = [for (final c in _l(s, 'diaryClasses')) if ((c as Map)['classId'] == classId) c['className']].firstOrNull ?? '';
    _l(s, 'classDiary').insert(0, {'id': _ds.nextId('dia'), 'classId': classId, 'className': cls, 'date': date, 'kindName': kindName, 'text': text, 'by': 'You', 'byId': 'me', 'acks': 0, 'families': 30});
  });

  @override
  Future<void> removeDiary(String id) => _write((s) => _l(s, 'classDiary').removeWhere((e) => (e as Map)['id'] == id));

  @override
  Future<List<FamilyMeeting>> meetings() => _read((s) => [for (final m in _l(s, 'meetings')) FamilyMeeting.fromJson(Map<String, dynamic>.from(m as Map))]);

  Iterable<Map<dynamic, dynamic>> _teachersOf(Map<String, dynamic> s) sync* {
    for (final m in _l(s, 'meetings')) {
      for (final c in (m as Map)['children'] as List) {
        for (final t in (c as Map)['teachers'] as List) {
          yield (t as Map)..['_student'] = c['studentId'];
        }
      }
    }
  }

  @override
  Future<void> book({required String slotId, required String studentId, String? mode}) => _write((s) {
    for (final t in _teachersOf(s)) {
      if (t['_student'] != studentId) continue;
      for (final slot in t['slots'] as List) {
        if ((slot as Map)['id'] != slotId) continue;
        if (t['booked'] != null) throw const AppException('meetings.already_booked');
        if (slot['state'] != 'open') throw const AppException('meetings.taken');
        slot['state'] = 'booked';
        slot['mode'] = mode ?? 'inPerson';
        t['booked'] = Map<String, dynamic>.from(slot);
      }
    }
  });

  @override
  Future<void> cancelBooking(String slotId) => _write((s) {
    for (final t in _teachersOf(s)) {
      if ((t['booked'] as Map?)?['id'] != slotId) continue;
      t['booked'] = null;
      for (final slot in t['slots'] as List) {
        if ((slot as Map)['id'] == slotId) slot['state'] = 'open';
      }
    }
  });

  @override
  Future<List<TeacherMeeting>> myMeetings() => _read((s) => [for (final m in _l(s, 'teacherMeetings')) TeacherMeeting.fromJson(Map<String, dynamic>.from(m as Map))]);

  @override
  Future<void> setSlot(String slotId, {bool? closed, String? link}) => _write((s) {
    for (final m in _l(s, 'teacherMeetings')) {
      for (final slot in (m as Map)['slots'] as List) {
        if ((slot as Map)['id'] != slotId) continue;
        if (closed != null) {
          slot['state'] = closed ? 'closed' : 'open';
          if (closed) slot['studentName'] = null;
        }
        if (link != null) slot['link'] = link;
      }
    }
  });

  @override
  Future<GatePassView> gatePasses() => _read((s) => GatePassView.fromJson(_m(s, 'gatePass')));

  @override
  Future<void> askGatePass({required String studentId, required DateTime leaveAt, required String reason, String? pickupId, String collector = ''}) => _write((s) {
    final g = s['gatePass'] as Map;
    final who = pickupId == null ? collector : [for (final p in g['people'] as List) if ((p as Map)['id'] == pickupId) p['name']].firstOrNull ?? collector;
    final name = [for (final p in g['passes'] as List) if ((p as Map)['studentId'] == studentId) p['studentName']].firstOrNull ?? '';
    (g['passes'] as List).insert(0, {'id': _ds.nextId('gtp'), 'studentId': studentId, 'studentName': name, 'leaveAt': leaveAt.toUtc().toIso8601String(), 'reason': reason, 'collector': who, 'state': 'pending'});
  });

  @override
  Future<void> answerGatePass(String id, {required bool yes}) => _write((s) {
    for (final p in (s['gatePass'] as Map)['passes'] as List) {
      if ((p as Map)['id'] == id && p['state'] == 'consent') p['state'] = yes ? 'pending' : 'cancelled';
    }
  });

  @override
  Future<void> cancelGatePass(String id) => _write((s) {
    for (final p in (s['gatePass'] as Map)['passes'] as List) {
      if ((p as Map)['id'] == id) p['state'] = 'cancelled';
    }
  });

  @override
  Future<void> addPickupPerson({required List<String> studentIds, required String name, required String relation, String phone = ''}) => _write((s) {
    for (final id in studentIds) {
      ((s['gatePass'] as Map)['people'] as List).add({'id': _ds.nextId('pkp'), 'studentId': id, 'name': name, 'relation': relation, 'phone': phone});
    }
  });

  @override
  Future<void> removePickupPerson(String id) => _write((s) => ((s['gatePass'] as Map)['people'] as List).removeWhere((p) => (p as Map)['id'] == id));

  @override
  Future<({List<Invite> invites, List<Named> purposes})> invites() => _read((s) => (
    invites: [for (final v in _l(s, 'invites')) Invite.fromJson(Map<String, dynamic>.from(v as Map))],
    purposes: [for (final p in _l(s, 'purposes')) (key: '${(p as Map)['key']}', name: '${p['name']}')],
  ));

  @override
  Future<void> invite({required String name, required String phone, required String purpose, required String expectedOn}) => _write((s) {
    final label = [for (final p in _l(s, 'purposes')) if ((p as Map)['key'] == purpose) p['name']].firstOrNull ?? purpose;
    _l(s, 'invites').insert(0, {'id': _ds.nextId('vis'), 'name': name, 'purposeName': label, 'expectedOn': expectedOn, 'state': 'invited', 'code': '${100000 + Clock.now().millisecond * 997 % 900000}'});
  });

  @override
  Future<void> cancelInvite(String id) => _write((s) {
    for (final v in _l(s, 'invites')) {
      if ((v as Map)['id'] == id) v['state'] = 'cancelled';
    }
  });

  @override
  Future<CertificatesView> certificates() => _read((s) => CertificatesView.fromJson(_m(s, 'certificates')));

  @override
  Future<void> requestCertificate({required String type, required String studentId, String purpose = ''}) => _write((s) {
    final c = s['certificates'] as Map;
    final name = [for (final t in c['types'] as List) if ((t as Map)['key'] == type) t['name']].firstOrNull ?? type;
    final pending = (c['certificates'] as List).any((x) => (x as Map)['typeName'] == name && x['state'] == 'pending' && x['studentId'] == studentId);
    if (pending) throw const AppException('certificates.already_waiting');
    (c['certificates'] as List).insert(0, {'id': _ds.nextId('crt'), 'typeName': name, 'studentId': studentId, 'studentName': '', 'state': 'pending', 'purpose': purpose, 'feeDue': 0});
  });

  @override
  Future<void> cancelCertificate(String id) => _write((s) {
    for (final x in (s['certificates'] as Map)['certificates'] as List) {
      if ((x as Map)['id'] == id) x['state'] = 'cancelled';
    }
  });
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
