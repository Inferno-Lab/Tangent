import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/utils/view_state.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart' show todayLine;
import 'package:tangent/features/dashboard/widgets/around_school_sheet.dart';
import 'package:tangent/features/dashboard/widgets/parent_home.dart' show HomeHeading, QuickTiles;
import 'package:tangent/features/teacher_tools/widgets/day_ribbon.dart';
import 'package:tangent/features/dashboard/widgets/home_cards.dart' show SchoolLinks;
import 'package:tangent/features/shell/shell_controller.dart';
import 'package:tangent/features/teacher_tools/controllers/teacher_controller.dart';
import 'package:tangent/features/school_life/views/staff_time_view.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/clock.dart';

String _attendanceRoute(String classId) => AppRoutes.teacherAttendance.replaceFirst(':classId', classId);
String _marksRoute(String classId) => AppRoutes.teacherMarks.replaceFirst(':classId', classId);

class TeacherHomeView extends GetView<TeacherHomeController> {
  const TeacherHomeView({super.key});

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.paddingOf(context);
    return Obx(() {
      controller.state.value;
      final c = context.app;
      final t = controller.teacher;
      final ready = controller.state.value == ViewState.success && t != null;
      final periods = controller.today.map((p) => p.slot).toList();
      final classOf = {for (final p in controller.today) p.slot.id: p.schoolClass};
      final hasDay = ready && periods.isNotEmpty;
      final own = controller.own;
      // As the approved canvas: the day as the old ribbon from the top of the screen, the teacher's capsule and bell over it,
      // then the greeting, the lesson on now, the check-in, the quick buttons and what needs the teacher.
      return Scaffold(
        backgroundColor: c.chalk,
        body: PullToRefresh(
          onRefresh: controller.load,
          top: inset.top + 14,
          child: ListView(
          physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
          padding: EdgeInsets.only(bottom: kDockClearance + inset.bottom),
          children: [
            Stack(
              children: [
                if (hasDay)
                  DayRibbon(
                    periods: periods,
                    subject: t.subject,
                    height: inset.top + 230,
                    label: (p) => classOf[p.id] == null ? subjectName(p.subject) : classLabel(classOf[p.id]!),
                  )
                else
                  SizedBox(height: inset.top + 64),
                PositionedDirectional(
                  start: 16,
                  end: 16,
                  top: inset.top + 8,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      if (t != null)
                        Flexible(
                          child: Pressable(
                            onTap: () => ShellController.showTab('profile'),
                            label: t.name,
                            child: Container(
                              height: 48,
                              padding: const EdgeInsetsDirectional.only(start: 6, end: 16),
                              decoration: BoxDecoration(
                                color: c.paper,
                                borderRadius: BorderRadius.circular(AppRadius.pill),
                                border: Border.all(color: c.line),
                                boxShadow: [BoxShadow(color: c.ink.withValues(alpha: .1), blurRadius: 20, offset: const Offset(0, 6))],
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Avatar(t.name, size: 36, background: c.subjectFor(t.subject).fill, foreground: c.subjectFor(t.subject).on),
                                  const SizedBox(width: 10),
                                  Flexible(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(t.name.split(' ').first, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.t(color: c.ink, height: 1.1)),
                                        Text(
                                          own == null
                                              ? subjectName(t.subject)
                                              : 'teacher.capsule_line'.trp({'subject': subjectName(t.subject), 'class': classLabel(own)}),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: AppText.tiny(color: c.ink3, height: 1.2),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      const SizedBox(width: 12),
                      GlassIconButton(
                        icon: PhosphorIconsRegular.magnifyingGlass,
                        label: 'common.search'.tr,
                        onTap: () => Get.toNamed<void>(AppRoutes.search),
                      ),
                      const SizedBox(width: 10),
                      GlassIconButton(
                        icon: PhosphorIconsRegular.bell,
                        label: 'menu.notifications'.tr,
                        onTap: () => Get.toNamed<void>(AppRoutes.notifications),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(20, hasDay ? 20 : 24, 20, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (t != null) ...[
                    Rise(child: Text(todayLine().toUpperCase(), style: context.type.o)),
                    const SizedBox(height: 6),
                    Rise(index: 1, child: Text('${Formatters.greetingKey(Clock.now()).tr}, ${t.name.split(' ').first}', style: context.type.h1)),
                  ],
                  const SizedBox(height: 20),
                  ViewStateView(
                    skeleton: const SkeletonCards(),
                    state: controller.state.value,
                    onRetry: controller.load,
                    errorKey: controller.errorMessage.value,
                    child: t == null ? const SizedBox.shrink() : _Body(controller: controller, teacher: t),
                  ),
                ],
              ),
            ),
          ],
          ),
        ),
      );
    });
  }
}

/// The lesson on now (or the next one) in the teacher's subject colour, with roll call and the class list a tap away.
class _NowLesson extends StatelessWidget {
  const _NowLesson({required this.period, required this.live, required this.subject});

  final TeacherPeriod period;
  final bool live;
  final String subject;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final pigment = c.subjectFor(subject);
    final cls = period.schoolClass!;
    final a = minutesOf(period.slot.start);
    final b = minutesOf(period.slot.end);
    final room = period.slot.room.isEmpty ? cls.room : period.slot.room;
    final ground = live ? pigment.fill : pigment.soft;
    final ink = live ? pigment.on : pigment.ink;
    final left = b - nowMinutes();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(AppRadius.panel)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                height: 24,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(color: ink.withValues(alpha: .18), borderRadius: BorderRadius.circular(AppRadius.pill)),
                child: Center(widthFactor: 1, child: Text((live ? 'home.now' : 'teacher.next').tr, style: AppText.tiny(color: ink))),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  live ? 'teacher.until_left'.trp({'time': clockOf(b), 'n': '$left'}) : 'teacher.at_time'.trp({'time': clockOf(a)}),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.cap(color: ink.withValues(alpha: .86)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            [classLabel(cls), subjectName(period.slot.subject), if (room.isNotEmpty) 'teacher.room_n'.trp({'room': room})].join(' · '),
            style: AppText.h3(color: ink),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _Pill(
                label: 'teacher.take_roll_call'.tr,
                ground: ink,
                ink: ground,
                onTap: () => Get.toNamed<void>(_attendanceRoute(cls.id)),
              ),
              _Pill(
                label: 'teacher.class_list'.tr,
                ground: ink.withValues(alpha: .16),
                ink: ink,
                onTap: () => Get.toNamed<void>(AppRoutes.teacherRoster.replaceFirst(':classId', cls.id)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.ground, required this.ink, required this.onTap});

  final String label;
  final Color ground;
  final Color ink;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    label: label,
    child: Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(color: ground, borderRadius: BorderRadius.circular(AppRadius.pill)),
      child: Center(widthFactor: 1, child: Text(label, style: AppText.chip(color: ink, height: 1))),
    ),
  );
}

/// The quick buttons as one row of pills that scrolls sideways, "More" last (it opens Around school).
class _Body extends StatelessWidget {
  const _Body({required this.controller, required this.teacher});

  final TeacherHomeController controller;
  final Teacher teacher;

  @override
  Widget build(BuildContext context) {
    final now = controller.current;
    final next = controller.next;
    final focus = now?.schoolClass ?? next?.schoolClass ?? controller.own ?? controller.classes.firstOrNull;
    final ownTaken = controller.own == null ? null : controller.taken(controller.own!.id);
    final tasks = <Widget>[
      if (controller.waitingTotal > 0)
        _Task(
          big: '${controller.waitingTotal}',
          title: 'teacher.to_grade'.tr,
          sub: _gradingLine(controller.grading.first),
          onTap: () => Get.toNamed<void>(AppRoutes.teacherGrade),
        ),
      for (final cls in controller.classes)
        if ((controller.students[cls.id]?.length ?? 0) > (controller.entered[cls.id] ?? 0) &&
            (controller.entered[cls.id] ?? 0) > 0)
          _Task(
            big: '${(controller.students[cls.id]?.length ?? 0) - (controller.entered[cls.id] ?? 0)}',
            title: 'teacher.marks_due'.tr,
            sub: 'teacher.marks_line'.trp({
              'class': classLabel(cls),
              'n': '${controller.entered[cls.id]}',
              'total': '${controller.students[cls.id]?.length ?? 0}',
            }),
            onTap: () => Get.toNamed<void>(_marksRoute(cls.id)),
          ),
      if (controller.leave.isNotEmpty)
        _Task(
          big: '${controller.leave.length}',
          title: controller.leave.length == 1 ? 'teacher.leave_one'.tr : 'teacher.leave_many'.tr,
          sub: '${controller.names[controller.leave.first.studentId] ?? ''} · ${_range(controller.leave.first)}',
          onTap: () => unawaited(showSheet<void>(_LeaveSheet(controller: controller))),
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (now?.schoolClass != null || next?.schoolClass != null) ...[
          Rise(child: _NowLesson(period: (now ?? next)!, live: now != null, subject: teacher.subject)),
          const SizedBox(height: 16),
        ] else ...[
          Rise(child: Text('teacher.day_done'.tr, style: context.type.s)),
          const SizedBox(height: 16),
        ],
        // Today's check-in, where the school keeps staff attendance and puts it on staff's Home (console: The app).
        if (SchoolConfig.has('staffAttendance') && SchoolConfig.home.contains('checkIn')) ...[
          const Rise(index: 1, child: CheckInCard(onHome: true)),
          const SizedBox(height: 16),
        ],
        // The console's quick buttons for staff (The app → Quick buttons); the server keeps only those of modules the
        // school has. Roll call and marks open the class in front of the teacher now, or their own.
        Rise(
          index: 2,
          child: Obx(() {
            final cls = controller.own ?? focus;
            final buttons = <String, (IconData, String, VoidCallback?, String)>{
              'markAttendance': (PhosphorIconsBold.check, 'teacher.qa_attendance', cls == null ? null : () => Get.toNamed<void>(_attendanceRoute(cls.id)), 'green'),
              'assignHomework': (PhosphorIconsRegular.fileText, 'teacher.qa_assign', () => Get.toNamed<void>(AppRoutes.teacherAssign, arguments: {'classId': focus?.id}), 'blue'),
              'grade': (PhosphorIconsRegular.pencilSimple, 'teacher.qa_grade', () => Get.toNamed<void>(AppRoutes.teacherGrade), 'violet'),
              'enterMarks': (PhosphorIconsRegular.exam, 'teacher.qa_marks', cls == null ? null : () => Get.toNamed<void>(_marksRoute(cls.id)), 'indigo'),
              'postNotice': (PhosphorIconsRegular.megaphone, 'teacher.qa_notice', () => Get.toNamed<void>(AppRoutes.teacherNotice), 'orange'),
              'staffLeave': (PhosphorIconsRegular.calendarPlus, 'teacher.qa_leave', () => Get.toNamed<void>(AppRoutes.staffMe), 'teal'),
              'writeDiary': (PhosphorIconsRegular.notebook, 'teacher.qa_diary', () => Get.toNamed<void>(AppRoutes.teacherDiary), 'amber'),
              'mySlots': (PhosphorIconsRegular.calendarDots, 'teacher.qa_slots', () => Get.toNamed<void>(AppRoutes.teacherMeetings), 'cyan'),
              'inviteVisitor': (PhosphorIconsRegular.userPlus, 'teacher.qa_visitor', () => Get.toNamed<void>(AppRoutes.inviteVisitor), 'pink'),
            };
            return QuickTiles(
              items: [
                for (final k in SchoolConfig.quick) ?buttons[k],
                if (AroundSchoolSheet.hasAny()) (PhosphorIconsRegular.squaresFour, 'teacher.more_school', () => unawaited(openAroundSchool()), 'brand'),
              ],
            );
          }),
        ),
        if (tasks.isNotEmpty) ...[
          Rise(index: 3, child: HomeHeading('teacher.needs_you'.trp({'n': '${tasks.length}'}))),
          Rise(
            index: 4,
            child: EduCard(
              child: Column(
                children: [
                  for (final (i, t) in tasks.indexed) ...[if (i > 0) const Hr(indent: 70), t],
                ],
              ),
            ),
          ),
        ] else ...[
          const SizedBox(height: 20),
          const Rise(
            index: 3,
            child: EmptyState(art: EmptyArt.grading, title: 'teacher.all_clear', body: 'teacher.all_clear_body'),
          ),
        ],
        if (controller.own != null) ...[
          const SizedBox(height: 10),
          Rise(
            index: 5,
            child: Text(
              ownTaken == null
                  ? 'teacher.attendance_open'.trp({'class': classLabel(controller.own!)})
                  : 'teacher.attendance_taken'.trp({
                      'class': classLabel(controller.own!),
                      'n': '${ownTaken.$1}',
                      'total': '${ownTaken.$2}',
                    }),
              style: context.type.cap,
            ),
          ),
        ],
      ],
    );
  }

  static String _gradingLine(GradingItem g) {
    final oldest = g.waiting.first.submittedAt;
    final days = oldest == null ? 0 : DateUtils.dateOnly(Clock.now()).difference(DateUtils.dateOnly(oldest)).inDays;
    return [
      g.homework.title,
      if (g.schoolClass != null) classLabel(g.schoolClass!),
      if (days > 0) 'teacher.oldest'.trn(days),
    ].join(' · ');
  }
}

String _range(LeaveRequest l) {
  final same = DateUtils.isSameDay(l.from, l.to);
  if (same) return DateFormat('d MMM').format(l.from);
  return l.from.month == l.to.month
      ? '${l.from.day}–${DateFormat('d MMM').format(l.to)}'
      : '${DateFormat('d MMM').format(l.from)} – ${DateFormat('d MMM').format(l.to)}';
}

class _Task extends StatelessWidget {
  const _Task({required this.big, required this.title, required this.sub, required this.onTap});

  final String big;
  final String title;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    scale: .985,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            child: Text(big, maxLines: 1, style: context.type.h2),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: context.type.t),
                Text(sub, style: context.type.cap, maxLines: 2, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          Icon(PhosphorIconsRegular.caretRight, size: 16, color: context.app.ink3),
        ],
      ),
    ),
  );
}

class _LeaveSheet extends StatelessWidget {
  const _LeaveSheet({required this.controller});

  final TeacherHomeController controller;

  @override
  Widget build(BuildContext context) => SheetBody(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Text('teacher.leave_title'.tr, style: context.type.h2),
        const SizedBox(height: 4),
        for (final l in controller.leave)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(controller.names[l.studentId] ?? '', style: context.type.t),
                Text('${l.reason} · ${_range(l)}', style: context.type.cap),
                if (l.note != null && l.note!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text('“${l.note}”', style: context.type.s),
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: Btn(
                        'teacher.decline',
                        kind: BtnKind.quiet,
                        small: true,
                        expand: true,
                        onPressed: () {
                          Get.back<void>();
                          unawaited(controller.review(l, LeaveStatus.rejected, null));
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Btn(
                        'teacher.approve',
                        kind: BtnKind.ink,
                        small: true,
                        expand: true,
                        onPressed: () {
                          Get.back<void>();
                          unawaited(controller.review(l, LeaveStatus.approved, null));
                        },
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        const SizedBox(height: 12),
      ],
    ),
  );
}

class TeacherClassesView extends GetView<TeacherHomeController> {
  const TeacherClassesView({super.key});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      controller.state.value;
      final classes = [...controller.classes]
        ..sort((a, b) {
          if (a.id == controller.own?.id) return -1;
          if (b.id == controller.own?.id) return 1;
          return _firstPeriod(a).compareTo(_firstPeriod(b));
        });
      final total = controller.students.values.fold<int>(0, (s, l) => s + l.length);
      return PageFrame(
        dockPage: true,
        topPadding: MediaQuery.paddingOf(context).top + 14,
        onRefresh: controller.load,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: PageTitle(
                  'teacher.classes',
                  subtitle: controller.classes.isEmpty
                      ? null
                      : 'teacher.classes_sub'.trp({
                          'n': '${controller.classes.length}',
                          'students': '$total',
                          'day': DateFormat('EEEE').format(Clock.now()),
                        }),
                ),
              ),
              GlassIconButton(
                icon: PhosphorIconsRegular.magnifyingGlass,
                label: 'teacher.search_students'.tr,
                onTap: () => Get.toNamed<void>(AppRoutes.search, arguments: {'scope': 'people'}),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ViewStateView(
            skeleton: const SkeletonCards(),
            state: controller.state.value,
            onRetry: controller.load,
            errorKey: controller.errorMessage.value,
            emptyArt: EmptyArt.search,
            emptyHint: 'teacher.no_classes_hint',
            emptyTitle: 'teacher.no_classes',
            emptyBody: 'teacher.no_classes_body',
            child: Column(
              children: [
                for (final (i, cls) in classes.indexed) ...[
                  if (i > 0) const SizedBox(height: 12),
                  Rise(
                    index: i,
                    child: _ClassCard(cls: cls, controller: controller),
                  ),
                ],
              ],
            ),
          ),
          // A class teacher's other work: the diary, meeting slots, visitors.
          const SchoolLinks('classes', title: 'teacher.class_work'),
        ],
      );
    });
  }

  int _firstPeriod(SchoolClass c) {
    final p = controller.today.where((p) => p.schoolClass?.id == c.id).firstOrNull;
    return p == null ? 9999 : minutesOf(p.slot.start);
  }
}

class _ClassCard extends StatelessWidget {
  const _ClassCard({required this.cls, required this.controller});

  final SchoolClass cls;
  final TeacherHomeController controller;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final mine = cls.id == controller.own?.id;
    final subject = controller.teacher?.subject ?? '';
    final periods = controller.today.where((p) => p.schoolClass?.id == cls.id).toList();
    final now = nowMinutes();
    final live = periods.where((p) => minutesOf(p.slot.start) <= now && minutesOf(p.slot.end) > now).firstOrNull;
    final upcoming = periods.where((p) => minutesOf(p.slot.start) > now).firstOrNull;
    final done = periods.isNotEmpty && periods.every((p) => minutesOf(p.slot.end) <= now) ? periods.last : null;
    final room = periods.firstOrNull?.slot.room.isNotEmpty ?? false ? periods.first.slot.room : cls.room;
    final count = controller.students[cls.id]?.length ?? cls.studentIds.length;
    final String when;
    if (live != null) {
      when = 'teacher.now_until'.trp({'time': clockOf(minutesOf(live.slot.end))});
    } else if (upcoming != null) {
      when = mine
          ? 'teacher.subject_at'.trp({
              'subject': subjectName(subject),
              'time': clockOf(minutesOf(upcoming.slot.start)),
            })
          : clockOf(minutesOf(upcoming.slot.start));
    } else if (done != null) {
      when = 'teacher.done_at'.trp({'time': clockOf(minutesOf(done.slot.end))});
    } else {
      when = 'teacher.not_today'.tr;
    }
    final taken = controller.taken(cls.id);
    final pigment = AppColors.subject(subject);
    final (Color tile, Color tileOn) = mine
        ? (context.app.brand, context.app.onBrand)
        : live != null
        ? (pigment.fill, pigment.on)
        : (c.paper2, c.ink);
    final actions = [
      if (mine) ('teacher.attendance', () => Get.toNamed<void>(_attendanceRoute(cls.id))),
      ('teacher.marks', () => Get.toNamed<void>(_marksRoute(cls.id))),
      ('teacher.homework', () => Get.toNamed<void>(AppRoutes.teacherAssign, arguments: {'classId': cls.id})),
      ('teacher.roster', () => Get.toNamed<void>(AppRoutes.teacherRoster.replaceFirst(':classId', cls.id))),
    ];
    return EduCard(
      ring: mine ? context.app.brand : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: tile, borderRadius: BorderRadius.circular(16)),
                  child: Text(
                    classLabel(cls).replaceAll(' ', ''),
                    style: AppText.h2(color: tileOn, height: 1),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (mine)
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                'teacher.class_n'.trp({'class': classLabel(cls)}),
                                style: context.type.t,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Stamp('teacher.your_class'.tr, color: c.mariText, size: 9.5),
                          ],
                        )
                      else
                        Text(
                          '${'teacher.class_n'.trp({'class': classLabel(cls)})} · ${subjectName(subject)}',
                          style: context.type.t,
                        ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          if (count > 0) 'teacher.n_students'.trn(count),
                          room,
                          when,
                        ].join(' · '),
                        style: context.type.cap,
                      ),
                      if (mine) ...[
                        const SizedBox(height: 2),
                        Text(
                          taken == null
                              ? 'teacher.attendance_not_taken'.tr
                              : 'teacher.attendance_done'.trp({'n': '${taken.$1}'}),
                          style: AppText.capB(color: taken == null ? (c.dark ? AppColors.blackboard.mariText : AppColors.late) : AppColors.ok),
                        ),
                      ],
                    ],
                  ),
                ),
                if (live != null) Padding(padding: const EdgeInsets.only(left: 8), child: PulseDot(AppColors.ok)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(92, 0, 16, 16),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final a in actions)
                  Pressable(
                    onTap: a.$2,
                    child: Container(
                      height: 32,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(12)),
                      child: Center(
                        widthFactor: 1,
                        child: Text(a.$1.tr, style: AppText.capB(color: c.ink2, height: 1)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

