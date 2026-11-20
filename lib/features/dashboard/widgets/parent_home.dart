import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/status.dart';
import 'package:tangent/core/widgets/app_icons.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart' show daysStamp;
import 'package:tangent/features/dashboard/widgets/home_cards.dart' show openFees;

/// A Home section's heading: its name, and a quiet count or link on the right. 24 above, 12 below (the spacing rule).
class HomeHeading extends StatelessWidget {
  const HomeHeading(this.title, {this.trailing, super.key});

  final String title;
  final String? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24, bottom: 12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.h3)),
        if (trailing != null) Text(trailing!, style: context.type.s.copyWith(color: context.app.ink3)),
      ],
    ),
  );
}

/// Quick tiles four to a row, each an icon on its colour's soft fill over its whole name (two lines when it needs them).
class QuickTiles extends StatelessWidget {
  const QuickTiles({required this.items, super.key});

  /// Icon, translation key, tap, and the spectrum colour of its tile.
  final List<(IconData, String, VoidCallback?, String)> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, box) {
        // Four to a row on a phone; wider screens keep tiles about the same size.
        final per = (box.maxWidth / 92).floor().clamp(4, 8);
        final w = (box.maxWidth - 8 * (per - 1)) / per;
        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [for (final item in items) SizedBox(width: w, child: _tile(context, item))],
        );
      },
    );
  }

  Widget _tile(BuildContext context, (IconData, String, VoidCallback?, String) item) {
    final c = context.app;
    final (icon, key, onTap, colour) = item;
    final tone = colour == 'brand' ? (c.mariSoft, c.mariText) : (c.spectrumFor(colour).soft, c.spectrumFor(colour).ink);
    return Pressable(
      onTap: onTap,
      label: key.tr,
      child: Opacity(
        opacity: onTap == null ? .5 : 1,
        child: Container(
          constraints: const BoxConstraints(minHeight: 84),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
          decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.panel), border: Border.all(color: c.line)),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: tone.$1, borderRadius: BorderRadius.circular(AppRadius.md)),
                child: Icon(icon, size: 18, color: tone.$2),
              ),
              const SizedBox(height: 8),
              Text(key.tr, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: AppText.capB(color: c.ink, height: 1.15)),
            ],
          ),
        ),
      ),
    );
  }
}

/// What needs the parent for the child shown: fees due (each with its Pay button) and homework due this week.
class NeedsYou extends StatelessWidget {
  const NeedsYou({required this.data, super.key});

  final HomeSnapshot data;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final first = data.student.name.split(' ').first;
    final mine = data.due
        .where((d) => d.kind != DueKind.event)
        // Only what the school's modules cover (a school without fees on the app shows no fee here).
        .where((d) => d.kind == DueKind.fee ? SchoolConfig.has('fees') : SchoolConfig.has('homework'))
        .where((d) => d.studentId != null ? d.studentId == data.student.id : (d.childName == null || d.childName == first))
        .take(3)
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HomeHeading('home.needs_you'.tr, trailing: mine.isEmpty ? 'home.nothing'.tr : 'home.n_things'.trn(mine.length)),
        if (mine.isEmpty)
          EduCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                _Tile(icon: PhosphorIconsBold.check, soft: c.okSoft, ink: c.okText),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('home.all_clear_for'.trp({'name': first}), style: context.type.t),
                      Text('home.all_clear_body'.tr, style: context.type.cap),
                    ],
                  ),
                ),
              ],
            ),
          )
        else
          for (final (i, d) in mine.indexed) ...[
            if (i > 0) const SizedBox(height: 8),
            if (d.kind == DueKind.fee) _FeeCard(item: d) else _HomeworkRow(item: d, teacher: data.teacherNames[d.homework!.teacherId]),
          ],
      ],
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.soft, required this.ink});

  final IconData icon;
  final Color soft;
  final Color ink;

  @override
  Widget build(BuildContext context) => Container(
    width: 40,
    height: 40,
    decoration: BoxDecoration(color: soft, borderRadius: BorderRadius.circular(AppRadius.md)),
    child: Icon(icon, size: 18, color: ink),
  );
}

class _FeeCard extends StatelessWidget {
  const _FeeCard({required this.item});

  final DueItem item;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final fee = item.installment!;
    final overdue = moneyStatus(fee) == MoneyStatus.overdue;
    final days = Formatters.daysUntil(fee.dueDate);
    final when = overdue ? 'home.days_late'.trn(-days) : 'home.due_in'.trp({'when': daysStamp(fee.dueDate).toLowerCase()});
    return EduCard(
      onTap: () => unawaited(openFees(item)),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Tile(icon: AppIcons.fees, soft: overdue ? c.badSoft : c.lateSoft, ink: overdue ? c.badText : c.lateText),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(fee.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.type.t),
                    Text(when, style: context.type.capB.copyWith(color: overdue ? c.badText : c.lateText)),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(Formatters.money(fee.amount), style: context.type.num),
            ],
          ),
          const SizedBox(height: 16),
          Btn('home.pay_amount'.trp({'amount': Formatters.money(fee.amount)}), expand: true, onPressed: () => unawaited(openFees(item, pay: true))),
        ],
      ),
    );
  }
}

class _HomeworkRow extends StatelessWidget {
  const _HomeworkRow({required this.item, required this.teacher});

  final DueItem item;
  final String? teacher;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final hw = item.homework!;
    final tone = c.subjectFor(hw.subject);
    return EduCard(
      onTap: () => Get.toNamed<void>(AppRoutes.homeworkDetail.replaceFirst(':id', hw.id)),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: [
          _Tile(icon: AppIcons.homework, soft: tone.soft, ink: tone.ink),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(hw.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t),
                Text(
                  [subjectName(hw.subject), if (teacher != null && teacher!.isNotEmpty) teacher!].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.type.cap,
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Stamp(daysStamp(hw.dueOn), color: c.lateText),
        ],
      ),
    );
  }
}

/// The next few dates for the family: a date block in the colour the item borrows, the title, and a button where there is
/// something to do (book a meeting, reply to an event).
class ComingUp extends StatelessWidget {
  const ComingUp({required this.items, super.key});

  final List<UpcomingItem> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final c = context.app;
    final lang = Get.locale?.languageCode;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        HomeHeading('home.coming_up'.tr),
        EduCard(
          child: Column(
            children: [
              for (final (i, u) in items.indexed) ...[
                if (i > 0) const Hr(indent: 78),
                Pressable(
                  onTap: () => Get.toNamed<void>(u.route),
                  scale: .985,
                  label: u.title,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      children: [
                        Container(
                          width: 48,
                          height: 52,
                          decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(AppRadius.md)),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(DateFormat('EEE', lang).format(u.date).toUpperCase(), style: AppText.o(color: c.subjectFor(u.subject).ink)),
                              const SizedBox(height: 2),
                              Text('${u.date.day}', style: AppText.num(color: c.ink)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(u.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t),
                              if (u.sub.isNotEmpty) Text(u.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
                            ],
                          ),
                        ),
                        if (u.action != null) ...[
                          const SizedBox(width: 10),
                          Container(
                            height: 32,
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            decoration: BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: c.line2)),
                            child: Center(widthFactor: 1, child: Text(u.action!.tr, style: AppText.capB(color: c.ink, height: 1))),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// The other child (the first of the others), with a glance at their day and a Switch.
class SiblingRow extends StatelessWidget {
  const SiblingRow({required this.data, super.key});

  final HomeSnapshot data;

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthService>();
    final others = data.children.where((k) => k.student.id != data.student.id).toList();
    if (others.isEmpty) return const SizedBox.shrink();
    final c = context.app;
    final family = [for (final k in data.children) k.student.name];
    return Column(
      children: [
        for (final k in others) ...[
          const SizedBox(height: 16),
          Pressable(
            onTap: () => unawaited(auth.switchChild(k.student.id)),
            label: 'home.switch_to'.trp({'name': k.student.name.split(' ').first}),
            child: CustomPaint(
              foregroundPainter: _Dashed(c.line2),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  children: [
                    Avatar(k.student.name, size: 36, initials: Avatar.siblingInitials(k.student.name, family), background: childColour(k.student.name, family)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${k.student.name.split(' ').first} · ${k.schoolClass.label}', maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts),
                          Text(_glance(k), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
                        ],
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text('home.switch'.tr, style: AppText.capB(color: c.mariText)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }

  String _glance(ChildToday k) {
    final first = k.student.name.split(' ').first;
    final due = data.due.where((d) => d.kind != DueKind.event && (d.studentId ?? '') == k.student.id || (d.studentId == null && d.childName == first)).length;
    final status = switch (k.status) {
      AttendanceStatus.present => 'home.status_present'.tr,
      AttendanceStatus.lateArrival => 'home.status_late'.tr,
      AttendanceStatus.absent => 'home.status_absent'.tr,
      AttendanceStatus.holiday => 'home.status_holiday'.tr,
      null => 'home.status_not_marked'.tr,
    };
    return '$status · ${due == 0 ? 'home.nothing_due_short'.tr : 'home.n_due'.trn(due)}';
  }
}

/// Each child keeps one avatar colour across Home and Profile: the family's order picks it.
Color childColour(String name, List<String> family) {
  const order = ['blue', 'pink', 'green', 'amber', 'teal', 'indigo'];
  final i = family.indexOf(name);
  return AppColors.spectrum(order[(i < 0 ? 0 : i) % order.length]).fill;
}

/// The dashed outline of the other child's row (a place to go, not a card).
class _Dashed extends CustomPainter {
  _Dashed(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()..addRRect(RRect.fromRectAndRadius((Offset.zero & size).deflate(.5), const Radius.circular(AppRadius.card)));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke;
    for (final m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 9) {
        canvas.drawPath(m.extractPath(d, d + 5), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_Dashed old) => old.color != color;
}
