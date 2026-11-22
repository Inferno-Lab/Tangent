import 'dart:io';


import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/translations/app_translations.dart';

/// Every literal `'area.key'.tr` / `.trp(` in lib must exist in English, or families see raw keys.
void main() {
  test('literal translation keys all exist in English', () {
    final english = AppTranslations().keys['en']!;
    final pattern = RegExp(r"'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'\s*\.\s*(?:tr|trp)\b");
    final missing = <String>{};
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      for (final m in pattern.allMatches(file.readAsStringSync())) {
        if (!english.containsKey(m.group(1))) missing.add('${m.group(1)}  (${file.path})');
      }
    }
    expect(missing, isEmpty);
  });

  test('a message with @values is never read with plain .tr, or the screen shows "@name"', () {
    final english = AppTranslations().keys['en']!;
    final withValues = {for (final e in english.entries) if (RegExp(r'@\w').hasMatch(e.value)) e.key};
    final plain = RegExp(r"'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'\s*\.\s*tr\b(?!\w)");
    final unfilled = <String>{};
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      for (final m in plain.allMatches(file.readAsStringSync())) {
        if (withValues.contains(m.group(1))) unfilled.add('${m.group(1)}  (${file.path})');
      }
    }
    expect(unfilled, isEmpty);
  });

  test('keys built from data exist: weekdays and the subjects a new school starts with', () {
    final english = AppTranslations().keys['en']!;
    // A school's own subjects are named by the school (SchoolConfig.subjectNameOf); a new school's starter subjects are the
    // app's own words (packages/db/src/seed/school.ts, SUBJECTS).
    final missing = <String>{
      for (final d in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) 'day.$d',
      for (final s in ['maths', 'english', 'science', 'hindi', 'social', 'computer', 'pe']) ...['subject.$s', 'subject_short.$s'],
    };
    expect(missing.where((k) => !english.containsKey(k)), isEmpty);
  });
}
