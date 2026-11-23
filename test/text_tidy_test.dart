import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/utils/extensions.dart';

void main() {
  test('an empty part leaves no separator behind', () {
    expect(tidySeparators(' · return by Wed 11 Nov'), 'Return by Wed 11 Nov');
    expect(tidySeparators('Today · '), 'Today');
    expect(tidySeparators('8 A ·  · 8 classes'), '8 A · 8 classes');
    expect(tidySeparators('Maths · Room 8A'), 'Maths · Room 8A');
  });

  test('a room reads by its own name, a bare number with the word', () {
    Get.addTranslations(AppTranslations().keys);
    Get.locale = const Locale('en');
    expect(roomLabel('Room 8A'), 'Room 8A');
    expect(roomLabel('Science lab'), 'Science lab');
    expect(roomLabel('12'), 'Room 12');
    expect(roomLabel(''), '');
  });
}
