import 'dart:async';

import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';
import 'package:image_picker/image_picker.dart';

class ProfileController extends GetxController with Loadable {
  Student? student;
  SchoolClass? schoolClass;
  Teacher? teacher;
  List<SchoolClass> teaching = [];

  /// The family's pick-up code for today (the back of the ID card), where the school keeps visitors.
  String? pickupCode;
  List<PickupPerson> pickups = [];

  @override
  Future<void> load() async {
    final auth = Get.find<AuthService>();
    final id = auth.activeStudentId.value;
    final teacherId = auth.user.value?.teacherId;
    await run(() async {
      final directory = Get.find<DirectoryRepository>();
      // Read the next person before letting go of the one shown: clearing first emptied the card for a moment on a child
      // switch, and the account rows jumped up into its place.
      Student? nextStudent;
      SchoolClass? nextClass;
      Teacher? nextTeacher;
      var nextTeaching = <SchoolClass>[];
      String? code;
      var people = <PickupPerson>[];
      if (id != null) {
        nextStudent = await directory.student(id);
        nextClass = await directory.schoolClass(nextStudent.classId);
        if (SchoolConfig.has('visitors') && auth.role == UserRole.parent) {
          try {
            final view = await Get.find<SchoolLifeRepository>().gatePasses();
            code = view.code;
            people = view.people.where((p) => p.studentId == id).toList();
          } on Object {
            // shortcut: the card falls back to the ID number; the gate pass page shows the error.
          }
        }
      } else if (teacherId != null) {
        nextTeacher = await directory.teacher(teacherId);
        nextTeaching = await directory.classesForTeacher(teacherId);
      }
      student = nextStudent;
      schoolClass = nextClass;
      teacher = nextTeacher;
      teaching = nextTeaching;
      pickupCode = code;
      pickups = people;
    }, isEmpty: () => false);
  }

  Future<void> editPhoto() async {
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
      if (file == null) return;
      await Get.find<AuthService>().updateAvatar(file.path);
      ToastHelper.show('profile.photo', kind: ToastKind.success);
    } on Exception {
      ToastHelper.show('profile.photo_failed', kind: ToastKind.error);
    }
  }
}
