import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/widgets/ui/subject_motif.dart';

void main() {
  test('each subject gets its own signs, read by its name', () {
    expect(motifFor('Mathematics'), contains(PhosphorIconsRegular.percent));
    expect(motifFor('Social Science'), contains(PhosphorIconsRegular.scales));
    expect(motifFor('Computer Science'), contains(PhosphorIconsRegular.code));
    expect(motifFor('Physical Education'), contains(PhosphorIconsRegular.soccerBall));
    expect(motifFor('Physics'), contains(PhosphorIconsRegular.atom));
    expect(motifFor('Science'), contains(PhosphorIconsRegular.flask));
    expect(motifFor('French'), contains(PhosphorIconsRegular.textAa));
    expect(motifFor('Woodwork'), contains(PhosphorIconsRegular.bookOpen));
  });
}
