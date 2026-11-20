import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart';
import 'package:tangent/features/dashboard/widgets/live_strip.dart';
import 'package:tangent/features/dashboard/widgets/parent_home.dart';
import 'package:tangent/features/settings/views/settings_view.dart';
import 'package:mocktail/mocktail.dart';

import 'support/harness.dart';

class _OfflineHttp extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = _MockClient();
    when(() => client.openUrl(any(), any())).thenThrow(const SocketException('offline'));
    return client;
  }
}

class _MockClient extends Mock implements HttpClient {}

/// What the console sets for a school (modules, Home cards, quick buttons, languages) is what a family sees.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = _OfflineHttp();
  setUpAll(() => registerFallbackValue(Uri.parse('https://tangent.app')));

  setUp(() async {
    await bootMock();
    Get.testMode = false;
  });

  tearDown(() {
    SchoolConfig.modules.clear();
    SchoolConfig.home.assignAll(['dayRibbon', 'dueStack', 'attendance', 'nextExam', 'notices', 'events']);
    SchoolConfig.quick.assignAll(['payFees', 'applyLeave', 'messageTeacher', 'timetable']);
    SchoolConfig.languages.assignAll(['en', 'hi', 'mr']);
    Get.reset();
  });

  Future<void> home(WidgetTester tester) async {
    final user = (await real(tester, () => signIn(UserRole.parent)))!;
    await real(tester, () => Get.find<AuthService>().setSession(user.copyWith(avatarUrl: '')));
    final c = Get.put(DashboardController());
    await real(tester, c.load);
    await tester.pumpWidget(testApp(home: const Scaffold(body: DashboardView())));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
  }

  testWidgets('home shows the quick buttons the school chose, in its order, then Around school', (tester) async {
    SchoolConfig.quick.assignAll(['timetable', 'payFees']);
    await home(tester);
    expect(find.text('Apply for leave'), findsNothing);
    final quick = find.byType(QuickTiles);
    Finder inQuick(String t) => find.descendant(of: quick, matching: find.text(t));
    expect(tester.getTopLeft(inQuick('Pay fees')).dx, greaterThan(tester.getTopLeft(inQuick('Timetable')).dx));
    expect(tester.getTopLeft(inQuick('Around school')).dx, greaterThan(tester.getTopLeft(inQuick('Pay fees')).dx));
  });

  testWidgets('more quick buttons than fit keep Home to one row of four', (tester) async {
    SchoolConfig.quick.assignAll(['payFees', 'applyLeave', 'timetable', 'bookMeeting', 'events']);
    await home(tester);
    final quick = find.byType(QuickTiles);
    final tops = {for (final t in ['Pay fees', 'Apply for leave', 'Timetable', 'Around school']) tester.getTopLeft(find.descendant(of: quick, matching: find.text(t))).dy};
    expect(tops, hasLength(1), reason: 'one row');
    expect(find.descendant(of: quick, matching: find.text('Book a meeting')), findsNothing);
  });

  testWidgets('the live strip follows the Home cards the console set', (tester) async {
    SchoolConfig.home.assignAll(['dueStack']);
    await home(tester);
    expect(find.byType(LiveStrip), findsNothing);
    expect(find.text('Needs you'), findsOneWidget);
  });

  testWidgets('what needs the parent comes before what is coming up', (tester) async {
    await home(tester);
    expect(find.byType(LiveStrip), findsOneWidget);
    final coming = find.text('Coming up');
    if (coming.evaluate().isNotEmpty) {
      expect(tester.getTopLeft(find.text('Needs you')).dy, lessThan(tester.getTopLeft(coming).dy));
    }
  });

  testWidgets('a module switched off takes its button and what is due from it', (tester) async {
    SchoolConfig.modules.assignAll(['people', 'attendance', 'timetable', 'homework']);
    // The server keeps only buttons of modules the school has.
    SchoolConfig.quick.assignAll(['timetable']);
    await home(tester);
    expect(find.text('Pay fees'), findsNothing);
    expect(find.textContaining('Pay ₹'), findsNothing);
  });

  testWidgets('settings offers only the languages the school offers', (tester) async {
    SchoolConfig.languages.assignAll(['en', 'mr']);
    await tester.pumpWidget(testApp(home: const SettingsView()));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('मराठी'), findsOneWidget);
    expect(find.text('हिंदी'), findsNothing);
    SchoolConfig.languages.assignAll(['en']);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('मराठी'), findsNothing);
  });
}
