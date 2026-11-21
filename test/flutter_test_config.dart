import 'dart:async';

import 'package:tangent/core/utils/clock.dart';

/// The app's clock is the school's: the tests read a running school whose records are dated from today (tools/dataset), so
/// a test checks what holds on any day of the week. `--dart-define=TEST_NOW=2026-11-14T13:33` replays another moment.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  const at = String.fromEnvironment('TEST_NOW');
  if (at.isNotEmpty) {
    final offset = DateTime.parse(at).difference(DateTime.now());
    Clock.source = () => DateTime.now().add(offset);
  }
  await testMain();
}
