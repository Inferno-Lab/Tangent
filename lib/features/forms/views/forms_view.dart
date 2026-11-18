import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/glass_controls.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/features/forms/controllers/forms_controller.dart';

/// The school's forms to answer (a trip consent, a survey, a details check): each waiting form, then the form itself.
class FormsView extends GetView<FormsController> {
  const FormsView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      children: [
        Rise(child: PageTitle('forms.title', subtitle: 'forms.waiting_n'.trn(controller.waiting.length))),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.notices,
          emptyTitle: 'forms.empty',
          emptyBody: 'forms.empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, f) in controller.forms.indexed)
                Rise(
                  index: i + 1,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: EduCard(
                      onTap: f.pending.isEmpty ? null : () => unawaited(Get.to<void>(() => _FormPage(form: f))),
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(f.title, style: context.type.ts),
                                if (f.intro.isNotEmpty) Text(f.intro, style: context.type.cap, maxLines: 2, overflow: TextOverflow.ellipsis),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Chip2(f.pending.isEmpty ? 'forms.answered'.tr : 'forms.to_answer'.tr),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  });
}

class _FormPage extends StatefulWidget {
  const _FormPage({required this.form});

  final SchoolForm form;

  @override
  State<_FormPage> createState() => _FormPageState();
}

class _FormPageState extends State<_FormPage> {
  final _answers = <String, Object?>{};
  final _text = <String, TextEditingController>{};
  final _names = <String, String>{};
  late String? _child = widget.form.pending.firstOrNull;

  FormsController get _c => Get.find<FormsController>();

  @override
  void initState() {
    super.initState();
    unawaited(_loadNames());
  }

  // The children's first names, for a form answered once per child.
  Future<void> _loadNames() async {
    for (final id in widget.form.pending.whereType<String>()) {
      try {
        _names[id] = (await Get.find<DirectoryRepository>().student(id)).name.split(' ').first;
      } on Object {
        _names[id] = '';
      }
    }
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _ctl(String key) => _text.putIfAbsent(key, TextEditingController.new);

  Future<void> _send() async {
    for (final e in _text.entries) {
      final v = e.value.text.trim();
      _answers[e.key] = v.isEmpty ? null : v;
    }
    final missing = widget.form.visible(_answers).where((q) => q.required && (_answers[q.key] == null || (_answers[q.key] is List && (_answers[q.key]! as List).isEmpty)));
    if (missing.isNotEmpty) {
      ToastHelper.show('forms.fill_in'.trp({'q': missing.first.label}), kind: ToastKind.error);
      return;
    }
    if (await _c.answer(widget.form, _child, _answers) && mounted) Get.back<void>();
  }

  Widget _question(FormQuestion q) {
    final label = q.required ? q.label : 'forms.optional'.trp({'q': q.label});
    switch (q.kind) {
      case 'yesno':
        final v = _answers[q.key];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(label, style: context.type.ts),
            const SizedBox(height: 8),
            GlassSegmented(
              labels: const ['forms.yes', 'forms.no'],
              index: v == true ? 0 : v == false ? 1 : -1,
              semanticLabel: q.label,
              onChanged: (i) => setState(() => _answers[q.key] = i == 0),
            ),
          ],
        );
      case 'choice':
      case 'multi':
        final picked = q.kind == 'multi' ? (_answers[q.key] as List<String>? ?? const <String>[]) : [if (_answers[q.key] != null) '${_answers[q.key]}'];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: context.type.ts),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final o in q.options)
                  Chip2(o.name, on: picked.contains(o.key), onTap: () => setState(() {
                    if (q.kind == 'choice') {
                      _answers[q.key] = o.key;
                    } else {
                      _answers[q.key] = picked.contains(o.key) ? picked.where((x) => x != o.key).toList() : [...picked, o.key];
                    }
                  })),
              ],
            ),
          ],
        );
      case 'date':
        final v = _answers[q.key] as String?;
        return Pressable(
          label: label,
          onTap: () async {
            final now = DateTime.now();
            final d = await showDatePicker(context: context, firstDate: DateTime(now.year - 100), lastDate: DateTime(now.year + 5), initialDate: v == null ? now : DateTime.parse(v));
            if (d != null) setState(() => _answers[q.key] = DateFormat('yyyy-MM-dd').format(d));
          },
          child: EduCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(child: Text(label, style: context.type.ts)),
                Text(v == null ? 'forms.pick_a_day'.tr : DateFormat.yMMMd(Get.locale?.toLanguageTag()).format(DateTime.parse(v)), style: context.type.cap),
              ],
            ),
          ),
        );
      default:
        return Field(
          controller: _ctl(q.key),
          label: label,
          hint: q.hint.isEmpty ? null : q.hint,
          maxLines: q.kind == 'longText' ? 4 : 1,
          keyboard: switch (q.kind) {
            'number' => const TextInputType.numberWithOptions(decimal: true),
            'phone' => TextInputType.phone,
            'email' => TextInputType.emailAddress,
            _ => TextInputType.text,
          },
          onChanged: (_) => setState(() {}),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    // The answers typed so far decide which questions show.
    for (final e in _text.entries) {
      final v = e.value.text.trim();
      _answers[e.key] = v.isEmpty ? null : v;
    }
    final children = widget.form.pending.whereType<String>().toList();
    return PageFrame(
      leading: const BackGlass(),
      bottomBarHeight: 56,
      bottomBar: Obx(() => Btn('forms.send', expand: true, icon: PhosphorIconsRegular.paperPlaneTilt, loading: _c.sending.value, onPressed: () => unawaited(_send()))),
      children: [
        PageTitle(widget.form.title),
        if (widget.form.intro.isNotEmpty) Text(widget.form.intro, style: context.type.b),
        if (children.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text('forms.for_child'.tr, style: context.type.cap),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            children: [for (final id in children) Chip2(_names[id]?.isNotEmpty ?? false ? _names[id]! : '…', on: _child == id, onTap: () => setState(() => _child = id))],
          ),
        ],
        for (final q in widget.form.visible(_answers)) ...[const SizedBox(height: 16), _question(q)],
        const SizedBox(height: 80),
      ],
    );
  }
}
