// Renders screens to PNG for visual review. Not part of the normal suite:
//   flutter test test/tool/shoot_test.dart --dart-define=SHOOT_DIR=out --dart-define=SHOOT_ROLE=teacher
// Glass uses its blur fallback here (no GPU shader in tests).
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/routes/app_pages.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/mock_json_datasource.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/auth/views/welcome_overlay.dart';
import 'package:tangent/features/dashboard/widgets/child_switcher.dart';
import 'package:tangent/features/shell/shell_controller.dart';

import '../support/harness.dart';

const _enabled = String.fromEnvironment('SHOOT_DIR') != '';
const _dir = String.fromEnvironment('SHOOT_DIR', defaultValue: 'build/shots');
const _roleName = String.fromEnvironment('SHOOT_ROLE', defaultValue: 'parent');
const _empty = bool.fromEnvironment('EMPTY_DATA');
const _dark = bool.fromEnvironment('SHOOT_DARK');
const _width = int.fromEnvironment('SHOOT_W', defaultValue: 390);
const _height = int.fromEnvironment('SHOOT_H', defaultValue: 844);

const _family = [
  AppRoutes.attendance,
  AppRoutes.homework,
  '/homework/hw_linear',
  AppRoutes.timetable,
  AppRoutes.results,
  AppRoutes.notices,
  '/notices/nt_mid',
  AppRoutes.events,
  '/events/ev_science',
  '/chat/th_kavita_priya',
  AppRoutes.library,
  AppRoutes.transport,
  AppRoutes.gallery,
  AppRoutes.leave,
  AppRoutes.leaveApply,
  AppRoutes.diary,
  AppRoutes.meetings,
  AppRoutes.gatePass,
  AppRoutes.certificates,
  AppRoutes.notifications,
  AppRoutes.search,
  AppRoutes.settings,
  AppRoutes.about,
  AppRoutes.help,
  AppRoutes.designSystem,
];

const _teacher = [
  '/teacher/attendance/cls_8a',
  AppRoutes.teacherAssign,
  AppRoutes.teacherGrade,
  '/teacher/marks/cls_8a',
  AppRoutes.teacherNotice,
  AppRoutes.staffMe,
  AppRoutes.teacherDiary,
  AppRoutes.teacherMeetings,
  AppRoutes.inviteVisitor,
  AppRoutes.notifications,
  AppRoutes.search,
  AppRoutes.events,
  AppRoutes.gallery,
  AppRoutes.settings,
];

final _key = GlobalKey();

Future<void> _save(WidgetTester tester, String name) async {
  await tester.runAsync(() async {
    final boundary = _key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    final image = await boundary.toImage(pixelRatio: 1.5);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('$_dir/$name.png')..createSync(recursive: true);
    file.writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

/// Opens a popup the way a person does (a tap on its button), shoots it, then, when it holds a field, shoots it again with
/// the field focused and a 300 pt keyboard up; then closes it back to [home]. A button it cannot find is printed, never
/// passed over in silence.
Future<void> _popup(WidgetTester tester, String name, Finder open, {required String home, bool type = true}) async {
  if (open.evaluate().isEmpty) {
    // ignore: avoid_print
    print('POPUP MISSING $name: nothing to tap');
    return;
  }
  await tester.ensureVisible(open.first);
  await tester.pump();
  await tester.tap(open.first, warnIfMissed: false);
  await _settle(tester);
  await _save(tester, name);
  final fields = find.byType(EditableText);
  if (type && fields.evaluate().isNotEmpty) {
    await tester.showKeyboard(fields.last);
    await tester.pump();
    tester.view.viewInsets = FakeViewPadding(bottom: 300 * tester.view.devicePixelRatio);
    await _settle(tester);
    await _save(tester, '${name}_keyboard');
    tester.view.resetViewInsets();
    FocusManager.instance.primaryFocus?.unfocus();
    await _settle(tester);
  }
  Get.until((r) => r.settings.name == home || r.isFirst);
  await _settle(tester);
}

/// Every sheet, dialog, picker and confirmation a role can open, from the page that opens it.
Future<void> _popups(WidgetTester tester, UserRole role) async {
  Future<void> on(String route, List<(String, Finder, bool)> steps) async {
    if (route != AppRoutes.shell) {
      Get.toNamed<void>(route)?.ignore();
      await _settle(tester);
    }
    for (final (name, open, type) in steps) {
      await _popup(tester, '${_roleName}_p_$name', open, home: route, type: type);
    }
    if (route != AppRoutes.shell) {
      Get.until((r) => r.settings.name == AppRoutes.shell);
      await _settle(tester);
    }
  }

  Finder text(String key) => find.text(key.tr);
  Finder label(String key) => find.bySemanticsLabel(RegExp(RegExp.escape(key.tr.split('@').first)));
  final shell = Get.find<ShellController>();
  // Toasts: a short one, a long one, an error after a success (the error waits its turn).
  ToastHelper.show('fees.payment_done', kind: ToastKind.success);
  await _settle(tester);
  await _save(tester, '${_roleName}_p_toast');
  ToastHelper.show('errors.network', kind: ToastKind.error, body: 'errors.generic');
  await _settle(tester);
  await _save(tester, '${_roleName}_p_toast_error');
  ToastHelper.clear();
  await _settle(tester);
  if (role == UserRole.teacher) {
    shell.go(0);
    await _settle(tester);
    await on(AppRoutes.shell, [('leave_requests', text('teacher.leave_one'), false)]);
    // "More" ends the row of quick pills, which scrolls sideways: bring it in first.
    if (text('teacher.qa_attendance').evaluate().isNotEmpty) await tester.drag(text('teacher.qa_attendance').first, const Offset(-900, 0));
    await _settle(tester);
    await on(AppRoutes.shell, [('around_school', text('teacher.more_school'), false)]);
    await on(AppRoutes.staffMe, [('staff_leave', text('staff.ask_for_leave'), true)]);
    await on(AppRoutes.teacherDiary, [('diary_write', text('diary.write'), true)]);
    await on(AppRoutes.inviteVisitor, [('invite', text('visitors.invite'), true)]);
    await on(AppRoutes.teacherNotice, [('notice_keyboard', find.byType(EditableText), true)]);
    await on(AppRoutes.teacherAssign, [('assign_keyboard', find.byType(EditableText), true)]);
    await on(AppRoutes.teacherGrade, [('grade_keyboard', find.byType(EditableText), true)]);
    shell.go(shell.tabs.indexOf('profile'));
    await _settle(tester);
    await on(AppRoutes.shell, [
      ('password', text('auth.change_password'), true),
      ('contact', text('account.phone_email'), true),
      ('devices', text('account.devices'), false),
      ('privacy', text('privacy.title'), false),
      ('sign_out', text('common.logout'), false),
    ]);
  } else {
    shell.go(0);
    await _settle(tester);
    await on(AppRoutes.shell, [('child_switcher', find.byType(ChildCapsule), false), ('around_school', text('quick.around_school'), false)]);
    await on(AppRoutes.gatePass, [('gate_pass', text('gate.leave_early'), true), ('pickup_person', text('gate.add_person'), true)]);
    await on(AppRoutes.certificates, [('certificate', text('certificates.ask'), true)]);
    await on(AppRoutes.leaveApply, [('leave_note', find.byType(EditableText), true)]);
    await on(AppRoutes.events, [('month', label('events.month'), false)]);
    await on(AppRoutes.fees, [('pay', find.textContaining(RegExp('^Pay ')), false)]);
    await on(AppRoutes.attendance, [('explain', text('attendance.explain'), true)]);
    shell.go(shell.tabs.indexOf('profile'));
    await _settle(tester);
    await on(AppRoutes.shell, [
      ('contact', text('account.phone_email'), true),
      ('devices', text('account.devices'), false),
      ('privacy', text('privacy.title'), false),
      ('sign_out', text('common.logout'), false),
    ]);
  }
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 14; i++) {
    await tester.pump(const Duration(milliseconds: 120));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(loadAppFonts);

  testWidgets('shoot $_roleName', skip: !_enabled, (tester) async {
    final guest = _roleName == 'guest';
    final role = guest ? UserRole.parent : UserRole.values.byName(_roleName);
    await bootMock();
    AppConfig.emptyData.value = _empty;
    Get.testMode = false;
    tester.view.physicalSize = Size(_width * 1.5, _height * 1.5);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() => Get.find<MockJsonDataSource>().ensureLoaded());
    if (!guest) await real(tester, () => signIn(role));
    // Home itself, not the one-time welcome over it.
    if (!guest) await real(tester, markWelcomeSeen);

    await tester.pumpWidget(
      RepaintBoundary(
        key: _key,
        child: GetMaterialApp(
          debugShowCheckedModeBanner: false,
          translations: AppTranslations(),
          locale: const Locale('en'),
          fallbackLocale: const Locale('en'),
          theme: AppTheme.resolve(mode: _dark ? AppThemeMode.amoled : AppThemeMode.light, platformBrightness: Brightness.light),
          initialRoute: guest ? AppRoutes.login : AppRoutes.shell,
          getPages: AppPages.pages,
          builder: (context, child) => ToastHost(child: child ?? const SizedBox.shrink()),
        ),
      ),
    );
    await _settle(tester);
    await _save(tester, '${_roleName}_tab0');
    if (guest) {
      // The first-run steps, one by one (each plays its drawing as it arrives).
      Get.offAllNamed<void>(AppRoutes.onboarding)?.ignore();
      await _settle(tester);
      for (var p = 0; p < 3; p++) {
        if (p > 0) {
          await tester.drag(find.byType(PageView), const Offset(-_width * 1.0, 0));
          await _settle(tester);
        }
        await tester.pump(const Duration(seconds: 3));
        await _save(tester, 'guest_onboard$p');
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(seconds: 10));
      return;
    }
    for (var tab = 1; tab < 5; tab++) {
      Get.find<ShellController>().go(tab);
      await _settle(tester);
      await _save(tester, '${_roleName}_tab$tab');
    }
    var i = 0;
    for (final route in role == UserRole.teacher ? _teacher : _family) {
      Get.toNamed<void>(route)?.ignore();
      await _settle(tester);
      await _save(tester, '${_roleName}_r${(i++).toString().padLeft(2, '0')}_${route.replaceAll(RegExp('[^a-z0-9]+'), '_')}');
      Get.back<void>();
      await _settle(tester);
    }
    if (const bool.fromEnvironment('SHOOT_POPUPS')) await _popups(tester, role);
    // Let screens' delayed work (toasts, autosave) finish, so the run ends without pending timers.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 10));
  });
}
