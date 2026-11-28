import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/translations/app_translations.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/features/events/controllers/events_controller.dart';

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

  test('an event with no time of its own reads All day, has no gates and never crashes', () {
    Get.addTranslations(AppTranslations().keys);
    Get.locale = const Locale('en');
    SchoolEvent at(String time, [String venue = '']) =>
        SchoolEvent(id: 'e', title: 'Holiday', description: '', date: DateTime(2026, 12, 25), time: time, venue: venue, category: 'holiday', imageUrl: '', rsvps: const []);
    for (final t in ['', '00:00', 'soon']) {
      expect(eventTime(at(t)), 'All day');
      expect(eventGates(at(t)), isNull);
    }
    expect(eventTime(at('16:00')), '4 pm');
    expect(eventTime(at('09:30')), '9:30 am');
    expect(eventGates(at('09:30')), DateTime(2000, 1, 1, 9, 15));
    expect(eventWhenWhere(at('16:00', 'Main hall'), lower: true), '4 pm · main hall');
    expect(eventWhenWhere(at('')), 'All day');
  });
}
