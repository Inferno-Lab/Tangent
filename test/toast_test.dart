import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/widgets/toast.dart';

void main() {
  test('a toast stays as long as it takes to read, within the bounds', () {
    expect(ToastHelper.holdFor('Saved', null), AppMotion.toastMin);
    final long = List.filled(40, 'word').join(' ');
    expect(ToastHelper.holdFor(long, null), AppMotion.toastMax);
    final mid = 'Your leave request was sent to the class teacher today';
    expect(ToastHelper.holdFor(mid, null, error: true) > ToastHelper.holdFor(mid, null), isTrue);
  });
}
