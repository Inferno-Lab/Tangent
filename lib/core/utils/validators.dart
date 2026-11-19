import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/extensions.dart';

/// Field checks. Each returns a translation key (shown under the field) or null. Phone numbers follow the school's
/// country, the same rule the server applies (packages/contracts/src/phones.ts), so what passes here is accepted there.
abstract final class Validators {
  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  /// The usual length of a national number (without the trunk 0) where it is fixed; elsewhere 6 to 12 digits.
  static const _lengths = <String, (int, int)>{
    'IN': (10, 10), 'US': (10, 10), 'CA': (10, 10), 'GB': (9, 10), 'AE': (8, 9), 'SA': (8, 9), 'QA': (8, 8), 'KW': (8, 8),
    'OM': (8, 8), 'BH': (8, 8), 'SG': (8, 8), 'MY': (9, 10), 'NG': (8, 10), 'KE': (9, 9), 'ZA': (9, 9), 'AU': (9, 9),
    'PK': (10, 10), 'BD': (10, 10), 'LK': (9, 9), 'NP': (8, 10), 'FR': (9, 9), 'DE': (6, 11), 'ES': (9, 9), 'IT': (6, 11),
    'IE': (7, 9), 'MX': (10, 10), 'BR': (10, 11), 'TR': (10, 10), 'JP': (9, 10), 'CN': (11, 11), 'EG': (9, 10),
    'ID': (8, 12), 'NZ': (8, 10),
  };

  static String? email(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return 'validation.email_required';
    if (!_email.hasMatch(text)) return 'validation.email_invalid';
    return null;
  }

  /// Families sign in with their phone number; staff often with their email.
  static String? emailOrPhone(String? value) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return 'validation.email_or_phone_required';
    if (text.contains('@')) return email(text);
    // Signing in may happen before the school's country is known: any plausible number, the school checks the rest.
    if (text.replaceAll(RegExp(r'\D'), '').length < 6) return 'validation.phone_invalid';
    return null;
  }

  /// A phone number: international (+ or 00, 8 to 15 digits) or local to the school's country (its usual length).
  static String? phone(String? value, {bool optional = false, String? country}) {
    final text = value?.trim() ?? '';
    if (text.isEmpty) return optional ? null : 'validation.phone_required';
    if (RegExp(r'[^\d\s()+\-.]').hasMatch(text)) return 'validation.phone_invalid';
    final digits = text.replaceAll(RegExp(r'\D'), '');
    if (text.startsWith('+') || text.startsWith('00')) {
      final d = text.startsWith('00') ? digits.substring(2) : digits;
      return d.length >= 8 && d.length <= 15 ? null : 'validation.phone_invalid';
    }
    final place = country ?? SchoolConfig.country;
    final keepsZero = const {'IT', 'VA', 'SM'}.contains(place);
    var national = keepsZero ? digits : digits.replaceFirst(RegExp('^0+'), '');
    final (min, max) = _lengths[place] ?? (6, 12);
    // Someone may type the country code without the + ("919822041200"): allow up to three digits more.
    if (national.length > max && national.length <= max + 3) national = national.substring(national.length - max);
    return national.length >= min && national.length <= max ? null : 'validation.phone_invalid';
  }

  static String? password(String? value) {
    if ((value ?? '').isEmpty) return 'validation.password_required';
    if ((value ?? '').length < 6) return 'validation.password_short';
    return null;
  }

  /// A new password, as long as the school asks (its security settings).
  static String? newPassword(String? value) {
    if ((value ?? '').isEmpty) return 'validation.password_required';
    // Returned translated: the message carries the school's number (a translated text shows as it is).
    if (value!.length < SchoolConfig.passwordMinLength) return 'validation.password_short_n'.trp({'n': '${SchoolConfig.passwordMinLength}'});
    if (value.length > 128) return 'validation.too_long';
    return null;
  }

  static String? required(String? value) {
    if ((value ?? '').trim().isEmpty) return 'validation.required';
    return null;
  }

  /// Free text a person must write: at least [min] characters (after trimming), at most [max].
  static String? Function(String?) text({int min = 1, int max = 500, bool optional = false}) => (value) {
    final t = value?.trim() ?? '';
    if (t.isEmpty) return optional ? null : 'validation.required';
    if (t.length < min) return 'validation.too_short';
    if (t.length > max) return 'validation.too_long';
    return null;
  };

  /// A person's name: letters in any script, with spaces, dots, hyphens and apostrophes; not digits alone.
  static String? name(String? value) {
    final t = value?.trim() ?? '';
    if (t.isEmpty) return 'validation.name_required';
    if (t.length < 2) return 'validation.too_short';
    if (t.length > 80) return 'validation.too_long';
    if (!RegExp(r'\p{L}', unicode: true).hasMatch(t) || RegExp(r'[0-9@#$%^&*=+<>{}\[\]|\\/~`]').hasMatch(t)) return 'validation.name_invalid';
    return null;
  }

  /// A meeting link: empty, or a whole https:// address.
  static String? link(String? value) {
    final t = value?.trim() ?? '';
    if (t.isEmpty) return null;
    final u = Uri.tryParse(t);
    return u != null && u.scheme == 'https' && u.host.contains('.') ? null : 'validation.link_invalid';
  }

  static String? otp(String? value) {
    if ((value ?? '').length != 6) return 'validation.otp';
    return null;
  }
}
