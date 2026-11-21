// The app's tests run against a real school: Sunrise Valley, moved in from its old systems' files by tools/dev-reset.sh, with
// the app's people signed in once by tools/dataset/app-sessions.mjs (codes from the console's Test inbox). The app talks to it
// through its own Remote repositories, as on a phone. Before `flutter test`:
//   bash tools/dev-reset.sh && node tools/dataset/app-sessions.mjs
// ponytail: one school for the whole run, shared by the test files; a copy per file when tests start stepping on each other.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:tangent/core/network/api_client.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/services/session_bus.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/auth_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/data/repositories/driver_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';

/// What tools/dataset/app-sessions.mjs wrote: the server, the school, its people and a session for each app role.
final Map<String, dynamic> _live = () {
  final file = File('.tangent-data/app-sessions.json');
  if (!file.existsSync()) {
    throw StateError('No school to test against: run `bash tools/dev-reset.sh` and `node tools/dataset/app-sessions.mjs` first.');
  }
  return Map<String, dynamic>.from(jsonDecode(file.readAsStringSync()) as Map);
}();

/// The school's people (tools/dataset/school.mjs), by the names the dataset gives them: parentOfTwo, classTeacher, driver…
Map<String, dynamic> person(String key) => Map<String, dynamic>.from((_live['people'] as Map)[key] as Map);

/// The parent's two children (both in 8 A, the class teacher's class), and 8 A itself, once [bootLive] has read them.
late String childId;
late String otherChildId;
late String classId;

/// The app's own services, for a test that shows widgets and reads nothing from the school.
Future<void> bootApp() async {
  await initializeDateFormatting();
  // Real calls to the school: the test binding's stand-in client answers every request with 400.
  HttpOverrides.global = null;
  // The image cache asks for temp directories; there is no platform plugin in tests.
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/path_provider'),
    (_) async => Directory.systemTemp.path,
  );
  Get.reset();
  Get.testMode = true;

  final storage = StorageService(memory: <String, dynamic>{});
  Get
    ..put<StorageService>(storage, permanent: true)
    ..put<ThemeService>(ThemeService(storage)..load(), permanent: true)
    ..put<AuthService>(AuthService(storage), permanent: true)
    ..put<SessionBus>(SessionBus(), permanent: true);
}

/// The app's services and its Remote repositories, talking to the school.
Future<void> bootLive() async {
  await bootApp();
  final storage = Get.find<StorageService>();
  final remote = Get.put(
    RemoteDataSource(ApiClient(storage: storage, base: _live['api'] as String, school: _live['school'] as String)),
    permanent: true,
  );
  Get
    ..put<AuthRepository>(AuthRepository(remote), permanent: true)
    ..put<DirectoryRepository>(DirectoryRepository(remote), permanent: true)
    ..put<AttendanceRepository>(AttendanceRepository(remote), permanent: true)
    ..put<TimetableRepository>(TimetableRepository(remote), permanent: true)
    ..put<HomeworkRepository>(HomeworkRepository(remote), permanent: true)
    ..put<ExamRepository>(ExamRepository(remote), permanent: true)
    ..put<FeeRepository>(FeeRepository(remote), permanent: true)
    ..put<NoticeRepository>(NoticeRepository(remote), permanent: true)
    ..put<EventRepository>(EventRepository(remote), permanent: true)
    ..put<ChatRepository>(ChatRepository(remote), permanent: true)
    ..put<LibraryRepository>(LibraryRepository(remote), permanent: true)
    ..put<TransportRepository>(TransportRepository(remote), permanent: true)
    ..put<DriverRepository>(DriverRepository(remote), permanent: true)
    ..put<LeaveRepository>(LeaveRepository(remote), permanent: true)
    ..put<GalleryRepository>(GalleryRepository(remote), permanent: true)
    ..put<SchoolLifeRepository>(SchoolLifeRepository(remote), permanent: true)
    ..put<NotificationRepository>(NotificationRepository(remote), permanent: true);
}

Future<T?> real<T>(WidgetTester tester, Future<T> Function() body) {
  return tester.runAsync(body);
}

/// Lets the screen's calls to the school come back (real time) and draws its frames, then runs out any call still waiting,
/// so no timer outlives the test.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.pump(const Duration(seconds: 30));
}

/// Puts a controller that loads from the school when it starts, outside the test's fake clock so its calls can finish.
Future<T> put<T>(WidgetTester tester, T Function() make) async => (await tester.runAsync(() async => Get.put<T>(make())))!;

/// Signs [role] in with the session app-sessions.mjs made, loads the school's setup as the app does, and returns who it is.
/// Call it inside [real] in a widget test.
Future<AppUser> signIn(UserRole role) async {
  final session = Map<String, dynamic>.from(_live[role.name] as Map);
  final remote = Get.find<RemoteDataSource>();
  await remote.client.saveTokens({'accessToken': session['accessToken']});
  final user = AppUser.fromJson(Map<String, dynamic>.from(await remote.get('/me') as Map));
  await Get.find<AuthService>().setSession(user);
  await SchoolConfig.load();
  if (role == UserRole.parent) {
    childId = user.childIds.first;
    otherChildId = user.childIds.last;
    classId = (Map<String, dynamic>.from(await remote.get('/students/$childId') as Map))['classId'] as String;
  }
  return user;
}

/// A call as the principal, for what a test needs the school's office to have done first; a path under `/v1/` as the admin uses it.
Future<dynamic> admin(String method, String path, [Map<String, dynamic> body = const {}]) async {
  final client = ApiClient(storage: StorageService(memory: <String, dynamic>{}), base: _live['api'] as String, school: _live['school'] as String);
  await client.saveTokens({'accessToken': (Map<String, dynamic>.from(_live['admin'] as Map))['accessToken']});
  return switch (method) { 'GET' => client.get(path), 'PATCH' => client.patch(path, body), 'DELETE' => client.delete(path), _ => client.post(path, body) };
}

Widget testApp({Widget? home, List<GetPage<dynamic>> pages = const []}) {
  return GetMaterialApp(
    translations: AppTranslations(),
    locale: const Locale('en'),
    fallbackLocale: const Locale('en'),
    theme: AppTheme.build(AppColors.light),
    home: pages.isEmpty ? home : null,
    initialRoute: pages.isEmpty ? null : pages.first.name,
    getPages: pages,
  );
}

/// Loads the app's real fonts so text measures as on a phone.
Future<void> loadAppFonts() async {
  final fonts = {
    'BricolageGrotesque': ['assets/fonts/BricolageGrotesque.ttf'],
    'AnekDevanagari': ['assets/fonts/AnekDevanagari.ttf'],
    'IBMPlexMono': ['assets/fonts/IBMPlexMono-Regular.ttf', 'assets/fonts/IBMPlexMono-Medium.ttf'],
    'packages/phosphor_flutter/PhosphorRegular': ['packages/phosphor_flutter/lib/fonts/Phosphor.ttf'],
    'packages/phosphor_flutter/PhosphorBold': ['packages/phosphor_flutter/lib/fonts/Phosphor-Bold.ttf'],
    'packages/phosphor_flutter/PhosphorFill': ['packages/phosphor_flutter/lib/fonts/Phosphor-Fill.ttf'],
  };
  for (final e in fonts.entries) {
    final loader = FontLoader(e.key);
    for (final f in e.value) {
      loader.addFont(rootBundle.load(f));
    }
    await loader.load();
  }
}
