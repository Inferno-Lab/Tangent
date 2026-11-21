import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/data/repositories/assistant_repository.dart';

void main() {
  test('replies parse from the backend contract', () {
    final reply = AssistantReply.fromJson({'text': 'Hi', 'suggestions': ['A'], 'route': '/x'});
    expect(reply.text, 'Hi');
    expect(reply.suggestions, ['A']);
    expect(reply.route, '/x');
  });
}
