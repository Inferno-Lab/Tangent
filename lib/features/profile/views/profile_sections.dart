import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/auth/views/account_sheets.dart';
import 'package:tangent/features/auth/views/password_sheets.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart' show openTimetable;
import 'package:tangent/features/settings/views/privacy_sheet.dart';
import 'package:tangent/features/shell/shell_controller.dart';
import 'package:tangent/features/teacher_tools/controllers/teacher_controller.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// A row of a list card: an icon, the words, and a caret (or a colour for a row that ends something, like signing out).
class LinkRow extends StatelessWidget {
  const LinkRow({required this.icon, required this.label, required this.onTap, this.color, this.detail, super.key});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  /// A short value on the right (the phone number on file, the theme in use).
  final String? detail;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    scale: .985,
    label: label.tr,
    child: ConstrainedBox(
      // 44 pt at least: a row is a tap target.
      constraints: const BoxConstraints(minHeight: 56),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(icon, size: 20, color: color ?? context.app.ink2),
            const SizedBox(width: 12),
            Expanded(child: Text(label.tr, style: context.type.ts.copyWith(color: color))),
            if (detail != null && detail!.isNotEmpty) ...[
              const SizedBox(width: 12),
              Flexible(child: Text(detail!, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end, style: context.type.cap)),
            ],
            if (color == null) ...[const SizedBox(width: 8), Icon(PhosphorIconsRegular.caretRight, size: 16, color: context.app.ink3)],
          ],
        ),
      ),
    ),
  );
}

/// Three figures side by side in one card, each opening the page it comes from.
class _Figures extends StatelessWidget {
  const _Figures({required this.items});

  /// The figure, what it counts, and where a tap goes (null: no page to open).
  final List<(String, String, VoidCallback?)> items;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return EduCard(
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (i, (value, label, onTap)) in items.indexed) ...[
              if (i > 0) VerticalDivider(width: 1, thickness: 1, indent: 16, endIndent: 16, color: c.line),
              Expanded(
                child: Pressable(
                  onTap: onTap,
                  label: '$value ${label.tr}',
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 16, 12, 16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FittedBox(fit: BoxFit.scaleDown, child: Text(value, maxLines: 1, style: context.type.h2.copyWith(fontFeatures: const [FontFeature.tabularFigures()]))),
                        const SizedBox(height: 4),
                        Text(label.tr, maxLines: 2, textAlign: TextAlign.center, style: context.type.cap),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The child shown: their attendance this month, homework still to do and fees due, from the same load as Home.
class ChildFigures extends StatelessWidget {
  const ChildFigures({super.key});

  @override
  Widget build(BuildContext context) {
    final dash = Get.find<DashboardController>();
    return Obx(() {
      dash.state.value;
      final data = dash.snapshot;
      if (data == null) return const SizedBox.shrink();
      // A due line names its child by id, or only by first name (fees); a line naming neither is the child's own.
      final first = data.student.name.split(' ').first;
      final mine = data.due.where((d) => d.studentId != null ? d.studentId == data.student.id : (d.childName == null || d.childName == first));
      final homework = mine.where((d) => d.kind == DueKind.homework).length;
      final fees = mine.where((d) => d.kind == DueKind.fee && !(d.installment?.paid ?? true)).fold<num>(0, (s, d) => s + d.installment!.amount);
      final marked = data.summary.present + data.summary.absent + data.summary.lateCount;
      return _Figures(items: [
        if (SchoolConfig.has('attendance'))
          (marked == 0 ? '—' : '${data.summary.percent.round()}%', 'profile.fig_attendance', () => Get.toNamed<void>(AppRoutes.attendance)),
        if (SchoolConfig.has('homework')) ('$homework', 'profile.fig_homework', () => Get.toNamed<void>(AppRoutes.homework)),
        if (SchoolConfig.has('fees')) (fees == 0 ? '—' : Formatters.money(fees), fees == 0 ? 'profile.fig_no_fees' : 'profile.fig_fees', () => Get.toNamed<void>(AppRoutes.fees)),
      ]);
    });
  }
}

/// A teacher's figures: their classes, their lessons today and the work waiting to be graded.
class TeacherFigures extends StatelessWidget {
  const TeacherFigures({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Get.find<TeacherHomeController>();
    return Obx(() {
      t.state.value;
      if (t.teacher == null) return const SizedBox.shrink();
      final lessons = t.today.where((p) => p.slot.kind == PeriodKind.klass).length;
      return _Figures(items: [
        ('${t.classes.length}', 'profile.fig_classes', () => ShellController.showTab('classes')),
        ('$lessons', 'profile.fig_lessons', SchoolConfig.has('timetable') ? openTimetable : null),
        if (SchoolConfig.has('homework')) ('${t.waitingTotal}', 'profile.fig_to_grade', () => Get.toNamed<void>(AppRoutes.teacherGrade)),
      ]);
    });
  }
}

/// A family with more than one child at the school: each child, the one shown marked, a tap to show another.
class ChildrenRow extends StatelessWidget {
  const ChildrenRow({super.key});

  @override
  Widget build(BuildContext context) {
    final dash = Get.find<DashboardController>();
    final auth = Get.find<AuthService>();
    return Obx(() {
      dash.state.value;
      final kids = dash.snapshot?.children ?? const [];
      final active = auth.activeStudentId.value;
      if (kids.length < 2) return const SizedBox.shrink();
      final c = context.app;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionLabel('profile.your_children'.tr),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final k in kids)
                Pressable(
                  onTap: k.student.id == active ? null : () => unawaited(auth.switchChild(k.student.id)),
                  label: k.student.name,
                  child: AnimatedContainer(
                    duration: AppMotion.t2,
                    height: 48,
                    padding: const EdgeInsets.fromLTRB(6, 6, 16, 6),
                    decoration: BoxDecoration(
                      color: k.student.id == active ? c.ink : c.paper,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      border: Border.all(color: k.student.id == active ? c.ink : c.line2),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Avatar(k.student.name, size: 36, initials: Avatar.siblingInitials(k.student.name, [for (final x in kids) x.student.name])),
                        const SizedBox(width: 8),
                        Text(k.student.name.split(' ').first, style: context.type.ts.copyWith(color: k.student.id == active ? c.chalk : c.ink)),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ],
      );
    });
  }
}

/// The person's own account: how they are reached, their password (staff), where they are signed in, their data, signing
/// out. The app's own preferences (look, language, alerts) stay in Settings.
class AccountCard extends StatelessWidget {
  const AccountCard({required this.onSignOut, super.key});

  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final user = Get.find<AuthService>().user.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel('profile.account'.tr),
        EduCard(
          child: Column(
            children: [
              LinkRow(icon: PhosphorIconsRegular.at, label: 'account.phone_email', detail: (user?.phone.isNotEmpty ?? false) ? user!.phone : user?.email, onTap: () => unawaited(showContactChange())),
              const Hr(indent: 48),
              // Staff sign in with a password; families sign in with a code and have none to change.
              if (user?.role == UserRole.teacher) ...[
                LinkRow(icon: PhosphorIconsRegular.password, label: 'auth.change_password', onTap: () => unawaited(showChangePassword())),
                const Hr(indent: 48),
              ],
              LinkRow(icon: PhosphorIconsRegular.devices, label: 'account.devices', onTap: () => unawaited(showDevices())),
              const Hr(indent: 48),
              LinkRow(icon: PhosphorIconsRegular.bell, label: 'menu.notifications', onTap: () => Get.toNamed<void>(AppRoutes.notifications)),
              const Hr(indent: 48),
              LinkRow(icon: PhosphorIconsRegular.shieldCheck, label: 'privacy.title', onTap: () => unawaited(showPrivacy())),
              const Hr(indent: 48),
              LinkRow(icon: PhosphorIconsRegular.signOut, label: 'auth.sign_out_everywhere', onTap: () => unawaited(signOutEverywhere())),
            ],
          ),
        ),
        const SizedBox(height: 12),
        EduCard(child: LinkRow(icon: PhosphorIconsRegular.signOut, label: 'common.logout', color: c.badText, onTap: onSignOut)),
      ],
    );
  }
}
