import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/utils/open_link.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

/// Adds an event to the phone's own calendar: the school's server makes a calendar file (its days on the school's clock,
/// with a reminder when [remindMinutes] is given) that the phone opens in its calendar app. All-day events end on [last].
/// Sample content has no server, so it opens a pre-filled web calendar instead.
Future<void> addToCalendar({
  required String title,
  required DateTime first,
  DateTime? last,
  String details = '',
  int? remindMinutes,
}) async {
  final day = DateFormat('yyyy-MM-dd');
  if (AppConfig.live) {
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
  final fmt = DateFormat('yyyyMMdd');
  final end = (last ?? first).add(const Duration(days: 1));
  final uri = Uri.https('calendar.google.com', '/calendar/render', {
    'action': 'TEMPLATE',
    'text': title,
    'dates': '${fmt.format(first)}/${fmt.format(end)}',
    'details': details,
  });
  var ok = false;
  try {
    ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } on Exception {
    ok = false;
  }
  if (!ok) ToastHelper.show('errors.cant_open', kind: ToastKind.error);
}

/// A week of lessons added to the phone's calendar, repeating until the term ends: a class's, or (no class) the
/// signed-in teacher's own.
Future<void> addLessonsToCalendar({String? classId}) =>
    openFromServer((r) => r.post('/timetable/calendar-link', {'classId': ?classId}));
