import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/services/theme_service.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/translations/languages.dart';
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

/// A row of a list card: an icon on its small tile, the words, a value on the right and a caret (or a colour for a row
/// that ends something, like signing out).
class LinkRow extends StatelessWidget {
  const LinkRow({required this.icon, required this.label, required this.onTap, this.color, this.detail, super.key});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  /// A value: the theme in use on the right, the phone number on file under the label.
  final String? detail;

  bool get _long => (detail?.length ?? 0) > 12;

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
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(color: context.app.paper2, borderRadius: BorderRadius.circular(AppRadius.sm)),
              child: Icon(icon, size: 16, color: color ?? context.app.ink2),
            ),
            const SizedBox(width: 12),
            // A short value sits on the right; a long one (a phone number, an email) goes under the label, so neither wraps.
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts.copyWith(color: color)),
                  if (_long) Text(detail!, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
                ],
              ),
            ),
            if (!_long && detail != null && detail!.isNotEmpty) ...[
              const SizedBox(width: 12),
              Text(detail!, maxLines: 1, style: context.type.cap),
            ],
            if (color == null) ...[const SizedBox(width: 8), Icon(PhosphorIconsRegular.caretRight, size: 14, color: context.app.ink3)],
          ],
        ),
      ),
    ),
  );
}

/// Four figures, two to a row, each opening the page it comes from. Always the same height, so switching a child never
/// moves what is under them.
class _Figures extends StatelessWidget {
  const _Figures({required this.items, required this.id});

  /// What it counts, the figure, its colour (null: ink) and where a tap goes (null: no page to open).
  final List<(String, String, Color?, VoidCallback?)> items;
  final String id;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    Widget tile((String, String, Color?, VoidCallback?) f) {
      final (label, value, tone, onTap) = f;
      return Pressable(
        onTap: onTap,
        label: '${label.tr} $value',
        child: Container(
          height: 76,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.panel), border: Border.all(color: c.line)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: (value.length > 9 ? context.type.t : context.type.h2).copyWith(color: tone ?? c.ink, fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ],
          ),
        ),
      );
    }

    final four = items.take(4).toList();
    if (four.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: four.length > 2 ? 160 : 76,
      child: AnimatedSwitcher(
        duration: context.reduceMotion ? Duration.zero : AppMotion.t2,
        child: Column(
          key: ValueKey(id),
          children: [
            for (var i = 0; i < four.length; i += 2) ...[
              if (i > 0) const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(child: tile(four[i])),
                  const SizedBox(width: 8),
                  Expanded(child: i + 1 < four.length ? tile(four[i + 1]) : const SizedBox.shrink()),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The child shown: attendance this month, homework still to do, fees due and their class teacher, from Home's load.
class ChildFigures extends StatelessWidget {
  const ChildFigures({super.key});

  @override
  Widget build(BuildContext context) {
    final dash = Get.find<DashboardController>();
    return Obx(() {
      dash.state.value;
      final data = dash.snapshot;
      if (data == null) return const SizedBox(height: 160);
      // A due line names its child by id, or only by first name (fees); a line naming neither is the child's own.
      final first = data.student.name.split(' ').first;
      final mine = data.due.where((d) => d.studentId != null ? d.studentId == data.student.id : (d.childName == null || d.childName == first));
      final homework = mine.where((d) => d.kind == DueKind.homework).length;
      final fees = mine.where((d) => d.kind == DueKind.fee && !(d.installment?.paid ?? true)).fold<num>(0, (s, d) => s + d.installment!.amount);
      final marked = data.summary.present + data.summary.absent + data.summary.lateCount;
      final teacher = data.teacherNames[data.schoolClass.classTeacherId] ?? '';
      return _Figures(id: data.student.id, items: [
        if (SchoolConfig.has('attendance'))
          ('profile.tile_attendance', marked == 0 ? '—' : '${data.summary.percent.round()}%', marked == 0 ? null : AppColors.ok, () => Get.toNamed<void>(AppRoutes.attendance)),
        if (SchoolConfig.has('homework')) ('profile.fig_homework', '$homework', null, () => Get.toNamed<void>(AppRoutes.homework)),
        if (SchoolConfig.has('fees'))
          ('profile.fig_fees', fees == 0 ? 'profile.fig_none'.tr : Formatters.money(fees), fees == 0 ? null : context.app.badText, () => Get.toNamed<void>(AppRoutes.fees)),
        if (teacher.isNotEmpty) ('profile.fig_class_teacher', teacher, null, null),
      ]);
    });
  }
}

/// A teacher's figures: their classes, their lessons today, the work waiting to be graded and their own class.
class TeacherFigures extends StatelessWidget {
  const TeacherFigures({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Get.find<TeacherHomeController>();
    return Obx(() {
      t.state.value;
      if (t.teacher == null) return const SizedBox(height: 160);
      final lessons = t.today.where((p) => p.slot.kind == PeriodKind.klass).length;
      return _Figures(id: t.teacher!.id, items: [
        ('profile.fig_classes', '${t.classes.length}', null, () => ShellController.showTab('classes')),
        ('profile.fig_lessons', '$lessons', null, SchoolConfig.has('timetable') ? openTimetable : null),
        if (SchoolConfig.has('homework'))
          ('profile.fig_to_grade', '${t.waitingTotal}', t.waitingTotal > 0 ? context.app.lateText : null, () => Get.toNamed<void>(AppRoutes.teacherGrade)),
        if (t.own != null) ('profile.fig_own_class', classLabel(t.own!), null, () => ShellController.showTab('classes')),
      ]);
    });
  }
}

/// The person's own account and the app's preferences, then signing out and the app's version.
class AccountCard extends StatelessWidget {
  const AccountCard({required this.onSignOut, super.key});

  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final user = Get.find<AuthService>().user.value;
    final theme = Get.find<ThemeService>();
    Widget group(String title, List<Widget> rows) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel(title.tr),
        EduCard(
          child: Column(children: [for (final (i, r) in rows.indexed) ...[if (i > 0) const Hr(indent: 60), r]]),
        ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        group('profile.account', [
          LinkRow(
            icon: PhosphorIconsRegular.at,
            label: 'account.phone_email',
            detail: (user?.phone.isNotEmpty ?? false) ? user!.phone : user?.email,
            onTap: () => unawaited(showContactChange()),
          ),
          // Staff sign in with a password; families sign in with a code and have none to change.
          if (user?.role == UserRole.teacher)
            LinkRow(icon: PhosphorIconsRegular.password, label: 'auth.change_password', onTap: () => unawaited(showChangePassword())),
          LinkRow(icon: PhosphorIconsRegular.bell, label: 'menu.notifications', onTap: () => Get.toNamed<void>(AppRoutes.notifications)),
          LinkRow(icon: PhosphorIconsRegular.devices, label: 'account.devices', onTap: () => unawaited(showDevices())),
          LinkRow(icon: PhosphorIconsRegular.shieldCheck, label: 'privacy.title', onTap: () => unawaited(showPrivacy())),
          LinkRow(icon: PhosphorIconsRegular.signOut, label: 'auth.sign_out_everywhere', onTap: () => unawaited(signOutEverywhere())),
        ]),
        Obx(
          () => group('profile.this_app', [
            LinkRow(
              icon: PhosphorIconsRegular.globe,
              label: 'settings.language',
              detail: kLanguageNames[theme.locale.value.languageCode] ?? '',
              onTap: () => Get.toNamed<void>(AppRoutes.settings),
            ),
            LinkRow(
              icon: PhosphorIconsRegular.moon,
              label: 'settings.theme',
              detail: switch (theme.mode.value) {
                AppThemeMode.light => 'settings.theme_chalk'.tr,
                AppThemeMode.amoled => 'settings.theme_amoled'.tr,
                AppThemeMode.system => 'settings.theme_auto'.tr,
              },
              onTap: () => Get.toNamed<void>(AppRoutes.settings),
            ),
            LinkRow(icon: PhosphorIconsRegular.slidersHorizontal, label: 'menu.settings', onTap: () => Get.toNamed<void>(AppRoutes.settings)),
            LinkRow(icon: PhosphorIconsRegular.question, label: 'profile.help', onTap: () => Get.toNamed<void>(AppRoutes.help)),
          ]),
        ),
        const SizedBox(height: 24),
        Pressable(
          onTap: onSignOut,
          label: 'common.logout'.tr,
          child: Container(
            height: 52,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: c.line2, width: 1.5)),
            child: Center(child: Text('common.logout'.tr, style: AppText.label(color: c.badText))),
          ),
        ),
        const SizedBox(height: 12),
        Center(child: Text('Tangent · ${AppConfig.schoolName} · ${AppConfig.version}', textAlign: TextAlign.center, style: context.type.tiny)),
      ],
    );
  }
}
