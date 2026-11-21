import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/student.dart';

abstract class DirectoryRepository {
  Future<Student> student(String id);

  Future<List<Student>> studentsIn(String classId);

  Future<SchoolClass> schoolClass(String id);

  Future<List<SchoolClass>> classesForTeacher(String teacherId);

  Future<Teacher> teacher(String id);

  Future<Teacher?> teacherOrNull(String id);

  /// Display name for any account (parent, student or teacher), or null.
  Future<String?> userName(String userId);

  Future<List<Teacher>> teachers();

  Future<SchoolInfo> school();
}

class RemoteDirectoryRepository implements DirectoryRepository {
  RemoteDirectoryRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<Student> student(String id) async =>
      Student.fromJson(Map<String, dynamic>.from(await _remote.get('/students/$id') as Map));

  @override
  Future<List<Student>> studentsIn(String classId) async => _students(
    await _remote.get('/classes/$classId/students'),
  );

  @override
  Future<SchoolClass> schoolClass(String id) async => SchoolClass.fromJson(
    Map<String, dynamic>.from(await _remote.get('/classes/$id') as Map),
  );

  @override
  Future<List<SchoolClass>> classesForTeacher(String teacherId) async {
    final json = await _remote.get('/teachers/$teacherId/classes');
    return [
      for (final item in json as List)
        SchoolClass.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<Teacher> teacher(String id) async =>
      Teacher.fromJson(Map<String, dynamic>.from(await _remote.get('/teachers/$id') as Map));

  @override
  Future<Teacher?> teacherOrNull(String id) async => teacher(id);

  @override
  Future<String?> userName(String userId) async {
    final json = await _remote.get('/users/$userId');
    return (json as Map)['name'] as String?;
  }

  @override
  Future<List<Teacher>> teachers() async {
    final json = await _remote.get('/teachers');
    return [
      for (final item in json as List)
        Teacher.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  @override
  Future<SchoolInfo> school() async => SchoolInfo.fromJson(
    Map<String, dynamic>.from(await _remote.get('/school') as Map),
  );

  Future<List<Student>> _students(dynamic json) async => [
    for (final item in json as List)
      Student.fromJson(Map<String, dynamic>.from(item as Map)),
  ];
}
