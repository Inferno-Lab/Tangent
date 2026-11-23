import 'package:flutter/material.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/app_icons.dart';
import 'package:tangent/core/widgets/ui/labels.dart';

/// A subject's mark: in a row, the Hue tile (spectrum soft fill, icon); large, the notebook cover (shelves, heroes).
class Cover extends StatelessWidget {
  const Cover({
    required this.subject,
    this.label,
    this.large = false,
    this.width,
    this.height,
    super.key,
  });

  final String subject;
  final String? label;
  final bool large;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    final pigment = AppColors.subject(subject);
    final tile = context.app.subjectFor(subject);
    // In a list row a subject is Tangent Hue's tile: its spectrum soft fill with the homework icon in its ink.
    if (!large && width == null && height == null) {
      return Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: tile.soft, borderRadius: BorderRadius.circular(AppRadius.md)),
        child: Icon(AppIcons.homework, size: 20, color: tile.ink),
      );
    }
    final w = width ?? (large ? 64.0 : 42.0);
    final h = height ?? (large ? 82.0 : 52.0);
    final r = large ? 14.0 : 11.0;
    return Container(
      width: w,
      height: h,
      // A narrow cover (30 wide beside the class chips) keeps its label inside: less inset, and the label shrinks to fit.
      padding: EdgeInsets.only(left: large ? 12 : (w < 40 ? 7 : 10), right: 3, bottom: large ? 10 : 6),
      alignment: Alignment.bottomLeft,
      decoration: BoxDecoration(
        color: pigment.fill,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(large ? 6 : 5),
          bottomLeft: Radius.circular(large ? 6 : 5),
          topRight: Radius.circular(r),
          bottomRight: Radius.circular(r),
        ),
      ),
      foregroundDecoration: const _SpineDecoration(),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.bottomLeft,
        child: Text(
          label ?? subjectAbbr[subject] ?? _abbr(subjectName(subject)),
          style: hueText(large ? 13 : 11, 760, width: 122, height: 1, em: .05, color: pigment.on),
          maxLines: 1,
        ),
      ),
    );
  }
}

/// The darker binding strip along the left edge of a cover.
class _SpineDecoration extends Decoration {
  const _SpineDecoration({this.width = 4});

  final double width;

  @override
  BoxPainter createBoxPainter([VoidCallback? onChanged]) => _SpinePainter(width);
}

class _SpinePainter extends BoxPainter {
  _SpinePainter(this.width);

  final double width;

  @override
  void paint(Canvas canvas, Offset offset, ImageConfiguration configuration) {
    final size = configuration.size!;
    final rect = offset & size;
    canvas
      ..save()
      ..clipRRect(
        RRect.fromRectAndCorners(rect, topLeft: const Radius.circular(7), bottomLeft: const Radius.circular(7)),
      )
      ..drawRect(Rect.fromLTWH(rect.left, rect.top, width, rect.height), Paint()..color = AppColors.amoled.chalk.withValues(alpha: 0.2))
      ..drawRect(Rect.fromLTWH(rect.right - 1, rect.top, 1, rect.height), Paint()..color = AppColors.white.withValues(alpha: 0.15))
      ..restore();
  }
}

/// Spine decoration usable on bigger custom covers (book shelf, hero bands).
const spineDecoration = _SpineDecoration(width: 6);

/// The SignIn board's cell art: rows of the deep colour's tints with a few cells in the bright colour. [reveal] (0 to 1)
/// brings the cells in one after another.
class CellArt extends StatelessWidget {
  const CellArt({this.rows = 3, this.reveal = 1, this.width, super.key});

  final int rows;
  final double reveal;

  /// A fixed width, for parents that measure intrinsic sizes (a LayoutBuilder cannot answer them).
  final double? width;

  static const _bright = {3, 15, 16, 27, 30};
  static const _mid = {1, 4, 8, 12, 14, 19, 22, 26, 28};

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    const cols = 11;
    final n = rows * cols;
    Widget grid(double width) {
        final size = (width - 6 * (cols - 1)) / cols;
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var r = 0; r < rows; r++) ...[
              if (r > 0) const SizedBox(height: 6),
              Row(
                children: [
                  for (var i = 0; i < cols; i++) ...[
                    if (i > 0) const SizedBox(width: 6),
                    Opacity(
                      opacity: ((reveal * (n + 8) - (r * cols + i)) / 8).clamp(0.0, 1.0),
                      child: Container(
                        width: size,
                        height: size,
                        decoration: BoxDecoration(
                          color: _bright.contains(r * cols + i)
                              ? c.bright
                              : _mid.contains(r * cols + i)
                              ? c.deep3
                              : c.deep2,
                          borderRadius: BorderRadius.circular(AppRadius.sm),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ],
        );
    }

    return width != null ? grid(width!) : LayoutBuilder(builder: (context, box) => grid(box.maxWidth));
  }
}

/// "Mathematics" → "MAT", "Social Science" → "SS": a school's own subject, as a cover's short label.
String _abbr(String name) {
  final words = name.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (words.length > 1) return words.take(3).map((w) => w[0]).join().toUpperCase();
  return name.length <= 3 ? name.toUpperCase() : name.substring(0, 3).toUpperCase();
}

/// A cover as a book in the hand: turned a little, its pages showing along the open edge and the foot, the spine
/// shaded with its hinge, a gloss across the board. [child] is the flat cover; it fills the front board.
class Book3D extends StatelessWidget {
  const Book3D({required this.child, required this.height, this.radius = 10, super.key});

  final Widget child;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    // The page block is thinner on a small book, so a 38-wide one in a row still reads as a book, not a box.
    final depth = (height * .045).clamp(3.0, 7.0);
    final board = BorderRadius.only(
      topLeft: Radius.circular(radius * .5),
      bottomLeft: Radius.circular(radius * .5),
      topRight: Radius.circular(radius),
      bottomRight: Radius.circular(radius),
    );
    return Transform(
      alignment: Alignment.center,
      transform: Matrix4.identity()
        ..setEntry(3, 2, .0012)
        ..rotateY(-.14),
      child: SizedBox(
        height: height,
        child: Stack(
          children: [
            // The pages, cream in every theme, a line for every few leaves.
            Positioned(
              left: depth * 2,
              top: depth * .7,
              right: 0,
              bottom: 0,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.light.paper,
                  borderRadius: BorderRadius.only(topRight: Radius.circular(radius), bottomRight: Radius.circular(radius)),
                  boxShadow: [BoxShadow(color: AppColors.light.ink.withValues(alpha: .45), blurRadius: 14, spreadRadius: -6, offset: Offset(depth, depth * 1.6))],
                ),
                child: CustomPaint(painter: _Leaves(AppColors.light.ink3.withValues(alpha: .35), depth)),
              ),
            ),
            // The front board.
            Positioned(
              left: 0,
              top: 0,
              right: depth,
              bottom: depth * .7,
              child: ClipRRect(
                borderRadius: board,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    child,
                    IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              AppColors.amoled.chalk.withValues(alpha: .34),
                              AppColors.amoled.chalk.withValues(alpha: .1),
                              AppColors.white.withValues(alpha: .22),
                              AppColors.amoled.chalk.withValues(alpha: .08),
                              AppColors.white.withValues(alpha: 0),
                              AppColors.white.withValues(alpha: .1),
                            ],
                            stops: const [0, .06, .085, .12, .55, 1],
                          ),
                        ),
                      ),
                    ),
                    // Light from the top left catches the board.
                    IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [AppColors.white.withValues(alpha: .16), AppColors.white.withValues(alpha: 0), AppColors.amoled.chalk.withValues(alpha: .14)],
                            stops: const [0, .45, 1],
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
      ),
    );
  }
}

/// The lines of a book's leaves along its open edge and its foot.
class _Leaves extends CustomPainter {
  _Leaves(this.line, this.depth);

  final Color line;
  final double depth;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = line
      ..strokeWidth = .6;
    for (var x = size.width - depth + 1.5; x < size.width - 1; x += 1.6) {
      canvas.drawLine(Offset(x, 4), Offset(x, size.height - 2), p);
    }
    for (var y = size.height - depth * .7 + 1.2; y < size.height - .8; y += 1.6) {
      canvas.drawLine(Offset(4, y), Offset(size.width - 2, y), p);
    }
  }

  @override
  bool shouldRepaint(_Leaves old) => old.line != line || old.depth != depth;
}
