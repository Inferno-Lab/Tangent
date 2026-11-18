import 'package:get/get.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/repositories/directory_repository.dart';

/// A class the teacher teaches, every student in it by roll number; a name or number search narrows it.
class RosterController extends GetxController with Loadable {
  List<Student> students = [];
  final query = ''.obs;

  String get classId => Get.parameters['classId'] ?? '';

  List<Student> get shown {
    final q = query.value.trim().toLowerCase();
    if (q.isEmpty) return students;
    return students.where((s) => s.name.toLowerCase().contains(q) || s.rollNo.toLowerCase() == q || s.admissionNo.toLowerCase().contains(q)).toList();
  }

  @override
  Future<void> load() => run(() async {
    students = [...await Get.find<DirectoryRepository>().studentsIn(classId)]
      ..sort((a, b) => (int.tryParse(a.rollNo) ?? 1 << 20).compareTo(int.tryParse(b.rollNo) ?? 1 << 20));
  }, isEmpty: () => students.isEmpty);

  /// One student's record as the school keeps it (what this teacher may see).
  Future<Student> profile(String id) => Get.find<DirectoryRepository>().student(id);
}
