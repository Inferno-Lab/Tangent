import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/view_state.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/auth/views/account_sheets.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/widgets/child_switcher.dart' show classLine;
import 'package:tangent/features/dashboard/widgets/parent_home.dart' show childColour;
import 'package:tangent/features/profile/controllers/profile_controller.dart';
import 'package:tangent/features/profile/views/id_card.dart';
import 'package:tangent/features/profile/views/profile_sections.dart';
import 'package:tangent/features/settings/views/settings_view.dart' show signOut;

/// Profile as the approved canvas: who you are, your children (a parent), the school ID card on the page, a few figures,
/// your account and the app, then signing out. The card and the figures keep their size while a child is switched, so
/// nothing below them moves.
class ProfileView extends GetView<ProfileController> {
  const ProfileView({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthService>();
    return Obx(() {
      final state = controller.state.value;
      final user = auth.user.value;
      final role = user?.role;
      final student = controller.student;
      final teacher = controller.teacher;
      // Reloading keeps what is shown (a child switch reloads): the skeleton is for the first load only.
      final shown = student != null || teacher != null;
      final view = state == ViewState.loading && shown ? ViewState.success : state;
      return PageFrame(
        dockPage: true,
        topPadding: MediaQuery.paddingOf(context).top + 16,
        onRefresh: controller.load,
        children: [
          _Header(user: user, controller: controller),
          ViewStateView(
            skeleton: const SkeletonCards(),
            state: view,
            onRetry: controller.load,
            errorKey: controller.errorMessage.value,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (role == UserRole.parent) const Rise(index: 1, child: _ChildPicker()),
                const SizedBox(height: 16),
                if (shown)
                  Rise(
                    index: 2,
                    child: AnimatedSwitcher(
                      duration: context.reduceMotion ? Duration.zero : AppMotion.t2,
                      child: KeyedSubtree(key: ValueKey(student?.id ?? teacher?.id), child: _card(context, role, user)),
                    ),
                  ),
                const SizedBox(height: 16),
                Rise(index: 3, child: role == UserRole.teacher ? const TeacherFigures() : const ChildFigures()),
                if (student != null && role == UserRole.student) Rise(index: 4, child: _Guardian(controller: controller)),
                if (user != null) Rise(index: 4, child: AccountCard(onSignOut: () => unawaited(signOut()))),
              ],
            ),
          ),
        ],
      );
    });
  }

  Widget _card(BuildContext context, UserRole? role, AppUser? user) {
    final student = controller.student;
    final teacher = controller.teacher;
    final now = Clock.now();
    final start = now.month >= 6 ? now.year : now.year - 1;
    final year = '$start–${(start + 1) % 100}';
    if (student != null) {
      final family = [for (final k in Get.find<DashboardController>().snapshot?.children ?? const <ChildToday>[]) k.student.name];
      final id = student.admissionNo.isNotEmpty ? student.admissionNo : '${(controller.schoolClass?.label ?? '').replaceAll(' ', '')}-${student.rollNo}';
      return IdBadge(
        accent: childColour(student.name, family.isEmpty ? [student.name] : family),
        school: AppConfig.schoolName,
        kind: 'profile.kind_student'.tr,
        name: student.name,
        line: [if (controller.schoolClass != null) classLine(controller.schoolClass!.label), 'fees.roll'.trp({'n': student.rollNo})].join(' · '),
        fields: [('profile.id_number'.tr, id), ('profile.blood'.tr, student.bloodGroup), ('profile.year'.tr, year)],
        code: controller.pickupCode ?? id,
        codeTitle: controller.pickupCode == null ? 'profile.id_number'.tr : 'profile.pickup_code'.tr,
        back: [
          if (controller.pickups.isNotEmpty) ('profile.pickup'.tr, controller.pickups.map((p) => p.name).join(', ')),
          ('profile.guardian'.tr, [student.guardianName, student.guardianPhone].where((x) => x.isNotEmpty).join(' · ')),
          if (student.house.isNotEmpty) ('profile.house'.tr, student.house),
        ],
        photo: role == UserRole.student ? user?.avatarUrl : null,
      );
    }
    final t = teacher!;
    final code = t.id.toUpperCase().replaceAll('_', '-');
    return IdBadge(
      accent: AppColors.subject(t.subject).fill,
      school: AppConfig.schoolName,
      kind: 'profile.kind_staff'.tr,
      name: t.name,
      line: 'profile.teacher_of'.trp({'subject': subjectName(t.subject)}),
      fields: [('profile.id_number'.tr, code), ('profile.subject'.tr, subjectName(t.subject)), ('profile.year'.tr, year)],
      code: code,
      codeTitle: 'profile.id_number'.tr,
      back: [
        ('profile.classes'.tr, controller.teaching.map((c) => c.label).join(', ')),
        if (t.phone.isNotEmpty) ('profile.phone'.tr, t.phone),
      ],
      photo: user?.avatarUrl,
    );
  }
}

/// You: your photo (with a button to change it where the school keeps one), your name, what you are here, and Edit.
class _Header extends StatelessWidget {
  const _Header({required this.user, required this.controller});

  final AppUser? user;
  final ProfileController controller;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final u = user;
    if (u == null) return const SizedBox.shrink();
    final role = u.role;
    final teacher = controller.teacher;
    final kids = Get.find<DashboardController>().snapshot?.children ?? const <ChildToday>[];
    final line = switch (role) {
      UserRole.parent => kids.isEmpty
          ? 'profile.parent'.tr
          : 'profile.parent_of'.trp({'names': kids.map((k) => k.student.name.split(' ').first).join(', ')}),
      UserRole.teacher => teacher == null ? 'profile.teacher'.tr : 'profile.teacher_of'.trp({'subject': subjectName(teacher.subject)}),
      _ => controller.schoolClass == null ? '' : classLine(controller.schoolClass!.label),
    };
    final photo = u.avatarUrl;
    final local = photo.isNotEmpty && !photo.startsWith('http');
    final canPhoto = role == UserRole.teacher || role == UserRole.student;
    return Row(
      children: [
        SizedBox(
          width: 64,
          height: 64,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              if (local)
                ClipOval(child: Image.file(File(photo), width: 60, height: 60, fit: BoxFit.cover, errorBuilder: (_, _, _) => Avatar(u.name, size: 60)))
              else
                Avatar(u.name, size: 60, background: role == UserRole.teacher && teacher != null ? AppColors.subject(teacher.subject).fill : c.brand, foreground: c.onBrand),
              if (canPhoto)
                PositionedDirectional(
                  end: -2,
                  bottom: -2,
                  child: Pressable(
                    onTap: () => unawaited(controller.editPhoto()),
                    label: 'profile.new_photo'.tr,
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(color: c.brand, shape: BoxShape.circle, border: Border.all(color: c.chalk, width: 3)),
                      child: Icon(PhosphorIconsBold.camera, size: 14, color: c.onBrand),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(u.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.type.h2),
              if (line.isNotEmpty) Text(line, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.s.copyWith(color: c.ink3)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Pressable(
          onTap: () => unawaited(showContactChange()),
          label: 'profile.edit'.tr,
          child: Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: c.line2)),
            child: Center(widthFactor: 1, child: Text('profile.edit'.tr, style: AppText.chip(color: c.ink, height: 1))),
          ),
        ),
      ],
    );
  }
}

/// A family with more than one child: each child on one track, the one shown raised. Switching keeps the page still.
class _ChildPicker extends StatelessWidget {
  const _ChildPicker();

  @override
  Widget build(BuildContext context) {
    final dash = Get.find<DashboardController>();
    final auth = Get.find<AuthService>();
    return Obx(() {
      dash.state.value;
      final kids = dash.snapshot?.children ?? const <ChildToday>[];
      final active = auth.activeStudentId.value;
      if (kids.length < 2) return const SizedBox.shrink();
      final c = context.app;
      final family = [for (final k in kids) k.student.name];
      // The children as tabs on a sunken track, as the app's segmented choices in a sheet: the chosen one raised on paper.
      return Padding(
        padding: const EdgeInsets.only(top: 24),
        child: Container(
          height: 60,
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: c.paper3,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: c.line),
          ),
          child: LayoutBuilder(
            builder: (context, box) {
              // The class only where a tab has room for it beside the name (two children on a phone; not four).
              final roomy = (box.maxWidth - 4 * (kids.length - 1)) / kids.length >= 150;
              return Row(
                children: [
                  for (final (i, k) in kids.indexed) ...[
                    if (i > 0) const SizedBox(width: 4),
                    Expanded(
                      child: Pressable(
                        onTap: k.student.id == active ? null : () => unawaited(auth.switchChild(k.student.id)),
                        label: k.student.name,
                        child: AnimatedContainer(
                          duration: AppMotion.t2,
                          curve: kEase,
                          padding: const EdgeInsetsDirectional.only(start: 6, end: 12),
                          decoration: BoxDecoration(
                            color: k.student.id == active ? c.paper : Colors.transparent,
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                            border: Border.all(color: k.student.id == active ? c.line2 : Colors.transparent),
                            boxShadow: k.student.id == active ? [BoxShadow(color: c.shadow, blurRadius: 10, offset: const Offset(0, 2))] : null,
                          ),
                          child: Row(
                            children: [
                              Avatar(k.student.name, size: 36, initials: Avatar.siblingInitials(k.student.name, family), background: childColour(k.student.name, family), foreground: AppColors.white),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      k.student.name.split(' ').first,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: AppText.ts(color: k.student.id == active ? c.ink : c.ink2, height: 1.15),
                                    ),
                                    if (roomy) Text(k.schoolClass.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.tiny(color: c.ink3, height: 1.2)),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      );
    });
  }
}

/// A student's own guardian (a student signs in where the console turns their role on).
class _Guardian extends StatelessWidget {
  const _Guardian({required this.controller});

  final ProfileController controller;

  @override
  Widget build(BuildContext context) {
    final s = controller.student!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel('profile.guardian_title'.tr),
        EduCard(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Avatar(s.guardianName, size: 32, background: context.app.paper2, foreground: context.app.ink),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${s.guardianName} · ${'profile.guardian'.tr}', style: context.type.ts),
                      Text(s.guardianPhone, style: context.type.cap),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
