import 'dart:async';

import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/routes/middlewares.dart';
import 'package:tangent/core/services/auth_service.dart';

class SplashController extends GetxController {
  @override
  void onReady() {
    super.onReady();
    // Entrance is ~1.8s after the window settles; give it room to finish.
    Future<void>.delayed(const Duration(milliseconds: 2400), _go);
  }

  void _go() {
    DeepLinks.booted = true;
    // No first-run pages: the welcome after the first sign-in (one per role) says what the app is.
    if (Get.find<AuthService>().isLoggedIn) {
      unawaited(Get.offAllNamed<void>(AppRoutes.shell));
      return;
    }
    unawaited(Get.offAllNamed<void>(AppRoutes.login));
  }
}
