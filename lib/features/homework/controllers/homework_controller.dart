import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/services/session_bus.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:image_picker/image_picker.dart';

class HomeworkController extends GetxController with Loadable {
  final tab = 0.obs;
  final selectedId = RxnString();
  List<Homework> items = [];
  String? studentId;
  Student? student;
  Map<String, String> teachers = {};

  int count(HomeworkStatus status) => items.where((item) {
    final mine = studentId == null ? null : item.forStudent(studentId!);
    return (mine?.status ?? HomeworkStatus.pending).shown == status;
  }).length;

  List<Homework> get visible {
    final status = switch (tab.value) {
      1 => HomeworkStatus.submitted,
      2 => HomeworkStatus.graded,
      _ => HomeworkStatus.pending,
    };
    return items.where((item) {
      final mine = studentId == null ? null : item.forStudent(studentId!);
      final current = (mine?.status ?? HomeworkStatus.pending).shown;
      return current == status;
    }).toList();
  }

  String? get pick => selectedId.value;

  set pick(String? id) => selectedId.value = id;

  Homework? get selected {
    final id = selectedId.value;
    if (id != null) {
      for (final item in items) {
        if (item.id == id) return item;
      }
    }
    return visible.firstOrNull;
  }

  @override
  Future<void> load() async {
    studentId = Get.find<AuthService>().activeStudentId.value;
    if (studentId == null) {
      await run(() async {}, isEmpty: () => true);
      return;
    }
    await run(() async {
      student = await Get.find<DirectoryRepository>().student(studentId!);
      items = await Get.find<HomeworkRepository>().forClass(student!.classId);
      teachers = {for (final t in await Get.find<DirectoryRepository>().teachers()) t.id: t.name};
    }, isEmpty: () => false);
  }

  /// Upload a file from the gallery.
  Future<void> upload(Homework homework) async {
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery);
      if (file == null) return;
      await send(homework, file.name, paths: [file.path]);
    } on Exception {
      ToastHelper.show('errors.generic', kind: ToastKind.error);
    }
  }

  /// The scanned pages, each a photo of the work (the school keeps up to five a hand-in).
  Future<bool> sendScan(Homework homework, List<String> pages) =>
      send(homework, 'homework.scan_file'.trn(pages.length), paths: pages);

  /// A written answer, typed in the app.
  Future<bool> sendAnswer(Homework homework, String answer) => send(homework, '', answer: answer.trim());

  Future<bool> send(Homework homework, String fileName, {List<String> paths = const [], String answer = ''}) async {
    if (!SchoolConfig.allows('homework.onlineSubmission')) return false;
    final id = studentId ?? Get.find<AuthService>().activeStudentId.value;
    if (id == null) return false;
    try {
      await Get.find<HomeworkRepository>().submit(
        homeworkId: homework.id,
        studentId: id,
        fileName: fileName,
        filePaths: paths,
        answer: answer,
      );
      ToastHelper.show('homework.sent', kind: ToastKind.success);
      Get.find<SessionBus>().bump();
      return true;
    } on AppException catch (error) {
      ToastHelper.show(error.message, kind: ToastKind.error);
      return false;
    }
  }
}

class HomeworkDetailController extends GetxController with Loadable {
  Homework? item;
  String? teacher;
  String? studentId;

  HomeworkSubmission? get mine => studentId == null ? null : item?.forStudent(studentId!);

  @override
  Future<void> load() async {
    final id = Get.parameters['id'];
    if (id == null) {
      await run(() async {}, isEmpty: () => true);
      return;
    }
    await run(() async {
      studentId = Get.find<AuthService>().activeStudentId.value;
      item = await Get.find<HomeworkRepository>().byId(id);
      if (item != null) teacher = (await Get.find<DirectoryRepository>().teacherOrNull(item!.teacherId))?.name;
    }, isEmpty: () => item == null);
  }
}
