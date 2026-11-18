import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/features/teacher_tools/controllers/roster_controller.dart';
import 'package:url_launcher/url_launcher.dart';

/// A class's students for its teachers: roll number, name, and each student's record on a tap (house, guardian to call).
class RosterView extends GetView<RosterController> {
  const RosterView({super.key});

  Future<void> _open(Student s) async {
    try {
      final full = await controller.profile(s.id);
      await showSheet<void>(_StudentSheet(student: full));
    } on AppException catch (e) {
      ToastHelper.show(e.message, kind: ToastKind.error);
    }
  }

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    final list = controller.shown;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      children: [
        Rise(child: PageTitle('teacher.roster', subtitle: 'teacher.roster_n'.trn(controller.students.length))),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.teacher,
          emptyTitle: 'teacher.roster_empty',
          emptyBody: 'teacher.roster_empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Field(label: 'teacher.roster_search'.tr, icon: PhosphorIconsRegular.magnifyingGlass, onChanged: (v) => controller.query.value = v),
              const SizedBox(height: 12),
              EduCard(
                child: Column(
                  children: [
                    if (list.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text('teacher.roster_none_match'.tr, style: context.type.s)),
                    for (final (i, s) in list.indexed) ...[
                      if (i > 0) const Hr(indent: 56),
                      Pressable(
                        onTap: () => unawaited(_open(s)),
                        label: s.name,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Row(
                            children: [
                              SizedBox(width: 32, child: Text(s.rollNo, style: context.type.cap)),
                              const SizedBox(width: 8),
                              Expanded(child: Text(s.name, style: context.type.ts, maxLines: 1, overflow: TextOverflow.ellipsis)),
                              Icon(PhosphorIconsRegular.caretRight, size: 18, color: context.app.ink3),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  });
}

class _StudentSheet extends StatelessWidget {
  const _StudentSheet({required this.student});

  final Student student;

  @override
  Widget build(BuildContext context) {
    final s = student;
    final rows = <(String, String)>[
      if (s.admissionNo.isNotEmpty) ('teacher.admission_no', s.admissionNo),
      if (s.rollNo.isNotEmpty) ('teacher.roll_no', s.rollNo),
      if (s.house.isNotEmpty) ('teacher.house', s.house),
      if (s.bloodGroup.isNotEmpty) ('teacher.blood_group', s.bloodGroup),
      if (s.guardianName.isNotEmpty) ('teacher.guardian', s.guardianName),
      for (final f in s.fields.entries) (f.key, f.value),
    ];
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: s.guardianPhone.isEmpty
          ? null
          : Btn('teacher.call_guardian', expand: true, icon: PhosphorIconsRegular.phone,
              onPressed: () => unawaited(launchUrl(Uri(scheme: 'tel', path: s.guardianPhone)))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(s.name, style: context.type.h2),
          if (s.nameLocal.isNotEmpty) Text(s.nameLocal, style: context.type.s),
          const SizedBox(height: 12),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(child: Text(r.$1.tr, style: context.type.cap)),
                  Flexible(child: Text(r.$2, style: context.type.ts, textAlign: TextAlign.end)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
