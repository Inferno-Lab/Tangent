import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

/// Single place for the product name and the school this build is for.
class AppConfig {
  const AppConfig._();

  static const appName = 'Tangent';

  /// Which school this build is for, and where its API lives:
  /// `--dart-define=SCHOOL=<slug> --dart-define=API_BASE_URL=<address>`; the console's build workflow sets both, and a
  /// local run names the school tools/dev-reset.sh moves in (SCHOOL=sunrise-valley API_BASE_URL=http://10.0.2.2:4000).
  static const schoolSlug = String.fromEnvironment('SCHOOL');
  static const apiBase = String.fromEnvironment('API_BASE_URL');

  /// Every build talks to a real school; a release build only over https.
  static void assertSchool() {
    if (schoolSlug == '' || apiBase == '') throw StateError('Build the app for a school: --dart-define=SCHOOL=<slug> --dart-define=API_BASE_URL=<address>.');
    if (!kReleaseMode) return;
    final uri = Uri.tryParse(apiBase);
    if (uri == null || uri.scheme != 'https') {
      throw StateError('API_BASE_URL must use https in a release build.');
    }
  }

  /// The school's name and tagline, from its API (`SchoolProfileService`); empty until the first answer.
  static String schoolName = '';
  static String schoolTagline = '';

  /// The school's mark: its brand colour and logo letters (console: Identity and branding). Null colour: the app's own ink.
  static Color? schoolColor;
  static String schoolMark = '';

  /// The school's privacy notice and grievance officer (console: Privacy). Empty until the school sets them.
  static String privacyNotice = '';
  static String privacyOfficer = '';
  static const version = '2.0.6';
  static const build = 216;

  /// Feature switches. Off until the screen and the backend for it exist, so unfinished work
  /// never reaches families. A school's build profile can turn them on with --dart-define.
  static const assistantEnabled = bool.fromEnvironment('ASSISTANT');
}
