import 'package:flutter/services.dart';

abstract final class Haptics {
  static void light() => HapticFeedback.lightImpact();

  static void medium() => HapticFeedback.mediumImpact();

  static void selection() => HapticFeedback.selectionClick();

  /// Something the person did worked (fired by its success toast).
  static void success() => HapticFeedback.lightImpact();

  /// Something the person did failed (fired by its error toast).
  static void error() => HapticFeedback.heavyImpact();
}
