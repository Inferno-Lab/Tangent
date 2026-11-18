import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/utils/extensions.dart';

void main() {
  test('a count of one reads in the singular, others in the plural', () {
    Get
      ..addTranslations(AppTranslations().keys)
      ..locale = const Locale('en');
    expect('homework.n_files'.trn(1), '1 file');
    expect('homework.n_files'.trn(3), '3 files');
    expect('teacher.oldest'.trn(1), 'oldest 1 day');
    // A key without a singular keeps its one form.
    expect('teacher.n_absent'.trn(1), '1 absent');
  });

  test('each language counts by its own rules: Arabic has a form for a few and for many', () {
    Get
      ..addTranslations({
        'ar': {'homework.n_files': '@n ملف', 'homework.n_files_one': 'ملف واحد', 'homework.n_files_two': 'ملفان', 'homework.n_files_few': '@n ملفات'},
      })
      ..locale = const Locale('ar');
    expect(['homework.n_files'.trn(1), 'homework.n_files'.trn(2), 'homework.n_files'.trn(3), 'homework.n_files'.trn(11)], ['ملف واحد', 'ملفان', '3 ملفات', '11 ملف']);
    Get.locale = const Locale('en');
  });
}
