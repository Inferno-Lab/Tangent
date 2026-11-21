import 'package:tangent/core/utils/open_link.dart';
import 'package:intl/intl.dart';

/// Adds an event to the phone's own calendar: the school's server makes a calendar file (its days on the school's clock,
/// with a reminder when [remindMinutes] is given) that the phone opens in its calendar app. All-day events end on [last].
Future<void> addToCalendar({
  required String title,
  required DateTime first,
  DateTime? last,
  String details = '',
  int? remindMinutes,
}) async {
  final day = DateFormat('yyyy-MM-dd');
  return openFromServer(
    (r) => r.post('/calendar/link', {
      'events': [
        {
          'title': title.length > 120 ? title.substring(0, 120) : title,
          'start': day.format(first),
          if (last != null) 'end': day.format(last),
          if (details.isNotEmpty) 'details': details.length > 300 ? details.substring(0, 300) : details,
          'alarmMinutes': ?remindMinutes,
        },
      ],
    }),
  );
}

/// A week of lessons added to the phone's calendar, repeating until the term ends: a class's, or (no class) the
/// signed-in teacher's own.
Future<void> addLessonsToCalendar({String? classId}) =>
    openFromServer((r) => r.post('/timetable/calendar-link', {'classId': ?classId}));
