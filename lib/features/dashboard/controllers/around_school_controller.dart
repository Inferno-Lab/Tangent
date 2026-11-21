import 'package:get/get.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/formatters.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';

/// What each "Around school" tile shows: a line of the module's own content, read when the sheet opens. A tile whose
/// module the school does not have is not built; one whose read fails shows its plain name and a quiet line.
class SchoolGlance {
  Notice? latestNotice;
  int newNotices = 0;
  SchoolEvent? nextEvent;
  DiaryEntry? diary;
  TransportInfo? bus;
  FamilyMeeting? meeting;
  List<DateTime> slots = const [];
  List<PickupPerson> pickups = const [];
  LibraryBook? book;
  int books = 0;
  GalleryAlbum? album;
  int formsWaiting = 0;
  int certificatesOpen = 0;
}

class AroundSchoolController extends GetxController {
  final glance = SchoolGlance().obs;
  final loading = true.obs;

  @override
  void onInit() {
    super.onInit();
    load().ignore();
  }

  bool has(String module) => SchoolConfig.has(module);

  Future<void> load() async {
    final g = SchoolGlance();
    final auth = Get.find<AuthService>();
    final child = auth.activeStudentId.value;
    final family = auth.role == UserRole.parent || auth.role == UserRole.student;
    final now = Clock.now();
    Future<void> read({required bool on, required Future<void> Function() f}) async {
      if (!on) return;
      try {
        await f();
      } on Object {
        // shortcut: a tile whose read fails keeps its plain line; the module's own page shows the error.
      }
    }

    await Future.wait([
      read(on: has('notices'), f: () async {
        final all = await Get.find<NoticeRepository>().all()
          ..sort((a, b) => b.date.compareTo(a.date));
        g.latestNotice = all.firstOrNull;
        g.newNotices = all.where((n) => now.difference(n.date).inDays < 7).length;
      }),
      read(on: has('events'), f: () async {
        final all = (await Get.find<EventRepository>().all()).where((e) => Formatters.daysUntil(e.date) >= 0).toList()
          ..sort((a, b) => a.date.compareTo(b.date));
        g.nextEvent = all.firstOrNull;
      }),
      read(on: has('diary') && family && child != null, f: () async {
        g.diary = (await Get.find<SchoolLifeRepository>().diary(child!)).firstOrNull;
      }),
      read(on: has('transport') && family && child != null, f: () async {
        g.bus = await Get.find<TransportRepository>().forStudent(child!);
      }),
      read(on: has('ptm') && family, f: () async {
        final all = await Get.find<SchoolLifeRepository>().meetings();
        g.meeting = all.where((m) => m.canBook).firstOrNull ?? all.firstOrNull;
        final mine = g.meeting?.children.where((k) => k.studentId == child).firstOrNull ?? g.meeting?.children.firstOrNull;
        g.slots = [for (final t in mine?.teachers ?? const <MeetingTeacher>[]) for (final s in t.slots) s.startsAt]..sort();
      }),
      read(on: has('visitors') && auth.role == UserRole.parent, f: () async {
        g.pickups = (await Get.find<SchoolLifeRepository>().gatePasses()).people.where((p) => child == null || p.studentId == child).toList();
      }),
      read(on: has('library'), f: () async {
        final mine = (await Get.find<LibraryRepository>().all()).where((b) => b.borrowedBy != null && b.borrowedBy == (child ?? auth.user.value?.id)).toList()
          ..sort((a, b) => (a.dueDate ?? now).compareTo(b.dueDate ?? now));
        g
          ..books = mine.length
          ..book = mine.firstOrNull;
      }),
      read(on: has('gallery'), f: () async {
        final all = await Get.find<GalleryRepository>().all()
          ..sort((a, b) => b.date.compareTo(a.date));
        g.album = all.firstOrNull;
      }),
      read(on: auth.role != UserRole.student, f: () async {
        final json = await Get.find<RemoteDataSource>().get('/v1/f/forms');
        g.formsWaiting = [for (final f in json as List) f].where((f) => ((f as Map)['pending'] as List? ?? const []).isNotEmpty).length;
      }),
      read(on: has('certificates') && auth.role == UserRole.parent, f: () async {
        g.certificatesOpen = (await Get.find<SchoolLifeRepository>().certificates()).certificates.where((c) => c.state == 'pending').length;
      }),
    ]);
    glance.value = g;
    loading.value = false;
  }
}
