import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/student.dart';

class DirectoryRepository {
  DirectoryRepository(this._remote);

  final RemoteDataSource _remote;

  Future<Student> student(String id) async =>
      Student.fromJson(Map<String, dynamic>.from(await _remote.get('/students/$id') as Map));

  Future<List<Student>> studentsIn(String classId) async => _students(
    await _remote.get('/classes/$classId/students'),
  );

  Future<SchoolClass> schoolClass(String id) async => SchoolClass.fromJson(
    Map<String, dynamic>.from(await _remote.get('/classes/$id') as Map),
  );

  Future<List<SchoolClass>> classesForTeacher(String teacherId) async {
    final json = await _remote.get('/teachers/$teacherId/classes');
    return [
      for (final item in json as List)
        SchoolClass.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<Teacher> teacher(String id) async =>
      Teacher.fromJson(Map<String, dynamic>.from(await _remote.get('/teachers/$id') as Map));

  Future<Teacher?> teacherOrNull(String id) async => teacher(id);

  /// Display name for any account (parent, student or teacher), or null.
  Future<String?> userName(String userId) async {
    final json = await _remote.get('/users/$userId');
    return (json as Map)['name'] as String?;
  }

  Future<List<Teacher>> teachers() async {
    final json = await _remote.get('/teachers');
    return [
      for (final item in json as List)
        Teacher.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<SchoolInfo> school() async => SchoolInfo.fromJson(
    Map<String, dynamic>.from(await _remote.get('/school') as Map),
  );

  Future<List<Student>> _students(dynamic json) async => [
    for (final item in json as List)
      Student.fromJson(Map<String, dynamic>.from(item as Map)),
  ];
}
