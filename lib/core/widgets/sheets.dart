import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Opens a paper sheet over a scrim (content sheets are solid, never glass).
/// [dismissible] false keeps it open until it closes itself (a step the person must answer).
Future<T?> showSheet<T>(Widget child, {bool dismissible = true}) {
  return Get.bottomSheet<T>(
    child,
    isScrollControlled: true,
    isDismissible: dismissible,
    enableDrag: dismissible,
    backgroundColor: Colors.transparent,
    barrierColor: Get.context?.app.scrim,
    enterBottomSheetDuration: AppMotion.t4,
    exitBottomSheetDuration: AppMotion.t3,
  );
}

class SheetBody extends StatefulWidget {
  const SheetBody({required this.child, this.padding = const EdgeInsets.fromLTRB(20, 0, 20, 0), this.footer, super.key});

  final Widget child;
  final EdgeInsetsGeometry padding;

  /// Stays in view under the scrolling [child] (the actions of a step the person must answer).
  final Widget? footer;

  static final _open = <GlobalKey<FormState>>[];

  /// Checks every field of the sheet on top (each shows what is wrong under it): call before sending what it holds.
  static bool valid() => _open.isEmpty || (_open.last.currentState?.validate() ?? true);

  @override
  State<SheetBody> createState() => _SheetBodyState();
}

class _SheetBodyState extends State<SheetBody> {
  // Each sheet is a form, so its fields' validators run and show their message, and stay checked as they change.
  final _form = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    SheetBody._open.add(_form);
  }

  @override
  void dispose() {
    SheetBody._open.remove(_form);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final child = widget.child;
    final padding = widget.padding;
    final footer = widget.footer;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    final safe = MediaQuery.paddingOf(context).bottom;
    // The route may already end the sheet's space at the keyboard (Get's sheets do) or give it the whole screen: lift the
    // sheet by the keyboard only in the second case. Padding it in the first counted the keyboard twice, squeezed the sheet
    // and pushed it up under the status bar, cut off.
    return LayoutBuilder(builder: (context, box) {
      final screen = MediaQuery.sizeOf(context).height;
      final double lift = box.maxHeight > screen - inset + 1 ? inset : 0;
      // Below the status bar (from the device itself: a bottom sheet is given a MediaQuery without the top safe area),
      // and never taller than nine tenths of the screen; what does not fit scrolls.
      final double room = math.max(0, math.min(screen * .9, box.maxHeight - lift - _statusBar(context) - 16));
      return Padding(
        padding: EdgeInsets.only(bottom: lift),
        child: Container(
          constraints: BoxConstraints(maxHeight: room),
          decoration: BoxDecoration(
            color: context.app.paper,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet)),
            boxShadow: [BoxShadow(color: AppColors.light.ink.withValues(alpha: 0.2), blurRadius: 40, offset: const Offset(0, -12))],
          ),
          child: Form(
            key: _form,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: SafeArea(
              top: false,
              minimum: EdgeInsets.only(bottom: safe > 0 ? 0 : 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Grab(),
                  Flexible(
                    child: SingleChildScrollView(
                      padding: padding,
                      child: child,
                    ),
                  ),
                  if (footer != null) Padding(padding: const EdgeInsets.fromLTRB(24, 12, 24, 16), child: footer),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
}

/// Confirmation sheet from the canvas: icon bubble, title, body, two buttons.
Future<bool> confirmSheet({
  required String title,
  required String body,
  required String confirm,
  String cancel = 'common.cancel',
  required IconData icon,
  bool danger = true,
}) async {
  final result = await showSheet<bool>(
    Builder(
      builder: (context) {
        final c = context.app;
        return SheetBody(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(color: danger ? c.badSoft : c.mariSoft, shape: BoxShape.circle),
                    child: Icon(icon, color: danger ? c.badText : c.mariText),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(title.tr, style: context.type.h2)),
                ],
              ),
              const SizedBox(height: 12),
              Text(body.tr, style: context.type.b.copyWith(color: c.ink2)),
              const SizedBox(height: 24),
              Btn(
                confirm,
                kind: danger ? BtnKind.danger : BtnKind.primary,
                expand: true,
                onPressed: () => Get.back(result: true),
              ),
              const SizedBox(height: 10),
              Btn(cancel, kind: BtnKind.quiet, expand: true, onPressed: () => Get.back(result: false)),
            ],
          ),
        );
      },
    ),
  );
  return result ?? false;
}

/// Reporting something to the school office: the person picks why (one of [reasons], translation keys), then Report.
/// Returns the reason in English, which is what the office reads, or null when they cancel.
Future<String?> reportSheet({required String title, required String body, required String confirm, required List<String> reasons}) async {
  var picked = reasons.first;
  final result = await showSheet<bool>(
    StatefulBuilder(
      builder: (context, setState) {
        final c = context.app;
        return SheetBody(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(color: c.badSoft, shape: BoxShape.circle),
                    child: Icon(PhosphorIconsRegular.flag, color: c.badText),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(title.tr, style: context.type.h2)),
                ],
              ),
              const SizedBox(height: 12),
              Text(body.tr, style: context.type.b.copyWith(color: c.ink2)),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [for (final r in reasons) Chip2(r.tr, on: r == picked, onTap: () => setState(() => picked = r))],
              ),
              const SizedBox(height: 24),
              Btn(confirm, kind: BtnKind.danger, expand: true, onPressed: () => Get.back(result: true)),
              const SizedBox(height: 10),
              Btn('common.cancel', kind: BtnKind.quiet, expand: true, onPressed: () => Get.back(result: false)),
            ],
          ),
        );
      },
    ),
  );
  return result ?? false ? english[picked] ?? picked.tr : null;
}

double _statusBar(BuildContext context) {
  final view = View.of(context);
  return view.padding.top / view.devicePixelRatio;
}
