import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';

/// "Forgot password?" on the sign-in screen: a code to the person's email or phone, then a new password (§5.1.3).
Future<void> showForgotPassword(String identifier) => showSheet<void>(_ForgotSheet(identifier: identifier));

/// Profile → Change password, for staff who sign in with one.
Future<void> showChangePassword() => showSheet<void>(const _ChangeSheet());

/// Signs this person out on every phone and computer, then here.
Future<void> signOutEverywhere() async {
  if (AppConfig.live) {
    try {
      await Get.find<RemoteDataSource>().post('/v1/auth/logout-all', const {});
    } on AppException catch (e) {
      ToastHelper.show(e.message, kind: ToastKind.error);
      return;
    }
  }
  await Get.find<AuthService>().signOut();
}

Future<bool> _send(String path, Map<String, dynamic> body, {void Function(dynamic json)? then}) async {
  if (!AppConfig.live) {
    ToastHelper.show('common.sample_only');
    return false;
  }
  try {
    final json = await Get.find<RemoteDataSource>().post(path, body);
    then?.call(json);
    return true;
  } on AppException catch (e) {
    ToastHelper.show(e.message, kind: ToastKind.error);
    return false;
  }
}

class _ForgotSheet extends StatefulWidget {
  const _ForgotSheet({required this.identifier});

  final String identifier;

  @override
  State<_ForgotSheet> createState() => _ForgotSheetState();
}

class _ForgotSheetState extends State<_ForgotSheet> {
  late final _who = TextEditingController(text: widget.identifier);
  final _code = TextEditingController();
  final _password = TextEditingController();
  String? _challenge;
  String _sentTo = '';
  var _busy = false;

  Future<void> _start() async {
    setState(() => _busy = true);
    await _send('/v1/auth/reset/start', {'identifier': _who.text.trim()}, then: (json) {
      final m = Map<String, dynamic>.from(json as Map);
      _challenge = m['challengeId'] as String?;
      _sentTo = '${m['maskedTo'] ?? ''}${m['demoCode'] == null ? '' : ' · ${m['demoCode']}'}';
    });
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _finish() async {
    setState(() => _busy = true);
    final ok = await _send('/v1/auth/reset/finish', {'challengeId': _challenge, 'code': _code.text.trim(), 'password': _password.text});
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Get.back<void>();
      ToastHelper.show('auth.password_reset_done', kind: ToastKind.success);
    }
  }

  @override
  Widget build(BuildContext context) => SheetBody(
    padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
    footer: Btn(_challenge == null ? 'auth.send_code' : 'auth.save_password', expand: true, loading: _busy, onPressed: _challenge == null ? _start : _finish),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
      Text('auth.forgot_title'.tr, style: context.type.h2),
      const SizedBox(height: 6),
      Text(_challenge == null ? 'auth.forgot_body'.tr : 'auth.code_sent_to'.trp({'to': _sentTo}), style: context.type.s),
      const SizedBox(height: 16),
      if (_challenge == null)
        Field(controller: _who, label: 'auth.email_or_phone'.tr, icon: PhosphorIconsRegular.at, keyboard: TextInputType.emailAddress)
      else ...[
        Field(controller: _code, label: 'auth.code'.tr, icon: PhosphorIconsRegular.hash, keyboard: TextInputType.number),
        const SizedBox(height: 12),
        Field(controller: _password, label: 'auth.new_password'.tr, icon: PhosphorIconsRegular.lockSimple, obscure: true),
      ],
      ],
    ),
  );
}

class _ChangeSheet extends StatefulWidget {
  const _ChangeSheet();

  @override
  State<_ChangeSheet> createState() => _ChangeSheetState();
}

class _ChangeSheetState extends State<_ChangeSheet> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  var _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    final ok = await _send('/v1/auth/password', {'current': _current.text, 'next': _next.text});
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) {
      Get.back<void>();
      ToastHelper.show('auth.password_changed', kind: ToastKind.success);
    }
  }

  @override
  Widget build(BuildContext context) => SheetBody(
    padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
    footer: Btn('auth.save_password', expand: true, loading: _busy, onPressed: _save),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
      Text('auth.change_password'.tr, style: context.type.h2),
      const SizedBox(height: 16),
      Field(controller: _current, label: 'auth.current_password'.tr, icon: PhosphorIconsRegular.lockSimple, obscure: true),
      const SizedBox(height: 12),
      Field(controller: _next, label: 'auth.new_password'.tr, icon: PhosphorIconsRegular.lockSimpleOpen, obscure: true),
      const SizedBox(height: 8),
      Text('auth.password_rule'.tr, style: context.type.cap),
      ],
    ),
  );
}
