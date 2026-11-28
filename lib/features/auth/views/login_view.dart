import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:tangent/features/auth/views/password_sheets.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:tangent/core/widgets/glass.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/features/auth/controllers/login_controller.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

class LoginView extends GetView<LoginController> {
  const LoginView({super.key});

  @override
  Widget build(BuildContext context) {
    return Obx(
      () => AnimatedSwitcher(
        duration: context.reduceMotion ? Duration.zero : AppMotion.t3,
        child: controller.useOtp.value
            ? _OtpScreen(key: const ValueKey('otp'), controller: controller)
            : _PasswordScreen(key: const ValueKey('pw'), controller: controller),
      ),
    );
  }
}

/// The top of the sign-in screens, as the SignIn board: the school's crest and name with the cell art on its deep
/// colour, ending in the sheet's rounded edge.
class SignInHead extends StatelessWidget {
  const SignInHead({this.art = true, this.leading, super.key});

  final bool art;

  /// A back button, in the row before the crest so the two never overlap.
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    // The sheet's edge overlaps the deep block by a pixel so no seam shows between them.
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ColoredBox(
          color: c.deep,
          child: Padding(
            padding: EdgeInsets.fromLTRB(24, MediaQuery.paddingOf(context).top + 20, 24, 52),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    if (leading != null) ...[leading!, const SizedBox(width: 12)],
                    Container(
                      width: 36,
                      height: 36,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: c.bright, borderRadius: BorderRadius.circular(AppRadius.md)),
                      child: Text(AppConfig.schoolMark, style: context.type.h3.copyWith(color: c.onBright)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(AppConfig.schoolName, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.type.t.copyWith(color: c.onDeep)),
                    ),
                  ],
                ),
                if (art) ...[
                  const SizedBox(height: 24),
                  // On a tablet the art keeps a phone's size.
                  Align(alignment: Alignment.centerLeft, child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 440), child: const CellArt())),
                ],
              ],
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: -1,
          height: 29,
          child: DecoratedBox(
            decoration: BoxDecoration(color: c.chalk, borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
          ),
        ),
      ],
    );
  }
}

class _PasswordScreen extends StatelessWidget {
  const _PasswordScreen({required this.controller, super.key});

  final LoginController controller;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final inset = MediaQuery.paddingOf(context);
    return Scaffold(
      backgroundColor: c.chalk,
      body: ListView(
        padding: EdgeInsets.only(bottom: inset.bottom + 24),
        children: [
          const SignInHead(),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 0),
            child: Form(
              key: controller.formKey,
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Rise(child: Text('auth.sign_in'.tr, style: context.type.h1)),
                    const SizedBox(height: 20),
                    Rise(
                      index: 2,
                      child: Field(
                        controller: controller.email,
                        label: 'auth.email_or_phone',
                        help: 'field.sign_in_id',
                        icon: PhosphorIconsRegular.envelopeSimple,
                        keyboard: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email, AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        validator: Validators.emailOrPhone,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Rise(index: 3, child: _PasswordField(controller: controller)),
                    const SizedBox(height: 20),
                    Rise(
                      index: 4,
                      child: Obx(
                        () => Btn(
                          'auth.sign_in',
                          kind: BtnKind.ink,
                          expand: true,
                          loading: controller.loading.value,
                          onPressed: controller.submit,
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    Center(
                      child: Pressable(
                        onTap: () => Get.toNamed<void>(AppRoutes.help),
                        child: Text.rich(
                          TextSpan(
                            text: '${'auth.trouble'.tr} ',
                            children: [
                              TextSpan(
                                text: 'auth.contact_office'.tr,
                                style: AppText.capB(color: c.mariText),
                              ),
                            ],
                          ),
                          style: context.type.cap,
                          textAlign: TextAlign.center,
                        ),),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PasswordField extends StatefulWidget {
  const _PasswordField({required this.controller});

  final LoginController controller;

  @override
  State<_PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<_PasswordField> {
  var _shown = false;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Text('auth.password'.tr, style: AppText.capB(color: c.ink2, height: 1.2)),
              ),
            ),
            Pressable(
              onTap: () => unawaited(showForgotPassword(widget.controller.email.text)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                child: Text('auth.forgot'.tr, style: AppText.capB(color: c.mariText, height: 1.2)),
              ),),
            Pressable(
              onTap: () => unawaited(widget.controller.requestCode()),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text('auth.use_code'.tr, style: AppText.capB(color: c.mariText, height: 1.2)),
              ),),
          ],
        ),
        const SizedBox(height: 8),
        Field(
          controller: widget.controller.password,
          icon: PhosphorIconsRegular.lockSimple,
          obscure: !_shown,
          help: 'field.password',
          autofillHints: const [AutofillHints.password],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => widget.controller.submit(),
          validator: Validators.password,
          trailing: Semantics(
            button: true,
            label: (_shown ? 'auth.hide_password' : 'auth.show_password').tr,
            child: Pressable(
              onTap: () => setState(() => _shown = !_shown),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Icon(_shown ? PhosphorIconsRegular.eyeSlash : PhosphorIconsRegular.eye, size: 18, color: c.ink3),
              ),),
          ),
        ),
      ],
    );
  }
}

class _OtpScreen extends StatefulWidget {
  const _OtpScreen({required this.controller, super.key});

  final LoginController controller;

  @override
  State<_OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<_OtpScreen> {
  final _focus = FocusNode();
  Timer? _timer;
  Worker? _wait;
  var _left = 30;

  @override
  void initState() {
    super.initState();
    _startTimer();
    // A new code restarts the wait the school gave with it.
    _wait = ever(widget.controller.resendIn, (_) => _startTimer());
    widget.controller.otp.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  void _changed() => setState(() {});

  void _startTimer() {
    _timer?.cancel();
    setState(() => _left = widget.controller.resendIn.value);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      if (_left <= 1) t.cancel();
      setState(() => _left--);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _wait?.dispose();
    widget.controller.otp.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final inset = MediaQuery.paddingOf(context);
    final code = widget.controller.otp.text;
    final app = widget.controller.fromApp.value;
    final setup = widget.controller.setupKey.value;
    void back() => widget.controller.useOtp.value = false;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) back();
      },
      child: Scaffold(
        backgroundColor: c.chalk,
        resizeToAvoidBottomInset: true,
        // The list ends above Verify, which ends above the keyboard: nothing scrolls under the button.
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                SignInHead(
                  art: false,
                  leading: GlassIconButton(
                    icon: PhosphorIconsRegular.caretLeft,
                    label: 'common.back'.tr,
                    color: AppColors.white,
                    onTap: back,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 4, 24, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text((app ? 'auth.app_code_title' : 'auth.enter_code').tr, style: context.type.h1),
                      const SizedBox(height: 8),
                      Text((setup != null ? 'auth.app_setup_body' : app ? 'auth.app_code_body' : 'auth.code_sent').tr, style: context.type.b.copyWith(color: c.ink2)),
                      if (setup != null) ...[
                        const SizedBox(height: 16),
                        _SetupKey(secret: setup, uri: widget.controller.setupUri, qr: widget.controller.setupQr),
                      ],
                      const SizedBox(height: 24),
                      Pressable(
                        onTap: _focus.requestFocus,
                        child: Semantics(
                          label: 'auth.one_time_code'.tr,
                          textField: true,
                          child: Stack(
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  for (var i = 0; i < 6; i++)
                                    _Cell(
                                      char: i < code.length ? code[i] : null,
                                      active: i == code.length && _focus.hasFocus,
                                    ),
                                ],
                              ),
                              Opacity(
                                opacity: 0,
                                child: TextField(
                                  controller: widget.controller.otp,
                                  focusNode: _focus,
                                  keyboardType: TextInputType.number,
                                  autofillHints: const [AutofillHints.oneTimeCode],
                                  maxLength: 6,
                                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                                  onChanged: (v) {
                                    if (v.length == 6) unawaited(widget.controller.submit());
                                  },
                                  decoration: const InputDecoration(counterText: ''),
                                ),
                              ),
                            ],
                          ),
                        ),),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          // An authenticator makes its own codes: there is nothing to send again.
                          if (app) const Spacer() else Expanded(
                            child: _left > 0
                                ? Text.rich(
                                    TextSpan(
                                      text: '${'auth.resend_in'.tr} ',
                                      children: [
                                        TextSpan(
                                          text: '${_left ~/ 60}:${(_left % 60).toString().padLeft(2, '0')}',
                                          style: AppText.capB(color: c.ink2),
                                        ),
                                      ],
                                    ),
                                    style: context.type.cap,
                                  )
                                : Pressable(
                                    onTap: () => unawaited(widget.controller.resend()),
                                    child: Text('auth.resend'.tr, style: AppText.capB(color: c.mariText)),),
                          ),
                          Pressable(
                            onTap: back,
                            child: Text('auth.use_password'.tr, style: AppText.capB(color: c.mariText)),),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(16)),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(PhosphorIconsRegular.shieldCheck, color: AppColors.ok),
                            const SizedBox(width: 12),
                            Expanded(child: Text('auth.code_note'.tr, style: context.type.s)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(24, 8, 24, (MediaQuery.viewInsetsOf(context).bottom > 0 ? 12 : 34) + inset.bottom),
              child: Obx(
                () => Btn(
                  'auth.verify',
                  kind: BtnKind.ink,
                  expand: true,
                  loading: widget.controller.loading.value,
                  onPressed: code.length == 6 ? widget.controller.submit : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell({required this.char, required this.active});

  final String? char;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return AnimatedContainer(
      duration: AppMotion.t2,
      curve: kEase,
      width: 48,
      height: 60,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: c.paper,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: active ? c.ink : c.line2, width: active ? 2 : 1),
      ),
      child: char != null
          ? Text(char!, style: AppText.h2(color: c.ink, height: 1))
          : active
          ? const _Caret()
          : null,
    );
  }
}

class _Caret extends StatefulWidget {
  const _Caret();

  @override
  State<_Caret> createState() => _CaretState();
}

class _CaretState extends State<_Caret> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: AppMotion.loopFast)..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _c,
    builder: (context, _) => Opacity(
      opacity: _c.value < .5 ? 1 : 0,
      child: Container(width: 2, height: 28, color: context.app.ink),
    ),
  );
}

/// The key a first sign-in adds to the authenticator app: copied to type in, or added in one tap on this phone.
class _SetupKey extends StatelessWidget {
  const _SetupKey({required this.secret, required this.uri, this.qr});

  final String secret;
  final String? uri;
  final List<String>? qr;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: c.paper2, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (qr != null && qr!.isNotEmpty) ...[
            Text('auth.app_setup_scan'.tr, style: AppText.capB(color: c.ink2)),
            const SizedBox(height: 8),
            Center(child: _Qr(rows: qr!)),
            const SizedBox(height: 16),
          ],
          Text('auth.app_setup_key'.tr, style: AppText.capB(color: c.ink2)),
          const SizedBox(height: 4),
          SelectableText(secret, style: context.type.mono),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Btn('auth.app_setup_copy', small: true, kind: BtnKind.quiet, onPressed: () {
                unawaited(Clipboard.setData(ClipboardData(text: secret)));
                ToastHelper.show('auth.app_setup_copied');
              }),
              if (uri != null)
                Btn('auth.app_setup_open', small: true, onPressed: () async {
                  final ok = await launchUrl(Uri.parse(uri!), mode: LaunchMode.externalApplication).catchError((Object _) => false);
                  if (!ok) ToastHelper.show('auth.app_setup_no_app', kind: ToastKind.error);
                }),
            ],
          ),
        ],
      ),
    );
  }
}

/// A QR code from rows of 0 and 1 (1 dark), black on white with a quiet border, as authenticator apps scan it.
class _Qr extends StatelessWidget {
  const _Qr({required this.rows});

  final List<String> rows;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'auth.app_setup_qr'.tr,
      image: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: AppColors.white, borderRadius: BorderRadius.circular(12)),
        child: SizedBox.square(dimension: 168, child: CustomPaint(painter: _QrPainter(rows))),
      ),
    );
  }
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.rows);

  final List<String> rows;

  @override
  void paint(Canvas canvas, Size size) {
    final n = rows.length;
    if (n == 0) return;
    final cell = size.width / n;
    final dark = Paint()..color = AppColors.qrDark;
    for (var r = 0; r < n; r++) {
      final row = rows[r];
      for (var c = 0; c < row.length; c++) {
        if (row.codeUnitAt(c) == 0x31) canvas.drawRect(Rect.fromLTWH(c * cell, r * cell, cell + 0.5, cell + 0.5), dark);
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter old) => old.rows != rows;
}
