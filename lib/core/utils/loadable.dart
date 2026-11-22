import 'dart:async';

import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/connectivity_service.dart';
import 'package:tangent/core/services/error_reporter.dart';
import 'package:tangent/core/services/session_bus.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/view_state.dart';
import 'package:tangent/core/widgets/toast.dart';

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
    // What the screen shows already (a list, or the friendly empty page) stays up while it reloads, and when the reload
    // fails: the person keeps reading and hears of the failure in a toast. Only a first load that fails shows the error page.
    final shown = state.value == ViewState.success || state.value == ViewState.empty;
    if (!shown) state.value = ViewState.loading;
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
      _failed(error.message, shown);
    } on Object catch (error, stack) {
      // A bug (bad data, a case nobody wrote for): the screen says it could not load and offers Retry, instead of
      // spinning for ever; the school's server hears of it.
      ErrorReporter.report(error, stack);
      _failed('errors.generic', shown);
    }
  }

  void _failed(String message, bool shown) {
    errorMessage.value = message;
    if (!shown) {
      state.value = ViewState.error;
      return;
    }
    // Offline, the page's offline capsule already says why nothing new came.
    final offline = Get.isRegistered<ConnectivityService>() && !Get.find<ConnectivityService>().isOnline.value;
    if (!offline) ToastHelper.show(message, kind: ToastKind.error);
  }

  @override
  void onInit() {
    super.onInit();
    watchSession();
    unawaited(load());
  }
}
