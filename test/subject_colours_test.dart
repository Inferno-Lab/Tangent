import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/theme/app_colors.dart';

void main() {
  test("a school's subjects, keyed by its own ids, each take their own colour", () {
    AppColors.setSchoolSubjects({
      's6fdm78a9f': 'Mathematics',
      'k2j8x': 'English',
      'p0q1': 'Physics',
      'z9z9': 'Geography',
      'a1b2': 'French',
    });
    expect(AppColors.colourOfSubject('s6fdm78a9f'), 'blue');
    expect(AppColors.colourOfSubject('k2j8x'), 'red');
    final all = ['s6fdm78a9f', 'k2j8x', 'p0q1', 'z9z9', 'a1b2'].map(AppColors.colourOfSubject).toSet();
    expect(all.length, 5);
    // A key the school does not have still reads its familiar name, else teal.
    expect(AppColors.colourOfSubject('science'), 'green');
    expect(AppColors.colourOfSubject('nope'), 'teal');
    AppColors.setSchoolSubjects(const {});
  });
}
