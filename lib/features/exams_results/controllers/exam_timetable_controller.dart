import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';

/// The active child's exams still to come (or under way), each with its papers by day: the exam timetable.
class ExamTimetableController extends GetxController with Loadable {
  List<Exam> exams = [];
  String? childName;

  @override
  Future<void> load() async {
    final id = Get.find<AuthService>().activeStudentId.value;
    if (id == null) {
      await run(() async {}, isEmpty: () => true);
      return;
    }
    await run(() async {
      final student = await Get.find<DirectoryRepository>().student(id);
      childName = student.name.split(' ').first;
      final today = DateTime(Clock.now().year, Clock.now().month, Clock.now().day);
      // Upcoming and running exams, soonest first; one that has ended is in Results instead.
      exams = (await Get.find<ExamRepository>().forClass(student.classId)).where((e) => !e.endDate.isBefore(today)).toList()
        ..sort((a, b) => a.startDate.compareTo(b.startDate));
    }, isEmpty: () => exams.isEmpty);
  }

  /// An exam's papers in order of day and time; papers without a day yet come last.
  List<ExamPaper> papersOf(Exam e) => [...e.papers]..sort((a, b) {
    if (a.date == null || b.date == null) return a.date == null ? (b.date == null ? 0 : 1) : -1;
    final d = a.date!.compareTo(b.date!);
    return d != 0 ? d : a.startsAt.compareTo(b.startsAt);
  });
}
