import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/status.dart';
import 'package:tangent/core/widgets/app_icons.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/views/dashboard_view.dart';
import 'package:tangent/features/dashboard/widgets/around_school_sheet.dart';
import 'package:tangent/features/dashboard/widgets/parent_home.dart' show QuickTiles;
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// The quick buttons under the greeting (console: The app → Quick buttons), for families, as tiles four to a row, and
/// last "Around school", which opens the school's other pages. The server keeps only buttons of modules the school has.
class QuickRow extends StatelessWidget {
  const QuickRow({super.key});

  static const _buttons = <String, (String, IconData, String, String)>{
    'payFees': ('quick.pay_fees', AppIcons.fees, AppRoutes.fees, 'green'),
    'applyLeave': ('quick.apply_leave', AppIcons.calendar, AppRoutes.leaveApply, 'blue'),
    'messageTeacher': ('quick.message_teacher', AppIcons.messages, AppRoutes.chat, 'indigo'),
    'timetable': ('quick.timetable', AppIcons.timetable, AppRoutes.timetable, 'red'),
    'homework': ('quick.homework', AppIcons.homework, AppRoutes.homework, 'amber'),
    'events': ('quick.events', AppIcons.events, AppRoutes.events, 'teal'),
    'bookMeeting': ('quick.book_meeting', PhosphorIconsRegular.calendarPlus, AppRoutes.meetings, 'violet'),
    'gatePass': ('quick.gate_pass', PhosphorIconsRegular.doorOpen, AppRoutes.gatePass, 'cyan'),
    'certificates': ('quick.certificates', PhosphorIconsRegular.certificate, AppRoutes.certificates, 'lime'),
  };

  static (IconData, String, VoidCallback?, String) _item(String k) =>
      (_buttons[k]!.$2, _buttons[k]!.$1, () => Get.toNamed<void>(_buttons[k]!.$3), _buttons[k]!.$4);

  static List<String> get _keys => SchoolConfig.quick.where(_buttons.containsKey).toList();

  /// One row of four on a phone: with "Around school" last, three of the console's buttons fit beside it.
  static int get _shown => AroundSchoolSheet.hasAny() && _keys.length > 3 ? 3 : 4;

  /// The console's buttons that did not fit on Home; "Around school" shows them first.
  static List<(IconData, String, VoidCallback?, String)> get overflow => [for (final k in _keys.skip(_shown)) _item(k)];

  @override
  Widget build(BuildContext context) => Obx(
    () => QuickTiles(
      items: [
        for (final k in _keys.take(_shown)) _item(k),
        if (AroundSchoolSheet.hasAny()) (PhosphorIconsRegular.squaresFour, 'quick.around_school', () => unawaited(openAroundSchool()), 'brand'),
      ],
    ),
  );
}

/// Quick buttons two to a row: the old Home's chips (an icon and the whole name) grown into Hue's tiles. Every tile leaves
/// room for a two-line name, so none is cut short and all are one size however many buttons the console picks.
class QuickGrid extends StatelessWidget {
  const QuickGrid({required this.items, super.key});

  /// Icon, translation key of the name, and the tap (null shows the button but leaves it off).
  final List<(IconData, String, VoidCallback?)> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < items.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 10),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _tile(context, items[i])),
                const SizedBox(width: 10),
                Expanded(child: i + 1 < items.length ? _tile(context, items[i + 1]) : const SizedBox.shrink()),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _tile(BuildContext context, (IconData, String, VoidCallback?) item) {
    final c = context.app;
    final (icon, key, onTap) = item;
    return Pressable(
      onTap: onTap,
      label: key.tr,
      child: Opacity(
        opacity: onTap == null ? .5 : 1,
        child: Container(
          padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
          decoration: BoxDecoration(
            color: c.paper,
            borderRadius: BorderRadius.circular(AppRadius.field),
            border: Border.all(color: c.line),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: c.mariSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
                child: Icon(icon, size: 20, color: c.mariText),
              ),
              const SizedBox(width: 10),
              // Room for two lines on every tile, so every row of tiles is one height.
              Expanded(
                child: SizedBox(
                  height: context.linesHeight(context.type.ts, 2),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Text(key.tr, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.type.ts.copyWith(color: c.ink)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The school's other pages, each where it belongs: learning on Academics, the day-to-day of school on Home, a teacher's
/// class work on My classes. Profile keeps to the person. Only modules the school has (console: Modules), and never a
/// page the console already put in the dock.
class SchoolLinks extends StatelessWidget {
  const SchoolLinks(this.place, {required this.title, super.key});

  /// `learning`, `school` or `classes`.
  final String place;
  final String title;

  @override
  Widget build(BuildContext context) => Obx(() {
    final role = Get.find<AuthService>().role;
    final parent = role == UserRole.parent;
    final student = role == UserRole.student;
    final teacher = role == UserRole.teacher;
    bool has(String module, [String? tab]) => SchoolConfig.has(module) && !SchoolConfig.dock.contains(tab ?? module);
    (IconData, String, VoidCallback?) go(IconData icon, String key, String route) => (icon, key, () => Get.toNamed<void>(route));
    final items = switch (place) {
      'learning' => [
        if (has('diary')) go(PhosphorIconsRegular.notePencil, 'menu.diary', AppRoutes.diary),
        if (has('library')) go(PhosphorIconsRegular.bookOpen, 'menu.library', AppRoutes.library),
        if (has('ptm', 'meetings') && !student) go(PhosphorIconsRegular.calendarPlus, 'menu.meetings', AppRoutes.meetings),
        if (has('certificates') && parent) go(PhosphorIconsRegular.certificate, 'menu.certificates', AppRoutes.certificates),
      ],
      'classes' => [
        if (has('diary')) go(PhosphorIconsRegular.notePencil, 'menu.diary', AppRoutes.teacherDiary),
        if (has('ptm', 'meetings')) go(PhosphorIconsRegular.calendarPlus, 'menu.meetings', AppRoutes.teacherMeetings),
        if (has('visitors', 'invite')) go(PhosphorIconsRegular.userPlus, 'menu.invite_visitor', AppRoutes.inviteVisitor),
        if (has('library')) go(PhosphorIconsRegular.bookOpen, 'menu.library', AppRoutes.library),
      ],
      _ => [
        if (has('notices')) go(PhosphorIconsRegular.megaphone, 'menu.notices', AppRoutes.notices),
        if (has('events')) go(PhosphorIconsRegular.calendarBlank, 'menu.events', AppRoutes.events),
        if (has('gallery')) go(PhosphorIconsRegular.image, 'menu.gallery', AppRoutes.gallery),
        if (has('transport') && !teacher) go(PhosphorIconsRegular.bus, 'menu.transport', AppRoutes.transport),
        if (!teacher) go(PhosphorIconsRegular.calendarCheck, 'menu.leave', AppRoutes.leave),
        if (has('visitors', 'gatePass') && parent) go(PhosphorIconsRegular.doorOpen, 'menu.gate_pass', AppRoutes.gatePass),
        if (!student) go(PhosphorIconsRegular.clipboardText, 'menu.forms', AppRoutes.forms),
      ],
    };
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [SectionLabel(title.tr, top: 24), QuickGrid(items: items)],
    );
  });
}

/// The latest notices, pinned ones first (console: Home screen cards → Latest notices).
class NoticesCard extends StatelessWidget {
  const NoticesCard({required this.notices, super.key});

  final List<Notice> notices;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel('home.latest_notices'.tr, top: 24, action: 'common.see_all', onAction: () => Get.toNamed<void>(AppRoutes.notices)),
        EduCard(
          child: Column(
            children: [
              for (final (i, n) in notices.indexed) ...[
                if (i > 0) const Hr(),
                NoticeLine(notice: n),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Merged Due stack: fees, homework and replies in one card.
class DueList extends StatelessWidget {
  const DueList({required this.items, this.showChild = false, super.key});

  final List<DueItem> items;
  final bool showChild;

  @override
  Widget build(BuildContext context) {
    return EduCard(
      child: Column(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const Hr(indent: 68),
            _DueRow(item: items[i], showChild: showChild),
          ],
        ],
      ),
    );
  }
}

class _DueRow extends StatelessWidget {
  const _DueRow({required this.item, required this.showChild});

  final DueItem item;
  final bool showChild;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final child = showChild && item.childName != null ? ' · ${item.childName}' : '';
    switch (item.kind) {
      case DueKind.fee:
        final fee = item.installment!;
        final overdue = moneyStatus(fee) == MoneyStatus.overdue;
        final late = -Formatters.daysUntil(fee.dueDate);
        return _Row(
          leading: _MoneyCover(overdue: overdue),
          title: '${fee.title}$child',
          subtitle: overdue
              ? 'home.fee_late'.trp({'amount': Formatters.money(fee.due), 'n': '$late'})
              : 'home.fee_due_on'.trp({
                  'amount': Formatters.money(fee.due),
                  'date': DateFormat('EEE d MMM').format(fee.dueDate),
                }),
          subtitleColor: overdue ? c.badText : null,
          trailing: overdue
              ? Btn('home.pay', small: true, onPressed: () => unawaited(openFees(item, pay: true)))
              : Stamp(daysStamp(fee.dueDate), color: c.lateText),
          onTap: () => unawaited(openFees(item)),
        );
      case DueKind.homework:
        final hw = item.homework!;
        return _Row(
          leading: Cover(subject: hw.subject),
          title: '${hw.title}$child',
          subtitle:
              '${subjectName(hw.subject)} · ${Formatters.countdown(hw.dueOn).trp({'count': '${Formatters.daysUntil(hw.dueOn)}'}).toLowerCase()}',
          trailing: Stamp(daysStamp(hw.dueOn), color: c.lateText),
          onTap: () => Get.toNamed<void>(AppRoutes.homeworkDetail.replaceFirst(':id', hw.id)),
        );
      case DueKind.event:
        final event = item.event!;
        return _Row(
          leading: Cover(subject: eventSubject(event.category)),
          title: 'home.reply_to'.trp({'title': event.title}),
          subtitle: 'home.are_you_going'.trp({'date': DateFormat('EEE d MMM').format(event.date)}),
          trailing: Icon(PhosphorIconsRegular.caretRight, size: 18, color: c.ink3),
          onTap: () => Get.toNamed<void>(AppRoutes.eventDetail.replaceFirst(':id', event.id)),
        );
    }
  }
}


class _MoneyCover extends StatelessWidget {
  const _MoneyCover({required this.overdue});

  final bool overdue;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Container(
      width: 40,
      height: 40,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: overdue ? c.badSoft : c.lateSoft,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Icon(AppIcons.fees, size: 20, color: overdue ? c.badText : c.lateText),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.leading,
    required this.title,
    required this.subtitle,
    this.subtitleColor,
    this.trailing,
    this.onTap,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final Color? subtitleColor;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: onTap,
      scale: .985,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            leading,
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.capB.copyWith(color: subtitleColor),
                  ),
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 10), trailing!],
          ],
        ),
      ),
    );
  }
}

/// Parent strip: each child's attendance and current class today.
class ChildrenStrip extends StatelessWidget {
  const ChildrenStrip({required this.children, super.key});

  final List<ChildToday> children;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return EduCard(
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const Hr(indent: 66),
            Builder(
              builder: (context) {
                final child = children[i];
                final status = child.status;
                final (label, tone) = switch (status) {
                  AttendanceStatus.present => ('attendance.present', AppColors.ok),
                  AttendanceStatus.absent => ('attendance.absent', c.badText),
                  AttendanceStatus.lateArrival => ('attendance.late', AppColors.late),
                  AttendanceStatus.holiday => ('attendance.holiday', AppColors.off),
                  null => ('attendance.not_marked', AppColors.off),
                };
                final period = child.period;
                final now = period == null
                    ? 'home.no_class_now'.tr
                    : period.kind == PeriodKind.klass
                    ? 'home.subject_now'.trp({'subject': subjectName(period.subject)})
                    : subjectName(period.subject);
                return Pressable(
                  onTap: () => Get.toNamed<void>(AppRoutes.attendance),
                  scale: .985,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      children: [
                        Avatar(
                          child.student.name,
                          initials: Avatar.siblingInitials(child.student.name, [
                            for (final k in children) k.student.name,
                          ]),
                          background: i.isEven ? AppColors.subject('maths').fill : AppColors.subject('hindi').fill,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text.rich(
                                TextSpan(
                                  text: child.student.name.split(' ').first,
                                  children: [
                                    TextSpan(
                                      text:
                                          ' · ${child.schoolClass.label}',
                                      style: context.type.cap,
                                    ),
                                  ],
                                ),
                                style: context.type.t,
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${label.tr} · $now',
                                style: context.type.cap,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ),
                        ),
                        Stamp(label.tr, color: tone),
                      ],
                    ),
                  ),
                );
              },
            ),
          ],
        ],
      ),
    );
  }
}

class NoticeLine extends StatelessWidget {
  const NoticeLine({required this.notice, super.key});

  final Notice notice;

  @override
  Widget build(BuildContext context) {
    return Pressable(
      onTap: () => Get.toNamed<void>(AppRoutes.noticeDetail.replaceFirst(':id', notice.id)),
      scale: .985,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Stamp('notices.cat_${notice.category}'.tr, color: noticeTone(context, notice.category), size: 10),
            const SizedBox(width: 12),
            Expanded(
              child: Text(notice.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t),
            ),
          ],
        ),
      ),
    );
  }
}

Color noticeTone(BuildContext context, String category) {
  final c = context.app;
  return switch (category) {
    'exams' => c.badText,
    'academic' => c.mariText,
    'sports' => AppColors.ok,
    'holiday' => AppColors.subject('social').fill,
    'fees' => c.lateText,
    _ => c.ink3,
  };
}

/// Opens Fees for the child the fee belongs to, optionally straight into paying it.
Future<void> openFees(DueItem item, {bool pay = false}) async {
  final auth = Get.find<AuthService>();
  if (item.studentId != null && item.studentId != auth.activeStudentId.value) {
    await auth.switchChild(item.studentId!);
  }
  await Get.toNamed<void>(AppRoutes.fees, arguments: pay ? {'pay': item.installment!.id} : null);
}
