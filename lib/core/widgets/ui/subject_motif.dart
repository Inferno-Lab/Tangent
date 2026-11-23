import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/widgets/ui/labels.dart';

/// A few faint signs of a lesson's subject behind its block (+ ÷ % for maths, a flask for chemistry), kept to the end
/// side so the words stay clear. Subjects are the school's own, so they are read by their name; one the list does not
/// know gets the signs of study.
class SubjectMotif extends StatelessWidget {
  const SubjectMotif({required this.subject, required this.color, super.key});

  final String subject;

  /// The ink of the block (its text colour); the signs take a share of it.
  final Color color;

  @override
  Widget build(BuildContext context) {
    final icons = motifFor('$subject ${subjectName(subject)}');
    return ExcludeSemantics(
      child: LayoutBuilder(
        builder: (context, box) {
          // One large sign leans out past the end edge, two small ones sit beside it: a mark, not a pattern.
          final h = math.min(box.maxHeight, box.maxWidth * .6);
          final big = (h * 1.05).clamp(36.0, 96.0);
          final small = big * .34;
          return Stack(
            clipBehavior: Clip.hardEdge,
            children: [
              PositionedDirectional(
                end: -big * .18,
                top: (box.maxHeight - big) / 2,
                child: Transform.rotate(angle: -.21, child: Icon(icons[0], size: big, color: color.withValues(alpha: .22))),
              ),
              PositionedDirectional(
                end: big * .86,
                top: box.maxHeight * .5 - small * 1.25,
                child: Transform.rotate(angle: .17, child: Icon(icons[1], size: small, color: color.withValues(alpha: .3))),
              ),
              PositionedDirectional(
                end: big * .68,
                top: box.maxHeight * .5 + small * .3,
                child: Transform.rotate(angle: -.12, child: Icon(icons[2], size: small * .8, color: color.withValues(alpha: .26))),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The signs for a subject, by the words in its id and name.
List<IconData> motifFor(String subject) {
  final s = subject.toLowerCase();
  bool has(String pattern) => RegExp(pattern).hasMatch(s);
  // Order matters: "social science" and "computer science" are not science, "physical education" is not physics.
  if (has(r'\bp\.?e\b|physical ed|sport|games|yoga|gym|athlet')) {
    return const [PhosphorIconsRegular.soccerBall, PhosphorIconsRegular.personSimpleRun, PhosphorIconsRegular.basketball, PhosphorIconsRegular.barbell];
  }
  if (has(r'comput|\bict\b|\bit\b|coding|program|informat|robot|digital')) {
    return const [PhosphorIconsRegular.code, PhosphorIconsRegular.cpu, PhosphorIconsRegular.bracketsCurly, PhosphorIconsRegular.binary];
  }
  if (has('econ|commerce|account|business|financ')) {
    return const [PhosphorIconsRegular.coins, PhosphorIconsRegular.chartLine, PhosphorIconsRegular.currencyCircleDollar, PhosphorIconsRegular.calculator];
  }
  if (has('social|civic|politic|citizen')) {
    return const [PhosphorIconsRegular.globeHemisphereWest, PhosphorIconsRegular.scales, PhosphorIconsRegular.bank, PhosphorIconsRegular.handshake];
  }
  if (has('histor')) {
    return const [PhosphorIconsRegular.hourglass, PhosphorIconsRegular.scroll, PhosphorIconsRegular.bank, PhosphorIconsRegular.feather];
  }
  if (has('geog')) {
    return const [PhosphorIconsRegular.globe, PhosphorIconsRegular.compass, PhosphorIconsRegular.mapTrifold, PhosphorIconsRegular.sun];
  }
  if (has('math|algebra|geometr|arith|calcul|statist|numera')) {
    return const [PhosphorIconsRegular.percent, PhosphorIconsRegular.plus, PhosphorIconsRegular.divide, PhosphorIconsRegular.minus];
  }
  if (has('physic')) {
    return const [PhosphorIconsRegular.atom, PhosphorIconsRegular.lightning, PhosphorIconsRegular.magnet, PhosphorIconsRegular.planet];
  }
  if (has('chem')) {
    return const [PhosphorIconsRegular.flask, PhosphorIconsRegular.testTube, PhosphorIconsRegular.atom, PhosphorIconsRegular.drop];
  }
  if (has('bio|botan|zoolog|life sci')) {
    return const [PhosphorIconsRegular.dna, PhosphorIconsRegular.leaf, PhosphorIconsRegular.microscope, PhosphorIconsRegular.heartbeat];
  }
  if (has(r'scien|\bevs\b|environ|nature')) {
    return const [PhosphorIconsRegular.flask, PhosphorIconsRegular.atom, PhosphorIconsRegular.leaf, PhosphorIconsRegular.lightbulb];
  }
  if (has(r'\bart\b|arts|draw|paint|craft|design')) {
    return const [PhosphorIconsRegular.paintBrush, PhosphorIconsRegular.palette, PhosphorIconsRegular.pencil, PhosphorIconsRegular.sparkle];
  }
  if (has('music|danc|drama|theat|choir')) {
    return const [PhosphorIconsRegular.musicNotes, PhosphorIconsRegular.musicNote, PhosphorIconsRegular.sparkle];
  }
  if (has(r'english|literat|language|reading|writing|grammar|french|spanish|german|arabic|hindi|sanskrit|kannada|tamil|latin|chinese|japanese|urdu|bengali|marathi|telugu|swahili|\blang')) {
    return const [PhosphorIconsRegular.textAa, PhosphorIconsRegular.quotes, PhosphorIconsRegular.bookOpen, PhosphorIconsRegular.translate];
  }
  return const [PhosphorIconsRegular.bookOpen, PhosphorIconsRegular.pencil, PhosphorIconsRegular.lightbulb, PhosphorIconsRegular.sparkle];
}
