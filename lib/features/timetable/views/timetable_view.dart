import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/utils/calendar.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/features/timetable/controllers/timetable_controller.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class TimetableView extends GetView<TimetableController> {
  const TimetableView({super.key});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final index = controller.dayIndex.value;
      final day = controller.selected;
      final cls = controller.schoolClass;
      final classes = day?.periods.where((p) => p.kind == PeriodKind.klass).length ?? 0;
      // A dock tab (a teacher's or a family's, as the console sets it) has no way back; the page opened from Home does.
      final tab = ModalRoute.of(context)?.settings.name != AppRoutes.timetable;
      return PageFrame(
        leading: tab ? null : const BackGlass(),
        dockPage: tab,
        actions: [
          GlassIconButton(
            icon: PhosphorIconsRegular.calendarPlus,
            label: 'timetable.add_calendar'.tr,
            onTap: () => unawaited(addLessonsToCalendar(classId: controller.schoolClass?.id)),
          ),
        ],
        onRefresh: controller.load,
        bottomBarHeight: 60,
        bottomBar: _DayPicker(controller: controller, index: index),
        children: [
          PageTitle(
            controller.dateOf(index) == null || !const ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].contains(controller.keys[index])
                ? controller.dayLabel(index)
                : DateFormat('EEEE').format(controller.dateOf(index)!),
            subtitle: cls == null
                ? (controller.forTeacher && day != null ? 'timetable.lessons'.trn(classes) : null)
                : 'timetable.subtitle'.trp({
                    'class': cls.label,
                    'room': roomLabel(cls.room),
                    'n': '$classes',
                  }),
          ),
          const SizedBox(height: 16),
          ViewStateView(
            state: controller.state.value,
            onRetry: controller.load,
            errorKey: controller.errorMessage.value,
            emptyTitle: 'timetable.empty',
            emptyBody: 'timetable.empty_body',
            emptyArt: EmptyArt.timetable,
            emptyHint: 'timetable.empty_hint',
            child: day == null || day.periods.isEmpty
                ? const EmptyState(art: EmptyArt.timetable, title: 'timetable.free_day', body: 'timetable.free_day_body')
                : _Timeline(controller: controller, day: day),
          ),
        ],
      );
    });
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.controller, required this.day});

  final TimetableController controller;
  final TimetableDay day;

  static const k = 1.6;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final periods = day.periods;
    final start = minutesOf(periods.first.start);
    final end = minutesOf(periods.last.end);
    final now = nowMinutes();
    final showNow = controller.isToday && now >= start && now <= end;
    double y(int m) => (m - start) * k;
    return SizedBox(
      height: (end - start) * k + 10,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Time between lessons (a teacher's free periods; a class's gaps) reads as free, never as blank page.
          for (final (i, p) in periods.indexed)
            if (i > 0 && minutesOf(p.start) - minutesOf(periods[i - 1].end) >= 15)
              Positioned(
                left: 44,
                right: 0,
                top: y(minutesOf(periods[i - 1].end)) + 2,
                height: (minutesOf(p.start) - minutesOf(periods[i - 1].end)) * k - 6,
                child: _Free(minutes: minutesOf(p.start) - minutesOf(periods[i - 1].end)),
              ),
          for (final p in periods) ...[
            if (p.kind == PeriodKind.klass)
              Positioned(
                left: 0,
                top: y(minutesOf(p.start)) - 6,
                child: Text(clockOf(minutesOf(p.start)), style: context.type.mono),
              ),
            Positioned(
              left: 44,
              right: 0,
              top: y(minutesOf(p.start)),
              height: (minutesOf(p.end) - minutesOf(p.start)) * k - 2,
              child: _Block(period: p, controller: controller, past: controller.isToday && minutesOf(p.end) <= now),
            ),
          ],
          if (showNow) ...[
            Positioned(
              left: 32,
              right: -8,
              top: y(now) - 1,
              height: 2,
              child: ColoredBox(color: c.ink),
            ),
            Positioned(
              left: -12,
              top: y(now) - 9,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(7)),
                child: Text(clockOf(now), style: context.type.mono.copyWith(color: c.chalk)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({required this.period, required this.controller, required this.past});

  final PeriodSlot period;
  final TimetableController controller;
  final bool past;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    if (period.kind != PeriodKind.klass) {
      final mins = minutesOf(period.end) - minutesOf(period.start);
      return Hatch(
        radius: BorderRadius.circular(12),
        background: c.paper2,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'timetable.break_line'.trp({'name': subjectName(period.subject), 'n': '$mins'}),
              style: context.type.tiny,
            ),
          ),
        ),
      );
    }
    final cls = controller.classOf[period];
    final pigment = cls != null ? AppColors.classColour(cls.id) : AppColors.subject(period.subject);
    final now = controller.isNow(period);
    final hw = controller.homeworkDue.contains(period.subject);
    // A teacher's block names the class; a family's the teacher.
    final teacher = controller.classOf[period]?.label ?? controller.teachers[period.teacherId];
    final block = Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: pigment.fill, borderRadius: BorderRadius.circular(12)),
      child: Stack(
        children: [
          Positioned.fill(child: SubjectMotif(subject: period.subject, color: pigment.on)),
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                subjectName(period.subject),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.t(color: pigment.on, height: 1.1),
                              ),
                            ),
                            if (past) ...[
                              const SizedBox(width: 6),
                              Icon(PhosphorIconsBold.checkCircle, size: 16, color: pigment.on, semanticLabel: 'common.done'.tr),
                            ],
                          ],
                        ),
                        if (teacher != null)
                          Text(
                            period.room.isEmpty ? teacher : '$teacher · ${period.room}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.cap(color: pigment.on.withValues(alpha: .88), height: 1.2),
                          ),
                      ],
                    ),
                  ),
                  // A lesson that is over keeps its colour (after school every lesson is over); a check says it is done.
                  if (now)
                    Stamp('home.now'.tr, color: pigment.on)
                  else if (hw)
                    Stamp('timetable.hw_due'.tr, color: pigment.on),
                ],
              ),
            ),
          ),
        ],
      ),
    );
    return Semantics(
      label:
          '${subjectName(period.subject)}, ${clockOf(minutesOf(period.start))} – ${clockOf(minutesOf(period.end))}${teacher == null ? '' : ', $teacher'}',
      child: block,
    );
  }
}

/// Free time between two lessons, said with its length.
class _Free extends StatelessWidget {
  const _Free({required this.minutes});

  final int minutes;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final h = minutes ~/ 60;
    final m = minutes % 60;
    final span = h == 0
        ? 'timetable.span_m'.trp({'m': '$m'})
        : m == 0
            ? 'timetable.span_h'.trp({'h': '$h'})
            : 'timetable.span_hm'.trp({'h': '$h', 'm': '$m'});
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c.line),
      ),
      alignment: AlignmentDirectional.centerStart,
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text('timetable.free_line'.trp({'span': span}), maxLines: 1, style: context.type.tiny),
      ),
    );
  }
}

class _DayPicker extends StatelessWidget {
  const _DayPicker({required this.controller, required this.index});

  final TimetableController controller;
  final int index;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Glass(
      height: 60,
      radius: 999,
      child: LayoutBuilder(
        builder: (context, box) {
          final slot = (box.maxWidth - 8) / controller.keys.length;
          return Stack(
            children: [
              AnimatedPositioned(
                duration: context.reduceMotion ? Duration.zero : AppMotion.spring,
                curve: kSpring,
                left: 4 + index * slot + (slot - 56).clamp(0, 99) / 2,
                top: 4,
                width: slot.clamp(0, 56),
                height: 52,
                // A plain pill: glass nested in glass drew unreliably on devices.
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: c.dark ? AppColors.white.withValues(alpha: 0.22) : AppColors.white.withValues(alpha: 0.8),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(color: AppColors.white.withValues(alpha: 0.4)),
                    boxShadow: [BoxShadow(color: c.shadow, blurRadius: 10, spreadRadius: -3, offset: const Offset(0, 3))],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: Row(
                  children: [
                    for (var i = 0; i < controller.keys.length; i++)
                      Expanded(
                        child: Semantics(
                          button: true,
                          selected: i == index,
                          label: controller.dateOf(i) == null ? controller.dayLabel(i) : '${controller.dayLabel(i)} · ${DateFormat('d MMMM').format(controller.dateOf(i)!)}',
                          child: Pressable(
                            onTap: () => controller.dayIndex.value = i,
                            child: SizedBox(
                              height: 60,
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text(
                                    controller.dayLabel(i),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppText.capB(color: c.ink3, height: 1.1),
                                  ),
                                  Text(
                                    controller.dateOf(i) == null ? '' : '${controller.dateOf(i)!.day}',
                                    style: AppText.t(color: i == index ? c.ink : c.ink2, height: 1.1),
                                  ),
                                ],
                              ),
                            ),),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
