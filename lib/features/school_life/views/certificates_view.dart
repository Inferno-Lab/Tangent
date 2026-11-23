import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/open_link.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';

/// Certificates for a family's children: those asked for and issued (opened as a PDF), and asking for another.
class CertificatesView extends GetView<CertificatesController> {
  const CertificatesView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    final v = controller.view.value;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      bottomBarHeight: 56,
      bottomBar: v == null || v.types.isEmpty ? null : Btn('certificates.ask', expand: true, icon: PhosphorIconsRegular.certificate, onPressed: () => unawaited(showSheet<void>(const _AskSheet()))),
      children: [
        const Rise(child: PageTitle('certificates.title')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.results,
          emptyTitle: 'certificates.empty',
          emptyBody: 'certificates.empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              if (v == null || v.certificates.isEmpty) const EmptyState(art: EmptyArt.results, title: 'certificates.empty', body: 'certificates.empty_body'),
              for (final (i, c) in (v?.certificates ?? const []).indexed)
                Rise(
                  index: i + 1,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: EduCard(
                      padding: const EdgeInsets.all(16),
                      onTap: c.state == 'issued' ? () => unawaited(openFromServer((r) => r.post('/certificates/${c.id}/link', const {}))) : null,
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(c.typeName, style: context.type.ts),
                                Text(
                                  [c.studentName, ?c.number, if (c.purpose.isNotEmpty) c.purpose, if (c.feeDue > 0) 'certificates.fee_due'.trp({'amount': Formatters.money(c.feeDue)})].join(' · '),
                                  style: context.type.cap,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          if (c.state == 'pending')
                            Btn('certificates.cancel', small: true, kind: BtnKind.quiet, action: () => controller.cancel(c))
                          else if (c.state == 'issued')
                            Icon(PhosphorIconsRegular.filePdf, size: 22, color: context.app.mariText)
                          else
                            Chip2('certificates.state_${c.state}'.tr),
                        ],
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 80),
            ],
          ),
        ),
      ],
    );
  });
}

class _AskSheet extends StatefulWidget {
  const _AskSheet();

  @override
  State<_AskSheet> createState() => _AskSheetState();
}

class _AskSheetState extends State<_AskSheet> {
  CertificatesController get _c => Get.find<CertificatesController>();
  late String _type = _c.view.value!.types.first.key;
  String? _child;
  final _purpose = TextEditingController();

  List<String> get _children => _c.children;

  @override
  void dispose() {
    _purpose.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _child ??= _children.firstOrNull;
    final types = _c.view.value!.types;
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: Obx(() => Btn('certificates.send', expand: true, loading: _c.busy.value, onPressed: () async {
        if (_child == null || !SheetBody.valid()) return;
        final ok = await _c.request(type: _type, studentId: _child!, purpose: _purpose.text.trim());
        if (ok) Get.back<void>();
      })),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('certificates.ask'.tr, style: context.type.h2),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final t in types) Chip2(t.fee > 0 ? '${t.name} · ${Formatters.money(t.fee)}' : t.name, on: t.key == _type, onTap: () => setState(() => _type = t.key)),
          ]),
          if (_children.length > 1) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final id in _children) Chip2((_c.names[id] ?? '').split(' ').first, on: id == _child, onTap: () => setState(() => _child = id)),
            ]),
          ],
          const SizedBox(height: 12),
          Field(controller: _purpose, label: 'certificates.purpose'.tr, hint: 'certificates.purpose_hint'.tr, help: 'field.purpose', maxLength: 200, validator: Validators.text(max: 200, optional: true)),
        ],
      ),
    );
  }
}
