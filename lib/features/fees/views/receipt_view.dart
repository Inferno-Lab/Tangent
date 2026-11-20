import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/open_link.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/features/fees/controllers/fees_controller.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

Map<String, Object?> receiptArgs(Receipt r, FeesController controller) => {
  'receipt': r,
  'student': controller.student?.name,
  'roll': controller.student?.rollNo,
  'class': controller.schoolClass == null
      ? null
      : controller.schoolClass!.label,
};

/// Receipt: the stored receipt printed on a perforated slip.
class ReceiptView extends StatelessWidget {
  const ReceiptView({super.key});

  @override
  Widget build(BuildContext context) {
    final args = Get.arguments is Map ? Get.arguments as Map : const <String, Object?>{};
    final receipt = args['receipt'] as Receipt?;
    final c = context.app;
    final inset = MediaQuery.paddingOf(context);
    if (receipt == null) {
      return const PageFrame(
        leading: BackGlass(close: true),
        children: [EmptyState(title: 'fees.no_receipt', body: 'fees.no_receipt_body')],
      );
    }
    // The school's own receipt number; sample receipts show their id.
    final number = receipt.number.isNotEmpty ? receipt.number : receipt.id.toUpperCase();
    final rows = [
      if (args['student'] != null)
        (
          'fees.student'.tr,
          '${args['student']} · ${args['class'] ?? ''} · ${'fees.roll'.trp({'n': '${args['roll'] ?? ''}'.padLeft(2, '0')})}',
          false,
        ),
      ('fees.paid_on'.tr, DateFormat('EEE d MMM y, HH:mm').format(receipt.paidOn), false),
      ('fees.method'.tr, paymentMethod(receipt.method), false),
      ('fees.reference'.tr, receipt.reference, true),
      ('fees.receipt_no'.tr, number, true),
    ];
    return Scaffold(
      backgroundColor: c.chalk,
      body: Stack(
        children: [
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            height: 253 + inset.top,
            child: ColoredBox(color: AppColors.subject('science').fill),
          ),
          Positioned(
            left: 16,
            right: 16,
            top: inset.top + 8,
            child: Row(
              children: [
                GlassIconButton(
                  icon: PhosphorIconsRegular.x,
                  label: 'common.close'.tr,
                  color: AppColors.white,
                  onTap: () => Get.back<void>(),
                ),
                Expanded(
                  child: Text(
                    'fees.payment_done'.tr,
                    textAlign: TextAlign.center,
                    style: AppText.t(color: AppColors.white, height: 1),
                  ),
                ),
                GlassIconButton(
                  icon: PhosphorIconsRegular.export,
                  label: 'fees.share_receipt'.tr,
                  color: AppColors.white,
                  onTap: () => unawaited(openFromServer((s) => s.post('/receipts/${receipt.id}/link', {}))),
                ),
              ],
            ),
          ),
          Positioned.fill(
            top: inset.top + 96,
            child: ListView(
              padding: EdgeInsets.fromLTRB(24, 0, 24, inset.bottom + 110),
              children: [
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: context.reduceMotion ? 1 : 0, end: 1),
                  duration: AppMotion.celebrate,
                  curve: const Cubic(.2, .8, .2, 1),
                  builder: (context, t, child) => ClipRect(
                    child: Align(
                      alignment: Alignment.topCenter,
                      heightFactor: t,
                      child: Transform.translate(offset: Offset(0, -60 * (1 - t)), child: child),
                    ),
                  ),
                  child: _Slip(receipt: receipt, rows: rows),
                ),
              ],
            ),
          ),
          Positioned(
            left: 24,
            right: 24,
            bottom: 34 + inset.bottom,
            child: Row(
              children: [
                Expanded(
                  child: Btn(
                    'fees.save_pdf',
                    kind: BtnKind.quiet,
                    icon: PhosphorIconsRegular.downloadSimple,
                    expand: true,
                    onPressed: () => unawaited(openFromServer((s) => s.post('/receipts/${receipt.id}/link', {}))),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Btn('common.done', kind: BtnKind.ink, expand: true, onPressed: () => Get.back<void>()),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Slip extends StatelessWidget {
  const _Slip({required this.receipt, required this.rows});

  final Receipt receipt;
  final List<(String, String, bool)> rows;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return DecoratedBox(
      decoration: BoxDecoration(
        boxShadow: [BoxShadow(color: AppColors.light.ink.withValues(alpha: 0.5), blurRadius: 60, spreadRadius: -30, offset: const Offset(0, 30))],
      ),
      child: ClipPath(
        clipper: const _PerforatedClipper(),
        child: Container(
          color: c.paper,
          padding: const EdgeInsets.fromLTRB(24, 40, 24, 32),
          child: Stack(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Overline(AppConfig.schoolName),
                  // The school's own address, as it set it (nothing when it has none).
                  if (SchoolConfig.schoolAddress.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(SchoolConfig.schoolAddress, style: context.type.cap),
                  ],
                  const SizedBox(height: 20),
                  Text(Formatters.money(receipt.amount), style: context.type.dl),
                  const SizedBox(height: 6),
                  Text(receipt.title, style: context.type.t),
                  const Padding(padding: EdgeInsets.only(top: 20, bottom: 8), child: DashedLine()),
                  for (final r in rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(r.$1, style: AppText.s(color: c.ink3, height: 1.3)),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              r.$2,
                              textAlign: TextAlign.end,
                              style: r.$3
                                  ? context.type.mono.copyWith(color: c.ink)
                                  : AppText.chip(color: c.ink, height: 1.3),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const Padding(padding: EdgeInsets.symmetric(vertical: 10), child: DashedLine()),
                  Text(
                    SchoolConfig.schoolPhone.isEmpty
                        ? 'fees.receipt_note'.tr
                        : 'fees.receipt_note_phone'.trp({'phone': SchoolConfig.schoolPhone}),
                    style: context.type.cap,
                  ),
                ],
              ),
              Positioned(
                right: -2,
                top: 66,
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: context.reduceMotion ? 1 : 0, end: 1),
                  duration: AppMotion.loop,
                  curve: const Interval(.6, 1, curve: Cubic(.3, 1.45, .45, 1)),
                  builder: (context, t, child) => Opacity(
                    opacity: (t * .85).clamp(0, .85),
                    child: Transform.scale(scale: .86 + .14 * t, child: child),
                  ),
                  child: Transform.rotate(
                    angle: -.21,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.ok, width: 3),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        'fees.paid_stamp'.tr,
                        style: AppText.h2(color: AppColors.ok, height: 1),
                      ),
                    ),
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

class _PerforatedClipper extends CustomClipper<Path> {
  const _PerforatedClipper();

  @override
  Path getClip(Size size) {
    const r = 6.0;
    const step = 12.0;
    final path = Path()..moveTo(0, 0);
    for (var x = 0.0; x + step <= size.width + .5; x += step) {
      path.arcToPoint(Offset(x + step, 0), radius: const Radius.circular(r), clockwise: false);
    }
    path
      ..lineTo(size.width, 0)
      ..lineTo(size.width, size.height);
    for (var x = 0.0; x + step <= size.width + .5; x += step) {
      path.arcToPoint(Offset(size.width - x - step, size.height), radius: const Radius.circular(r), clockwise: false);
    }
    return path
      ..lineTo(0, size.height)
      ..close();
  }

  @override
  bool shouldReclip(_PerforatedClipper oldClipper) => false;
}

/// A payment method in the reader's words; one the app has no word for (a country's own scheme, such as UPI) shows as the
/// school's server names it, never as a key.
String paymentMethod(String method) {
  final key = 'fees.$method';
  if (key.tr != key) return key.tr;
  return method.length <= 4 ? method.toUpperCase() : '${method[0].toUpperCase()}${method.substring(1)}';
}
