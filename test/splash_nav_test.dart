import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/app.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/features/auth/controllers/splash_controller.dart';
import 'package:tangent/features/auth/views/onboarding_view.dart';

import 'support/harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> splash(WidgetTester tester) async {
    await tester.pumpWidget(const TangentApp());
    await tester.pump();
    // Plain chalk until the window size settles, then the mark.
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Tangent'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2400));
    await tester.pump(const Duration(milliseconds: 800));
  }

  testWidgets('the first run goes from the splash to the three steps', (tester) async {
    await bootMock();
    Get.testMode = false;
    await real(tester, () => Get.find<StorageService>().write(StorageKeys.onboardingSeen, false));
    await splash(tester);
    expect(Get.currentRoute, AppRoutes.onboarding);
    expect(find.text('Know where to be before the bell.'), findsOneWidget);
  });

  testWidgets('once the steps are seen, the splash goes to sign-in', (tester) async {
    await bootMock();
    Get.testMode = false;
    await real(tester, () => Get.find<StorageService>().write(StorageKeys.onboardingSeen, true));
    await splash(tester);
    expect(Get.currentRoute, AppRoutes.login);
  });

  Widget steps() {
    Get.put(OnboardingController());
    return testApp(
    pages: [
      GetPage(name: AppRoutes.onboarding, page: () => const OnboardingView()),
      GetPage(name: AppRoutes.login, page: () => const Scaffold(body: Text('Login ready'))),
    ],
    );
  }

  testWidgets('Next walks the steps, Back returns, Skip reaches sign-in', (tester) async {
    await bootMock();
    Get.testMode = false;
    await tester.pumpWidget(steps());
    await tester.pump();
    expect(find.text('Know where to be before the bell.'), findsOneWidget);
    await tester.tap(find.text('Next'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Every child, at one glance.'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Back'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Know where to be before the bell.'), findsOneWidget);
    await tester.tap(find.text('Skip'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(Get.currentRoute, AppRoutes.login);
    expect(find.text('Login ready'), findsOneWidget);
    expect(Get.find<StorageService>().read<bool>(StorageKeys.onboardingSeen), isTrue);
  });

  testWidgets('the last step says Get started and has no Skip', (tester) async {
    await bootMock();
    Get.testMode = false;
    await tester.pumpWidget(steps());
    await tester.pump();
    for (var i = 0; i < 2; i++) {
      await tester.tap(find.text('Next'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
    }
    expect(find.text('Attendance in six taps.'), findsOneWidget);
    expect(find.text('Get started'), findsOneWidget);
    await tester.tap(find.text('Get started'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(Get.currentRoute, AppRoutes.login);
  });

  testWidgets('the steps fit a small phone', (tester) async {
    await bootMock();
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(steps());
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    expect(tester.takeException(), isNull);
    expect(find.text('Know where to be before the bell.'), findsOneWidget);
    expect(find.text('Skip'), findsOneWidget);
    expect(find.text('Next'), findsOneWidget);
  });
}
