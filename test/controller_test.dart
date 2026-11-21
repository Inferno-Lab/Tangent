@Tags(['school'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/view_state.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/features/auth/controllers/login_controller.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/homework/controllers/homework_controller.dart';
import 'package:tangent/features/teacher_tools/controllers/teacher_controller.dart';

import 'support/harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await bootLive();
  });

  tearDown(Get.reset);

  testWidgets('the login controller keeps a wrong password out and says why', (tester) async {
    await tester.pumpWidget(
      testApp(
        pages: [
          GetPage<void>(name: AppRoutes.login, page: () => const SizedBox.shrink()),
          GetPage<void>(name: AppRoutes.shell, page: () => const Scaffold(body: Text('shell'))),
        ],
      ),
    );
    final login = await put(tester, () => LoginController());
    login.email.text = person('classTeacher')['email'] as String;
    login.password.text = 'not-the-password';
    await real(tester, login.submit);
    expect(Get.find<AuthService>().user.value, isNull);
    expect(login.useOtp.value, isFalse);
  });

  testWidgets('the dashboard loads the child and what the family owes', (tester) async {
    await tester.pumpWidget(testApp(home: const SizedBox.shrink()));
    await real(tester, () => signIn(UserRole.parent));
    final home = await put(tester, () => DashboardController());
    await real(tester, home.load);
    expect(home.state.value, ViewState.success);
    final names = [for (final c in person('parentOfTwo')['children'] as List) (c as Map)['name']];
    expect(names, contains(home.snapshot?.student.name));
  });

  testWidgets('a family hands in homework the class teacher set', (tester) async {
    await tester.pumpWidget(testApp(home: const SizedBox.shrink()));
    await real(tester, () => signIn(UserRole.parent));
    final cls = classId;
    final child = childId;
    // The class teacher sets it in the app, for the class the child is in.
    final teacher = await real(tester, () => signIn(UserRole.teacher));
    final subject = (await real(tester, () => Get.find<DirectoryRepository>().teacher(teacher!.id)))!.subject;
    final title = 'Read chapter ${DateTime.now().millisecondsSinceEpoch % 100000}';
    await real(
      tester,
      () => Get.find<HomeworkRepository>().assign(Homework(
        id: '', classId: cls, subject: subject, title: title, description: '', assignedOn: DateTime.now(),
        dueOn: DateTime.now().add(const Duration(days: 3)), teacherId: teacher!.id, maxMarks: 10, attachments: const [], submissions: const [],
      )),
    );
    await real(tester, () => signIn(UserRole.parent));
    final homework = await put(tester, () => HomeworkController());
    await real(tester, homework.load);
    final set = homework.items.firstWhere((h) => h.title == title);
    await real(tester, () => Get.find<HomeworkRepository>().submit(homeworkId: set.id, studentId: child, fileName: 'Homework_scan.jpg'));
    await real(tester, homework.load);
    expect(homework.items.firstWhere((item) => item.id == set.id).forStudent(child)?.status, HomeworkStatus.submitted);
  });

  testWidgets('a teacher takes the roll and enters marks for the open exam', (tester) async {
    await tester.pumpWidget(testApp(home: const SizedBox.shrink()));
    final me = await real(tester, () => signIn(UserRole.teacher));
    final classes = (await real(tester, () => Get.find<DirectoryRepository>().classesForTeacher(me!.id)))!;
    final cls = classes.firstWhere((c) => c.name == person('classTeacher')['class']).id;
    final attendance = await put(tester, () => MarkAttendanceController(classId: cls));
    await real(tester, attendance.load);
    expect(attendance.students, isNotEmpty);
    final studentId = attendance.students.first.id;
    attendance
      ..cycle(studentId)
      ..allPresent();
    // Only exceptions are kept; "all present" clears them.
    expect(attendance.marks[studentId], isNull);
    expect(attendance.present, attendance.students.length);
    await real(tester, attendance.submit);

    // The office has put the term's next exam in, with the teacher's subject.
    final subject = (await real(tester, () => Get.find<DirectoryRepository>().teacher(me!.id)))!.subject;
    final subjects = List<Map<String, dynamic>>.from((await real(tester, () => admin('GET', '/v1/subjects'))) as List);
    final subjectId = subjects.firstWhere((s) => (s['id'] as String).replaceFirst('sub_', '') == subject)['id'];
    final day = DateTime.now().add(const Duration(days: 12)).toIso8601String().substring(0, 10);
    await real(tester, () => admin('POST', '/v1/exams', {'name': 'Mid-term exams', 'classId': cls, 'startsOn': day, 'endsOn': day, 'subjects': [{'subjectId': subjectId, 'maxMarks': 100}]}));
    final marks = await put(tester, () => MarksEntryController(classId: cls));
    await real(tester, marks.load);
    expect(marks.subject.value, subject);
    marks.values[studentId] = 91;
    await real<void>(tester, marks.save);
    final draft = await real(tester, () => Get.find<ExamRepository>().marksDraft(cls, subject));
    expect(draft?.marks[studentId], 91);
  });
}
