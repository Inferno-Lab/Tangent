import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/data/repositories/auth_repository.dart';

class LoginController extends GetxController {
  final email = TextEditingController();
  final password = TextEditingController();
  final otp = TextEditingController();
  final formKey = GlobalKey<FormState>();
  final loading = false.obs;
  final useOtp = false.obs;

  /// Seconds before another code may be asked for (the school's answer).
  final resendIn = 30.obs;

  /// The code comes from the person's authenticator app; with a key to add first when it is their first sign-in with one.
  final fromApp = false.obs;
  final setupKey = RxnString();
  String? setupUri;
  List<String>? setupQr;
  /// True when the person asked for a code instead of typing a password (families have no password).
  var _codeOnly = false;

  /// "Use a code instead" and "Resend": a fresh code, by the same route the person started on.
  Future<void> requestCode() {
    if (email.text.trim().isEmpty) {
      ToastHelper.show('validation.email_or_phone_required'.tr, kind: ToastKind.error);
      return Future.value();
    }
    _codeOnly = true;
    return _enter(() => Get.find<AuthRepository>().requestCode(email.text));
  }

  Future<void> resend() => _codeOnly ? requestCode() : _enter(() => Get.find<AuthRepository>().login(email: email.text, password: password.text));

  Future<void> submit() async {
    // The code screen has no form (the password screen's is gone once it shows); its Verify waits for six digits.
    if (useOtp.value) {
      await _enter(
        () => Get.find<AuthRepository>().loginWithOtp(
          email: email.text,
          otp: otp.text,
        ),
      );
      return;
    }
    if (formKey.currentState?.validate() != true) return;
    _codeOnly = false;
    await _enter(
      () => Get.find<AuthRepository>().login(
        email: email.text,
        password: password.text,
      ),
    );
  }

  Future<void> _enter(Future<AppUser> Function() action) async {
    if (loading.value) return;
    loading.value = true;
    try {
      final user = await action();
      await Get.find<AuthService>().setSession(user);
      unawaited(Get.offAllNamed<void>(AppRoutes.shell));
    } on OtpRequired catch (sent) {
      // The password was right. The school sent a code; the code screen takes over.
      otp.clear();
      useOtp.value = true;
      fromApp.value = sent.fromApp;
      setupKey.value = sent.setupKey;
      setupUri = sent.setupUri;
      setupQr = sent.setupQr;
      resendIn.value = sent.resendIn;
      resendIn.refresh();
      ToastHelper.show(sent.message, body: sent.sentTo);
    } on AppException catch (error) {
      ToastHelper.show(error.message, kind: ToastKind.error);
    } finally {
      loading.value = false;
    }
  }

  @override
  void onClose() {
    email.dispose();
    password.dispose();
    otp.dispose();
    super.onClose();
  }
}
