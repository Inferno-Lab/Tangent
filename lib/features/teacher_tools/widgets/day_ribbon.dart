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

/// The teacher's day as the old Home's ribbon (the approved canvas): tall columns from the top of the screen, one per
/// lesson, drawn to the length of the lesson; free time and breaks hatched; an amber line at now with the time; the hours
/// underneath. It scrolls sideways and opens on now.
class DayRibbon extends StatefulWidget {
  const DayRibbon({required this.periods, required this.label, required this.subject, this.height = 282, this.colourOf, super.key});

  /// A lesson's own colour (the teacher's: its class's); null takes the subject's.
  final SubjectColor Function(PeriodSlot)? colourOf;

  final List<PeriodSlot> periods;

  /// What a column says: the class for a teacher.
  final String Function(PeriodSlot) label;

  /// The teacher's subject: the colour of a lesson whose own subject is not known (each lesson takes its subject's colour).
  final String subject;
  final double height;

  @override
  State<DayRibbon> createState() => _DayRibbonState();
}

class _DayRibbonState extends State<DayRibbon> with SingleTickerProviderStateMixin {
  static const _perMinute = 2.4;
  static const _lead = 24.0;
  late final _drop = AnimationController(vsync: this, duration: AppMotion.celebrate);
  final _scroll = ScrollController();

  int get _start => minutesOf(widget.periods.first.start) - 10;
  int get _end => minutesOf(widget.periods.last.end) + 10;
  double _x(int m) => _lead + (m - _start) * _perMinute;

  @override
  void initState() {
    super.initState();
    _drop.forward();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final now = nowMinutes().clamp(_start, _end);
      final w = MediaQuery.sizeOf(context).width;
      _scroll.jumpTo((_x(now) - w * .4).clamp(0, _scroll.position.maxScrollExtent));
    });
  }

  @override
  void dispose() {
    _drop.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final pigment = c.subjectFor(widget.subject);
    final now = nowMinutes();
    final total = _x(_end) + _lead;
    final col = widget.height - 46;
    final still = context.reduceMotion;
    // The gaps between a teacher's lessons are free time; the school's breaks keep their own names.
    final blocks = <(int, int, PeriodSlot?)>[];
    for (final (i, p) in widget.periods.indexed) {
      final a = minutesOf(p.start);
      if (i > 0) {
        final prev = minutesOf(widget.periods[i - 1].end);
        if (a - prev >= 15) blocks.add((prev, a, null));
      }
      blocks.add((a, minutesOf(p.end), p));
    }
    return SizedBox(
      height: widget.height,
      child: SingleChildScrollView(
        controller: _scroll,
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        child: SizedBox(
          width: total,
          height: widget.height,
          child: AnimatedBuilder(
            animation: _drop,
            builder: (context, _) => Stack(
              clipBehavior: Clip.none,
              children: [
                for (final (i, (a, b, p)) in blocks.indexed)
                  Positioned(
                    left: _x(a) + 2,
                    top: 0,
                    width: math.max(8, (b - a) * _perMinute - 4),
                    height: col,
                    child: FractionalTranslation(
                      // Each column drops in from above, a beat after the one before.
                      translation: Offset(0, still ? 0 : -1.04 * (1 - Interval(math.min(.5, i * .07), math.min(1, .5 + i * .07), curve: kEase).transform(_drop.value))),
                      child: p != null && p.kind == PeriodKind.klass ? _lesson(context, p, now, widget.colourOf?.call(p) ?? pigment) : _gap(context, p),
                    ),
                  ),
                if (now >= _start && now <= _end) ...[
                  Positioned(
                    left: _x(now) - 1,
                    top: 0,
                    width: 2,
                    height: col + 8,
                    child: DecoratedBox(decoration: BoxDecoration(color: c.bright)),
                  ),
                  Positioned(
                    left: _x(now) - 28,
                    top: col - 10,
                    width: 56,
                    height: 24,
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: c.bright, borderRadius: BorderRadius.circular(AppRadius.pill)),
                      child: Center(child: Text(clockOf(now), style: AppText.mono(color: c.onBright, height: 1))),
                    ),
                  ),
                ],
                for (var h = (_start ~/ 60) + 1; h * 60 <= _end; h++)
                  Positioned(left: _x(h * 60) + 4, top: col + 22, child: Text(clockOf(h * 60), style: AppText.mono(color: c.ink3))),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _lesson(BuildContext context, PeriodSlot p, int now, SubjectColor pigment) {
    final a = minutesOf(p.start);
    final b = minutesOf(p.end);
    final past = b <= now;
    // A lesson that is over keeps its colour (after school every lesson is over); a check says it is done.
    final ground = pigment.fill;
    final ink = pigment.on;
    return Semantics(
      label: tidySeparators('${widget.label(p)} · ${p.room} · ${clockOf(a)} – ${clockOf(b)}'),
      child: DecoratedBox(
        decoration: BoxDecoration(color: ground, borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.panel))),
        child: Stack(
          children: [
            // The subject's signs fill the tall column above the words.
            Positioned.fill(bottom: 76, child: ClipRect(child: SubjectMotif(subject: p.subject, color: ink))),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 0, 6, 16),
                child: Align(
                  alignment: AlignmentDirectional.bottomStart,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (past) Icon(PhosphorIconsBold.checkCircle, size: 18, color: ink, semanticLabel: 'common.done'.tr),
                      Text(widget.label(p), maxLines: 1, overflow: TextOverflow.clip, style: AppText.h3(color: ink)),
                      if (p.room.isNotEmpty)
                        Text(p.room, maxLines: 1, overflow: TextOverflow.clip, style: AppText.capB(color: ink.withValues(alpha: .86))),
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: AlignmentDirectional.centerStart,
                        child: Text('${clockOf(a)}–${clockOf(b)}', maxLines: 1, style: AppText.mono(color: ink.withValues(alpha: .86))),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _gap(BuildContext context, PeriodSlot? p) {
    final c = context.app;
    // A break without a name of its own in the app's words reads as free time.
    final named = p == null ? null : subjectName(p.subject);
    final name = named == null || named.startsWith('subject.') ? 'teacher.free'.tr : named;
    return Semantics(
      label: name,
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.panel)),
        child: CustomPaint(
          painter: _Hatch(c.paper3, c.chalk),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 20),
            child: Align(
              alignment: Alignment.bottomCenter,
              child: RotatedBox(quarterTurns: 3, child: Text(name.toUpperCase(), maxLines: 1, overflow: TextOverflow.clip, style: AppText.o(color: c.ink3))),
            ),
          ),
        ),
      ),
    );
  }
}

/// Diagonal hatching for free time and breaks.
class _Hatch extends CustomPainter {
  _Hatch(this.line, this.ground);

  final Color line;
  final Color ground;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = ground);
    final p = Paint()
      ..color = line
      ..strokeWidth = 6;
    for (var x = -size.height; x < size.width; x += 12) {
      canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
    }
  }

  @override
  bool shouldRepaint(_Hatch old) => old.line != line || old.ground != ground;
}
