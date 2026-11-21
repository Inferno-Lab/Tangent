@Tags(['school'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/auth_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';

import 'support/harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(bootLive);

  tearDown(Get.reset);

  test('theme choices survive in memory storage', () async {
    final storage = Get.find<StorageService>();
    final themes = Get.find<ThemeService>();
    await themes.setMode(AppThemeMode.amoled);
    await themes.setTextScale(1.15);
    await themes.setLocale(const Locale('hi'));

    final restored = ThemeService(storage)..load();
    expect(restored.mode.value, AppThemeMode.amoled);
    expect(restored.textScale.value, 1.15);
    expect(restored.locale.value.languageCode, 'hi');
  });

  test('a class reads as the school writes it, its section added only when the name lacks it', () {
    SchoolClass cls(String name, String section) => SchoolClass(id: 'c', name: name, section: section, classTeacherId: '', room: '', studentIds: const []);
    expect(cls('8 A', 'A').label, '8 A');
    expect(cls('8', 'A').label, '8 A');
    expect(cls('Year 7 Blue', '').label, 'Year 7 Blue');
  });

  test('sign-in refuses what the school refuses', () async {
    final auth = Get.find<AuthRepository>();
    await expectLater(auth.login(email: person('classTeacher')['email'] as String, password: 'nope'), throwsA(isA<AppException>()));
    // No code was asked for, so there is none to type.
    await expectLater(auth.loginWithOtp(email: person('classTeacher')['email'] as String, otp: '000000'), throwsA(isA<AppException>()));
    // Staff sign in with their password; a code alone is for families.
    await expectLater(auth.requestCode(person('classTeacher')['email'] as String), throwsA(isA<AppException>()));
  });

  test('a family reads its school, fees, homework, notices, messages and attendance', () async {
    await signIn(UserRole.parent);
    final school = await Get.find<DirectoryRepository>().school();
    expect(school.name, 'Sunrise Valley School');
    // Mid-year: the fee register brought the quarters billed since April.
    final fees = await Get.find<FeeRepository>().forStudent(childId);
    expect(fees!.installments, isNotEmpty);
    await Get.find<HomeworkRepository>().forClass(classId);
    // A circular the office sends reaches the family.
    final title = 'Sports day lanes ${DateTime.now().millisecondsSinceEpoch % 100000}';
    await admin('POST', '/v1/notices', {'title': title, 'body': 'House lanes are posted outside the gym.', 'audience': 'parents', 'publish': true});
    expect((await Get.find<NoticeRepository>().all()).map((n) => n.title), contains(title));
    // The attendance register since April.
    expect(await Get.find<AttendanceRepository>().forStudent(childId), isNotEmpty);
  });
}
