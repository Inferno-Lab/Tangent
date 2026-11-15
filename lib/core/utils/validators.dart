abstract final class Validators {
  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

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
    // Lengths differ by country (8 digits in Qatar, 10 in India); the school checks the number itself.
    if (text.replaceAll(RegExp(r'\D'), '').length < 6) return 'validation.phone_invalid';
    return null;
  }

  static String? password(String? value) {
    if ((value ?? '').isEmpty) return 'validation.password_required';
    if ((value ?? '').length < 6) return 'validation.password_short';
    return null;
  }

  static String? required(String? value) {
    if ((value ?? '').trim().isEmpty) return 'validation.required';
    return null;
  }

  static String? otp(String? value) {
    if ((value ?? '').length != 6) return 'validation.otp';
    return null;
  }
}
