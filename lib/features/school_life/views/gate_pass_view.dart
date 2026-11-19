import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';

String _when(DateTime t) => DateFormat('EEE d MMM, HH:mm', Get.locale?.languageCode).format(t);

/// Leaving early and pick-up for a family: today's code for the gate, passes asked for (and the school's own, to agree to),
/// and the people allowed to collect their children.
class GatePassScreen extends GetView<GatePassController> {
  const GatePassScreen({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    final v = controller.view.value;
    final names = controller.names;
    String first(String id) => (names[id] ?? '').split(' ').first;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      bottomBarHeight: 56,
      bottomBar: controller.children.isEmpty ? null : Btn('gate.leave_early', expand: true, icon: PhosphorIconsRegular.doorOpen, onPressed: () => unawaited(showSheet<void>(const _AskSheet()))),
      children: [
        const Rise(child: PageTitle('gate.title')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.leave,
          emptyTitle: 'gate.empty',
          emptyBody: 'gate.empty_body',
          child: v == null ? const SizedBox.shrink() : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              if (v.code != null)
                Rise(
                  index: 1,
                  child: EduCard(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        Text('gate.code_today'.tr, style: context.type.cap),
                        const SizedBox(height: 6),
                        Semantics(label: v.code!.split('').join(' '), child: Text(v.code!, style: context.type.h1.copyWith(letterSpacing: 8))),
                        const SizedBox(height: 6),
                        Text('gate.code_help'.tr, style: context.type.cap, textAlign: TextAlign.center),
                      ],
                    ),
                  ),
                ),
              for (final p in v.passes.where((p) => p.state == 'consent'))
                Rise(
                  index: 2,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: EduCard(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text('gate.school_asks'.trp({'name': p.studentName.split(' ').first, 'time': _when(p.leaveAt)}), style: context.type.ts),
                          Text(p.reason, style: context.type.s),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(child: Btn('gate.agree', small: true, onPressed: () => unawaited(controller.answer(p, yes: true)))),
                              const SizedBox(width: 10),
                              Expanded(child: Btn('gate.refuse', small: true, kind: BtnKind.quiet, onPressed: () => unawaited(controller.answer(p, yes: false)))),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              Rise(index: 3, child: SectionLabel('gate.passes'.tr, top: 24)),
              if (v.passes.where((p) => p.state != 'consent').isEmpty)
                Text('gate.no_passes'.tr, style: context.type.cap)
              else
                for (final p in v.passes.where((p) => p.state != 'consent'))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: EduCard(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${p.studentName} · ${_when(p.leaveAt)}', style: context.type.ts, maxLines: 1, overflow: TextOverflow.ellipsis),
                                Text([p.reason, 'gate.collected_by'.trp({'name': p.collector}), ?p.number].join(' · '), style: context.type.cap, maxLines: 2, overflow: TextOverflow.ellipsis),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          if (p.state == 'pending' || p.state == 'approved')
                            Btn('gate.cancel', small: true, kind: BtnKind.quiet, onPressed: () => unawaited(controller.cancel(p)))
                          else
                            Chip2('gate.state_${p.state}'.tr),
                        ],
                      ),
                    ),
                  ),
              Rise(index: 4, child: SectionLabel('gate.who_collects'.tr, top: 24, action: 'gate.add_person', onAction: () => unawaited(showSheet<void>(const _PersonSheet())))),
              EduCard(
                child: Column(
                  children: [
                    if (v.people.isEmpty)
                      Padding(padding: const EdgeInsets.all(16), child: Text('gate.nobody_named'.tr, style: context.type.cap)),
                    for (final (i, p) in v.people.indexed) ...[
                      if (i > 0) const Hr(),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 10, 8, 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(p.name, style: context.type.ts),
                                  Text([p.relation, 'gate.for_child'.trp({'name': first(p.studentId)}), if (p.phone.isNotEmpty) p.phone].join(' · '), style: context.type.cap),
                                ],
                              ),
                            ),
                            Pressable(
                              label: 'gate.remove'.tr,
                              onTap: () => unawaited(controller.removePerson(p)),
                              child: Padding(padding: const EdgeInsets.all(8), child: Icon(PhosphorIconsRegular.trash, size: 18, color: context.app.ink)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
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
  GatePassController get _c => Get.find<GatePassController>();
  late String _child = _c.children.first;
  var _day = Clock.now();
  var _at = TimeOfDay.fromDateTime(Clock.now().add(const Duration(hours: 1)));
  String? _person;
  final _reason = TextEditingController();
  final _collector = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    _collector.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final people = _c.view.value?.people.where((p) => p.studentId == _child).toList() ?? const <PickupPerson>[];
    final at = DateTime(_day.year, _day.month, _day.day, _at.hour, _at.minute);
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: Obx(() => Btn('gate.ask', expand: true, loading: _c.busy.value, onPressed: () async {
        if (!SheetBody.valid()) return;
        final ok = await _c.ask(studentId: _child, leaveAt: at, reason: _reason.text.trim(), pickupId: _person, collector: _collector.text.trim());
        if (ok) Get.back<void>();
      })),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('gate.leave_early'.tr, style: context.type.h2),
          const SizedBox(height: 12),
          if (_c.children.length > 1)
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final id in _c.children) Chip2((_c.names[id] ?? '').split(' ').first, on: id == _child, onTap: () => setState(() { _child = id; _person = null; })),
            ]),
          const SizedBox(height: 12),
          Pressable(
            label: 'gate.when'.tr,
            onTap: () async {
              final d = await showDatePicker(context: context, firstDate: Clock.now(), lastDate: Clock.now().add(const Duration(days: 30)), initialDate: _day);
              if (d == null || !context.mounted) return;
              final t = await showTimePicker(context: context, initialTime: _at);
              if (t != null) setState(() { _day = d; _at = t; });
            },
            child: EduCard(
              padding: const EdgeInsets.all(16),
              child: Row(children: [Expanded(child: Text('gate.when'.tr, style: context.type.ts)), Text(_when(at), style: context.type.cap)]),
            ),
          ),
          const SizedBox(height: 12),
          Field(controller: _reason, label: 'gate.reason'.tr, maxLines: 2, maxLength: 300, validator: Validators.text(min: 3, max: 300)),
          const SizedBox(height: 12),
          Text('gate.who_collects'.tr, style: context.type.cap),
          const SizedBox(height: 6),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final p in people) Chip2(p.name, on: p.id == _person, onTap: () => setState(() => _person = p.id)),
            Chip2('gate.someone_else'.tr, on: _person == null, onTap: () => setState(() => _person = null)),
          ]),
          if (_person == null) ...[const SizedBox(height: 8), Field(controller: _collector, label: 'gate.their_name'.tr, maxLength: 80, validator: Validators.name)],
        ],
      ),
    );
  }
}

class _PersonSheet extends StatefulWidget {
  const _PersonSheet();

  @override
  State<_PersonSheet> createState() => _PersonSheetState();
}

class _PersonSheetState extends State<_PersonSheet> {
  GatePassController get _c => Get.find<GatePassController>();
  late final _for = {..._c.children};
  final _name = TextEditingController();
  final _relation = TextEditingController();
  final _phone = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _relation.dispose();
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SheetBody(
    padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
    footer: Obx(() => Btn('gate.add_person', expand: true, loading: _c.busy.value, onPressed: () async {
      if (!SheetBody.valid() || _for.isEmpty) return;
      final ok = await _c.addPerson(studentIds: _for.toList(), name: _name.text.trim(), relation: _relation.text.trim(), phone: _phone.text.trim());
      if (ok) Get.back<void>();
    })),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('gate.add_person'.tr, style: context.type.h2),
        const SizedBox(height: 6),
        Text('gate.add_person_body'.tr, style: context.type.s),
        const SizedBox(height: 12),
        if (_c.children.length > 1)
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final id in _c.children)
              Chip2((_c.names[id] ?? '').split(' ').first, on: _for.contains(id), onTap: () => setState(() => _for.contains(id) ? _for.remove(id) : _for.add(id))),
          ]),
        const SizedBox(height: 12),
        Field(controller: _name, label: 'gate.their_name'.tr, maxLength: 80, validator: Validators.name),
        const SizedBox(height: 8),
        Field(controller: _relation, label: 'gate.relation'.tr, hint: 'gate.relation_hint'.tr, maxLength: 40, validator: Validators.text(min: 2, max: 40)),
        const SizedBox(height: 8),
        Field(controller: _phone, label: 'gate.phone_optional'.tr, keyboard: TextInputType.phone, maxLength: 24, validator: (v) => Validators.phone(v, optional: true)),
      ],
    ),
  );
}
