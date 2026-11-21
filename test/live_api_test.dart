// Reads every app endpoint from the school through the app's own repositories, as a parent and as a teacher, so a change
// in what the server sends shows up as a failure here instead of on a phone (test/support/harness.dart: the running school).
@Tags(['school'])
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';

import 'support/harness.dart';

/// Chat may be paused for every school (the console's kill.chat); a paused module answers that it is, and nothing else.
Future<void> unlessPaused(Future<Object?> Function() read) async {
  try {
    await read();
  } on AppException catch (e) {
    expect(e.message, contains('paused'));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(bootLive);
  tearDown(Get.reset);

  test('a parent reads everything the app shows', () async {
    final me = await signIn(UserRole.parent);
    expect(me.role, UserRole.parent);
    expect(me.childIds, hasLength(2));
    final dir = Get.find<DirectoryRepository>();
    expect((await dir.school()).name, 'Sunrise Valley School');
    expect(await dir.teachers(), isNotEmpty);
    for (final id in me.childIds) {
      final child = await dir.student(id);
      final cls = await dir.schoolClass(child.classId);
      expect(cls.label, '8 A');
      // Since April: the attendance register, the aSc week with its breaks, and the old system's published exams.
      expect(await Get.find<AttendanceRepository>().forStudent(id), isNotEmpty);
      await Get.find<AttendanceRepository>().summary(id);
      final week = await Get.find<TimetableRepository>().forClass(child.classId);
      expect(week.first.periods.any((p) => p.kind == PeriodKind.breakTime), isTrue);
      await Get.find<HomeworkRepository>().forClass(child.classId);
      final exams = await Get.find<ExamRepository>().forClass(child.classId);
      final done = exams.firstWhere((e) => e.status == ExamStatus.completed);
      final result = await Get.find<ExamRepository>().result(examId: done.id, studentId: id);
      expect(result!.overallPercent, inInclusiveRange(0, 100));
      expect(await Get.find<ExamRepository>().resultsFor(id), isNotEmpty);
      expect((await Get.find<FeeRepository>().forStudent(id))!.installments, isNotEmpty);
      await Get.find<TransportRepository>().forStudent(id);
      await Get.find<LeaveRepository>().forStudent(id);
    }
    await Get.find<NoticeRepository>().all();
    await Get.find<EventRepository>().all();
    await unlessPaused(() => Get.find<ChatRepository>().inbox(me.id));
    // The Koha catalogue.
    expect(await Get.find<LibraryRepository>().all(), isNotEmpty);
    await Get.find<GalleryRepository>().all();
    await Get.find<NotificationRepository>().forUser(me.id);
  });

  test('a teacher reads everything the app shows', () async {
    final me = await signIn(UserRole.teacher);
    expect(me.role, UserRole.teacher);
    final dir = Get.find<DirectoryRepository>();
    final classes = await dir.classesForTeacher(me.id);
    expect(classes.map((c) => c.label), contains(person('classTeacher')['class']));
    for (final c in classes) {
      final students = await dir.studentsIn(c.id);
      expect(students, isNotEmpty);
      await Get.find<AttendanceRepository>().todayForClass([for (final s in students) s.id]);
      await Get.find<HomeworkRepository>().forClass(c.id);
      await Get.find<ExamRepository>().forClass(c.id);
      expect(await Get.find<TimetableRepository>().forClass(c.id), isNotEmpty);
    }
    await Get.find<NoticeRepository>().all();
    await unlessPaused(() => Get.find<ChatRepository>().inbox(me.id));
    await Get.find<LibraryRepository>().all();
    await Get.find<NotificationRepository>().forUser(me.id);
  });
}
