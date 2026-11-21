@Tags(['school'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_pages.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/features/shell/shell_controller.dart';

import 'support/harness.dart';

/// Every route a role can reach, opened in turn on phone, small phone and tablet sizes, on the school's real records (a
/// homework, a notice, an event and a conversation of the family's own). Any exception, overflow or bad Obx fails the test.
const _family = [
  AppRoutes.attendance,
  AppRoutes.homework,
  AppRoutes.timetable,
  AppRoutes.results,
  AppRoutes.fees,
  AppRoutes.notices,
  AppRoutes.events,
  AppRoutes.library,
  AppRoutes.transport,
  AppRoutes.gallery,
  AppRoutes.leave,
  AppRoutes.leaveApply,
  AppRoutes.notifications,
  AppRoutes.search,
  AppRoutes.settings,
  AppRoutes.about,
  AppRoutes.help,
  AppRoutes.designSystem,
];

const _teacher = [
  AppRoutes.teacherAssign,
  AppRoutes.teacherGrade,
  AppRoutes.teacherNotice,
  AppRoutes.notifications,
  AppRoutes.search,
];

const _sizes = {'phone': Size(390, 844), 'small': Size(320, 640), 'tablet': Size(1024, 1366)};

/// Lets the screen's calls to the school come back (real time) and draws its frames (the test's time).
Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
    await tester.pump(const Duration(milliseconds: 120));
  }
}

/// The detail screens of the person's own records, as the app opens them.
Future<List<String>> _details(UserRole role) async {
  if (role == UserRole.teacher) {
    final me = Get.find<AuthService>().user.value!;
    final classes = await Get.find<DirectoryRepository>().classesForTeacher(me.id);
    return [for (final c in classes.take(1)) ...['/teacher/attendance/${c.id}', '/teacher/marks/${c.id}']];
  }
  final homework = await Get.find<HomeworkRepository>().forClass(classId);
  final notices = await Get.find<NoticeRepository>().all();
  final events = await Get.find<EventRepository>().all();
  // Chat may be paused for every school (the console's kill.chat): then there is no conversation to open.
  final threads = <String>[];
  try {
    threads.addAll((await Get.find<ChatRepository>().inbox(Get.find<AuthService>().user.value!.id)).threads.map((t) => t.id));
  } on AppException {
    // Paused: the chat screens say so themselves.
  }
  return [
    for (final h in homework.take(1)) '/homework/${h.id}',
    for (final n in notices.take(1)) '/notices/${n.id}',
    for (final e in events.take(1)) '/events/${e.id}',
    for (final t in threads.take(1)) '/chat/$t',
  ];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(loadAppFonts);

  for (final role in [UserRole.parent, UserRole.teacher]) {
    for (final size in _sizes.entries) {
      testWidgets('${role.name} screens render on ${size.key}', (tester) async {
        await bootLive();
        Get.testMode = false;
        tester.view.physicalSize = size.value * 3;
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await real(tester, () => signIn(role));
        final details = (await real(tester, () => _details(role)))!;

        await tester.pumpWidget(
          GetMaterialApp(
            translations: AppTranslations(),
            locale: const Locale('en'),
            fallbackLocale: const Locale('en'),
            theme: AppTheme.build(AppColors.light),
            initialRoute: AppRoutes.shell,
            getPages: AppPages.pages,
            builder: (context, child) => ToastHost(child: child ?? const SizedBox.shrink()),
          ),
        );
        final errors = <String>[];
        final original = FlutterError.onError;
        FlutterError.onError = (d) {
          errors.add(d.toString());
          original?.call(d);
        };
        addTearDown(() => FlutterError.onError = original);
        void check(String where) {
          final e = tester.takeException();
          if (e != null) throw TestFailure('$where: ${errors.isEmpty ? e : errors.join(' | ')}');
        }

        await _settle(tester);
        check('shell');

        for (var tab = 0; tab < 5; tab++) {
          Get.find<ShellController>().go(tab);
          await _settle(tester);
          check('tab $tab');
        }

        for (final route in [...(role == UserRole.teacher ? _teacher : _family), ...details]) {
          Get.toNamed<void>(route)?.ignore();
          await _settle(tester);
          check(route);
          Get.back<void>();
          await _settle(tester);
        }

        if (role != UserRole.teacher) {
          final receipt = Receipt(
            id: 'rcpt_1',
            installmentId: 'inst_1',
            title: 'Term 1 tuition',
            amount: 28500,
            paidOn: DateTime(2026, 8, 18, 10, 2),
            method: 'upi',
            reference: 'UPI28461937',
          );
          Get.toNamed<void>(AppRoutes.receipt, arguments: {'receipt': receipt, 'student': ((person('parentOfTwo')['children'] as List).first as Map)['name']})?.ignore();
          await _settle(tester);
          check('receipt');
        }
        // A call still waiting for the school runs out here, not after the test.
        await tester.pump(const Duration(seconds: 30));
      });
    }
  }
}
