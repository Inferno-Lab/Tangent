import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';

/// Languages beyond the built-in English (docs/one-shot-plan.md §3.5.3): a pack per language from the server
/// (`/v1/i18n/app/<lang>`, the console's Languages page over `assets/i18n/<lang>.json`), kept on the phone so the app still
/// speaks it offline, and taken from the bundled file on sample content. A word a pack lacks reads in English.
abstract final class LanguagePacks {
  static String _key(String lang) => 'i18n.app.$lang';

  /// The pack kept from last time, at once (before the first frame).
  static void restore(String lang) {
    if (lang == 'en') return;
    final kept = Get.find<StorageService>().read<Map<String, dynamic>>(_key(lang));
    if (kept != null) _use(lang, kept);
  }

  /// The newest pack, then kept for next time; a failure keeps what the phone has.
  static Future<void> refresh(String lang) async {
    if (lang == 'en') return;
    try {
      final Object? fresh = AppConfig.useMockData
          ? jsonDecode(await rootBundle.loadString('assets/i18n/$lang.json'))
          : Get.isRegistered<RemoteDataSource>()
              ? await Get.find<RemoteDataSource>().get('/v1/i18n/app/$lang')
              : null;
      if (fresh is! Map) return;
      final pack = Map<String, dynamic>.from(fresh);
      _use(lang, pack);
      await Get.find<StorageService>().write(_key(lang), pack);
      if (Get.locale?.languageCode == lang) await Get.forceAppUpdate();
    } on Object {
      // Offline, or no pack for this language yet: the kept one (or English) stays.
    }
  }

  /// The school learns the person's language, so its messages reach them in it (a signed-in account on a real school only).
  static Future<void> remember(String lang) async {
    if (AppConfig.useMockData || !Get.isRegistered<RemoteDataSource>() || !Get.isRegistered<AuthService>() || !Get.find<AuthService>().isLoggedIn) return;
    try {
      await Get.find<RemoteDataSource>().client.send('PUT', '/v1/auth/me/prefs', {'key': 'language', 'value': lang});
    } on Object {
      // Offline: the next start says it again.
    }
  }

  static void _use(String lang, Map<String, dynamic> pack) =>
      Get.addTranslations({lang: pack.map((k, v) => MapEntry(k, '$v'))});
}
