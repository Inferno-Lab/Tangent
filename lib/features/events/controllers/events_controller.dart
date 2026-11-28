import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/core/utils/clock.dart';

/// The event's start as hours and minutes, or null when it has none of its own: no time, or midnight (a holiday, all day).
({int h, int m})? _start(SchoolEvent e) {
  final p = e.time.split(':');
  final h = int.tryParse(p.first);
  final m = p.length > 1 ? int.tryParse(p[1]) : null;
  return h == null || m == null || (h == 0 && m == 0) ? null : (h: h, m: m);
}

/// Whether the event runs all day (it has no start time of its own).
bool eventAllDay(SchoolEvent e) => _start(e) == null;

/// The event's start as people read it ("4 pm", "9:30 am"), or "All day"; never "12 am" or a bare "00:00".
String eventTime(SchoolEvent e) {
  final s = _start(e);
  if (s == null) return 'events.all_day'.tr;
  return DateFormat(s.m == 0 ? 'h a' : 'h:mm a').format(DateTime(2000, 1, 1, s.h, s.m)).toLowerCase();
}

/// When and where as one line: its time, then its place when it has one; never a separator with nothing after it.
String eventWhenWhere(SchoolEvent e, {bool lower = false}) => [
  eventTime(e),
  if (e.venue.trim().isNotEmpty) lower ? e.venue.trim().toLowerCase() : e.venue.trim(),
].join(' · ');

/// When the gates open, a quarter of an hour before it starts; null for an event that runs all day.
DateTime? eventGates(SchoolEvent e) {
  final s = _start(e);
  return s == null ? null : DateTime(2000, 1, 1, s.h, s.m).subtract(const Duration(minutes: 15));
}

class EventsController extends GetxController with Loadable {
  List<SchoolEvent> items = [];
  String? childName;

  /// Answers given on this device before the server confirms them.
  final pending = <String, RsvpStatus>{}.obs;

  String? get _me => Get.find<AuthService>().user.value?.id;

  List<SchoolEvent> get upcoming {
    final today = DateUtils.dateOnly(Clock.now());
    return items.where((e) => !e.date.isBefore(today)).toList()..sort((a, b) => a.date.compareTo(b.date));
  }

  String? _featuredId;

  /// The next event that asks families to come and has no answer yet; else the next one.
  /// Picked on first load and then held, so answering shows the choice on the same card
  /// instead of swapping to the next event.
  SchoolEvent? get featured => byId(_featuredId) ?? _pick();

  SchoolEvent? _pick() {
    final list = upcoming;
    return list.where((e) => e.category != 'general' && mine(e) == null).firstOrNull ?? list.firstOrNull;
  }

  RsvpStatus? mine(SchoolEvent e) =>
      pending[e.id] ?? e.rsvps.where((r) => r.userId == _me).map((r) => r.status).firstOrNull;

  /// Replies are taken while the school asks for one, up to its last day and never after the event's day.
  bool canReply(SchoolEvent e) {
    final today = DateUtils.dateOnly(Clock.now());
    return e.needsRsvp && !today.isAfter(e.date) && (e.rsvpBy == null || !today.isAfter(e.rsvpBy!));
  }

  int going(SchoolEvent e) {
    final others = e.rsvps.where((r) => r.userId != _me && r.status == RsvpStatus.going).length;
    return others + (mine(e) == RsvpStatus.going ? 1 : 0);
  }

  @override
  Future<void> load() => run(() async {
    items = await Get.find<EventRepository>().all();
    // A reload after an answer must not move the card: pick again only if the held event is gone.
    if (byId(_featuredId) == null) _featuredId = _pick()?.id;
    final id = Get.find<AuthService>().activeStudentId.value;
    childName = id == null ? null : (await Get.find<DirectoryRepository>().student(id)).name.split(' ').first;
  }, isEmpty: () => items.isEmpty);

  SchoolEvent? byId(String? id) => items.where((e) => e.id == id).firstOrNull;

  Future<void> rsvp(String eventId, RsvpStatus status) async {
    if (!SchoolConfig.allows('events.rsvp')) return;
    final userId = _me;
    if (userId == null) return;
    pending[eventId] = status;
    try {
      await Get.find<EventRepository>().rsvp(eventId: eventId, userId: userId, status: status);
      ToastHelper.show('events.saved', kind: ToastKind.success);
    } on AppException catch (error) {
      pending.remove(eventId);
      ToastHelper.show(error.message, kind: ToastKind.error);
    }
  }
}
