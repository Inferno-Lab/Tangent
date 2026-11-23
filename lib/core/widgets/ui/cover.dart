import 'dart:math' as math;

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

/// A cover as a hardback seen from the front: a rounded spine down the left in the cover's deeper shade, the board, a
/// thick block of pages under it held in the back board's edge, and a golden ribbon hanging out below. [child] is the
/// flat cover; it fills the board.
class Book3D extends StatelessWidget {
  const Book3D({required this.child, required this.height, required this.colour, this.radius = 10, super.key});

  final Widget child;
  final double height;

  /// The board's colour; the spine and the back board take its deeper shade.
  final Color colour;

  /// The roundness of the spine's corners (the open side stays almost square, as a board is cut).
  final double radius;

  @override
  Widget build(BuildContext context) {
    final ink = AppColors.light.ink;
    final deep = Color.lerp(colour, ink, .28)!;
    final paper = AppColors.light.paper;
    final gold = Color.lerp(AppColors.late, AppColors.white, .12)!;
    // The ribbon hangs below the book; the book itself takes the rest of the height.
    final tail = height * .075;
    final body = height - tail;
    final edge = (body * .035).clamp(1.5, 5.0);
    final pages = (body * .14).clamp(5.0, 22.0);
    final board = body - pages - edge;
    const corner = Radius.circular(AppRadius.hair);
    return LayoutBuilder(
      builder: (context, box) {
        final w = box.maxWidth.isFinite ? box.maxWidth : height * .7;
        final spine = (w * .11).clamp(4.0, 14.0);
        final round = Radius.circular(math.min(radius * 1.6, spine * 2.2));
        return SizedBox(
          width: w,
          height: height,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // The case: spine and back board in one, rounded down the spine side.
              Positioned(
                left: 0,
                top: 0,
                right: 0,
                height: body,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.only(topLeft: round, bottomLeft: round, topRight: corner, bottomRight: corner),
                    gradient: LinearGradient(
                      colors: [deep, Color.lerp(deep, AppColors.white, .1)!, deep, deep],
                      stops: [0, spine / w * .45, spine / w, 1],
                    ),
                  ),
                ),
              ),
              // The pages: a cream block, its end rounded into the spine, shaded where the board lies on it.
              Positioned(
                left: spine * .8,
                right: 0,
                top: board,
                height: pages,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.horizontal(left: Radius.circular(pages / 2)),
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color.lerp(paper, ink, .16)!, paper, paper, Color.lerp(paper, ink, .06)!],
                      stops: const [0, .3, .8, 1],
                    ),
                  ),
                ),
              ),
              // The ribbon, from under the board down past the foot, its end cut in a notch.
              Positioned(
                left: w * .7,
                top: board,
                width: (w * .12).clamp(4.0, 14.0),
                height: height - board,
                child: CustomPaint(painter: _Ribbon(gold, Color.lerp(gold, ink, .14)!)),
              ),
              // The board, flat against the spine.
              Positioned(
                left: spine,
                top: 0,
                right: 0,
                height: board,
                child: ClipRRect(
                  borderRadius: const BorderRadius.horizontal(right: corner),
                  child: ColoredBox(color: colour, child: child),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// A ribbon marker: a strip with a notch cut in its end, lighter down its middle.
class _Ribbon extends CustomPainter {
  _Ribbon(this.fill, this.shade);

  final Color fill;
  final Color shade;

  @override
  void paint(Canvas canvas, Size size) {
    final notch = size.width * .5;
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width, size.height)
      ..lineTo(size.width / 2, size.height - notch)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(
      path,
      Paint()..shader = LinearGradient(colors: [shade, fill, shade]).createShader(Offset.zero & size),
    );
  }

  @override
  bool shouldRepaint(_Ribbon old) => old.fill != fill || old.shade != shade;
}
