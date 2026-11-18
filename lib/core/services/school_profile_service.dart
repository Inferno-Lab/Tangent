import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/core/theme/app_colors.dart';

/// Reads the school's own name and tagline from its API at start-up, so the app follows what the school sets in its admin.
/// Without a build profile (`SCHOOL` and `API_BASE_URL`) nothing happens and the demo values stay. A slow or failed call
/// uses the copy kept from the last answer (or the built-in values on a first start offline): the app must always open.
class SchoolProfileService {
  const SchoolProfileService._();

  static Future<void> load(StorageService storage) async {
    if (!AppConfig.live) return;
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final base = AppConfig.apiBase.replaceAll(RegExp(r'/$'), '');
      final req = await client.getUrl(Uri.parse('$base/v1/brand')).timeout(const Duration(seconds: 8));
      req.headers.set('x-school', AppConfig.schoolSlug);
      final res = await req.close().timeout(const Duration(seconds: 20));
      if (res.statusCode != 200) throw const HttpException('brand');
      final json = jsonDecode(await res.transform(utf8.decoder).join()) as Map<String, dynamic>;
      await storage.write(StorageKeys.schoolProfile, json);
      await _apply(json, storage);
    } on Object {
      // Offline or the school's server is down: the last copy, so the app still looks like the school.
      final kept = storage.read<Map<dynamic, dynamic>>(StorageKeys.schoolProfile);
      if (kept != null) await _apply(Map<String, dynamic>.from(kept), storage);
    } finally {
      client.close(force: true);
    }
  }

  static Future<void> _apply(Map<String, dynamic> json, StorageService storage) async {
    final name = json['name'];
    final tagline = json['tagline'];
    if (name is String && name.trim().isNotEmpty) AppConfig.schoolName = name.trim();
    if (tagline is String && tagline.trim().isNotEmpty) AppConfig.schoolTagline = tagline.trim();
    AppConfig.demoSchool.value = json['demoMode'] == true;
    final color = json['color'];
    if (color is String && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(color)) {
      AppConfig.schoolColor = Color(int.parse('FF${color.substring(1)}', radix: 16));
    }
    // Every colour of the app as the console set it, kept for the next start.
    final palette = json['palette'];
    if (palette is Map) {
      AppPalette.apply(Map<String, dynamic>.from(palette));
      await storage.write(StorageKeys.palette, palette);
    }
    final logo = json['logoText'];
    if (logo is String && logo.trim().isNotEmpty) AppConfig.schoolMark = logo.trim().toUpperCase();
    final privacy = json['privacy'];
    if (privacy is Map) {
      AppConfig.privacyNotice = '${privacy['notice'] ?? ''}'.trim();
      AppConfig.privacyOfficer = [privacy['officerName'], privacy['officerEmail'], privacy['officerPhone']]
          .whereType<String>()
          .where((s) => s.trim().isNotEmpty)
          .join(' · ');
    }
  }
}
