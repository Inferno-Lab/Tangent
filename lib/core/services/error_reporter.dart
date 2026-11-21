import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/storage_service.dart';

/// Sends crashes to Tangent's error list (the console's Health page). Only builds for a real school report; debug runs print.
abstract final class ErrorReporter {
  static final _seen = <String>{};

  static void install() {
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      previous?.call(details);
      report(details.exception, details.stack);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      report(error, stack);
      return false;
    };
    // Reports kept while offline go once the app is up again.
    if (!kDebugMode) Future<void>.delayed(const Duration(seconds: 20), () => unawaited(_flush()));
  }

  static StorageService? get _storage => Get.isRegistered<StorageService>() ? Get.find<StorageService>() : null;

  static List<Map<String, dynamic>> get _queue =>
      [for (final x in _storage?.read<List<dynamic>>(StorageKeys.errorQueue) ?? const <dynamic>[]) Map<String, dynamic>.from(x as Map)];

  static Future<void> _flush() async {
    final queue = _queue;
    if (queue.isEmpty) return;
    await _storage?.write(StorageKeys.errorQueue, <dynamic>[]);
    for (final body in queue) {
      if (!await _post(body)) {
        await _keep(body);
        return;
      }
    }
  }

  static Future<void> _keep(Map<String, dynamic> body) async {
    final queue = [..._queue, body];
    await _storage?.write(StorageKeys.errorQueue, queue.sublist(queue.length > 20 ? queue.length - 20 : 0));
  }

  static void report(Object error, StackTrace? stack) {
    if (kDebugMode) return;
    final message = error.toString();
    // Once per message per run, and never a flood from one broken screen.
    if (!_seen.add(message) || _seen.length > 20) return;
    unawaited(_send(message, stack));
  }

  static Future<void> _send(String message, StackTrace? stack) async {
    final trace = stack?.toString() ?? '';
    final body = {
      'source': 'app',
      'message': message.length > 500 ? message.substring(0, 500) : message,
      if (trace.isNotEmpty) 'stack': trace.length > 4000 ? trace.substring(0, 4000) : trace,
      'release': '${AppConfig.version}+${AppConfig.build}',
    };
    // Not sent (offline): kept on the phone and sent with the next report that gets through.
    if (await _post(body)) {
      await _flush();
    } else {
      await _keep(body);
    }
  }

  static Future<bool> _post(Map<String, dynamic> body) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final base = AppConfig.apiBase.replaceAll(RegExp(r'/$'), '');
      final req = await client.postUrl(Uri.parse('$base/v1/errors'));
      req.headers
        ..contentType = ContentType.json
        ..set('x-school', AppConfig.schoolSlug);
      req.write(jsonEncode(body));
      final res = await req.close();
      await res.drain<void>();
      return res.statusCode < 500;
    } on Object {
      return false;
    } finally {
      client.close(force: true);
    }
  }
}
