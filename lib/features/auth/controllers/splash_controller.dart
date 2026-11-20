import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/routes/middlewares.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/storage_service.dart';
import 'package:tangent/core/theme/tokens.dart';

class SplashController extends GetxController {
  @override
  void onReady() {
    super.onReady();
    // Entrance is ~1.8s after the window settles; give it room to finish.
    Future<void>.delayed(AppMotion.intro, _go);
  }

  void _go() {
    DeepLinks.booted = true;
    if (Get.find<AuthService>().isLoggedIn) {
      unawaited(Get.offAllNamed<void>(AppRoutes.shell));
      return;
    }
    // The three first-run steps come once, before the first sign-in (the owner brought them back, 20 Nov 2026).
    final seen = Get.find<StorageService>().read<bool>(StorageKeys.onboardingSeen) ?? false;
    unawaited(Get.offAllNamed<void>(seen ? AppRoutes.login : AppRoutes.onboarding));
  }
}

/// The three first-run steps: one for students, one for parents, one for teachers.
class OnboardingController extends GetxController {
  final page = 0.obs;
  final controller = PageController();

  Future<void> next() async {
    if (page.value < 2) return goTo(page.value + 1);
    await finish();
  }

  Future<void> previous() async {
    if (page.value > 0) await goTo(page.value - 1);
  }

  Future<void> goTo(int index) => controller.animateToPage(index, duration: AppMotion.t4, curve: kEase);

  Future<void> finish() async {
    await Get.find<StorageService>().write(StorageKeys.onboardingSeen, true);
    unawaited(Get.offAllNamed<void>(AppRoutes.login));
  }

  @override
  void onClose() {
    controller.dispose();
    super.onClose();
  }
}
