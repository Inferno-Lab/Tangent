import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/glass_controls.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';

/// Settings → Phone and email: a new one is confirmed by a code sent to it (§5.1.3).
Future<void> showContactChange() => showSheet<void>(const _ContactSheet());

/// Settings → Signed-in devices: where this account is signed in, each signed out on its own.
Future<void> showDevices() => showSheet<void>(const _DevicesSheet());

/// A call to the school; its refusal is said in a toast.
Future<dynamic> _call(Future<dynamic> Function(RemoteDataSource r) fn) async {
  try {
    return await fn(Get.find<RemoteDataSource>()) ?? true;
  } on AppException catch (e) {
    ToastHelper.show(e.message, kind: ToastKind.error);
    return null;
  }
}

class _ContactSheet extends StatefulWidget {
  const _ContactSheet();

  @override
  State<_ContactSheet> createState() => _ContactSheetState();
}

class _ContactSheetState extends State<_ContactSheet> {
  final _value = TextEditingController();
  final _code = TextEditingController();
  var _email = false;
  String? _challenge;
  var _sentTo = '';
  var _busy = false;

  Future<void> _start() async {
    if (!SheetBody.valid()) return;
    setState(() => _busy = true);
    final json = await _call((r) => r.post('/v1/f/me/contact', {_email ? 'email' : 'phone': _value.text.trim()}));
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (json is Map) {
        _challenge = json['challengeId'] as String?;
        _sentTo = '${json['maskedTo'] ?? ''}';
      }
    });
  }

  Future<void> _finish() async {
    if (!SheetBody.valid()) return;
    setState(() => _busy = true);
    final ok = await _call((r) => r.post('/v1/f/me/contact/confirm', {'challengeId': _challenge, 'code': _code.text.trim()}));
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok != null) {
      Get.back<void>();
      ToastHelper.show(_email ? 'account.email_changed' : 'account.phone_changed', kind: ToastKind.success);
    }
  }

  @override
  void dispose() {
    _value.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SheetBody(
    padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
    footer: Btn(_challenge == null ? 'auth.send_code' : 'account.confirm', expand: true, loading: _busy, onPressed: _challenge == null ? _start : _finish),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('account.phone_email'.tr, style: context.type.h2),
        const SizedBox(height: 6),
        Text(_challenge == null ? 'account.phone_email_body'.tr : 'auth.code_sent_to'.trp({'to': _sentTo}), style: context.type.s),
        const SizedBox(height: 20),
        if (_challenge == null) ...[
          GlassSegmented(
            labels: const ['account.new_phone', 'account.new_email'],
            index: _email ? 1 : 0,
            flat: true,
            semanticLabel: 'account.phone_email'.tr,
            onChanged: (i) => setState(() {
              _email = i == 1;
              _value.clear();
            }),
          ),
          const SizedBox(height: 20),
          // The other tab's field sits unseen under this one, so the sheet keeps one height whichever tab is chosen (their
          // help lines differ in length).
          Stack(
            children: [
              IgnorePointer(
                child: ExcludeSemantics(
                  child: Opacity(
                    opacity: 0,
                    child: Field(
                      label: (_email ? 'account.new_phone' : 'account.new_email').tr,
                      icon: PhosphorIconsRegular.phone,
                      help: _email ? 'field.phone' : 'field.email',
                    ),
                  ),
                ),
              ),
              Field(
            controller: _value,
            label: (_email ? 'account.new_email' : 'account.new_phone').tr,
            icon: _email ? PhosphorIconsRegular.at : PhosphorIconsRegular.phone,
            keyboard: _email ? TextInputType.emailAddress : TextInputType.phone,
            help: _email ? 'field.email' : 'field.phone',
            maxLength: _email ? 254 : 24,
            // The key changes with the kind, so switching clears the other kind's message.
            key: ValueKey(_email),
            validator: _email ? Validators.email : Validators.phone,
          ),
            ],
          ),
        ] else
          Field(controller: _code, label: 'auth.code'.tr, icon: PhosphorIconsRegular.hash, keyboard: TextInputType.number, maxLength: 6, help: 'field.code', validator: Validators.otp),
      ],
    ),
  );
}

class _DevicesSheet extends StatefulWidget {
  const _DevicesSheet();

  @override
  State<_DevicesSheet> createState() => _DevicesSheetState();
}

class _DevicesSheetState extends State<_DevicesSheet> {
  List<Map<String, dynamic>>? _list;
  String? _ending;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final json = await _call((r) => r.get('/v1/f/me/sessions'));
    if (!mounted) return;
    setState(() => _list = json is List ? [for (final x in json) Map<String, dynamic>.from(x as Map)] : const []);
  }

  Future<void> _end(String id) async {
    setState(() => _ending = id);
    final ok = await _call((r) => r.delete('/v1/f/me/sessions/$id'));
    if (!mounted) return;
    setState(() => _ending = null);
    if (ok != null) {
      ToastHelper.show('account.signed_out_there', kind: ToastKind.success);
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('account.devices'.tr, style: context.type.h2),
          const SizedBox(height: 6),
          Text('account.devices_body'.tr, style: context.type.s),
          const SizedBox(height: 12),
          if (list == null)
            const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator.adaptive()))
          else if (list.isEmpty)
            Text('account.no_devices'.tr, style: context.type.cap)
          else
            for (final s in list)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s['device'] as String? ?? '', style: context.type.ts, maxLines: 1, overflow: TextOverflow.ellipsis),
                          Text(
                            s['current'] == true
                                ? 'account.this_device'.tr
                                : 'account.since'.trp({'day': DateFormat.yMMMd(Get.locale?.toLanguageTag()).format(DateTime.parse(s['since'] as String).toLocal())}),
                            style: context.type.cap,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    if (s['current'] != true)
                      Btn('account.sign_out_there', kind: BtnKind.quiet, loading: _ending == s['id'], action: () => _end(s['id'] as String)),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}
