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
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';

/// Visitors a member of staff invited: each is sent a pass code for reception; one still to come can be called off.
class InviteView extends GetView<InviteController> {
  const InviteView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      bottomBarHeight: 56,
      bottomBar: Btn('visitors.invite', expand: true, icon: PhosphorIconsRegular.userPlus, onPressed: () => unawaited(showSheet<void>(const _InviteSheet()))),
      children: [
        const Rise(child: PageTitle('visitors.title')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.events,
          emptyTitle: 'visitors.empty',
          emptyBody: 'visitors.empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              if (controller.invites.isEmpty) const EmptyState(art: EmptyArt.events, title: 'visitors.empty', body: 'visitors.empty_body'),
              for (final (i, v) in controller.invites.indexed)
                Rise(
                  index: i + 1,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: EduCard(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(v.name, style: context.type.ts),
                                Text(
                                  [v.purposeName, if (v.expectedOn != null) DateFormat.MMMd(Get.locale?.toLanguageTag()).format(DateTime.parse(v.expectedOn!)), if (v.code != null && v.state == 'invited') 'visitors.code_n'.trp({'code': v.code!})].join(' · '),
                                  style: context.type.cap,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 10),
                          if (v.state == 'invited' || v.state == 'pending')
                            Btn('visitors.cancel', small: true, kind: BtnKind.quiet, action: () => controller.cancel(v))
                          else
                            Chip2('visitors.state_${v.state}'.tr),
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

class _InviteSheet extends StatefulWidget {
  const _InviteSheet();

  @override
  State<_InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends State<_InviteSheet> {
  InviteController get _c => Get.find<InviteController>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  late String _purpose = _c.purposes.firstOrNull?.key ?? 'meeting';
  var _on = Clock.now();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SheetBody(
    padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
    footer: Obx(() => Btn('visitors.send_pass', expand: true, loading: _c.busy.value, onPressed: () async {
      if (!SheetBody.valid()) return;
      final ok = await _c.invite(name: _name.text.trim(), phone: _phone.text.trim(), purpose: _purpose, on: _on);
      if (ok) Get.back<void>();
    })),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('visitors.invite'.tr, style: context.type.h2),
        const SizedBox(height: 6),
        Text('visitors.invite_body'.tr, style: context.type.s),
        const SizedBox(height: 12),
        Field(controller: _name, label: 'visitors.name'.tr, help: 'field.person_name', keyboard: TextInputType.name, maxLength: 80, validator: Validators.name),
        const SizedBox(height: 8),
        Field(controller: _phone, label: 'visitors.phone'.tr, help: 'field.phone_optional', keyboard: TextInputType.phone, maxLength: 24, validator: (v) => Validators.phone(v, optional: true)),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [for (final p in _c.purposes) Chip2(p.name, on: p.key == _purpose, onTap: () => setState(() => _purpose = p.key))]),
        const SizedBox(height: 12),
        Pressable(
          label: 'visitors.day'.tr,
          onTap: () async {
            final d = await showDatePicker(context: context, firstDate: Clock.now(), lastDate: Clock.now().add(const Duration(days: 90)), initialDate: _on);
            if (d != null) setState(() => _on = d);
          },
          child: EduCard(
            padding: const EdgeInsets.all(16),
            child: Row(children: [Expanded(child: Text('visitors.day'.tr, style: context.type.ts)), Text(DateFormat.yMMMd(Get.locale?.toLanguageTag()).format(_on), style: context.type.cap)]),
          ),
        ),
      ],
    ),
  );
}
