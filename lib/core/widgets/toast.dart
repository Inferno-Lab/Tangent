import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:get/get.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/haptics.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/ui/controls.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

enum ToastKind { success, error, info }

class _Toast {
  _Toast(this.message, this.kind, this.body, this.action);

  final String message;
  final ToastKind kind;
  final String? body;

  /// A button on the toast (Undo): its translation key and what it does.
  final (String, VoidCallback)? action;
  final key = UniqueKey();
  final shownAt = DateTime.now();

  bool same(_Toast o) => o.message == message && o.body == body && o.kind == kind;
}

/// One toast at a time, dropping from the top. [ToastHost] sits above the navigator.
///
/// - A newer toast replaces the one showing (they never pile up or overlap); the same message again only keeps it up.
/// - An error stays readable: a success or a note that comes right after it waits its turn instead of hiding it.
/// - How long it stays follows how much there is to read, errors a little longer; a tap or an upward swipe closes it.
abstract final class ToastHelper {
  static final _current = Rxn<_Toast>();
  static _Toast? _next;
  static Timer? _timer;

  static void show(String messageKey, {ToastKind kind = ToastKind.info, String? body, (String, VoidCallback)? action}) {
    if (Get.testMode) return;
    // Asked for while a frame is being built (a sheet's initState): shown once that frame is done, since changing the
    // toast host mid-build throws.
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      SchedulerBinding.instance.addPostFrameCallback((_) => show(messageKey, kind: kind, body: body, action: action));
      return;
    }
    final toast = _Toast(messageKey, kind, body, action);
    final now = _current.value;
    if (now != null && now.same(toast)) return _hold(now);
    if (now != null && now.kind == ToastKind.error && kind != ToastKind.error && DateTime.now().difference(now.shownAt) < AppMotion.toastErrorFloor) {
      _next = toast;
      return;
    }
    _next = null;
    _current.value = toast;
    _hold(toast);
    // The outcome of something the person did is felt as well as seen.
    if (kind == ToastKind.success) Haptics.success();
    if (kind == ToastKind.error) Haptics.error();
  }

  /// Closes the toast showing (and any waiting), e.g. on sign-out.
  static void clear() {
    _timer?.cancel();
    _next = null;
    _current.value = null;
  }

  static void _dismiss() {
    _timer?.cancel();
    final next = _next;
    _next = null;
    _current.value = next;
    if (next != null) _hold(next);
  }

  static void _hold(_Toast toast) {
    _timer?.cancel();
    // One with a button stays as long as any toast does, so there is time to reach it.
    _timer = Timer(toast.action != null ? AppMotion.toastMax : holdFor(toast.message.tr, toast.body?.tr, error: toast.kind == ToastKind.error), _dismiss);
  }

  /// A moment to notice it and a little per word to read it (AppMotion.toast*).
  @visibleForTesting
  static Duration holdFor(String message, String? body, {bool error = false}) {
    final words = '$message ${body ?? ''}'.trim().split(RegExp(r'\s+')).length;
    final d = AppMotion.toastBase + AppMotion.toastPerWord * words + (error ? AppMotion.toastError : Duration.zero);
    return d < AppMotion.toastMin ? AppMotion.toastMin : (d > AppMotion.toastMax ? AppMotion.toastMax : d);
  }
}

class ToastHost extends StatelessWidget {
  const ToastHost({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        Positioned(
          left: 0,
          right: 0,
          top: MediaQuery.paddingOf(context).top + 6,
          // Above the Navigator there is no Material, so text would get the debug double underline.
          child: Material(
            type: MaterialType.transparency,
            child: Obx(() {
              final toast = ToastHelper._current.value;
              return AnimatedSwitcher(
                duration: context.reduceMotion ? Duration.zero : AppMotion.t3,
                switchInCurve: kEase,
                switchOutCurve: kEaseIn,
                layoutBuilder: (current, previous) => Stack(alignment: Alignment.topCenter, children: [...previous, ?current]),
                transitionBuilder: (child, t) => FadeTransition(
                  opacity: t,
                  child: SlideTransition(position: Tween(begin: const Offset(0, -.6), end: Offset.zero).animate(t), child: child),
                ),
                child: toast == null ? const SizedBox.shrink() : _ToastCard(key: toast.key, toast: toast),
              );
            }),
          ),
        ),
      ],
    );
  }
}

class _ToastCard extends StatelessWidget {
  const _ToastCard({required this.toast, super.key});

  final _Toast toast;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final (color, icon) = switch (toast.kind) {
      ToastKind.success => (AppColors.ok, PhosphorIconsBold.check),
      ToastKind.error => (AppColors.bad, PhosphorIconsBold.exclamationMark),
      ToastKind.info => (c.ink, PhosphorIconsBold.info),
    };
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Semantics(
            liveRegion: true,
            // Tap or swipe up to close it early.
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: ToastHelper._dismiss,
              onVerticalDragEnd: (d) {
                if ((d.primaryVelocity ?? 0) < -100) ToastHelper._dismiss();
              },
              child: Glass(
                radius: AppRadius.sheet,
                tint: c.paper,
                padding: const EdgeInsets.fromLTRB(10, 10, 16, 10),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                      child: Icon(icon, size: 18, color: toast.kind == ToastKind.info ? c.chalk : AppColors.white),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(toast.message.tr, maxLines: 3, overflow: TextOverflow.ellipsis, style: context.type.ts),
                          if (toast.body != null) Text(toast.body!.tr, maxLines: 2, overflow: TextOverflow.ellipsis, style: context.type.cap),
                        ],
                      ),
                    ),
                    if (toast.action case (final label, final onTap)) ...[
                      const SizedBox(width: 8),
                      Btn(label, small: true, kind: BtnKind.quiet, onPressed: () {
                        ToastHelper._dismiss();
                        onTap();
                      }),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
