@Tags(['school'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/auth/controllers/login_controller.dart';
import 'package:tangent/features/auth/views/login_view.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart';
import 'package:tangent/features/fees/controllers/fees_controller.dart';
import 'package:tangent/features/fees/views/fees_view.dart';
import 'package:tangent/features/settings/views/settings_view.dart';

import 'support/harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await bootLive();
    Get.testMode = false;
  });

  tearDown(Get.reset);

  testWidgets('sign-in asks for the email or phone and the password, with no shortcut in', (tester) async {
    Get.put(LoginController());
    await tester.pumpWidget(testApp(home: const LoginView()));
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.text('Sign in'), findsWidgets);
    expect(find.text('Parent'), findsNothing);
    expect(Get.find<AuthService>().user.value, isNull);
  });

  testWidgets('home shows the signed-in student', (tester) async {
    final user = (await real(tester, () => signIn(UserRole.parent)))!;
    await real(
      tester,
      () => Get.find<AuthService>().setSession(user.copyWith(avatarUrl: '')),
    );
    final home = await put(tester, DashboardController.new);
    await real(tester, home.load);
    await tester.pumpWidget(testApp(home: const Scaffold(body: DashboardView())));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.textContaining(home.snapshot!.student.name.split(' ').first), findsWidgets);
    await settle(tester);
  });

  testWidgets('fees screen lists an installment', (tester) async {
    await real(tester, () => signIn(UserRole.parent));
    final fees = await put(tester, FeesController.new);
    await real(tester, fees.load);
    await tester.pumpWidget(testApp(home: const FeesView()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Fees'), findsOneWidget);
    // The quarters the fee register brought, as the school names them.
    expect(find.textContaining('Tuition'), findsWidgets);
    await settle(tester);
  });

  testWidgets('settings theme chip switches to AMOLED', (tester) async {
    await tester.pumpWidget(testApp(home: const SettingsView()));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Blackboard'), findsNothing);
    await tester.tap(find.text('AMOLED'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(Get.find<ThemeService>().mode.value, AppThemeMode.amoled);
  });
}
