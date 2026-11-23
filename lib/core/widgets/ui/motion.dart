import 'dart:async';

import 'package:flutter/material.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';

/// Fade-and-rise entrance with a 35ms stagger (first five items); under Reduce motion, the fade alone.
class Rise extends StatefulWidget {
  const Rise({required this.child, this.index = 0, super.key});

  final Widget child;
  final int index;

  @override
  State<Rise> createState() => _RiseState();
}

class _RiseState extends State<Rise> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: AppMotion.t4);
  late final _a = CurvedAnimation(parent: _c, curve: kEase);
  // About 12px for a typical row; SlideTransition moves by the child's own height.
  late final _slide = Tween(begin: const Offset(0, .08), end: Offset.zero).animate(_a);
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    // Stagger the first few items only; a long list should not wait on its tail.
    final delay = AppMotion.stagger * widget.index.clamp(0, 5);
    if (delay == Duration.zero) {
      _c.forward();
    } else {
      _timer = Timer(delay, () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Reduce motion: the fade stays (a change is still followable), the movement goes.
    if (context.reduceMotion) return FadeTransition(opacity: _a, child: widget.child);
    // Transitions, not an Opacity rebuilt every frame: the fade is a layer property and the child is never rebuilt.
    return FadeTransition(
      opacity: _a,
      child: SlideTransition(position: _slide, transformHitTests: false, child: widget.child),
    );
  }
}
