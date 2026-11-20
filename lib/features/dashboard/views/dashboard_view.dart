import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/dashboard/widgets/child_switcher.dart';
import 'package:tangent/features/dashboard/widgets/home_cards.dart';
import 'package:tangent/features/dashboard/widgets/home_welcome.dart';
import 'package:tangent/features/dashboard/widgets/live_strip.dart';
import 'package:tangent/features/dashboard/widgets/parent_home.dart';
import 'package:tangent/features/shell/shell_controller.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/clock.dart';

class DashboardView extends StatefulWidget {
  const DashboardView({super.key});

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  int? _scrub;
  var _pulled = false;

  DashboardController get controller => Get.find<DashboardController>();

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthService>();
    return Obx(() {
      final data = controller.snapshot;
      final parent = auth.role == UserRole.parent;
      final wide = context.isWide;
      final hasDay = data != null && data.periods.isNotEmpty && _show('dayRibbon', 'timetable');
      final top = MediaQuery.paddingOf(context).top;
      controller.state.value; // rebuild on state changes
      final c = context.app;
      final user = auth.user.value;
      final first = parent ? (user?.name ?? '').split(' ').first : (data?.student.name ?? '').split(' ').first;
      final hello = parent ? '${Formatters.greetingKey(Clock.now()).tr}, $first' : greeting(first);
      final side = wide ? 130.0 : 20.0;
      // Home as the ParentHome and TeacherHome boards (design/hue/src), on the chalk ground: the greeting, today's lessons
      // as a strip and the cards the console chose.
      return Scaffold(
        backgroundColor: c.chalk,
        body: Stack(
          children: [
            NotificationListener<ScrollUpdateNotification>(
              // Pull down on Home opens search.
              onNotification: (n) {
                if (n.metrics.pixels < -90 && !_pulled) {
                  _pulled = true;
                  unawaited(Get.toNamed<void>(AppRoutes.search)?.then((_) => _pulled = false));
                }
                return false;
              },
              // No refresh circle here: pulling down is the search gesture, and Home reloads itself on any change.
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                padding: EdgeInsets.zero,
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(side, top + 8, wide ? 40 : (parent ? 20 : 16), parent ? 16 : 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            if (parent) const ChildCapsule() else _ProfileCapsule(data: data),
                            const Spacer(),
                            if (!parent) ...[
                              GlassIconButton(
                                icon: PhosphorIconsRegular.magnifyingGlass,
                                label: 'common.search'.tr,
                                onTap: () => Get.toNamed<void>(AppRoutes.search),
                              ),
                              const SizedBox(width: 10),
                            ],
                            if (parent)
                              const _Bell()
                            else
                              GlassIconButton(
                                icon: PhosphorIconsRegular.bell,
                                label: 'notifications.title'.tr,
                                badge: true,
                                onTap: () => Get.toNamed<void>(AppRoutes.notifications),
                              ),
                          ],
                        ),
                        SizedBox(height: parent ? 24 : 16),
                        Rise(child: Text(parent ? dateLine() : todayLine(), style: parent ? context.type.s.copyWith(color: c.ink3) : context.type.capB)),
                        SizedBox(height: parent ? 2 : 6),
                        Rise(index: 1, child: Text(hello, style: context.type.h1)),
                      ],
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.fromLTRB(side, 0, wide ? 40 : 20, wide ? 40 : kDockClearance + MediaQuery.paddingOf(context).bottom),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const OfflineCapsule(),
                        if (hasDay && !(parent && !wide))
                          Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: PeriodStrip(
                              periods: data.periods,
                              onAll: SchoolConfig.has('timetable') ? () => openTimetable() : null,
                              picked: _scrub == null ? null : data.periods.firstWhereOrNull((p) => minutesOf(p.start) <= _scrub! && _scrub! < minutesOf(p.end)),
                              // A child's lesson opens the timetable; a student's own shows in the Now card (again
                              // on the lesson on now, to come back to now).
                              onPick: parent || wide
                                  ? (_) => Get.toNamed<void>(AppRoutes.timetable)
                                  : (p) => setState(() {
                                      final a = minutesOf(p.start);
                                      final on = nowMinutes() >= a && nowMinutes() < minutesOf(p.end);
                                      // A few minutes in: the Now card reads the minute right after a lesson as the one before.
                                      final at = math.min(a + 3, minutesOf(p.end) - 1);
                                      _scrub = on || _scrub == at ? null : at;
                                    }),
                            ),
                          ),
                        ViewStateView(
                          state: controller.state.value,
                          onRetry: controller.load,
                          errorKey: controller.errorMessage.value,
                          emptyTitle: 'home.empty_title',
                          emptyBody: 'home.empty_body',
                          child: data == null
                              ? const SizedBox.shrink()
                              : wide
                              ? _WideBody(data: data, scrub: _scrub, parent: parent)
                              : parent
                              ? _ParentBody(data: data)
                              : _StudentBody(data: data, scrub: _scrub),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }
}

/// Today's lessons as a row of cards, each as wide as it is long (the old day ribbon's idea in Hue's cards): its name and
/// its times inside it, the lesson on now filled in its subject's colour with how much of it has gone, earlier lessons
/// quiet, breaks as a cup. It opens on now; tapping a lesson calls [onPick].
class PeriodStrip extends StatefulWidget {
  const PeriodStrip({required this.periods, this.label, this.onPick, this.picked, this.onAll, super.key});

  final List<PeriodSlot> periods;

  /// What a card says: the subject by default, a class for a teacher.
  final String Function(PeriodSlot)? label;
  final ValueChanged<PeriodSlot>? onPick;

  /// The lesson the person is looking at, when it is not the one on now.
  final PeriodSlot? picked;

  /// The whole timetable (the header's link); null hides the link.
  final VoidCallback? onAll;

  @override
  State<PeriodStrip> createState() => _PeriodStripState();
}

class _PeriodStripState extends State<PeriodStrip> {
  final _scroll = ScrollController();

  // A 40-minute lesson is about a phone's half-width; no lesson is narrower than its name and times need.
  static const _perMinute = 3.4;
  static const _minLesson = 116.0;
  static const _break = 44.0;
  static const _gap = 8.0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _toNow());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  double _width(PeriodSlot p) => p.kind == PeriodKind.klass ? math.max(_minLesson, (minutesOf(p.end) - minutesOf(p.start)) * _perMinute) : _break;

  // The lesson on now (or the next) opens at the left edge, whole; earlier ones are a swipe back (a sliver of one read as
  // cut-off text).
  void _toNow() {
    if (!mounted || !_scroll.hasClients) return;
    final now = nowMinutes();
    var x = 0.0;
    for (final p in widget.periods) {
      if (minutesOf(p.end) > now) break;
      x += _width(p) + _gap;
    }
    _scroll.jumpTo(x.clamp(0, _scroll.position.maxScrollExtent));
  }

  @override
  Widget build(BuildContext context) {
    final periods = widget.periods;
    final lessons = periods.where((p) => p.kind == PeriodKind.klass).length;
    if (lessons == 0) return const SizedBox.shrink();
    final now = nowMinutes();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionLabel('home.todays_lessons'.trn(lessons), top: 0, action: widget.onAll == null ? null : 'home.timetable', onAction: widget.onAll),
        SizedBox(
          height: 76,
          child: ListView.separated(
            controller: _scroll,
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            clipBehavior: Clip.none,
            itemCount: periods.length,
            separatorBuilder: (_, _) => const SizedBox(width: _gap),
            itemBuilder: (context, i) {
              final p = periods[i];
              return SizedBox(width: _width(p), child: p.kind == PeriodKind.klass ? _lesson(context, p, now) : _breakCard(context, p));
            },
          ),
        ),
      ],
    );
  }

  Widget _lesson(BuildContext context, PeriodSlot p, int now) {
    final c = context.app;
    final col = c.subjectFor(p.subject);
    final a = minutesOf(p.start);
    final b = minutesOf(p.end);
    final live = now >= a && now < b;
    final picked = widget.picked == null ? live : widget.picked!.id == p.id;
    final past = now >= b && !picked;
    final name = widget.label?.call(p) ?? subjectName(p.subject);
    // On now: the subject's own colour. Later: its soft fill. Earlier: the page's quiet card, so the day reads at a glance.
    final ground = live ? col.fill : past ? c.paper : col.soft;
    final ink = live ? col.on : past ? c.ink3 : col.ink;
    return Pressable(
      onTap: widget.onPick == null ? null : () => widget.onPick!(p),
      label: '$name · ${clockOf(a)} – ${clockOf(b)}',
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
        decoration: BoxDecoration(
          color: ground,
          borderRadius: BorderRadius.circular(AppRadius.field),
          border: past ? Border.all(color: c.line) : null,
        ),
        // The lesson being looked at, when it is not the one on now, is outlined over the card (it never changes size).
        foregroundDecoration: picked && !live
            ? BoxDecoration(borderRadius: BorderRadius.circular(AppRadius.field), border: Border.all(color: col.ink, width: 2))
            : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts.copyWith(color: ink))),
                if (live) ...[const SizedBox(width: 6), Stamp('home.now'.tr, color: ink)],
              ],
            ),
            const Spacer(),
            Text('${clockOf(a)} – ${clockOf(b)}', maxLines: 1, style: context.type.cap.copyWith(color: ink, fontFeatures: const [FontFeature.tabularFigures()])),
            if (live) ...[
              const SizedBox(height: 6),
              // How much of the lesson has gone.
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.hair),
                child: LinearProgressIndicator(value: ((now - a) / (b - a)).clamp(0, 1), minHeight: 3, color: col.on, backgroundColor: col.on.withValues(alpha: .25)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _breakCard(BuildContext context, PeriodSlot p) {
    final c = context.app;
    return Semantics(
      label: 'timetable.break_line'.trp({'name': subjectName(p.subject), 'n': '${minutesOf(p.end) - minutesOf(p.start)}'}),
      child: DecoratedBox(
        decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(AppRadius.field)),
        child: Center(child: Icon(PhosphorIconsRegular.coffee, size: 16, color: c.ink3)),
      ),
    );
  }
}

/// The whole timetable: its dock tab where the console put one there, else its page.
void openTimetable() => SchoolConfig.dock.contains('timetable') ? ShellController.showTab('timetable') : unawaited(Get.toNamed<void>(AppRoutes.timetable));

class _ProfileCapsule extends StatelessWidget {
  const _ProfileCapsule({required this.data});

  final HomeSnapshot? data;

  @override
  Widget build(BuildContext context) {
    final user = Get.find<AuthService>().user.value;
    final name = data?.student.name ?? user?.name ?? '';
    final cls = data == null ? '' : data!.schoolClass.label;
    return GlassPress(
      onTap: () => Get.toNamed<void>(AppRoutes.profile),
      child: Semantics(
        button: true,
        label: 'home.profile_capsule'.trp({'name': name, 'class': cls}),
        child: Glass(
          height: 44,
          // Frosted with ink text: over the ribbon the capsule meets pale hatching as well as colour.
          padding: const EdgeInsets.only(left: 6, right: 16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Avatar(name, size: 30, background: AppColors.light.paper, foreground: AppColors.light.ink),
              const SizedBox(width: 8),
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name.split(' ').first,
                    style: AppText.chip(color: context.app.ink, height: 1.05),
                  ),
                  Text(
                    cls,
                    style: AppText.tiny(color: context.app.ink3, height: 1.05),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}


String greeting(String first) => '${Formatters.greetingKey(Clock.now()).tr},\n$first';

/// "Friday, 20 November", the parent home's date line.
String dateLine() => DateFormat('EEEE, d MMMM', Get.locale?.languageCode).format(Clock.now());

String todayLine() => DateFormat('EEEE · d MMMM', Get.locale?.languageCode).format(Clock.now());

/// Home sections follow what Tangent set for the school (console → The app → Home screen cards) and its modules.
bool _show(String card, [String? module]) => SchoolConfig.home.contains(card) && (module == null || SchoolConfig.has(module));

/// Home's cards in the order the console set, each once: what is due (fees, homework and events share one list),
/// attendance and the next exam side by side, and the latest notices. Today's timetable is the band at the top.
/// [due] replaces the student's due list (a parent's covers every child); [only] picks groups for the wide layout.
List<Widget> homeSections(HomeSnapshot data, {bool parent = false, List<Widget>? due, Set<String>? only}) {
  final out = <Widget>[];
  final done = <String>{};
  for (final key in SchoolConfig.home) {
    final group = switch (key) {
      'dueStack' || 'homework' || 'events' => 'due',
      'attendance' || 'nextExam' => 'stats',
      'notices' => 'notices',
      _ => null,
    };
    if (group == null || (only != null && !only.contains(group)) || !done.add(group)) continue;
    switch (group) {
      case 'due':
        out.addAll(due ?? [DueSection(items: data.due)]);
      case 'stats':
        final attendance = _show('attendance', 'attendance');
        final exam = _show('nextExam', 'exams');
        if (!parent && (attendance || exam)) {
          out
            ..add(const SizedBox(height: 12))
            ..add(StatsRow(data: data, attendance: attendance, exam: exam));
        }
      case 'notices':
        if (data.notices.isNotEmpty && SchoolConfig.has('notices')) out.add(NoticesCard(notices: data.notices.take(3).toList()));
    }
  }
  return out;
}

class _StudentBody extends StatelessWidget {
  const _StudentBody({required this.data, required this.scrub});

  final HomeSnapshot data;
  final int? scrub;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Rise(index: 1, child: QuickRow()),
        const SizedBox(height: 16),
        if (data.isNew)
          const Rise(index: 2, child: HomeWelcome())
        else ...[
          Rise(
            index: 2,
            child: NowCard(data: data, scrub: scrub),
          ),
          for (final (i, w) in homeSections(data).indexed) Rise(index: 3 + i, child: w),
        ],
      ],
    );
  }
}

class _ParentBody extends StatelessWidget {
  const _ParentBody({required this.data});

  final HomeSnapshot data;

  @override
  Widget build(BuildContext context) {
    final named = [for (final k in data.children) k.student.name];
    final family = named.isEmpty ? [data.student.name] : named;
    final me = data.children.where((k) => k.student.id == data.student.id).firstOrNull;
    final name = data.student.name;
    // As the approved canvas: the child's live strip, the quick tiles, then only what needs the parent and what is coming.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_show('dayRibbon', 'timetable')) ...[
          Rise(
            index: 2,
            child: AnimatedSwitcher(
              duration: context.reduceMotion ? Duration.zero : AppMotion.t2,
              child: LiveStrip(
                key: ValueKey(data.student.id),
                name: name.split(' ').first,
                initials: Avatar.siblingInitials(name, family),
                avatar: childColour(name, family),
                periods: data.periods,
                teacherNames: data.teacherNames,
                status: me?.status,
                onTap: SchoolConfig.has('timetable') ? openTimetable : null,
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        const Rise(index: 3, child: QuickRow()),
        if (data.isNew)
          const Padding(padding: EdgeInsets.only(top: 24), child: Rise(index: 4, child: HomeWelcome()))
        else ...[
          Rise(index: 4, child: NeedsYou(data: data)),
          Rise(index: 5, child: ComingUp(items: data.upcoming)),
        ],
        Rise(index: 6, child: SiblingRow(data: data)),
      ],
    );
  }
}

/// The parent's bell: paper with the page's line, an amber dot when something is new.
class _Bell extends StatelessWidget {
  const _Bell();

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Pressable(
      onTap: () => Get.toNamed<void>(AppRoutes.notifications),
      label: 'notifications.title'.tr,
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(color: c.paper, shape: BoxShape.circle, border: Border.all(color: c.line)),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(PhosphorIconsRegular.bell, size: 20, color: c.ink),
            PositionedDirectional(
              top: 12,
              end: 12,
              child: Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(color: c.bright, shape: BoxShape.circle, border: Border.all(color: c.paper, width: 2)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WideBody extends StatelessWidget {
  const _WideBody({required this.data, required this.scrub, required this.parent});

  final HomeSnapshot data;
  final int? scrub;
  final bool parent;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          flex: 5,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Overline(todayLine()),
              const SizedBox(height: 8),
              Text(
                // A parent is greeted by their own name, as on a phone; a student by theirs.
                greeting(
                  (parent ? Get.find<AuthService>().user.value?.name ?? '' : data.student.name).split(' ').first,
                ).replaceAll('\n', ' '),
                style: context.type.dl,
              ),
              const SizedBox(height: 16),
              const QuickRow(),
              const SizedBox(height: 12),
              if (data.isNew) ...[
                const HomeWelcome(),
              ] else ...[
                NowCard(data: data, scrub: scrub, large: true),
                ...homeSections(data, parent: parent, only: const {'due', 'notices'}),
              ],
            ],
          ),
        ),
        const SizedBox(width: 24),
        Expanded(
          flex: 4,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 20),
              if (!data.isNew && !parent) ...homeSections(data, only: const {'stats'}),
              if (parent) ...[SectionLabel('home.both_children'.tr), ChildrenStrip(children: data.children)],
            ],
          ),
        ),
      ],
    );
  }
}

/// The "Now" card under the ribbon; follows the lens while scrubbing.
class NowCard extends StatelessWidget {
  const NowCard({required this.data, required this.scrub, this.large = false, super.key});

  final HomeSnapshot data;
  final int? scrub;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final periods = data.periods;
    if (periods.isEmpty) {
      return EduCard(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: c.mariSoft, borderRadius: BorderRadius.circular(10)),
              child: Icon(PhosphorIconsRegular.sun, size: 20, color: c.mariText),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('home.no_classes_today'.tr, style: context.type.t),
                  Text('home.no_classes_body'.tr, style: context.type.cap),
                ],
              ),
            ),
          ],
        ),
      );
    }
    final now = nowMinutes();
    final start = minutesOf(periods.first.start);
    final end = minutesOf(periods.last.end);
    final minute = scrub ?? now.clamp(start - 1, end + 1);
    final isNow = scrub == null;
    final p = periodAt(periods, minute.clamp(start, end))!;
    final a = minutesOf(p.start);
    final b = minutesOf(p.end);
    final klass = p.kind == PeriodKind.klass;
    final who = data.teacherNames[p.teacherId] ?? '';

    late final String when;
    late final String title;
    late final String meta;
    var pct = ((minute - a) / (b - a)).clamp(0.0, 1.0);
    if (isNow && now < start) {
      when = 'home.starts_at'.trp({'time': clockOf(start)});
      title = '${subjectName(p.subject)} · $who';
      meta = 'home.room_line'.trp({'room': p.room, 'start': clockOf(a), 'end': clockOf(b)});
      pct = 0;
    } else if (isNow && now > end) {
      when = 'home.done_today'.tr;
      title = 'home.school_over'.tr;
      meta = 'home.ended_at'.trp({'time': clockOf(end)});
      pct = 1;
    } else {
      final label = isNow ? 'home.now'.tr : (minute < now ? 'home.earlier'.tr : 'home.later'.tr);
      when = '$label · ${clockOf(minute)}';
      if (klass) {
        title = '${subjectName(p.subject)} · $who';
        final left = (b - minute).clamp(0, 999);
        meta =
            'home.room_line'.trp({'room': p.room, 'start': clockOf(a), 'end': clockOf(b)}) +
            (isNow ? ' · ${'home.min_left'.trp({'n': '$left'})}' : '');
      } else {
        final next = nextClassAfter(periods, p);
        title = subjectName(p.subject);
        meta = 'home.until_next'.trp({
          'time': clockOf(b),
          'next': next == null ? 'home.home_time'.tr : subjectName(next.subject),
        });
      }
    }
    return EduCard(
      padding: EdgeInsets.all(large ? 16 : 16),
      child: Row(
        children: [
          if (klass && !(isNow && now > end))
            Cover(subject: p.subject, large: large)
          else
            Hatch(
              radius: BorderRadius.circular(7),
              background: c.paper2,
              child: SizedBox(width: large ? 64 : 42, height: large ? 82 : 52),
            ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Overline(when, color: c.mariText),
                const SizedBox(height: 4),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: large ? context.type.h3 : context.type.t,
                ),
                const SizedBox(height: 2),
                Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: Stack(
                    children: [
                      Container(height: 4, color: c.line),
                      AnimatedFractionallySizedBox(
                        duration: AppMotion.t4,
                        widthFactor: pct,
                        child: Container(height: 4, color: c.ink),
                      ),
                    ],
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

class DueSection extends StatelessWidget {
  const DueSection({required this.items, super.key});

  final List<DueItem> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionLabel(
          'home.due_count'.trp({'n': '${items.length}'}),
          top: 24,
          action: 'common.see_all',
          onAction: () => Get.toNamed<void>(AppRoutes.homework),
        ),
        if (items.isEmpty)
          EduCard(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(PhosphorIconsRegular.checkCircle, color: AppColors.ok),
                const SizedBox(width: 12),
                Expanded(child: Text('home.nothing_due'.tr, style: context.type.t)),
              ],
            ),
          )
        else
          DueList(items: items.take(3).toList()),
      ],
    );
  }
}

class StatsRow extends StatelessWidget {
  const StatsRow({required this.data, this.attendance = true, this.exam = true, super.key});

  final HomeSnapshot data;

  /// Which halves the school shows (console: Home screen cards); one alone fills the row.
  final bool attendance;
  final bool exam;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final next = data.nextExam;
    final days = next == null ? null : Formatters.daysUntil(next.startDate);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (attendance)
          Expanded(
            child: EduCard(
              onTap: () => Get.toNamed<void>(AppRoutes.attendance),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Overline(DateFormat('MMMM', Get.locale?.languageCode).format(Clock.now())),
                  const SizedBox(height: 10),
                  BigNumber(value: data.summary.percent.round().toString(), unit: '%'),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 2,
                    runSpacing: 2,
                    children: [
                      for (final d in data.monthDays.where((d) => d.status != AttendanceStatus.holiday))
                        Dot(switch (d.status) {
                          AttendanceStatus.present => AppColors.ok,
                          AttendanceStatus.absent => AppColors.bad,
                          AttendanceStatus.lateArrival => AppColors.late,
                          AttendanceStatus.holiday => c.line2,
                        }),
                    ],
                  ),
                ],
              ),
            ),
          ),
          if (attendance && exam) const SizedBox(width: 10),
          if (exam)
          Expanded(
            child: EduCard(
              // The next exam opens its timetable; with none coming, the results.
              onTap: () => Get.toNamed<void>(next == null ? AppRoutes.results : AppRoutes.examTimetable),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Overline(next == null ? 'home.exam'.tr : 'home.exam_in'.trp({'name': next.name})),
                  const SizedBox(height: 10),
                  if (next == null)
                    Text('home.no_exam'.tr, style: context.type.t)
                  else
                    BigNumber(value: '$days', unit: ' ${'home.days'.tr}'),
                  const SizedBox(height: 10),
                  if (next != null)
                    Text(
                      'home.exam_meta'.trp({
                        'date': DateFormat('d MMM').format(next.startDate),
                        'n': '${next.subjects.length}',
                      }),
                      style: context.type.cap,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Wide display number with a narrower unit ("92%", "14 days").
class BigNumber extends StatelessWidget {
  const BigNumber({required this.value, this.unit = '', this.size = 48, super.key});

  final String value;
  final String unit;
  final double size;

  @override
  Widget build(BuildContext context) {
    final base = size >= 60 ? context.type.dx.copyWith(fontSize: size) : context.type.dl.copyWith(fontSize: size);
    return Text.rich(
      TextSpan(
        text: value,
        children: [
          TextSpan(
            text: unit,
            style: context.type.dl.copyWith(fontSize: size * .5, height: .9),
          ),
        ],
      ),
      style: base,
      maxLines: 1,
    );
  }
}

/// Status line shared by home rows ("6 days").
String daysStamp(DateTime date) {
  final d = Formatters.daysUntil(date);
  if (d == 0) return 'time.today'.tr;
  if (d == 1) return 'time.one_day'.tr;
  return 'time.n_days'.trn(d);
}
