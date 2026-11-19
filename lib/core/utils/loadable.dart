import 'dart:async';

import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/session_bus.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/view_state.dart';

mixin Loadable on GetxController {
  final state = ViewState.loading.obs;
  final errorMessage = 'errors.generic'.obs;

  bool get watchRevision => true;

  Future<void> load();

  void watchSession() {
    if (watchRevision && Get.isRegistered<SessionBus>()) {
      ever(Get.find<SessionBus>().revision, (_) => load());
    }
    if (Get.isRegistered<AuthService>()) {
      ever(Get.find<AuthService>().activeStudentId, (_) => load());
    }
  }

  Future<void> run(
    Future<void> Function() body, {
    bool Function()? isEmpty,
  }) async {
    if (state.value != ViewState.success) state.value = ViewState.loading;
    try {
      await body();
      final next = (isEmpty?.call() ?? false) ? ViewState.empty : ViewState.success;
      // Screens rebuild on `state`; a reload that ends where it started (success again) must still tell them, or
      // an approval showed its toast while the list kept the old row until the page was opened again.
      if (state.value == next) {
        state.refresh();
      } else {
        state.value = next;
      }
    } on AppException catch (error) {
      errorMessage.value = error.message;
      state.value = ViewState.error;
    }
  }

  @override
  void onInit() {
    super.onInit();
    watchSession();
    unawaited(load());
  }
}
