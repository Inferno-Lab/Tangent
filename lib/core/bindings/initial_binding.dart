import 'dart:async';

import 'package:get/get.dart';
import 'package:tangent/core/services/push_service.dart';
import 'package:tangent/core/network/api_client.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/connectivity_service.dart';
import 'package:tangent/core/services/live_stream.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/assistant_repository.dart';
import 'package:tangent/data/repositories/auth_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/data/repositories/driver_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';

class InitialBinding extends Bindings {
  @override
  void dependencies() {
    final remote = Get.put(
      RemoteDataSource(ApiClient(onSignedOut: () => unawaited(Get.find<AuthService>().signOut(server: false)), onLocked: () => unawaited(SchoolConfig.load()))),
      permanent: true,
    );
    Get
      ..put(LiveStream(), permanent: true)
      ..put(PushService(remote), permanent: true);
    // Attendance marked without a signal is sent as soon as the phone is back online.
    if (Get.isRegistered<ConnectivityService>()) {
      // What the school refused (a day locked meanwhile) is said, not dropped quietly.
      Get.find<ConnectivityService>().onBackOnline.add(() async {
        final r = await remote.client.flushOutbox();
        if (r.refused.isNotEmpty) ToastHelper.show('teacher.attendance_not_sent'.trp({'reason': r.refused.first.tr}), kind: ToastKind.error);
      });
    }
    Get
      ..lazyPut<AuthRepository>(() => AuthRepository(remote), fenix: true)
      ..lazyPut<DirectoryRepository>(
        () => DirectoryRepository(remote),
        fenix: true,
      )
      ..lazyPut<AttendanceRepository>(
        () => AttendanceRepository(remote),
        fenix: true,
      )
      ..lazyPut<TimetableRepository>(
        () => TimetableRepository(remote),
        fenix: true,
      )
      ..lazyPut<HomeworkRepository>(
        () => HomeworkRepository(remote),
        fenix: true,
      )
      ..lazyPut<ExamRepository>(() => ExamRepository(remote), fenix: true)
      ..lazyPut<FeeRepository>(() => FeeRepository(remote), fenix: true)
      ..lazyPut<NoticeRepository>(() => NoticeRepository(remote), fenix: true)
      ..lazyPut<EventRepository>(() => EventRepository(remote), fenix: true)
      ..lazyPut<ChatRepository>(() => ChatRepository(remote), fenix: true)
      ..lazyPut<LibraryRepository>(
        () => LibraryRepository(remote),
        fenix: true,
      )
      ..lazyPut<TransportRepository>(
        () => TransportRepository(remote),
        fenix: true,
      )
      ..lazyPut<DriverRepository>(() => DriverRepository(remote), fenix: true)
      ..lazyPut<LeaveRepository>(() => LeaveRepository(remote), fenix: true)
      ..lazyPut<GalleryRepository>(
        () => GalleryRepository(remote),
        fenix: true,
      )
      ..lazyPut<NotificationRepository>(
        () => NotificationRepository(remote),
        fenix: true,
      )
      ..lazyPut<SchoolLifeRepository>(() => SchoolLifeRepository(remote), fenix: true)
      ..lazyPut<AssistantRepository>(() => RemoteAssistantRepository(remote), fenix: true);
  }
}
