import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/ui.dart';

/// The school ID card on Profile (the approved canvas): a deep tone of the person's colour, a lanyard slot, the school's
/// crest as a faint watermark, the photo, the name and three small fields. A tap turns it over to the
/// code the gate reads and what the school needs in a hurry; its sheen passes once when it arrives.
class IdBadge extends StatefulWidget {
  const IdBadge({
    required this.accent,
    required this.school,
    required this.kind,
    required this.name,
    required this.line,
    required this.fields,
    required this.code,
    required this.codeTitle,
    required this.back,
    this.photo,
    super.key,
  });

  final Color accent;
  final String school;

  /// "Student" or "Staff".
  final String kind;
  final String name;
  final String line;

  /// Up to three small fields along the bottom (ID number, blood group, year).
  final List<(String, String)> fields;

  /// What the back shows large: the day's pick-up code, or the ID number.
  final String code;
  final String codeTitle;
  final List<(String, String)> back;

  /// A photo on the phone, when the person has added one.
  final String? photo;

  @override
  State<IdBadge> createState() => _IdBadgeState();
}

class _IdBadgeState extends State<IdBadge> with TickerProviderStateMixin {
  late final _turn = AnimationController(vsync: this, duration: AppMotion.t4);
  late final _sheen = AnimationController(vsync: this, duration: AppMotion.celebrate);

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(AppMotion.t4, () {
      if (mounted) _sheen.forward();
    }).ignore();
  }

  @override
  void dispose() {
    _turn.dispose();
    _sheen.dispose();
    super.dispose();
  }

  void _flip() => _turn.value < .5 ? _turn.forward() : _turn.reverse();

  // A sideways swipe turns the card under the finger, from either face; letting go settles on the nearer face, or the one a
  // flick points to. A drag that starts mid-turn picks the card up where it is.
  double _width = 1;
  void _drag(DragUpdateDetails d) {
    _turn.stop();
    final dir = Directionality.of(context) == TextDirection.rtl ? -1 : 1;
    _turn.value = (_turn.value - dir * d.delta.dx / _width).clamp(0.0, 1.0);
  }

  void _let(DragEndDetails d) {
    final dir = Directionality.of(context) == TextDirection.rtl ? -1 : 1;
    final v = -dir * (d.primaryVelocity ?? 0) / _width;
    final toBack = v.abs() > 1.5 ? v > 0 : _turn.value > .5;
    if (context.reduceMotion) {
      _turn.value = toBack ? 1 : 0;
    } else {
      _turn.animateTo(toBack ? 1 : 0, curve: kEase);
    }
  }

  @override
  Widget build(BuildContext context) {
    final still = context.reduceMotion;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: AspectRatio(
          aspectRatio: 350 / 220,
          child: LayoutBuilder(
            builder: (context, box) {
              _width = box.maxWidth;
              return GestureDetector(
                onHorizontalDragUpdate: _drag,
                onHorizontalDragEnd: _let,
                child: Pressable(
            onTap: still ? () => _turn.value = _turn.value < .5 ? 1 : 0 : _flip,
            scale: .985,
            label: 'profile.card_label'.trp({'name': widget.name}),
            child: AnimatedBuilder(
              animation: Listenable.merge([_turn, _sheen]),
              builder: (context, _) {
                final t = kEase.transform(_turn.value);
                final back = t > .5;
                final angle = math.pi * t;
                return Transform(
                  alignment: Alignment.center,
                  transform: Matrix4.identity()
                    ..setEntry(3, 2, .0011)
                    ..rotateY(angle),
                  child: back
                      ? Transform(alignment: Alignment.center, transform: Matrix4.rotationY(math.pi), child: _face(context, front: false))
                      : _face(context, front: true),
                );
              },
            ),
          ),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _face(BuildContext context, {required bool front}) {
    final c = context.app;
    final light = AppColors.light;
    final ground = Color.lerp(widget.accent, light.deep, c.dark ? .58 : .44)!;
    final on = light.onDeep;
    return LayoutBuilder(
      builder: (context, box) {
        final k = box.maxWidth / 350;
        return Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: ground,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: on.withValues(alpha: .08)),
            boxShadow: [BoxShadow(color: light.deep.withValues(alpha: .16), blurRadius: 24, offset: const Offset(0, 8))],
          ),
          child: Stack(
            children: [
              if (front)
                PositionedDirectional(
                  end: -34 * k,
                  bottom: -46 * k,
                  child: Icon(PhosphorIconsRegular.shieldCheck, size: 200 * k, color: on.withValues(alpha: .07)),
                ),
              // The lanyard slot, punched through to the page.
              Align(
                alignment: Alignment.topCenter,
                child: Padding(
                  padding: EdgeInsets.only(top: 8 * k),
                  child: Container(
                    width: 42 * k,
                    height: 7 * k,
                    decoration: BoxDecoration(color: c.chalk, borderRadius: BorderRadius.circular(AppRadius.pill)),
                  ),
                ),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(16 * k, 24 * k, 16 * k, 16 * k),
                child: front ? _front(context, on, k) : _back(context, on, k),
              ),
              if (front && !context.reduceMotion && _sheen.value > 0 && _sheen.value < 1)
                Positioned.fill(
                  child: IgnorePointer(
                    child: FractionalTranslation(
                      translation: Offset(-1.2 + 2.6 * kEase.transform(_sheen.value), 0),
                      child: FractionallySizedBox(
                        widthFactor: .4,
                        alignment: Alignment.centerLeft,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(colors: [on.withValues(alpha: 0), on.withValues(alpha: .12), on.withValues(alpha: 0)]),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _front(BuildContext context, Color on, double k) {
    final w = widget;
    final local = w.photo != null && w.photo!.isNotEmpty && !w.photo!.startsWith('http');
    final initials = Text(Avatar.initialsOf(w.name), style: AppText.h2(color: AppColors.white));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 24 * k,
              height: 24 * k,
              decoration: BoxDecoration(color: on.withValues(alpha: .16), borderRadius: BorderRadius.circular(AppRadius.xs)),
              child: Center(child: Text(w.school.isEmpty ? '' : w.school.characters.first.toUpperCase(), style: AppText.tiny(color: on))),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(w.school, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.chip(color: on))),
            const SizedBox(width: 8),
            Text(w.kind.toUpperCase(), style: AppText.o(color: on.withValues(alpha: .7))),
          ],
        ),
        SizedBox(height: 16 * k),
        Row(
          children: [
            Container(
              width: 62 * k,
              height: 74 * k,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: Color.lerp(w.accent, AppColors.white, .28),
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.white.withValues(alpha: .85), width: 2),
              ),
              child: local
                  ? Image.file(File(w.photo!), fit: BoxFit.cover, errorBuilder: (_, _, _) => Center(child: initials))
                  : Center(child: FittedBox(child: initials)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(w.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.h3(color: on, height: 1.05)),
                  const SizedBox(height: 4),
                  Text(w.line, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.cap(color: on.withValues(alpha: .75))),
                ],
              ),
            ),
          ],
        ),
        const Spacer(),
        Row(
          children: [
            for (final (i, (key, value)) in w.fields.indexed) ...[
              if (i > 0) const SizedBox(width: 10),
              Expanded(
                flex: i == 0 ? 7 : 5,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(key.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.o(color: on.withValues(alpha: .55))),
                    const SizedBox(height: 2),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(value.isEmpty ? '—' : value, maxLines: 1, style: AppText.mono(color: on)),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _back(BuildContext context, Color on, double k) {
    final w = widget;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(height: 4 * k),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 124 * k,
                height: 124 * k,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: AppColors.white, borderRadius: BorderRadius.circular(AppRadius.md)),
                child: Center(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(w.code, textAlign: TextAlign.center, style: AppText.h2(color: AppColors.light.ink, tabular: true)),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(w.codeTitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.ts(color: on)),
                    Text('profile.show_at_gate'.tr, maxLines: 2, overflow: TextOverflow.ellipsis, style: AppText.cap(color: on.withValues(alpha: .7))),
                    for (final (key, value) in w.back.take(2)) ...[
                      const SizedBox(height: 8),
                      Text(key.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.o(color: on.withValues(alpha: .55))),
                      Text(value.isEmpty ? '—' : value, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.capB(color: on)),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        Text('profile.if_found'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.tiny(color: on.withValues(alpha: .6))),
      ],
    );
  }
}
