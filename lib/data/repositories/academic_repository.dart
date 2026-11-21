import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/status.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/academics.dart';

abstract class AttendanceRepository {
  Future<List<AttendanceDay>> forStudent(String studentId);

  Future<AttendanceSummary> summary(String studentId, {DateTime? month});

  Future<Map<String, AttendanceStatus>> todayForClass(List<String> studentIds);

  Future<void> markToday(Map<String, AttendanceStatus> byStudent);
}

class RemoteAttendanceRepository implements AttendanceRepository {
  RemoteAttendanceRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<List<AttendanceDay>> forStudent(String studentId) async {
    final json = await _remote.get('/students/$studentId/attendance');
    return [
      for (final item in json as List)
        AttendanceDay.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<AttendanceSummary> summary(String studentId, {DateTime? month}) async {
    final days = await forStudent(studentId);
    return AttendanceSummary.from(days);
  }

  @override
  Future<Map<String, AttendanceStatus>> todayForClass(
    List<String> studentIds,
  ) async {
    final json = await _remote.get('/attendance/today', query: {'students': studentIds.join(',')});
    return {
      for (final e in (json as Map).entries)
        e.key as String: attendanceStatusOf(e.value),
    };
  }

  @override
  Future<void> markToday(Map<String, AttendanceStatus> byStudent) async {
    await _remote.post('/attendance', {
      for (final entry in byStudent.entries) entry.key: entry.value == AttendanceStatus.lateArrival ? 'late' : entry.value.name,
    });
  }
}

abstract class TimetableRepository {
  Future<List<TimetableDay>> forClass(String classId);
}

class RemoteTimetableRepository implements TimetableRepository {
  RemoteTimetableRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<List<TimetableDay>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/timetable');
    return [
      for (final item in json as List)
        TimetableDay.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }
}

abstract class HomeworkRepository {
  Future<List<Homework>> forClass(String classId);

  Future<Homework?> byId(String id);

  Future<void> submit({
    required String homeworkId,
    required String studentId,
    required String fileName,
    String? filePath,
  });

  Future<void> grade({
    required String homeworkId,
    required String studentId,
    required int marks,
    required String grade,
    required String feedback,
  });

  Future<void> assign(Homework homework);
}

class RemoteHomeworkRepository implements HomeworkRepository {
  RemoteHomeworkRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<List<Homework>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/homework');
    return [
      for (final item in json as List)
        Homework.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<Homework?> byId(String id) async {
    final json = await _remote.get('/homework/$id');
    return Homework.fromJson(Map<String, dynamic>.from(json as Map));
  }

  @override
  Future<void> submit({
    required String homeworkId,
    required String studentId,
    required String fileName,
    String? filePath,
  }) async {
    // The work itself goes to the school's storage first; the hand-in then names it.
    final fileId = filePath == null ? null : await _remote.client.upload(kind: 'homework_submission', ownerId: '$homeworkId:$studentId', path: filePath);
    await _remote.post('/homework/$homeworkId/submissions', {
      'studentId': studentId,
      'fileName': fileName,
      'fileIds': [?fileId],
    });
  }

  @override
  Future<void> grade({
    required String homeworkId,
    required String studentId,
    required int marks,
    required String grade,
    required String feedback,
  }) => _remote.post('/homework/$homeworkId/grades', {
    'studentId': studentId,
    'marks': marks,
    'grade': grade,
    'feedback': feedback,
  });

  @override
  Future<void> assign(Homework homework) =>
      _remote.post('/homework', homework.toJson());
}

abstract class ExamRepository {
  Future<List<Exam>> forClass(String classId);

  Future<ExamResult?> result({required String examId, required String studentId});

  Future<List<ExamResult>> resultsFor(String studentId);

  /// The marks entered so far and what the subject is marked out of; a subject graded without marks also has its grades
  /// to pick from and the grades given so far.
  Future<({Map<String, int> marks, int maxMarks, List<String> grades, Map<String, String> gradeMarks})> marksDraft(String classId, String subject);

  Future<void> saveMarks({
    required String classId,
    required String subject,
    required Map<String, int> values,
    Map<String, String> grades = const {},
  });
}

class RemoteExamRepository implements ExamRepository {
  RemoteExamRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<List<Exam>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/exams');
    return [
      for (final item in json as List)
        Exam.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<ExamResult?> result({
    required String examId,
    required String studentId,
  }) async {
    final json = await _remote.get('/results/$examId/$studentId');
    return ExamResult.fromJson(Map<String, dynamic>.from(json as Map));
  }

  @override
  Future<List<ExamResult>> resultsFor(String studentId) async {
    final json = await _remote.get('/students/$studentId/results');
    return [
      for (final item in json as List)
        ExamResult.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<({Map<String, int> marks, int maxMarks, List<String> grades, Map<String, String> gradeMarks})> marksDraft(String classId, String subject) async {
    final json = Map<String, dynamic>.from(await _remote.get('/classes/$classId/marks', query: {'subject': subject}) as Map);
    return (
      marks: {for (final e in (json['marks'] as Map? ?? const {}).entries) e.key as String: (e.value as num).toInt()},
      maxMarks: (json['maxMarks'] as num?)?.toInt() ?? SchoolConfig.defaultMaxMarks,
      grades: [for (final g in (json['grades'] as List? ?? const []) ) '$g'],
      gradeMarks: {for (final e in (json['gradeMarks'] as Map? ?? const {}).entries) e.key as String: '${e.value}'},
    );
  }

  @override
  Future<void> saveMarks({
    required String classId,
    required String subject,
    required Map<String, int> values,
    Map<String, String> grades = const {},
  }) => _remote.post('/classes/$classId/marks', {
    'subject': subject,
    'values': values,
    if (grades.isNotEmpty) 'grades': grades,
  });
}
