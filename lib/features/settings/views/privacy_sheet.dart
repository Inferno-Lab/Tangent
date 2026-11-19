import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/core/services/school_config.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/glass_controls.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/user.dart';

/// The school's privacy notice and grievance officer (Settings → Privacy).
Future<void> showPrivacy() => showSheet<void>(const PrivacySheet());

/// Once, right after sign-in: a family (and a student old enough to agree for themself, from the country's age of
/// consent) reads the school's privacy notice and agrees before using the app, when the school requires it.
/// Nothing to ask on sample content.
Future<void> askConsentIfNeeded() async {
  final role = Get.find<AuthService>().role;
  if (!AppConfig.live || !SchoolConfig.consentRequired || (role != UserRole.parent && role != UserRole.student)) return;
  try {
    final me = Map<String, dynamic>.from(await Get.find<RemoteDataSource>().get('/v1/f/me') as Map);
    if (me['consentedAt'] != null || me['consentFor'] == 'guardian') return;
  } on Object {
    return; // asked again on the next start
  }
  await showSheet<void>(const PrivacySheet(consent: true), dismissible: false);
}

class PrivacySheet extends StatefulWidget {
  const PrivacySheet({this.consent = false, super.key});

  /// Asks for consent (and the photo answer) instead of only showing the notice.
  final bool consent;

  @override
  State<PrivacySheet> createState() => _PrivacySheetState();
}

class _PrivacySheetState extends State<PrivacySheet> {
  var _photos = false;
  var _busy = false;

  /// Families and students change their answers here once they have agreed (live accounts only).
  bool get _yours {
    final role = Get.find<AuthService>().role;
    return !widget.consent && AppConfig.live && (role == UserRole.parent || role == UserRole.student);
  }

  @override
  void initState() {
    super.initState();
    if (_yours && SchoolConfig.photoConsent) unawaited(_loadPhotos());
  }

  Future<void> _loadPhotos() async {
    try {
      final me = Map<String, dynamic>.from(await Get.find<RemoteDataSource>().get('/v1/f/me') as Map);
      if (mounted) setState(() => _photos = me['photoConsent'] == true);
    } on Object {
      // Shown as off until it loads; changing it still saves.
    }
  }

  Future<void> _setPhotos(bool on) async {
    setState(() => _photos = on);
    try {
      await Get.find<RemoteDataSource>().post('/v1/f/consent', {'photos': on});
      ToastHelper.show('privacy.photos_saved', kind: ToastKind.success);
    } on AppException catch (e) {
      if (mounted) setState(() => _photos = !on);
      ToastHelper.show(e.message, kind: ToastKind.error);
    }
  }

  /// A copy of the family's data, a correction or its deletion: the school's office answers (Privacy requests).
  Future<void> _ask(String kind) async {
    final note = TextEditingController();
    final send = await showSheet<bool>(
      SheetBody(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
        footer: Btn('privacy.send_request', expand: true, onPressed: () {
          if (SheetBody.valid()) Get.back<bool>(result: true);
        }),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('privacy.ask_$kind'.tr, style: context.type.h2),
            const SizedBox(height: 12),
            Field(controller: note, label: 'privacy.what_you_need'.tr, maxLines: 4, maxLength: 400, validator: Validators.text(min: 3, max: 400)),
          ],
        ),
      ),
    );
    if (send != true) return;
    try {
      await Get.find<RemoteDataSource>().post('/v1/f/data-requests', {'kind': kind, 'note': note.text.trim()});
      ToastHelper.show('privacy.request_sent', kind: ToastKind.success);
    } on AppException catch (e) {
      ToastHelper.show(e.message, kind: ToastKind.error);
    }
  }

  /// Withdrawing consent: the school stops what the law does not require and says what it keeps.
  Future<void> _withdraw() async {
    final sure = await showSheet<bool>(
      SheetBody(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
        footer: Btn('privacy.withdraw', expand: true, onPressed: () => Get.back<bool>(result: true)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('privacy.withdraw_title'.tr, style: context.type.h2),
            const SizedBox(height: 8),
            Text('privacy.withdraw_body'.tr, style: context.type.s),
          ],
        ),
      ),
    );
    if (sure != true) return;
    try {
      await Get.find<RemoteDataSource>().delete('/v1/f/consent');
      Get.back<void>();
      ToastHelper.show('privacy.withdrawn', kind: ToastKind.success);
    } on AppException catch (e) {
      ToastHelper.show(e.message, kind: ToastKind.error);
    }
  }

  Future<void> _agree() async {
    setState(() => _busy = true);
    try {
      await Get.find<RemoteDataSource>().post('/v1/f/consent', {if (SchoolConfig.photoConsent) 'photos': _photos});
      Get.back<void>();
    } on Object {
      if (mounted) setState(() => _busy = false);
      ToastHelper.show('privacy.save_failed', kind: ToastKind.error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final notice = AppConfig.privacyNotice.isEmpty ? 'privacy.default_notice'.tr : AppConfig.privacyNotice;
    return PopScope(
      canPop: !widget.consent,
      child: SheetBody(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
        // The answer stays in view however long the school's notice is.
        footer: widget.consent
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Btn('privacy.agree', expand: true, loading: _busy, onPressed: _agree),
                  const SizedBox(height: 10),
                  Btn(
                    'common.logout',
                    kind: BtnKind.quiet,
                    expand: true,
                    onPressed: _busy ? null : () => unawaited(Get.find<AuthService>().signOut()),
                  ),
                ],
              )
            : null,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const SchoolMark(size: 36),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(widget.consent ? 'privacy.consent_title'.tr : 'privacy.title'.tr, style: context.type.h2),
                ),
              ],
            ),
            if (widget.consent) ...[
              const SizedBox(height: 10),
              Text('privacy.consent_intro'.trp({'school': AppConfig.schoolName}), style: context.type.b.copyWith(color: c.ink2)),
            ],
            const SizedBox(height: 12),
            EduCard(
              padding: const EdgeInsets.all(16),
              child: Text(notice, style: context.type.s),
            ),
            if (AppConfig.privacyOfficer.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text('privacy.officer'.trp({'who': AppConfig.privacyOfficer}), style: context.type.cap),
            ],
            if (_yours) ...[
              if (SchoolConfig.photoConsent) ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('privacy.photos'.tr, style: context.type.ts),
                          Text('privacy.photos_hint'.tr, style: context.type.cap),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    GlassSwitch(value: _photos, label: 'privacy.photos'.tr, onChanged: (v) => unawaited(_setPhotos(v))),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              Text('privacy.your_data'.tr, style: context.type.ts),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final k in const ['access', 'correction', 'erasure'])
                    Btn('privacy.ask_$k', kind: BtnKind.quiet, onPressed: () => unawaited(_ask(k))),
                ],
              ),
              const SizedBox(height: 12),
              Btn('privacy.withdraw', kind: BtnKind.quiet, onPressed: () => unawaited(_withdraw())),
            ],
            if (widget.consent) ...[
              if (SchoolConfig.photoConsent) ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('privacy.photos'.tr, style: context.type.ts),
                          Text('privacy.photos_hint'.tr, style: context.type.cap),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    GlassSwitch(value: _photos, label: 'privacy.photos'.tr, onChanged: (v) => setState(() => _photos = v)),
                  ],
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
