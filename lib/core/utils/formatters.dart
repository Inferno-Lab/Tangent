import 'package:intl/intl.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/clock.dart';

abstract final class Formatters {
  /// An amount in the school's currency, written its way: whole amounts without decimals ("₹22,000", "$1,250").
  static String money(num amount) {
    final whole = amount == amount.roundToDouble();
    return NumberFormat.simpleCurrency(locale: _locale, name: SchoolConfig.currency, decimalDigits: whole ? 0 : null).format(amount);
  }

  /// The currency's own sign, for a glyph or a field's label.
  static String currencySymbol() => NumberFormat.simpleCurrency(locale: _locale, name: SchoolConfig.currency).currencySymbol;

  /// A count in the school's way of grouping digits.
  static String count(num n) => NumberFormat.decimalPattern(_locale).format(n);

  static String weekday(DateTime date) => DateFormat.E(_locale).format(date);

  // intl knows most locales; one it does not falls back to its language, then to English.
  static String get _locale {
    final l = SchoolConfig.locale;
    if (DateFormat.localeExists(l)) return l;
    final lang = l.split('_').first;
    return DateFormat.localeExists(lang) ? lang : 'en';
  }

  static String greetingKey(DateTime now) {
    final hour = now.hour;
    if (hour < 12) return 'home.greeting_morning';
    if (hour < 17) return 'home.greeting_afternoon';
    return 'home.greeting_evening';
  }

  static String countdown(DateTime due) {
    final now = Clock.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(due.year, due.month, due.day);
    final days = target.difference(today).inDays;
    if (days < 0) return 'time.overdue';
    if (days == 0) return 'time.due_today';
    if (days == 1) return 'time.due_tomorrow';
    return 'time.due_in_days';
  }

  static int daysUntil(DateTime date) {
    final now = Clock.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(date.year, date.month, date.day);
    return target.difference(today).inDays;
  }

  static String initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty);
    final letters = parts.take(2).map((p) => p[0].toUpperCase()).join();
    return letters.isEmpty ? '?' : letters;
  }
}
