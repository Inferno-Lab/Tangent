import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/translations/app_translations.dart';

extension AppContext on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;

  AppColors get app => Theme.of(this).extension<AppColors>()!;

  AppType get type => AppType(app);

  TextTheme get text => Theme.of(this).textTheme;

  bool get isWide => MediaQuery.sizeOf(this).width >= AppBreakpoints.tablet;

  bool get reduceMotion =>
      MediaQuery.disableAnimationsOf(this) ||
      (Get.isRegistered<ThemeService>() && Get.find<ThemeService>().reduceMotion.value);

  /// How tall [lines] lines of [style] are at the reader's text size: tiles whose names wrap differently keep one size.
  double linesHeight(TextStyle style, int lines) {
    final p = TextPainter(
      text: TextSpan(text: List.filled(lines, 'Ag').join('\n'), style: style),
      textDirection: Directionality.of(this),
      textScaler: MediaQuery.textScalerOf(this),
    )..layout();
    final h = p.height;
    p.dispose();
    return h;
  }
}

extension DateOnly on DateTime {
  DateTime get dateOnly => DateTime(year, month, day);

  bool isSameDay(DateTime other) => year == other.year && month == other.month && day == other.day;
}

extension SafeTranslate on String {
  /// Translates this key and fills `@name` placeholders.
  ///
  /// GetX's own `trParams` replaces keys in map order, so `@n` also rewrote the
  /// start of `@name` ("1ame"). This replaces the longest keys first.
  String trp(Map<String, String> params) {
    final keys = params.keys.toList()..sort((a, b) => b.length.compareTo(a.length));
    var out = tr;
    for (final key in keys) {
      out = out.replaceAll('@$key', params[key]!);
    }
    return out;
  }

  /// A count: `'homework.n_files'.trn(1)` is "1 file" through the key's `_one` form. Each language picks its own form by
  /// its plural rules (`_zero`, `_one`, `_two`, `_few`, `_many`; the bare key is "other"): Arabic has six, Hindi two. A form
  /// is used only while it is in the reader's language, so a Hindi screen never shows an English word.
  String trn(num n, [Map<String, String> params = const {}]) {
    final lang = Get.locale?.languageCode ?? 'en';
    final form = Intl.pluralLogic(n, locale: lang, zero: '_zero', one: '_one', two: '_two', few: '_few', many: '_many', other: '');
    final key = '$this$form';
    final translated = key.tr != english[key] || tr == english[this];
    return (form.isNotEmpty && key.tr != key && translated ? key : this).trp({'n': '$n', ...params});
  }
}
