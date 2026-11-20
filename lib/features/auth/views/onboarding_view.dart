import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/haptics.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/features/auth/controllers/splash_controller.dart';

/// Progress of one step inside a page's entrance: 0 before [from], 1 after [to].
double _phase(double t, double from, double to, [Curve curve = kEase]) => curve.transform(((t - from) / (to - from)).clamp(0.0, 1.0));

/// The three first-run steps (the approved canvas): the school's name and Skip at the top, a drawing that plays as its step
/// arrives (the day's lessons with now sweeping across, two children's cards, a roll call), the words, and at the bottom
/// the dots, Back and Next (Get started on the last).
class OnboardingView extends GetView<OnboardingController> {
  const OnboardingView({super.key});

  static const _steps = [
    ('onboarding.one_kicker', 'onboarding.one_title', 'onboarding.one_body'),
    ('onboarding.two_kicker', 'onboarding.two_title', 'onboarding.two_body'),
    ('onboarding.three_kicker', 'onboarding.three_title', 'onboarding.three_body'),
  ];

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final inset = MediaQuery.paddingOf(context);
    final school = AppConfig.schoolName;
    return Scaffold(
      backgroundColor: c.chalk,
      body: Padding(
        padding: EdgeInsets.only(top: inset.top + 8, bottom: inset.bottom + 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: SizedBox(
                height: 44,
                child: Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(color: c.brand, borderRadius: BorderRadius.circular(AppRadius.sm)),
                      child: Center(child: Text(school.isEmpty ? '' : school.characters.first.toUpperCase(), style: AppText.chip(color: c.onBrand, height: 1))),
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(school, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.t(color: c.ink))),
                    const SizedBox(width: 12),
                    Obx(
                      () => AnimatedOpacity(
                        duration: AppMotion.t2,
                        opacity: controller.page.value < 2 ? 1 : 0,
                        child: IgnorePointer(
                          ignoring: controller.page.value == 2,
                          child: Pressable(
                            onTap: () => unawaited(controller.finish()),
                            label: 'common.skip'.tr,
                            child: Container(
                              height: 40,
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: c.line2)),
                              child: Center(widthFactor: 1, child: Text('common.skip'.tr, style: AppText.ts(color: c.ink, height: 1))),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Expanded(
              child: PageView.builder(
                controller: controller.controller,
                itemCount: 3,
                onPageChanged: (i) {
                  controller.page.value = i;
                  Haptics.selection();
                },
                itemBuilder: (context, i) => Obx(() => _Step(index: i, active: controller.page.value == i, words: _steps[i])),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
              child: Obx(() {
                final page = controller.page.value;
                return Row(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          for (var i = 0; i < 3; i++) ...[
                            if (i > 0) const SizedBox(width: 6),
                            Pressable(
                              onTap: () => unawaited(controller.goTo(i)),
                              label: 'onboarding.page_of'.trp({'n': '${i + 1}'}),
                              child: AnimatedContainer(
                                duration: AppMotion.t3,
                                curve: kEase,
                                width: i == page ? 28 : 8,
                                height: 8,
                                decoration: BoxDecoration(color: i == page ? c.brand : c.line2, borderRadius: BorderRadius.circular(AppRadius.pill)),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (page > 0) ...[
                      Pressable(
                        onTap: () => unawaited(controller.previous()),
                        label: 'common.back'.tr,
                        child: Container(
                          width: 56,
                          height: 56,
                          decoration: BoxDecoration(color: c.paper, shape: BoxShape.circle, border: Border.all(color: c.line2)),
                          child: Icon(PhosphorIconsBold.caretLeft, size: 18, color: c.ink),
                        ),
                      ),
                      const SizedBox(width: 12),
                    ],
                    Pressable(
                      onTap: () => unawaited(controller.next()),
                      label: (page < 2 ? 'common.next' : 'common.get_started').tr,
                      child: AnimatedContainer(
                        duration: AppMotion.t3,
                        curve: kEase,
                        height: 56,
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        decoration: BoxDecoration(color: c.brand, borderRadius: BorderRadius.circular(AppRadius.pill)),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text((page < 2 ? 'common.next' : 'common.get_started').tr, style: AppText.label(color: c.onBrand)),
                            const SizedBox(width: 8),
                            Icon(PhosphorIconsBold.arrowRight, size: 16, color: c.onBrand),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
}

/// One step: its drawing in a panel, then the kicker, the title and the words, rising in when the step arrives.
class _Step extends StatefulWidget {
  const _Step({required this.index, required this.active, required this.words});

  final int index;
  final bool active;
  final (String, String, String) words;

  @override
  State<_Step> createState() => _StepState();
}

class _StepState extends State<_Step> with TickerProviderStateMixin {
  // The entrance plays each time the step is reached; the pulse keeps going while it is on screen.
  late final _play = AnimationController(vsync: this, duration: AppMotion.intro);
  late final _pulse = AnimationController(vsync: this, duration: AppMotion.loop);

  @override
  void initState() {
    super.initState();
    // After the first frame: the entrance reads the reduce-motion setting from the context.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.active) _start();
    });
  }

  @override
  void didUpdateWidget(_Step old) {
    super.didUpdateWidget(old);
    if (widget.active && !old.active) _start();
    if (!widget.active && old.active) _pulse.stop();
  }

  void _start() {
    if (context.reduceMotion) {
      _play.value = 1;
      return;
    }
    _play.forward(from: 0);
    unawaited(_pulse.repeat());
  }

  @override
  void dispose() {
    _play.dispose();
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final (kicker, title, body) = widget.words;
    return LayoutBuilder(
      builder: (context, box) {
        // The drawing takes what the words leave, within the board's size; a small phone gets a shorter panel.
        final panel = (box.maxHeight * .52).clamp(200.0, 372.0);
        return SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: AnimatedBuilder(
            animation: Listenable.merge([_play, _pulse]),
            builder: (context, _) {
              final t = _play.value;
              double rise(double from) => _phase(t, from, from + .18);
              Widget up(double from, Widget child) => Opacity(
                opacity: rise(from),
                child: Transform.translate(offset: Offset(0, 16 * (1 - rise(from))), child: child),
              );
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    height: panel,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(color: c.paper, borderRadius: BorderRadius.circular(AppRadius.sheet), border: Border.all(color: c.line)),
                    child: switch (widget.index) {
                      0 => _Lessons(t: t, pulse: _pulse.value),
                      1 => _Family(t: t),
                      _ => _RollCall(t: t),
                    },
                  ),
                  const SizedBox(height: 24),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        up(0, Text(kicker.tr.toUpperCase(), style: AppText.stamp(color: c.mariText))),
                        const SizedBox(height: 8),
                        up(.03, Text(title.tr, style: context.type.h1)),
                        const SizedBox(height: 12),
                        up(.06, Text(body.tr, style: context.type.b.copyWith(color: c.ink2))),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

/// Step one: the day's lessons drop in, then now sweeps across them and pulses.
class _Lessons extends StatelessWidget {
  const _Lessons({required this.t, required this.pulse});

  final double t;
  final double pulse;

  static const _cols = [('maths', 'B-204', .06, .19), ('', '', .26, .06), ('science', 'Lab 2', .33, .19), ('english', 'A-110', .53, .19), ('art', 'Studio', .73, .22)];

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth;
        final h = box.maxHeight;
        final sweep = .18 + (.61 - .18) * _phase(t, .2, .87, kLoop);
        final line = h * .8;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            for (final (i, (subject, room, x, width)) in _cols.indexed)
              Positioned(
                left: w * x,
                top: 0,
                width: w * width,
                height: h * (i.isEven ? .65 : .73),
                child: FractionalTranslation(
                  translation: Offset(0, -1.04 * (1 - _phase(t, i * .03, .22 + i * .03))),
                  child: subject.isEmpty
                      ? ClipRRect(
                          borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.field)),
                          child: CustomPaint(painter: _Hatch(c.paper3, c.paper)),
                        )
                      : Container(
                          padding: const EdgeInsets.fromLTRB(8, 0, 4, 12),
                          decoration: BoxDecoration(
                            color: c.subjectFor(subject).fill,
                            borderRadius: const BorderRadius.vertical(bottom: Radius.circular(AppRadius.field)),
                          ),
                          alignment: AlignmentDirectional.bottomStart,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: AlignmentDirectional.centerStart,
                                child: Text(subjectName(subject), maxLines: 1, style: AppText.ts(color: c.subjectFor(subject).on, height: 1.1)),
                              ),
                              Text(room, maxLines: 1, overflow: TextOverflow.clip, style: AppText.tiny(color: c.subjectFor(subject).on.withValues(alpha: .85))),
                            ],
                          ),
                        ),
                ),
              ),
            if (t > .2) ...[
              Positioned(left: w * sweep - 1, top: 0, width: 2, height: line, child: DecoratedBox(decoration: BoxDecoration(color: c.bright))),
              Positioned(
                left: w * sweep - 26,
                top: line - 12,
                child: Container(
                  height: 24,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: c.bright,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    boxShadow: t >= 1 ? [BoxShadow(color: c.bright.withValues(alpha: .55 * (1 - pulse)), spreadRadius: 8 * pulse)] : null,
                  ),
                  child: Center(widthFactor: 1, child: Text('onboarding.now'.tr, style: AppText.mono(color: c.onBright, height: 1))),
                ),
              ),
            ],
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [for (final hour in ['8:00', '9:00', '10:00', '11:00']) Text(hour, style: AppText.mono(color: c.ink3))],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Step two: each child's day as a card, then the reminder before a fee is due.
class _Family extends StatelessWidget {
  const _Family({required this.t});

  final double t;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    Widget pop(double from, Widget child) {
      final p = _phase(t, from, from + .22, kSpring);
      return Opacity(
        opacity: _phase(t, from, from + .1),
        child: Transform.translate(offset: Offset(0, 24 * (1 - p)), child: Transform.scale(scale: .94 + .06 * p, child: child)),
      );
    }

    Widget kid(String name, String cls, String arrived, String line, Color avatar) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.chalk, borderRadius: BorderRadius.circular(AppRadius.panel), border: Border.all(color: c.line)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar(name.tr, size: 36, background: avatar, foreground: AppColors.white),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.ts),
                    Text(cls.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap),
                  ],
                ),
              ),
              Container(
                height: 24,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(color: c.okSoft, borderRadius: BorderRadius.circular(AppRadius.pill)),
                child: Center(widthFactor: 1, child: Text(arrived.tr, style: AppText.tiny(color: c.okText))),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(line.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.cap.copyWith(color: c.ink2)),
        ],
      ),
    );

    return Padding(
      padding: const EdgeInsets.all(16),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.center,
        child: SizedBox(
          width: 318,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              pop(.03, kid('onboarding.kid_a_name', 'onboarding.kid_a_class', 'onboarding.kid_a_in', 'onboarding.kid_a_line', c.spectrumFor('blue').fill)),
              const SizedBox(height: 10),
              pop(.11, kid('onboarding.kid_b_name', 'onboarding.kid_b_class', 'onboarding.kid_b_in', 'onboarding.kid_b_line', c.spectrumFor('pink').fill)),
              const SizedBox(height: 10),
              pop(
                .22,
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: c.deep, borderRadius: BorderRadius.circular(AppRadius.panel)),
                  child: Row(
                    children: [
                      Icon(PhosphorIconsRegular.bell, size: 22, color: c.bright),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('onboarding.fee_title'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.ts(color: c.onDeep)),
                            Text('onboarding.fee_line'.tr, maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.cap(color: c.onDeep2)),
                          ],
                        ),
                      ),
                    ],
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

/// Step three: a class where everyone starts present; two are tapped absent and one late, and the tally follows.
class _RollCall extends StatelessWidget {
  const _RollCall({required this.t});

  final double t;

  static const _absent = {6, 13};
  static const _late = {9};

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final present = c.spectrumFor('green').fill;
    final tallies = [
      ('onboarding.tally_present', c.okSoft, c.okText),
      ('onboarding.tally_absent', c.badSoft, c.badText),
      ('onboarding.tally_late', c.lateSoft, c.lateText),
    ];
    return Padding(
      padding: const EdgeInsets.all(20),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: SizedBox(
          width: 306,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(child: Text('onboarding.roll_title'.tr, style: context.type.ts)),
                  Text('onboarding.roll_meta'.tr, style: context.type.cap),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (var i = 0; i < 20; i++)
                    Builder(
                      builder: (context) {
                        final marked = _absent.contains(i) || _late.contains(i);
                        // Marked seats change colour a beat after the class appears, with a small ping.
                        final at = _phase(t, .3 + i * .008, .42 + i * .008);
                        final ping = marked ? math.sin(_phase(t, .4 + i * .008, .55 + i * .008) * math.pi) * .2 : 0.0;
                        final to = _absent.contains(i) ? c.spectrumFor('red').fill : _late.contains(i) ? c.bright : present;
                        return Transform.scale(
                          scale: 1 + ping,
                          child: Container(
                            width: 53,
                            height: 40,
                            decoration: BoxDecoration(
                              color: marked ? Color.lerp(present, to, at) : present,
                              borderRadius: BorderRadius.circular(AppRadius.md),
                            ),
                            child: Center(
                              child: Text(String.fromCharCodes([65 + i % 26, 65 + (i * 7 + 3) % 26]), style: AppText.tiny(color: AppColors.white)),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (i, (key, soft, ink)) in tallies.indexed) ...[
                    Opacity(
                      opacity: _phase(t, .62 + i * .04, .74 + i * .04),
                      child: Container(
                        height: 32,
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        decoration: BoxDecoration(color: soft, borderRadius: BorderRadius.circular(AppRadius.pill)),
                        child: Center(widthFactor: 1, child: Text(key.tr, style: AppText.chip(color: ink, height: 1))),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Diagonal hatching for a break between lessons.
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
