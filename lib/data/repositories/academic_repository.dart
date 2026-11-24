import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/status.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/academics.dart';

class AttendanceRepository {
  AttendanceRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<AttendanceDay>> forStudent(String studentId) async {
    final json = await _remote.get('/students/$studentId/attendance');
    return [
      for (final item in json as List)
        AttendanceDay.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<AttendanceSummary> summary(String studentId, {DateTime? month}) async {
    final days = await forStudent(studentId);
    return AttendanceSummary.from(days);
  }

  Future<Map<String, AttendanceStatus>> todayForClass(
    List<String> studentIds,
  ) async {
    final json = await _remote.get('/attendance/today', query: {'students': studentIds.join(',')});
    return {
      for (final e in (json as Map).entries)
        e.key as String: attendanceStatusOf(e.value),
    };
  }

  /// A class's register for one day as the school keeps it: each student's mark by the school's own key (null: not marked
  /// yet), with leave the school approved already filled in.
  Future<Map<String, String?>> rollCall(String classId, String date) async {
    final json = Map<String, dynamic>.from(await _remote.get('/attendance/roll', query: {'classId': classId, 'date': date}) as Map);
    return {for (final m in (json['marks'] as List? ?? const [])) '${(m as Map)['studentId']}': m['status'] as String?};
  }

  /// Marks a class's register for [date], every student by the school's mark key. True when it waits on the phone to be
  /// sent (no signal); it is still that day's register when it goes.
  Future<bool> markDay(String date, Map<String, String> byStudent) async {
    final r = await _remote.post('/attendance', byStudent, query: {'date': date});
    return r is Map && r['queued'] == true;
  }
}

class TimetableRepository {
  TimetableRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<TimetableDay>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/timetable');
    return [
      for (final item in json as List)
        TimetableDay.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }
}

class HomeworkRepository {
  HomeworkRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<Homework>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/homework');
    return [
      for (final item in json as List)
        Homework.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<Homework?> byId(String id) async {
    final json = await _remote.get('/homework/$id');
    return Homework.fromJson(Map<String, dynamic>.from(json as Map));
  }

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

  Future<void> assign(Homework homework) =>
      _remote.post('/homework', homework.toJson());
}

class ExamRepository {
  ExamRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<Exam>> forClass(String classId) async {
    final json = await _remote.get('/classes/$classId/exams');
    return [
      for (final item in json as List)
        Exam.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<ExamResult?> result({
    required String examId,
    required String studentId,
  }) async {
    final json = await _remote.get('/results/$examId/$studentId');
    return ExamResult.fromJson(Map<String, dynamic>.from(json as Map));
  }

  Future<List<ExamResult>> resultsFor(String studentId) async {
    final json = await _remote.get('/students/$studentId/results');
    return [
      for (final item in json as List)
        ExamResult.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  /// The marks entered so far and what the subject is marked out of; a subject graded without marks also has its grades
  /// to pick from and the grades given so far.
  Future<({Map<String, int> marks, int maxMarks, List<String> grades, Map<String, String> gradeMarks})> marksDraft(String classId, String subject) async {
    final json = Map<String, dynamic>.from(await _remote.get('/classes/$classId/marks', query: {'subject': subject}) as Map);
    return (
      marks: {for (final e in (json['marks'] as Map? ?? const {}).entries) e.key as String: (e.value as num).toInt()},
      maxMarks: (json['maxMarks'] as num?)?.toInt() ?? SchoolConfig.defaultMaxMarks,
      grades: [for (final g in (json['grades'] as List? ?? const []) ) '$g'],
      gradeMarks: {for (final e in (json['gradeMarks'] as Map? ?? const {}).entries) e.key as String: '${e.value}'},
    );
  }

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
