import 'package:get/get.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/utils/status.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/core/utils/clock.dart';

class TimetableController extends GetxController with Loadable {
  /// Opens on today's timetable day (the first one when the school has no lessons today).
  final dayIndex = (() {
    final i = SchoolConfig.timetableKeys.indexOf(weekdayKey(Clock.now()));
    return i < 0 ? 0 : i;
  })().obs;
  List<TimetableDay> days = [];
  SchoolClass? schoolClass;
  final teachers = <String, String>{}.obs;

  /// A teacher's timetable: the class each of their lessons is with (their lessons come from all their classes).
  final classOf = <PeriodSlot, SchoolClass>{};
  bool get forTeacher => Get.find<AuthService>().role == UserRole.teacher;

  /// Subjects with homework due by the next school day.
  Set<String> homeworkDue = {};

  /// The school's timetable days (weekdays, A/B weekdays or the days of a cycle).
  List<String> get keys => SchoolConfig.timetableKeys;

  /// How a timetable day reads: Monday's short name, "Mon B", or "Day 3".
  String dayLabel(int index) {
    final key = keys[index];
    if (key.startsWith('d') && int.tryParse(key.substring(1)) != null) return 'timetable.cycle_day'.trp({'n': key.substring(1)});
    final parts = key.split('-');
    return parts.length == 2 ? '${'day.${parts[0]}'.tr} ${parts[1].toUpperCase()}' : 'day.$key'.tr;
  }

  TimetableDay? get selected {
    final key = keys[dayIndex.value];
    for (final day in days) {
      if (day.day == key) return day;
    }
    return null;
  }

  bool get isToday => weekdayKey(Clock.now()) == keys[dayIndex.value];

  /// The date a timetable day falls on: this week's for a weekly timetable, else the next one from today (null when none is near).
  DateTime? dateOf(int index) {
    final now = Clock.now();
    final today = DateTime(now.year, now.month, now.day);
    final key = keys[index];
    const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (week.contains(key) && SchoolConfig.cycleKey(today) == null) return today.subtract(Duration(days: now.weekday - 1)).add(Duration(days: week.indexOf(key)));
    for (var d = 0; d < 21; d++) {
      final date = today.add(Duration(days: d));
      if (weekdayKey(date) == key) return date;
    }
    return null;
  }

  @override
  Future<void> load() async {
    final teacherId = Get.find<AuthService>().user.value?.teacherId;
    if (forTeacher && teacherId != null) return _loadTeacher(teacherId);
    final id = Get.find<AuthService>().activeStudentId.value;
    if (id == null) {
      await run(() async {}, isEmpty: () => true);
      return;
    }
    await run(() async {
      final directory = Get.find<DirectoryRepository>();
      final student = await directory.student(id);
      final results = await Future.wait<Object?>([
        Get.find<TimetableRepository>().forClass(student.classId),
        directory.teachers(),
        directory.schoolClass(student.classId),
        Get.find<HomeworkRepository>().forClass(student.classId),
      ]);
      days = results[0]! as List<TimetableDay>;
      teachers
        ..clear()
        ..addAll({for (final teacher in results[1]! as List<Teacher>) teacher.id: teacher.name});
      schoolClass = results[2] as SchoolClass?;
      homeworkDue = {
        for (final hw in results[3]! as List<Homework>)
          if ((hw.forStudent(id)?.status ?? HomeworkStatus.pending) == HomeworkStatus.pending &&
              Formatters.daysUntil(hw.dueOn) >= 0 &&
              Formatters.daysUntil(hw.dueOn) <= 1)
            hw.subject,
      };
    }, isEmpty: () => days.isEmpty);
  }

  /// The teacher's own lessons on each day, from every class they teach, in time order.
  Future<void> _loadTeacher(String teacherId) => run(() async {
    final classes = await Get.find<DirectoryRepository>().classesForTeacher(teacherId);
    AppColors.setTeacherClasses([for (final c in classes) (id: c.id, name: c.label)]);
    final byDay = <String, List<PeriodSlot>>{};
    classOf.clear();
    for (final c in classes) {
      for (final d in await Get.find<TimetableRepository>().forClass(c.id)) {
        for (final p in d.periods.where((p) => p.kind == PeriodKind.klass && p.teacherId == teacherId)) {
          byDay.putIfAbsent(d.day, () => []).add(p);
          classOf[p] = c;
        }
      }
    }
    days = [
      for (final e in byDay.entries)
        TimetableDay(classId: '', day: e.key, periods: e.value..sort((a, b) => minutesOf(a.start).compareTo(minutesOf(b.start)))),
    ];
    schoolClass = null;
    teachers.clear();
    homeworkDue = {};
  }, isEmpty: () => days.isEmpty);

  bool isNow(PeriodSlot period) {
    if (!isToday) return false;
    final current = nowMinutes();
    return current >= minutesOf(period.start) && current < minutesOf(period.end);
  }
}
