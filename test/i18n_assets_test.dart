import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/translations/app_translations.dart';

/// The app's English words, as the server and the console's Languages page read them (`assets/i18n/en.json`, the `app`
/// surface): the same as the built-in maps, or translators work from stale English.
/// Write it again after changing copy: flutter test test/i18n_assets_test.dart --dart-define=UPDATE_I18N=true
void main() {
  test('assets/i18n/en.json is the app’s English', () {
    final en = Map<String, String>.from(AppTranslations().keys['en']!);
    final sorted = Map.fromEntries(en.entries.toList()..sort((a, b) => a.key.compareTo(b.key)));
    final file = File('assets/i18n/en.json');
    final json = '${const JsonEncoder.withIndent(' ').convert(sorted)}\n';
    if (const bool.fromEnvironment('UPDATE_I18N')) {
      file
        ..createSync(recursive: true)
        ..writeAsStringSync(json);
      // A language still built into the app moves to its own file (words that differ from the English only).
      for (final MapEntry(key: lang, value: words) in AppTranslations().keys.entries.where((e) => e.key != 'en')) {
        final own = Map.fromEntries(words.entries.where((e) => en[e.key] != e.value).toList()..sort((a, b) => a.key.compareTo(b.key)));
        if (own.isNotEmpty) File('assets/i18n/$lang.json').writeAsStringSync('${const JsonEncoder.withIndent(' ').convert(own)}\n');
      }
    }
    expect(file.readAsStringSync(), json, reason: 'Run: flutter test test/i18n_assets_test.dart --dart-define=UPDATE_I18N=true');
  });

  test('every other language keeps the app’s @values', () {
    final en = Map<String, String>.from(AppTranslations().keys['en']!);
    final names = (String s) => (RegExp(r'@(\w+)').allMatches(s).map((m) => m[1]!).toList()..sort()).join(',');
    for (final f in Directory('assets/i18n').listSync().whereType<File>().where((f) => f.path.endsWith('.json') && !f.path.endsWith('en.json'))) {
      final own = Map<String, dynamic>.from(jsonDecode(f.readAsStringSync()) as Map);
      for (final e in own.entries) {
        expect(en.containsKey(e.key), isTrue, reason: '${f.path}: ${e.key} is not an English key');
        expect(names('${e.value}'), names(en[e.key]!), reason: '${f.path}: ${e.key} changed its @values');
      }
    }
  });
}
