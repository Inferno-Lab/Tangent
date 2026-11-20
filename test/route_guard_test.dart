import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/routes/middlewares.dart';

void main() {
  test('a page is known by the module it belongs to', () {
    expect(moduleOfRoute('/chat'), 'chat');
    expect(moduleOfRoute('/chat/th_1'), 'chat');
    expect(moduleOfRoute('/teacher/diary'), 'diary');
    expect(moduleOfRoute('/gate-pass?child=s1'), 'visitors');
    expect(moduleOfRoute('/homework/hw_1'), 'homework');
    expect(moduleOfRoute('/leave/apply'), isNull);
    expect(moduleOfRoute('/settings'), isNull);
    expect(moduleOfRoute('/chatter'), isNull);
  });
}
