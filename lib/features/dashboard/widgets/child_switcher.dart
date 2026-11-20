import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/haptics.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/student.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/features/dashboard/widgets/parent_home.dart' show childColour;
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Loads the parent's children once; shared by the capsule and the popover.
class ChildrenCache {
  static final _cache = <String, (Student, SchoolClass)>{};

  static Future<List<(Student, SchoolClass)>> load(List<String> ids) async {
    final directory = Get.find<DirectoryRepository>();
    final out = <(Student, SchoolClass)>[];
    for (final id in ids) {
      final hit = _cache[id];
      if (hit != null) {
        out.add(hit);
        continue;
      }
      final student = await directory.student(id);
      final cls = await directory.schoolClass(student.classId);
      out.add(_cache[id] = (student, cls));
    }
    return out;
  }
}

String shortClass(SchoolClass c) => c.label;

/// "Class 8 A", in the school's own word for a class where it has one ("Grade 8 A", "Year 8 A").
String classLine(String label) => SchoolConfig.classWord.isEmpty ? 'home.class_line'.trp({'class': label}) : '${SchoolConfig.classWord} $label';

/// Glass capsule with stacked child avatars. Tap to open the switcher,
/// swipe sideways to switch straight away.
class ChildCapsule extends StatefulWidget {
  const ChildCapsule({super.key});

  @override
  State<ChildCapsule> createState() => _ChildCapsuleState();
}

class _ChildCapsuleState extends State<ChildCapsule> {
  List<(Student, SchoolClass)> _kids = const [];
  final _anchor = GlobalKey();

  @override
  void initState() {
    super.initState();
    final ids = Get.find<AuthService>().user.value?.childIds ?? const [];
    unawaited(
      ChildrenCache.load(ids).then((kids) {
        if (mounted) setState(() => _kids = kids);
      }),
    );
  }

  Future<void> _switchBy(int step) async {
    if (_kids.length < 2) return;
    final auth = Get.find<AuthService>();
    final i = _kids.indexWhere((k) => k.$1.id == auth.activeStudentId.value);
    final next = _kids[(i + step) % _kids.length].$1.id;
    Haptics.selection();
    await auth.switchChild(next);
  }

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthService>();
    return Obx(() {
      final active = auth.activeStudentId.value;
      final current = _kids.where((k) => k.$1.id == active).firstOrNull ?? _kids.firstOrNull;
      final family = [for (final k in _kids) k.$1.name];
      final label = current == null ? '' : '${current.$1.name.split(' ').first} · ${shortClass(current.$2)}';
      return Semantics(
        button: true,
        label: 'home.viewing_child'.trp({'name': label}),
        child: GestureDetector(
          onHorizontalDragEnd: (d) => _switchBy((d.primaryVelocity ?? 0) < 0 ? 1 : -1),
          child: GlassPress(
            // One child: nothing to switch to, so the capsule only names them.
            onTap: _kids.length < 2 ? null : () => _open(context),
            child: Container(
              key: _anchor,
              height: 48,
              padding: const EdgeInsetsDirectional.only(start: 6, end: 16),
              decoration: BoxDecoration(color: context.app.paper, borderRadius: BorderRadius.circular(AppRadius.pill), border: Border.all(color: context.app.line)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (current != null)
                    Avatar(current.$1.name, initials: Avatar.siblingInitials(current.$1.name, family), size: 36, background: childColour(current.$1.name, family)),
                  const SizedBox(width: 10),
                  Flexible(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(current?.$1.name.split(' ').first ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.t(color: context.app.ink, height: 1.1)),
                        if (current != null)
                          Text(
                            classLine(shortClass(current.$2)),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.tiny(color: context.app.ink3, height: 1.2),
                          ),
                      ],
                    ),
                  ),
                  if (_kids.length > 1) ...[
                    const SizedBox(width: 10),
                    Icon(PhosphorIconsBold.caretDown, size: 13, color: context.app.ink3),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    });
  }

  Future<void> _open(BuildContext context) async {
    final box = _anchor.currentContext?.findRenderObject() as RenderBox?;
    final origin = box?.localToGlobal(Offset.zero) ?? const Offset(16, 52);
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'common.close'.tr,
      barrierColor: Colors.transparent,
      transitionDuration: context.reduceMotion ? Duration.zero : AppMotion.t4,
      pageBuilder: (context, _, _) => _SwitcherPopover(kids: _kids, top: origin.dy + 52, left: origin.dx),
      transitionBuilder: (context, animation, _, child) {
        final t = CurvedAnimation(parent: animation, curve: kSpring, reverseCurve: kEase);
        return FadeTransition(
          opacity: animation,
          child: ScaleTransition(
            alignment: Alignment.topLeft,
            scale: Tween<double>(begin: .6, end: 1).animate(t),
            child: child,
          ),
        );
      },
    );
  }
}

class _SwitcherPopover extends StatelessWidget {
  const _SwitcherPopover({required this.kids, required this.top, required this.left});

  final List<(Student, SchoolClass)> kids;
  final double top;
  final double left;

  @override
  Widget build(BuildContext context) {
    final auth = Get.find<AuthService>();
    final c = context.app;
    final active = auth.activeStudentId.value;
    final family = [for (final k in kids) k.$1.name];
    final screen = MediaQuery.sizeOf(context).width;
    // As wide as a phone allows, never past either edge.
    final width = math.min(320.0, screen - 32);
    return Stack(
      children: [
        Positioned(
          left: left.clamp(16, math.max(16, screen - 16 - width)),
          top: top,
          width: width,
          child: Material(
            type: MaterialType.transparency,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: c.paper,
                borderRadius: BorderRadius.circular(AppRadius.card),
                border: Border.all(color: c.line),
                boxShadow: [BoxShadow(color: c.shadow, blurRadius: 24, offset: const Offset(0, 10))],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final k in kids)
                    _Option(
                      selected: k.$1.id == active,
                      avatar: Avatar(k.$1.name, initials: Avatar.siblingInitials(k.$1.name, family)),
                      title: k.$1.name,
                      subtitle: 'home.child_line'.trp({'class': k.$2.label, 'roll': k.$1.rollNo}),
                      onTap: () async {
                        Get.back<void>();
                        if (k.$1.id != active) await auth.switchChild(k.$1.id);
                      },
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                    child: Text('home.swipe_tip'.tr, style: context.type.cap),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.selected,
    required this.avatar,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final bool selected;
  final Widget avatar;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Semantics(
      selected: selected,
      button: true,
      child: Pressable(
        onTap: onTap,
        scale: .98,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? c.paper2 : Colors.transparent,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              avatar,
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: context.type.t, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(subtitle, style: context.type.cap, maxLines: 1, overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              if (selected) Icon(PhosphorIconsBold.check, size: 18, color: c.ink),
            ],
          ),
        ),
      ),
    );
  }
}
