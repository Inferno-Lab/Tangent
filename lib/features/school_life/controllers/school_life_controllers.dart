import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';

SchoolLifeRepository get _repo => Get.find<SchoolLifeRepository>();
String dayKey(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

/// The family's children, each by name (for choosing which child a request is for).
List<String> get _children => Get.find<AuthService>().user.value?.childIds ?? const [];
Future<void> _nameChildren(RxMap<String, String> names) async {
  for (final id in _children) {
    if (names.containsKey(id)) continue;
    try {
      names[id] = (await Get.find<DirectoryRepository>().student(id)).name;
    } on Object {
      names[id] = '';
    }
  }
}

/// Runs an action, says what went wrong if it did, and reports whether it worked.
Future<bool> _act(Future<void> Function() fn, {String? done}) async {
  try {
    await fn();
    if (done != null) ToastHelper.show(done, kind: ToastKind.success);
    return true;
  } on AppException catch (e) {
    ToastHelper.show(e.message, kind: ToastKind.error);
    return false;
  }
}

/// A member of staff's own day: check in and out (near the school, where it asks), leave balances and requests.
class StaffTimeController extends GetxController with Loadable {
  final day = Rxn<MyStaffDay>();
  final busy = false.obs;

  @override
  Future<void> load() => run(() async => day.value = await _repo.staffDay());

  /// Where the phone is, when the school checks staff check in near it; null (and why, said) when it cannot tell.
  Future<Position?> _where() async {
    var allowed = await Geolocator.checkPermission();
    if (allowed == LocationPermission.denied) allowed = await Geolocator.requestPermission();
    if (allowed == LocationPermission.denied || allowed == LocationPermission.deniedForever || !await Geolocator.isLocationServiceEnabled()) {
      ToastHelper.show('staff.location_needed', kind: ToastKind.error);
      return null;
    }
    return Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 20)));
  }

  Future<void> checkIn() async {
    if (busy.value) return;
    busy.value = true;
    try {
      Position? at;
      if (day.value?.needsPlace ?? false) {
        at = await _where().catchError((Object _) => null);
        if (at == null) return;
      }
      await _act(() async => day.value = await _repo.checkIn(lat: at?.latitude, lng: at?.longitude, accuracy: at?.accuracy), done: 'staff.checked_in');
    } finally {
      busy.value = false;
    }
  }

  Future<void> checkOut() async {
    if (busy.value) return;
    busy.value = true;
    await _act(() async => day.value = await _repo.checkOut(), done: 'staff.checked_out');
    busy.value = false;
  }

  Future<bool> askLeave({required String type, required DateTime from, required DateTime to, String? halfDay, String reason = ''}) async {
    busy.value = true;
    final ok = await _act(() => _repo.askLeave(type: type, from: dayKey(from), to: dayKey(halfDay != null ? from : to), halfDay: halfDay, reason: reason), done: 'staff.leave_sent');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> withdraw(String id) async {
    if (await _act(() => _repo.withdrawLeave(id), done: 'staff.leave_withdrawn')) await load();
  }
}

/// A family's (or a student's) class diary for the active child: newest first, each acknowledged once read.
class DiaryController extends GetxController with Loadable {
  List<DiaryEntry> entries = [];

  String? get _child => Get.find<AuthService>().activeStudentId.value;

  @override
  Future<void> load() => run(() async {
    final id = _child;
    entries = id == null ? [] : await _repo.diary(id);
  }, isEmpty: () => entries.isEmpty);

  int get unread => entries.where((e) => e.needsAck).length;

  Future<void> acknowledge(DiaryEntry e) async {
    final id = _child;
    if (id == null || !e.needsAck) return;
    if (await _act(() => _repo.acknowledge(e.id, id), done: 'diary.acknowledged')) await load();
  }
}

/// A teacher writing the diary of the classes they may write for.
class TeacherDiaryController extends GetxController with Loadable {
  List<DiaryClass> classes = [];
  List<Named> kinds = [];
  final classId = RxnString();
  List<DiaryEntry> entries = [];
  final busy = false.obs;

  DiaryClass? get current => classes.firstWhereOrNull((c) => c.id == classId.value);

  @override
  Future<void> load() => run(() async {
    if (classes.isEmpty) {
      final r = await _repo.diaryClasses();
      classes = r.classes;
      kinds = r.kinds;
      classId.value ??= classes.firstOrNull?.id;
    }
    entries = classId.value == null ? [] : await _repo.classDiary(classId.value!);
  }, isEmpty: () => classes.isEmpty);

  Future<void> pick(String id) async {
    classId.value = id;
    await load();
  }

  Future<bool> write({required String kind, required String text, required DateTime date, String? subjectId}) async {
    final c = current;
    if (c == null) return false;
    busy.value = true;
    final ok = await _act(() => _repo.writeDiary(classId: c.id, date: dayKey(date), kind: kind, subjectId: subjectId, text: text), done: 'diary.written');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> remove(DiaryEntry e) async {
    if (await _act(() => _repo.removeDiary(e.id), done: 'diary.removed')) await load();
  }
}

/// Parent-teacher meetings a family can book: one time with each of a child's teachers.
class MeetingsController extends GetxController with Loadable {
  List<FamilyMeeting> meetings = [];
  final busy = false.obs;

  @override
  Future<void> load() => run(() async => meetings = await _repo.meetings(), isEmpty: () => meetings.isEmpty);

  Future<bool> book(MeetingSlot slot, String studentId, String? mode) async {
    busy.value = true;
    final ok = await _act(() => _repo.book(slotId: slot.id, studentId: studentId, mode: mode), done: 'meetings.booked');
    busy.value = false;
    await load();
    return ok;
  }

  Future<void> cancel(MeetingSlot slot) async {
    if (await _act(() => _repo.cancelBooking(slot.id), done: 'meetings.cancelled')) await load();
  }
}

/// A teacher's own meeting times: who booked, closing a time, giving a link for an online one.
class TeacherMeetingsController extends GetxController with Loadable {
  List<TeacherMeeting> meetings = [];

  @override
  Future<void> load() => run(() async => meetings = await _repo.myMeetings(), isEmpty: () => meetings.isEmpty);

  Future<void> setClosed(MeetingSlot s, {required bool closed}) async {
    if (await _act(() => _repo.setSlot(s.id, closed: closed), done: closed ? 'meetings.time_closed' : 'meetings.time_opened')) await load();
  }

  Future<void> setLink(MeetingSlot s, String link) async {
    if (await _act(() => _repo.setSlot(s.id, link: link), done: 'meetings.link_saved')) await load();
  }
}

/// A family's early-leave passes, the day's pick-up code, and the people they named to collect their children.
class GatePassController extends GetxController with Loadable {
  final view = Rxn<GatePassView>();
  final names = <String, String>{}.obs;
  final busy = false.obs;

  List<String> get children => _children;

  @override
  Future<void> load() => run(() async {
    view.value = await _repo.gatePasses();
    await _nameChildren(names);
  });

  Future<bool> ask({required String studentId, required DateTime leaveAt, required String reason, String? pickupId, String collector = ''}) async {
    if (leaveAt.isBefore(Clock.now())) {
      ToastHelper.show('gate.time_passed', kind: ToastKind.error);
      return false;
    }
    busy.value = true;
    final ok = await _act(() => _repo.askGatePass(studentId: studentId, leaveAt: leaveAt, reason: reason, pickupId: pickupId, collector: collector), done: 'gate.asked');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> answer(GatePass p, {required bool yes}) async {
    if (await _act(() => _repo.answerGatePass(p.id, yes: yes), done: yes ? 'gate.agreed' : 'gate.refused')) await load();
  }

  Future<void> cancel(GatePass p) async {
    if (await _act(() => _repo.cancelGatePass(p.id), done: 'gate.cancelled')) await load();
  }

  Future<bool> addPerson({required List<String> studentIds, required String name, required String relation, String phone = ''}) async {
    busy.value = true;
    final ok = await _act(() => _repo.addPickupPerson(studentIds: studentIds, name: name, relation: relation, phone: phone), done: 'gate.person_added');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> removePerson(PickupPerson p) async {
    if (await _act(() => _repo.removePickupPerson(p.id), done: 'gate.person_removed')) await load();
  }
}

/// Visitors a member of staff invited: each gets a pass code to show at reception.
class InviteController extends GetxController with Loadable {
  List<Invite> invites = [];
  List<Named> purposes = [];
  final busy = false.obs;

  @override
  Future<void> load() => run(() async {
    final r = await _repo.invites();
    invites = r.invites;
    purposes = r.purposes;
  });

  Future<bool> invite({required String name, required String phone, required String purpose, required DateTime on}) async {
    busy.value = true;
    final ok = await _act(() => _repo.invite(name: name, phone: phone, purpose: purpose, expectedOn: dayKey(on)), done: 'visitors.invited');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> cancel(Invite v) async {
    if (await _act(() => _repo.cancelInvite(v.id), done: 'visitors.cancelled')) await load();
  }
}

/// Certificates a family asked for, and asking for another.
class CertificatesController extends GetxController with Loadable {
  final view = Rxn<CertificatesView>();
  final names = <String, String>{}.obs;
  final busy = false.obs;

  List<String> get children => _children;

  @override
  Future<void> load() => run(() async {
    view.value = await _repo.certificates();
    await _nameChildren(names);
  });

  Future<bool> request({required String type, required String studentId, String purpose = ''}) async {
    busy.value = true;
    final ok = await _act(() => _repo.requestCertificate(type: type, studentId: studentId, purpose: purpose), done: 'certificates.asked');
    busy.value = false;
    if (ok) await load();
    return ok;
  }

  Future<void> cancel(CertificateItem c) async {
    if (await _act(() => _repo.cancelCertificate(c.id), done: 'certificates.cancelled')) await load();
  }
}
