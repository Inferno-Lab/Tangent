import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/bindings/initial_binding.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/data/repositories/academic_repository.dart';
import 'package:tangent/data/repositories/auth_repository.dart';
import 'package:tangent/data/repositories/campus_repository.dart';
import 'package:tangent/data/repositories/directory_repository.dart';
import 'package:tangent/data/repositories/school_life_repository.dart';

void main() {
  tearDown(Get.reset);

  test('the binding resolves every repository to the school', () {
    Get.testMode = true;
    Get.put(StorageService(memory: <String, dynamic>{}));
    InitialBinding().dependencies();

    expect(Get.find<AuthRepository>(), isA<AuthRepository>());
    expect(Get.find<DirectoryRepository>(), isA<DirectoryRepository>());
    expect(Get.find<AttendanceRepository>(), isA<AttendanceRepository>());
    expect(Get.find<TimetableRepository>(), isA<TimetableRepository>());
    expect(Get.find<HomeworkRepository>(), isA<HomeworkRepository>());
    expect(Get.find<ExamRepository>(), isA<ExamRepository>());
    expect(Get.find<FeeRepository>(), isA<FeeRepository>());
    expect(Get.find<NoticeRepository>(), isA<NoticeRepository>());
    expect(Get.find<EventRepository>(), isA<EventRepository>());
    expect(Get.find<ChatRepository>(), isA<ChatRepository>());
    expect(Get.find<LibraryRepository>(), isA<LibraryRepository>());
    expect(Get.find<TransportRepository>(), isA<TransportRepository>());
    expect(Get.find<LeaveRepository>(), isA<LeaveRepository>());
    expect(Get.find<GalleryRepository>(), isA<GalleryRepository>());
    expect(Get.find<NotificationRepository>(), isA<NotificationRepository>());
    expect(Get.find<SchoolLifeRepository>(), isA<SchoolLifeRepository>());
  });
}
