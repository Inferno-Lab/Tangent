import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/schedule.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';

/// The parent's live strip (the approved canvas's home): the child ringed by how much of the lesson on now has gone, where
/// they are and with whom, the minutes left, and the day's lessons as one thin line with now marked. Small on purpose:
/// the owner wanted no big card on Home.
class LiveStrip extends StatefulWidget {
  const LiveStrip({
    required this.name,
    required this.initials,
    required this.avatar,
    required this.periods,
    required this.teacherNames,
    required this.status,
    this.onTap,
    super.key,
  });

  /// The child's first name.
  final String name;
  final String initials;
  final Color avatar;
  final List<PeriodSlot> periods;
  final Map<String, String> teacherNames;
  final AttendanceStatus? status;
  final VoidCallback? onTap;

  @override
  State<LiveStrip> createState() => _LiveStripState();
}

class _LiveStripState extends State<LiveStrip> with SingleTickerProviderStateMixin {
  // One clock for the entrance: the period line grows, the minutes roll in, then the ring fills.
  late final _c = AnimationController(vsync: this, duration: AppMotion.celebrate);
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _c.forward();
    // The strip is about now: it moves on with the clock.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final night = AppColors.blackboard;
    final w = widget;
    final now = nowMinutes();
    final lessons = w.periods;
    final start = lessons.isEmpty ? 0 : minutesOf(lessons.first.start);
    final end = lessons.isEmpty ? 0 : minutesOf(lessons.last.end);
    final p = lessons.isEmpty || now < start || now >= end ? null : periodAt(lessons, now);

    // What the strip says: the lesson on now, a break, the first lesson to come, the day done, or no lessons today.
    late final String over;
    late final String title;
    late final String sub;
    String? count;
    String? countLabel;
    var pct = 0.0;
    var tone = night.ink2;
    if (lessons.isEmpty) {
      over = w.name;
      title = 'home.no_classes_today'.tr;
      sub = 'home.no_classes_body'.tr;
    } else if (now < start) {
      final first = lessons.firstWhere((x) => x.kind == PeriodKind.klass, orElse: () => lessons.first);
      over = 'home.strip_starts'.trp({'name': w.name, 'time': clockOf(start)});
      title = subjectName(first.subject);
      sub = _who(first);
      tone = night.subjectFor(first.subject).ink;
      if (start - now <= 180) (count, countLabel) = ('${start - now}', 'home.min_to_go'.tr);
    } else if (p == null) {
      over = w.name;
      title = 'home.school_over'.tr;
      sub = 'home.ended_at'.trp({'time': clockOf(end)});
      pct = 1;
    } else {
      final a = minutesOf(p.start);
      final b = minutesOf(p.end);
      final klass = p.kind == PeriodKind.klass;
      over = (klass ? 'home.strip_in' : 'home.strip_on').trp({'name': w.name});
      title = subjectName(p.subject);
      sub = klass ? _who(p) : 'home.until_time'.trp({'time': clockOf(b)});
      tone = klass ? night.subjectFor(p.subject).ink : night.ink2;
      pct = ((now - a) / math.max(1, b - a)).clamp(0.0, 1.0);
      (count, countLabel) = ('${math.max(0, b - now)}', 'home.min_left_short'.tr);
    }
    final next = p == null ? null : nextClassAfter(lessons, p);
    final (statusKey, statusColor) = switch (w.status) {
      AttendanceStatus.present => ('home.status_present', AppColors.ok),
      AttendanceStatus.lateArrival => ('home.status_late', AppColors.late),
      AttendanceStatus.absent => ('home.status_absent', AppColors.bad),
      AttendanceStatus.holiday => ('home.status_holiday', night.ink3),
      null => ('home.status_not_marked', night.ink3),
    };
    final still = context.reduceMotion;

    return Pressable(
      onTap: w.onTap,
      scale: .985,
      label: '$over $title. $sub',
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
        decoration: BoxDecoration(
          color: c.deep,
          borderRadius: BorderRadius.circular(AppRadius.sheet),
          border: c.dark ? Border.all(color: c.line) : null,
        ),
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) {
            double at(double from, double to) => still ? 1 : Interval(from, to, curve: kEase).transform(_c.value);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    SizedBox.square(
                      dimension: 60,
                      child: Stack(
                        children: [
                          Positioned.fill(child: CustomPaint(painter: _Ring(pct * at(.35, 1), tone, c.onDeep.withValues(alpha: .12)))),
                          Positioned.fill(
                            child: Padding(
                              padding: const EdgeInsets.all(8),
                              child: Avatar(w.name, initials: w.initials, size: 44, background: w.avatar, foreground: AppColors.white),
                            ),
                          ),
                          if (w.status == AttendanceStatus.present || w.status == AttendanceStatus.lateArrival)
                            Positioned(
                              right: 1,
                              bottom: 1,
                              child: Container(
                                padding: const EdgeInsets.all(2),
                                decoration: BoxDecoration(color: c.deep, shape: BoxShape.circle),
                                child: PulseDot(statusColor),
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
                          Text(over, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.cap(color: c.onDeep2)),
                          Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.h3(color: tone)),
                          Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.cap(color: c.onDeep2)),
                        ],
                      ),
                    ),
                    if (count != null) ...[
                      const SizedBox(width: 12),
                      Opacity(
                        opacity: at(.2, .6),
                        child: Transform.translate(
                          offset: Offset(0, 12 * (1 - at(.2, .6))),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(count, style: AppText.h2(color: c.onDeep, height: 1, tabular: true)),
                              const SizedBox(height: 2),
                              Text(countLabel!, style: AppText.tiny(color: c.onDeep2)),
                            ],
                          ),
                        ),
                      ),
                    ] else if (lessons.isNotEmpty && p == null && now >= end)
                      Icon(PhosphorIconsBold.checkCircle, size: 24, color: AppColors.ok),
                  ],
                ),
                if (lessons.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _DayLine(periods: lessons, now: now, grow: (i) => at(math.min(.6, .1 + i * .05), math.min(1, .5 + i * .05))),
                  const SizedBox(height: 8),
                ] else
                  const SizedBox(height: 10),
                Row(
                  children: [
                    Icon(
                      w.status == AttendanceStatus.present ? PhosphorIconsBold.check : PhosphorIconsBold.circle,
                      size: 11,
                      color: statusColor,
                    ),
                    const SizedBox(width: 4),
                    Expanded(child: Text(statusKey.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.tiny(color: c.onDeep2))),
                    if (next != null)
                      Flexible(
                        child: Text(
                          'home.next_at'.trp({'subject': subjectName(next.subject), 'time': clockOf(minutesOf(next.start))}),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.end,
                          style: AppText.tiny(color: c.onDeep2),
                        ),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  String _who(PeriodSlot p) => [widget.teacherNames[p.teacherId] ?? '', p.room].where((x) => x.isNotEmpty).join(' · ');
}

/// The day's lessons as one thin line, each in its subject's colour: done ones faded, the one on now thicker, now marked.
class _DayLine extends StatelessWidget {
  const _DayLine({required this.periods, required this.now, required this.grow});

  final List<PeriodSlot> periods;
  final int now;
  final double Function(int i) grow;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final night = AppColors.blackboard;
    final start = minutesOf(periods.first.start);
    final span = math.max(1, minutesOf(periods.last.end) - start);
    return SizedBox(
      height: 12,
      child: LayoutBuilder(
        builder: (context, box) {
          final w = box.maxWidth;
          double x(int m) => (m - start) / span * w;
          final lessons = periods.where((p) => p.kind == PeriodKind.klass).toList();
          return Stack(
            clipBehavior: Clip.none,
            children: [
              for (final (i, p) in lessons.indexed)
                Builder(
                  builder: (context) {
                    final a = minutesOf(p.start);
                    final b = minutesOf(p.end);
                    final on = a <= now && now < b;
                    final h = on ? 10.0 : 6.0;
                    return Positioned(
                      left: x(a),
                      top: (12 - h) / 2,
                      width: math.max(2, x(b) - x(a) - 2),
                      height: h,
                      child: Transform.scale(
                        scaleX: grow(i),
                        alignment: AlignmentDirectional.centerStart,
                        child: Opacity(
                          opacity: b <= now ? .35 : (on ? 1 : .7),
                          child: DecoratedBox(
                            decoration: BoxDecoration(color: night.subjectFor(p.subject).fill, borderRadius: BorderRadius.circular(AppRadius.hair)),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              if (now >= start && now <= start + span)
                Positioned(
                  left: x(now) - 1,
                  top: -2,
                  width: 2,
                  height: 16,
                  child: DecoratedBox(decoration: BoxDecoration(color: c.bright, borderRadius: BorderRadius.circular(AppRadius.hair))),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// The ring round the child: its track, and how much of the lesson on now has gone.
class _Ring extends CustomPainter {
  _Ring(this.value, this.color, this.track);

  final double value;
  final Color color;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final r = rect.deflate(2);
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(r, 0, math.pi * 2, false, line..color = track);
    if (value > 0) canvas.drawArc(r, -math.pi / 2, math.pi * 2 * value, false, line..color = color);
  }

  @override
  bool shouldRepaint(_Ring old) => old.value != value || old.color != color || old.track != track;
}
