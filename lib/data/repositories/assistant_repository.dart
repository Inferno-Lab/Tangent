import 'package:tangent/data/datasources/remote_datasource.dart';

/// One message in an assistant conversation.
class AssistantTurn {
  const AssistantTurn({required this.fromUser, required this.text});

  final bool fromUser;
  final String text;

  Map<String, dynamic> toJson() => {'role': fromUser ? 'user' : 'assistant', 'text': text};
}

/// What the assistant says back. [suggestions] are one-tap follow-ups; [route] deep-links into the app.
class AssistantReply {
  const AssistantReply({required this.text, this.suggestions = const [], this.route});

  final String text;
  final List<String> suggestions;
  final String? route;

  factory AssistantReply.fromJson(Map<String, dynamic> json) => AssistantReply(
    text: json['text'] as String? ?? '',
    suggestions: [for (final s in (json['suggestions'] as List? ?? const [])) s as String],
    route: json['route'] as String?,
  );
}

/// The seam for chatbots and AI helpers. UI and controllers depend on this only; a model
/// provider (hosted LLM, school-specific RAG, ...) is a new adapter behind it, chosen in InitialBinding.
/// Add features by following docs/adding-a-feature.md ("An AI feature").
abstract class AssistantRepository {
  Future<AssistantReply> ask({required String userId, required String prompt, List<AssistantTurn> history});
}

/// Talks to the school backend, which owns the model provider, its keys and its guardrails.
/// The app never holds a provider key.
class RemoteAssistantRepository implements AssistantRepository {
  RemoteAssistantRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<AssistantReply> ask({
    required String userId,
    required String prompt,
    List<AssistantTurn> history = const [],
  }) async {
    final json = await _remote.post('/users/$userId/assistant', {
      'prompt': prompt,
      'history': [for (final t in history) t.toJson()],
    });
    return AssistantReply.fromJson(Map<String, dynamic>.from(json as Map));
  }
}
