import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';

/// One question of a school form (the school's field kinds), and when it is asked.
class FormQuestion {
  const FormQuestion({required this.key, required this.label, required this.kind, this.required = false, this.hint = '', this.options = const []});

  factory FormQuestion.fromJson(Map<String, dynamic> j) => FormQuestion(
    key: j['key'] as String,
    label: j['label'] as String? ?? '',
    kind: j['kind'] as String? ?? 'text',
    required: j['required'] == true,
    hint: j['hint'] as String? ?? '',
    options: [for (final o in (j['options'] as List? ?? const [])) (key: '${(o as Map)['key']}', name: '${o['name']}')],
  );

  final String key;
  final String label;
  final String kind;
  final bool required;
  final String hint;
  final List<({String key, String name})> options;
}

/// A form the school asked this person to answer, and the children still to answer for (one null: once for the family).
class SchoolForm {
  const SchoolForm({required this.id, required this.title, required this.intro, required this.questions, required this.conditions, required this.pending});

  factory SchoolForm.fromJson(Map<String, dynamic> j) => SchoolForm(
    id: j['id'] as String,
    title: j['title'] as String? ?? '',
    intro: j['intro'] as String? ?? '',
    questions: [for (final q in (j['fields'] as List? ?? const [])) FormQuestion.fromJson(Map<String, dynamic>.from(q as Map))],
    conditions: {
      for (final e in Map<String, dynamic>.from(j['conditions'] as Map? ?? const {}).entries)
        e.key: (key: '${(e.value as Map)['key']}', equals: '${e.value['equals']}'),
    },
    pending: [for (final p in (j['pending'] as List? ?? const [])) p as String?],
  );

  final String id;
  final String title;
  final String intro;
  final List<FormQuestion> questions;
  final Map<String, ({String key, String equals})> conditions;
  final List<String?> pending;

  /// The questions that apply given the answers so far, as the server decides them: one that depends on an earlier answer
  /// is asked only when that answer is given.
  List<FormQuestion> visible(Map<String, Object?> answers) {
    final shown = <String>{};
    final out = <FormQuestion>[];
    for (final q in questions) {
      final c = conditions[q.key];
      if (c != null) {
        if (!shown.contains(c.key)) continue;
        final v = answers[c.key];
        final said = v is List ? v.map((x) => '$x'.toLowerCase()) : v is bool ? [if (v) 'yes' else 'no'] : v == null ? const <String>[] : ['$v'.toLowerCase()];
        if (!said.contains(c.equals.toLowerCase())) continue;
      }
      shown.add(q.key);
      out.add(q);
    }
    return out;
  }
}

/// Forms open to this person (families, or staff): answered here, once per child where the school asks so.
class FormsController extends GetxController with Loadable {
  List<SchoolForm> forms = [];
  final sending = false.obs;

  List<SchoolForm> get waiting => forms.where((f) => f.pending.isNotEmpty).toList();

  @override
  Future<void> load() => run(() async {
    // Sample content has no school forms.
    if (!AppConfig.live) {
      forms = [];
      return;
    }
    final json = await Get.find<RemoteDataSource>().get('/v1/f/forms');
    forms = [for (final f in json as List) SchoolForm.fromJson(Map<String, dynamic>.from(f as Map))];
  }, isEmpty: () => forms.isEmpty);

  /// Sends one answer (for a child, on a per-child form); true once the school has it.
  Future<bool> answer(SchoolForm form, String? studentId, Map<String, Object?> answers) async {
    sending.value = true;
    try {
      final shown = form.visible(answers).map((q) => q.key).toSet();
      await Get.find<RemoteDataSource>().post('/v1/f/forms/${form.id}', {
        'answers': {for (final e in answers.entries) if (shown.contains(e.key)) e.key: e.value},
        if (studentId != null) 'studentId': studentId,
      });
      ToastHelper.show('forms.sent', kind: ToastKind.success);
      await load();
      return true;
    } on AppException catch (e) {
      ToastHelper.show(e.message, kind: ToastKind.error);
      return false;
    } finally {
      sending.value = false;
    }
  }
}
