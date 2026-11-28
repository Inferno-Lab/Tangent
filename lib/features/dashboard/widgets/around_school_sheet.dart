import 'dart:async';
import 'dart:math' as math;

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
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/dashboard/controllers/around_school_controller.dart';
import 'package:tangent/features/events/controllers/events_controller.dart';
import 'package:tangent/features/dashboard/widgets/home_cards.dart' show QuickRow;

/// Opens "Around school": the school's other pages as tiles, each showing a line of its own content.
Future<void> openAroundSchool() async {
  Get.put(AroundSchoolController());
  await showSheet<void>(const AroundSchoolSheet());
  await Get.delete<AroundSchoolController>();
}

/// One tile: how wide (one column or both), how tall, and what it draws.
typedef _Tile = ({bool wide, double height, Widget child});

/// The sheet (the approved canvas): a search field, then tiles of two widths in the order a family or a teacher reaches
/// for them. A tile shows only where the school has its module and the console did not put it in the dock.
class AroundSchoolSheet extends StatelessWidget {
  const AroundSchoolSheet({super.key});

  static bool _open(String module, [String? tab]) => SchoolConfig.has(module) && !SchoolConfig.dock.contains(tab ?? module);

  /// Whether the sheet would show anything (Home hides its tile otherwise).
  static bool hasAny() => ['notices', 'events', 'gallery', 'library', 'diary', 'transport', 'ptm', 'visitors', 'certificates', 'forms']
      .any((m) => SchoolConfig.has(m) && !SchoolConfig.dock.contains(m)) || Get.find<AuthService>().role != UserRole.teacher;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final ctrl = Get.find<AroundSchoolController>();
    final screen = MediaQuery.sizeOf(context).height;
    final top = MediaQuery.paddingOf(Get.context ?? context).top;
    return Container(
      height: math.max(320, screen - top - 24),
      decoration: BoxDecoration(color: c.chalk, borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Grab(),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 16, 0),
              child: Row(
                children: [
                  Expanded(child: Text('school.around_title'.tr, style: context.type.h2)),
                  Pressable(
                    onTap: Get.back<void>,
                    label: 'common.close'.tr,
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(color: c.paper, shape: BoxShape.circle, border: Border.all(color: c.line)),
                      child: Icon(PhosphorIconsBold.x, size: 16, color: c.ink),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Pressable(
                onTap: () {
                  Get.back<void>();
                  unawaited(Get.toNamed<void>(AppRoutes.search));
                },
                label: 'school.search'.tr,
                child: Container(
                  height: 48,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: c.line)),
                  child: Row(
                    children: [
                      Icon(PhosphorIconsRegular.magnifyingGlass, size: 18, color: c.ink3),
                      const SizedBox(width: 10),
                      Expanded(child: Text('school.search'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.s.copyWith(color: c.ink3))),
                    ],
                  ),
                ),
              ),
            ),
            Expanded(
              child: Obx(() {
                ctrl.loading.value;
                final tiles = _tiles(context, ctrl.glance.value);
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  children: [for (final (i, row) in _rows(tiles).indexed) Rise(index: i, child: row)],
                );
              }),
            ),
          ],
        ),
      ),
    );
  }

  /// Packs tiles into rows: a wide tile takes a row, narrow ones pair up, and a narrow one left alone takes the row.
  List<Widget> _rows(List<_Tile> tiles) {
    final rows = <Widget>[];
    _Tile? held;
    Widget one(_Tile t) => SizedBox(height: t.height, child: t.child);
    void flush() {
      if (held != null) rows.add(one(held!));
      held = null;
    }

    for (final t in tiles) {
      if (t.wide) {
        flush();
        rows.add(one(t));
      } else if (held == null) {
        held = t;
      } else {
        final h = math.max(held!.height, t.height);
        rows.add(SizedBox(height: h, child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(child: held!.child), const SizedBox(width: 8), Expanded(child: t.child)])));
        held = null;
      }
    }
    flush();
    return [for (final (i, r) in rows.indexed) Padding(padding: EdgeInsets.only(top: i == 0 ? 0 : 8), child: r)];
  }

  List<_Tile> _tiles(BuildContext context, SchoolGlance g) {
    final auth = Get.find<AuthService>();
    final teacher = auth.role == UserRole.teacher;
    final parent = auth.role == UserRole.parent;
    final student = auth.role == UserRole.student;
    final lang = Get.locale?.languageCode;
    String day(DateTime d) => DateFormat('EEE d MMM', lang).format(d);
    void go(String route) {
      Get.back<void>();
      unawaited(Get.toNamed<void>(route));
    }

    return [
      // The console's quick buttons that did not fit on Home come first.
      if (!teacher)
        for (final (icon, key, onTap, colour) in QuickRow.overflow)
          (wide: false, height: 72, child: _SmallTile(icon: icon, colour: colour, title: key.tr, line: 'school.shortcut'.tr, onTap: () {
            Get.back<void>();
            onTap?.call();
          })),
      if (!teacher && _open('transport') && g.bus != null)
        (wide: true, height: 124, child: _BusTile(glance: g, onTap: () => go(AppRoutes.transport))),
      if (_open('notices'))
        (wide: false, height: 158, child: _NoticesTile(glance: g, onTap: () => go(AppRoutes.notices))),
      if (_open('events'))
        (wide: false, height: 158, child: _EventsTile(glance: g, day: day, onTap: () => go(AppRoutes.events))),
      if (_open('diary'))
        (
          wide: true,
          height: teacher ? 84 : 112,
          child: _QuoteTile(
            over: g.diary == null ? 'school.diary'.tr : 'school.diary_on'.trp({'date': _diaryDay(g.diary!.date, lang)}),
            text: teacher ? 'school.diary_write'.tr : (g.diary?.text.isNotEmpty ?? false ? g.diary!.text : 'school.diary_none'.tr),
            by: teacher ? null : g.diary?.by,
            onTap: () => go(teacher ? AppRoutes.teacherDiary : AppRoutes.diary),
          ),
        ),
      if (_open('ptm', 'meetings') && parent)
        (wide: false, height: 138, child: _MeetingTile(glance: g, day: day, onTap: () => go(AppRoutes.meetings))),
      if (_open('ptm', 'meetings') && teacher)
        (wide: false, height: 138, child: _SmallTile(icon: PhosphorIconsRegular.calendarDots, colour: 'violet', title: 'school.meeting_title'.tr, line: 'school.meeting_slots'.tr, tall: true, onTap: () => go(AppRoutes.teacherMeetings))),
      if (_open('visitors', 'gatePass') && parent)
        (wide: false, height: 138, child: _PickupTile(glance: g, onTap: () => go(AppRoutes.gatePass))),
      if (_open('visitors', 'invite') && teacher)
        (wide: false, height: 138, child: _SmallTile(icon: PhosphorIconsRegular.userPlus, colour: 'pink', title: 'menu.invite_visitor'.tr, line: 'school.invite_line'.tr, tall: true, onTap: () => go(AppRoutes.inviteVisitor))),
      if (_open('library'))
        (wide: false, height: 138, child: _LibraryTile(glance: g, day: day, onTap: () => go(AppRoutes.library))),
      if (_open('gallery'))
        (wide: false, height: 138, child: _GalleryTile(glance: g, onTap: () => go(AppRoutes.gallery))),
      if (!teacher)
        (wide: false, height: 72, child: _SmallTile(icon: PhosphorIconsRegular.calendarCheck, colour: 'blue', title: 'menu.leave'.tr, line: 'school.leave_line'.tr, onTap: () => go(AppRoutes.leave))),
      if (_open('certificates') && parent)
        (
          wide: false,
          height: 72,
          child: _SmallTile(
            icon: PhosphorIconsRegular.certificate,
            colour: 'teal',
            title: 'menu.certificates'.tr,
            line: g.certificatesOpen == 0 ? 'school.cert_line'.tr : 'school.cert_open'.trn(g.certificatesOpen),
            onTap: () => go(AppRoutes.certificates),
          ),
        ),
      if (!student)
        (
          wide: false,
          height: 72,
          child: _SmallTile(
            icon: PhosphorIconsRegular.clipboardText,
            colour: 'lime',
            title: 'menu.forms'.tr,
            line: g.formsWaiting == 0 ? 'school.forms_none'.tr : 'school.forms_waiting'.trn(g.formsWaiting),
            badge: g.formsWaiting == 0 ? null : '${g.formsWaiting}',
            onTap: () => go(AppRoutes.forms),
          ),
        ),
    ];
  }

  static String _diaryDay(String iso, String? lang) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return DateUtils.isSameDay(d, Clock.now()) ? 'time.today'.tr.toLowerCase() : DateFormat('d MMM', lang).format(d);
  }
}

/// A tile's frame: the page's paper, its line, its corners and its press.
class _Frame extends StatelessWidget {
  const _Frame({required this.child, required this.onTap, required this.label, this.padding = const EdgeInsets.all(16)});

  final Widget child;
  final VoidCallback onTap;
  final String label;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    label: label,
    child: Container(
      padding: padding,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(color: context.app.paper, borderRadius: BorderRadius.circular(AppRadius.card), border: Border.all(color: context.app.line)),
      child: child,
    ),
  );
}

/// The amber count on a tile ("2 new", "1").
class _Badge extends StatelessWidget {
  const _Badge(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Container(
    height: 24,
    constraints: const BoxConstraints(minWidth: 24),
    padding: const EdgeInsets.symmetric(horizontal: 8),
    decoration: BoxDecoration(color: context.app.bright, borderRadius: BorderRadius.circular(AppRadius.pill)),
    child: Center(widthFactor: 1, child: Text(text, style: AppText.tiny(color: context.app.onBright))),
  );
}

/// Grows its child from 0 to 1 once, after [delay] (for the drawings inside tiles).
class _Grow extends StatefulWidget {
  const _Grow({required this.builder, this.delay = Duration.zero, this.duration = AppMotion.t4});

  final Widget Function(BuildContext, double) builder;
  final Duration delay;
  final Duration duration;

  @override
  State<_Grow> createState() => _GrowState();
}

class _GrowState extends State<_Grow> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: widget.duration);
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => context.reduceMotion
      ? widget.builder(context, 1)
      : AnimatedBuilder(animation: _c, builder: (context, _) => widget.builder(context, kEase.transform(_c.value)));
}

class _BusTile extends StatelessWidget {
  const _BusTile({required this.glance, required this.onTap});

  final SchoolGlance glance;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final bus = glance.bus!;
    final mine = bus.stops.indexWhere((s) => s.isMine);
    final line = mine < 0
        ? (bus.stops.isEmpty ? 'school.bus_no_stops'.tr : 'school.bus_stops'.trn(bus.stops.length))
        : 'school.bus_line'.trp({'first': bus.stops.first.time, 'stop': bus.stops[mine].name, 'time': bus.stops[mine].time});
    return _Frame(
      onTap: onTap,
      label: '${'school.bus_title'.trp({'route': bus.routeName})}. $line',
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('school.bus_title'.trp({'route': bus.routeName}), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t)),
              if (mine >= 0) Text('school.bus_your_stop'.trp({'n': '${mine + 1}'}), style: context.type.cap),
            ],
          ),
          Text(line, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
          const Spacer(),
          SizedBox(
            height: 36,
            child: _Grow(
              delay: AppMotion.t2,
              duration: AppMotion.celebrate,
              builder: (context, t) => CustomPaint(size: Size.infinite, painter: _Route(t, bus.stops.length, mine, c.bright, c.line2, c.paper)),
            ),
          ),
        ],
      ),
    );
  }
}

/// The route as a gentle line with its stops; the line draws itself in, the child's stop ringed in amber.
class _Route extends CustomPainter {
  _Route(this.t, this.stops, this.mine, this.amber, this.dot, this.ground);

  final double t;
  final int stops;
  final int mine;
  final Color amber;
  final Color dot;
  final Color ground;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    double y(double x) => h / 2 + math.sin(x / w * math.pi * 2.2) * h * .28;
    final path = Path()..moveTo(8, y(8));
    for (var x = 8.0; x <= w - 8; x += 4) {
      path.lineTo(x, y(x));
    }
    final metric = path.computeMetrics().first;
    canvas.drawPath(
      metric.extractPath(0, metric.length * t),
      Paint()
        ..color = amber
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round,
    );
    final n = math.max(2, stops);
    for (var i = 0; i < n; i++) {
      final at = i / (n - 1);
      if (at > t + .001) break;
      final p = metric.getTangentForOffset(metric.length * at)!.position;
      final own = i == mine;
      canvas
        ..drawCircle(p, own ? 8 : 5, Paint()..color = ground)
        ..drawCircle(
          p,
          own ? 6 : 3.5,
          Paint()
            ..color = own || i == 0 ? amber : dot
            ..style = own ? PaintingStyle.stroke : PaintingStyle.fill
            ..strokeWidth = 3,
        );
    }
  }

  @override
  bool shouldRepaint(_Route old) => old.t != t || old.stops != stops || old.mine != mine;
}

class _NoticesTile extends StatelessWidget {
  const _NoticesTile({required this.glance, required this.onTap});

  final SchoolGlance glance;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final n = glance.latestNotice;
    return _Frame(
      onTap: onTap,
      label: 'menu.notices'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text('menu.notices'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t)),
              if (glance.newNotices > 0) _Badge('school.n_new'.trp({'n': '${glance.newNotices}'})),
            ],
          ),
          const SizedBox(height: 10),
          Expanded(
            child: n == null
                ? const _Nothing(art: EmptyArt.notices, line: 'school.notices_none')
                : _Grow(
                    delay: AppMotion.t2,
                    builder: (context, t) => Stack(
                      clipBehavior: Clip.none,
                      children: [
                        // Two notices fanned like papers on a desk; the front one is the latest.
                        Positioned.fill(
                          left: 10,
                          right: 14,
                          bottom: 8,
                          child: Transform.rotate(
                            angle: -.12 * t,
                            alignment: Alignment.bottomCenter,
                            child: DecoratedBox(decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(AppRadius.md), border: Border.all(color: c.line))),
                          ),
                        ),
                        Positioned.fill(
                          top: 4,
                          right: 8,
                          child: Transform.rotate(
                            angle: .07 * t,
                            alignment: Alignment.bottomCenter,
                            child: Container(
                              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                              decoration: BoxDecoration(color: c.chalk, borderRadius: BorderRadius.circular(AppRadius.md), border: Border.all(color: c.line2)),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(_when(n.date), style: AppText.tiny(color: c.badText)),
                                  const SizedBox(height: 4),
                                  Expanded(child: Text(n.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: AppText.capB(color: c.ink, height: 1.2))),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  static String _when(DateTime d) {
    final days = Clock.now().difference(d).inDays;
    if (DateUtils.isSameDay(d, Clock.now())) return 'school.today'.tr;
    return days == 1 ? 'school.yesterday'.tr : DateFormat('d MMM', Get.locale?.languageCode).format(d);
  }
}

class _EventsTile extends StatelessWidget {
  const _EventsTile({required this.glance, required this.day, required this.onTap});

  final SchoolGlance glance;
  final String Function(DateTime) day;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final e = glance.nextEvent;
    final days = e == null ? 0 : Formatters.daysUntil(e.date);
    return _Frame(
      onTap: onTap,
      label: 'menu.events'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('menu.events'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t),
          Expanded(
            child: e == null
                ? const _Nothing(art: EmptyArt.events, line: 'school.events_none')
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _Grow(
                        delay: AppMotion.t3,
                        builder: (context, t) => Opacity(
                          opacity: t,
                          child: Transform.translate(
                            offset: Offset(0, 16 * (1 - t)),
                            child: Text(days == 0 ? 'school.today_short'.tr : '$days', style: AppText.dl(color: c.spectrumFor('green').ink)),
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Text(
                            days == 0 ? e.title : 'school.days_to'.trp({'title': e.title}),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.cap(color: c.ink3, height: 1.2),
                          ),
                        ),
                      ),
                    ],
                  ),
          ),
          if (e != null) ...[
            const SizedBox(height: 6),
            Text('${day(e.date)} · ${eventTime(e)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.capB),
          ],
        ],
      ),
    );
  }
}

class _QuoteTile extends StatelessWidget {
  const _QuoteTile({required this.over, required this.text, required this.by, required this.onTap});

  final String over;
  final String text;
  final String? by;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return _Frame(
      onTap: onTap,
      label: '$over. $text',
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('“', style: AppText.dl(color: c.spectrumFor('blue').ink, height: .8)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(over, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.capB(color: c.ink3)),
                const SizedBox(height: 2),
                Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.type.ts),
                if (by != null && by!.isNotEmpty) Text(by!, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MeetingTile extends StatelessWidget {
  const _MeetingTile({required this.glance, required this.day, required this.onTap});

  final SchoolGlance glance;
  final String Function(DateTime) day;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final m = glance.meeting;
    final when = m == null ? null : DateTime.tryParse(m.date);
    final slots = glance.slots.take(3).toList();
    return _Frame(
      onTap: onTap,
      label: 'school.meeting_title'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('school.meeting_title'.tr, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.ts(color: c.ink, height: 1.15)),
          Text(
            m == null ? 'school.meeting_none'.tr : [if (when != null) day(when), m.place].where((x) => x.isNotEmpty).join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.type.cap,
          ),
          if (slots.isEmpty) const Expanded(child: _Nothing(art: EmptyArt.events)) else const Spacer(),
          if (slots.isNotEmpty)
            Row(
              children: [
                for (final (i, s) in slots.indexed) ...[
                  if (i > 0) const SizedBox(width: 4),
                  Expanded(
                    child: _Grow(
                      delay: AppMotion.t2 + AppMotion.stagger * (i * 2),
                      builder: (context, t) => Transform.scale(
                        scale: .6 + .4 * t,
                        child: Opacity(
                          opacity: t,
                          child: Container(
                            height: 32,
                            decoration: BoxDecoration(
                              color: i == 0 ? c.brand : null,
                              borderRadius: BorderRadius.circular(AppRadius.sm),
                              border: Border.all(color: i == 0 ? c.brand : c.line2),
                            ),
                            child: Center(
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(clockOf(s.hour * 60 + s.minute), style: AppText.mono(color: i == 0 ? c.onBrand : c.ink)),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}

class _PickupTile extends StatelessWidget {
  const _PickupTile({required this.glance, required this.onTap});

  final SchoolGlance glance;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final people = glance.pickups.take(3).toList();
    return _Frame(
      onTap: onTap,
      label: 'school.pickup_title'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('school.pickup_title'.tr, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.ts(color: c.ink, height: 1.15)),
          Text('school.pickup_line'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
          const Spacer(),
          Row(
            children: [
              SizedBox(
                height: 30,
                width: people.isEmpty ? 0 : 30 + 22.0 * (people.length - 1),
                child: Stack(
                  children: [
                    for (final (i, p) in people.indexed)
                      Positioned(
                        left: 22.0 * i,
                        child: Container(
                          padding: const EdgeInsets.all(2),
                          decoration: BoxDecoration(color: c.paper, shape: BoxShape.circle),
                          child: Avatar(p.name, size: 26, background: AppColors.spectrum(const ['indigo', 'teal', 'pink'][i % 3]).fill, foreground: AppColors.white),
                        ),
                      ),
                  ],
                ),
              ),
              const Spacer(),
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: c.brand, shape: BoxShape.circle),
                child: Icon(PhosphorIconsBold.plus, size: 16, color: c.onBrand),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LibraryTile extends StatelessWidget {
  const _LibraryTile({required this.glance, required this.day, required this.onTap});

  final SchoolGlance glance;
  final String Function(DateTime) day;
  final VoidCallback onTap;

  static const _spines = [(10.0, 52.0, 'blue'), (8.0, 44.0, 'red'), (12.0, 58.0, 'amber'), (9.0, 40.0, 'green'), (11.0, 54.0, 'pink'), (8.0, 46.0, 'teal'), (10.0, 36.0, 'indigo')];

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final b = glance.book;
    final line = b?.dueDate != null
        ? 'school.return_by'.trp({'date': day(b!.dueDate!)})
        : glance.books > 0
        ? 'school.books_out'.trn(glance.books)
        : 'school.books_none'.tr;
    return _Frame(
      onTap: onTap,
      label: 'menu.library'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('menu.library'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts),
          Text(line, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap.copyWith(color: (b?.overdueDays ?? 0) > 0 ? c.badText : null)),
          Expanded(
            child: Align(
              alignment: AlignmentDirectional.bottomStart,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (final (i, (w, h, colour)) in _spines.indexed) ...[
                    if (i > 0) const SizedBox(width: 2),
                    _Grow(
                      delay: AppMotion.t2 + AppMotion.stagger * i,
                      builder: (context, t) => Container(
                        width: w,
                        height: h * .9 * t,
                        decoration: BoxDecoration(
                          color: c.spectrumFor(colour).fill,
                          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.hair)),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GalleryTile extends StatelessWidget {
  const _GalleryTile({required this.glance, required this.onTap});

  final SchoolGlance glance;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final a = glance.album;
    final photos = a?.photos.take(3).toList() ?? const [];
    Widget cell(int i, String colour) {
      final ground = DecoratedBox(decoration: BoxDecoration(color: c.spectrumFor(colour).soft));
      return _Grow(
        delay: AppMotion.t2 + AppMotion.stagger * (i * 2),
        builder: (context, t) => Opacity(
          opacity: t,
          child: i < photos.length
              ? Image.network(photos[i].url, fit: BoxFit.cover, errorBuilder: (_, _, _) => ground, frameBuilder: (_, child, frame, sync) => frame == null && !sync ? ground : child)
              : ground,
        ),
      );
    }

    return _Frame(
      onTap: onTap,
      label: 'menu.gallery'.tr,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('menu.gallery'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts),
          Text(a == null ? 'school.gallery_none'.tr : 'school.album_line'.trp({'title': a.title, 'n': '${a.photos.length}'}), maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
          const SizedBox(height: 8),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 2, child: cell(0, 'cyan')),
                  const SizedBox(width: 2),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [Expanded(child: cell(1, 'amber')), const SizedBox(height: 2), Expanded(child: cell(2, 'green'))],
                    ),
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

/// What a tile shows when it has nothing yet: its section's small animated drawing and, when the tile has room, a line
/// saying so (instead of a bare line under an empty box).
class _Nothing extends StatelessWidget {
  const _Nothing({required this.art, this.line});

  final EmptyArt art;
  final String? line;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final withLine = line != null && box.maxHeight >= 84;
      return Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // The scene is drawn for a page; here it is scaled down whole to the tile, never cut.
          SizedBox(
            height: (box.maxHeight - (withLine ? 22 : 0)).clamp(0, 80),
            child: FittedBox(child: SizedBox(width: 320, height: 214, child: EmptyArtView(art, caption: false))),
          ),
          if (withLine) ...[
            const SizedBox(height: 4),
            Text(line!.tr, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: context.type.cap),
          ],
        ],
      );
    },
  );
}

class _SmallTile extends StatelessWidget {
  const _SmallTile({required this.icon, required this.colour, required this.title, required this.line, required this.onTap, this.badge, this.tall = false});

  final IconData icon;
  final String colour;
  final String title;
  final String line;
  final String? badge;
  final bool tall;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final words = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(title, maxLines: tall ? 2 : 1, overflow: TextOverflow.ellipsis, style: AppText.ts(color: c.ink, height: 1.15)),
        Text(line, maxLines: tall ? 2 : 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
      ],
    );
    return _Frame(
      onTap: onTap,
      label: '$title. $line',
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: tall
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [Icon(icon, size: 22, color: c.spectrumFor(colour).ink), const Spacer(), words],
            )
          : Row(
              children: [
                Icon(icon, size: 22, color: c.spectrumFor(colour).ink),
                const SizedBox(width: 10),
                Expanded(child: words),
                if (badge != null) ...[const SizedBox(width: 6), _Badge(badge!)],
              ],
            ),
    );
  }
}
