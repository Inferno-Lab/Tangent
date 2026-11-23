import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_typography.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/utils/extensions.dart';

/// Squash-on-press wrapper used by cards, rows and buttons.
class Pressable extends StatefulWidget {
  const Pressable({required this.child, this.onTap, this.scale = .97, this.label, this.button = false, super.key});

  final Widget child;
  final VoidCallback? onTap;
  final double scale;
  final String? label;

  /// Always a button to a screen reader, said to be dimmed while it cannot be pressed (a card without a tap is not one).
  final bool button;

  @override
  State<Pressable> createState() => _PressableState();
}

class _PressableState extends State<Pressable> {
  var _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return Semantics(
      button: enabled || widget.button,
      enabled: widget.button ? enabled : null,
      label: widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        child: AnimatedScale(
          scale: _down && !context.reduceMotion ? widget.scale : 1,
          duration: _down ? AppMotion.press : AppMotion.spring,
          curve: _down ? kEase : kSpring,
          child: widget.child,
        ),
      ),
    );
  }
}

enum BtnKind { primary, ink, bright, quiet, danger, plain }

class Btn extends StatefulWidget {
  const Btn(
    this.label, {
    this.onPressed,
    this.action,
    this.kind = BtnKind.primary,
    this.small = false,
    this.icon,
    this.trailing,
    this.expand = false,
    this.loading = false,
    this.height,
    super.key,
  });

  final String label;

  /// What a tap does (opening a page or a sheet). Null, with no [action], dims the button.
  final VoidCallback? onPressed;

  /// What a tap sends instead: the button shows its spinner until it is done and ignores taps meanwhile, so a second tap
  /// never sends it twice.
  final Future<void> Function()? action;
  final BtnKind kind;
  final bool small;
  final IconData? icon;
  final IconData? trailing;
  final bool expand;
  final bool loading;
  final double? height;

  @override
  State<Btn> createState() => _BtnState();
}

class _BtnState extends State<Btn> {
  var _working = false;

  Future<void> _send(Future<void> Function() action) async {
    setState(() => _working = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final Btn(:label, :kind, :small, :icon, :trailing, :expand, :height, :action) = widget;
    final onPressed = action == null ? widget.onPressed : () => unawaited(_send(action));
    final loading = widget.loading || _working;
    final c = context.app;
    final (bg, fg) = switch (kind) {
      // Tangent Hue: brand for the main action, the deep colour for a strong second one.
      BtnKind.primary => (c.brand, c.onBrand),
      BtnKind.ink => (c.deep, c.onDeep),
      // On the deep header, the school's bright colour.
      BtnKind.bright => (c.bright, c.onBright),
      BtnKind.quiet => (Colors.transparent, c.ink),
      BtnKind.danger => (AppColors.bad, AppColors.white),
      BtnKind.plain => (Colors.transparent, c.ink),
    };
    final h = height ?? (small ? 40.0 : 56.0);
    final disabled = onPressed == null && !loading;
    // Dimmed by mixing with the page, not by Opacity: a button floating over a list never shows the list through it.
    Color dim(Color x) => disabled ? Color.alphaBlend(x.withValues(alpha: x.a * .4), x.a == 0 ? Colors.transparent : c.chalk) : x;
    final ink = disabled ? Color.alphaBlend(fg.withValues(alpha: .4), bg.a == 0 ? c.chalk : dim(bg)) : fg;
    final style = hueText(small ? 14 : 16, 600, height: 1, color: ink);
    final row = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[Icon(icon, size: 20, color: ink), const SizedBox(width: 8)],
        Flexible(
          child: Text(label.tr, style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
        if (trailing != null) ...[const SizedBox(width: 8), Icon(trailing, size: 20, color: ink)],
      ],
    );
    // The label stays laid out under the spinner, so the button keeps its width while it works.
    final content = Stack(
      alignment: Alignment.center,
      children: [
        AnimatedOpacity(opacity: loading ? 0 : 1, duration: AppMotion.t1, child: row),
        AnimatedOpacity(
          opacity: loading ? 1 : 0,
          duration: AppMotion.t1,
          child: SizedBox.square(dimension: 18, child: loading ? CircularProgressIndicator(strokeWidth: 2.2, color: fg) : null),
        ),
      ],
    );
    return Semantics(
      liveRegion: loading,
      child: Pressable(
        scale: .96,
        button: true,
        label: loading ? '${label.tr}, ${'common.working'.tr}' : label.tr,
        onTap: loading ? null : onPressed,
        child: ExcludeSemantics(
          child: Container(
            height: h,
            padding: EdgeInsets.symmetric(horizontal: small ? 16 : 24),
            decoration: BoxDecoration(
              color: dim(bg),
              borderRadius: BorderRadius.circular(small ? AppRadius.md : AppRadius.field),
              border: kind == BtnKind.quiet ? Border.all(color: dim(c.line2)) : null,
            ),
            child: content,
          ),
        ),
      ),
    );
  }
}

/// The space between the parts of a form (fields, choices, a day), and under its title.
const kFormGap = 16.0;

/// One labelled part of a form that is not a text field (a choice of chips, a segmented choice): its label over it, as a
/// Field's label, so every part of a form reads the same.
class FormGroup extends StatelessWidget {
  const FormGroup(this.label, {required this.child, super.key});

  /// A translation key.
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    mainAxisSize: MainAxisSize.min,
    children: [
      Padding(
        padding: const EdgeInsetsDirectional.only(start: 4, bottom: 8),
        child: Text(label.tr, style: AppText.capB(color: context.app.ink2, height: 1.2)),
      ),
      child,
    ],
  );
}

/// Text field in the paper style: label above, ring, focus ring in ink.
class Field extends StatefulWidget {
  const Field({
    this.controller,
    this.label,
    this.hint,
    this.icon,
    this.trailing,
    this.obscure = false,
    this.keyboard,
    this.validator,
    this.maxLines = 1,
    this.minHeight = 56,
    this.onChanged,
    this.textInputAction,
    this.autofillHints,
    this.onSubmitted,
    this.inputFormatters,
    this.fill,
    this.borderless = false,
    this.maxLength,
    this.help,
    super.key,
  });

  /// The most characters it takes (typing stops there): every free-text field has a bound.
  final int? maxLength;

  /// A line under the box saying what to write, and in what shape (a translation key); its message replaces it when wrong.
  final String? help;

  final TextEditingController? controller;
  final String? label;
  final String? hint;
  final IconData? icon;
  final Widget? trailing;
  final bool obscure;
  final TextInputType? keyboard;
  final String? Function(String?)? validator;
  final int maxLines;
  final double minHeight;
  final ValueChanged<String>? onChanged;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final ValueChanged<String>? onSubmitted;
  final List<dynamic>? inputFormatters;
  final Color? fill;

  /// No resting outline (search wells); focus and errors still draw one.
  final bool borderless;

  @override
  State<Field> createState() => _FieldState();
}

class _FieldState extends State<Field> with WidgetsBindingObserver {
  final _focus = FocusNode();
  final _box = GlobalKey();
  final _field = GlobalKey<FormFieldState<String>>();
  Timer? _settle;

  /// Checked as it changes only once the person has left it after typing, or it shows what is wrong: an address is not
  /// called invalid while it is still being typed.
  var _live = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _focus.addListener(() {
      setState(() {});
      final field = _field.currentState;
      if (!_focus.hasFocus && field != null && field.hasInteractedByUser) {
        _live = true;
        field.validate();
      }
      if (_focus.hasFocus) {
        // After the frame that draws the focus (a post-frame callback asks for no frame itself).
        WidgetsBinding.instance
          ..addPostFrameCallback((_) => _reveal())
          ..scheduleFrame();
      }
    });
  }

  // The keyboard opening (or growing) while this field has focus: once it stops moving (this is called on every frame of
  // its slide, before the page has laid itself out for it), bring the whole field back into view.
  @override
  void didChangeMetrics() {
    if (!_focus.hasFocus) return;
    _settle?.cancel();
    _settle = Timer(AppMotion.t2, _reveal);
  }

  /// Scrolls the whole field (its label, the box and its error) into the part of the page the keyboard leaves, after the
  /// frame that laid the page out for the keyboard. Flutter's own caret check kept only the caret line, and missed a field
  /// that was already under the keyboard when it opened.
  void _reveal() {
    final ctx = _box.currentContext;
    if (!mounted || ctx == null || !_focus.hasFocus) return;
    unawaited(Scrollable.ensureVisible(ctx, duration: context.reduceMotion ? Duration.zero : AppMotion.t2, curve: kEase, alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _settle?.cancel();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return FormField<String>(
      key: _field,
      initialValue: widget.controller?.text,
      validator: widget.validator == null ? null : (_) => widget.validator!(widget.controller?.text),
      builder: (state) {
        final error = state.errorText;
        final ringColor = error != null
            ? AppColors.bad
            : (_focus.hasFocus ? c.ink : (widget.borderless ? Colors.transparent : c.line2));
        return Column(
          key: _box,
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (widget.label != null)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(widget.label!.tr, style: AppText.capB(color: c.ink2, height: 1.2)),
              ),
            AnimatedContainer(
              duration: AppMotion.t2,
              curve: kEase,
              constraints: BoxConstraints(minHeight: widget.minHeight),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: widget.fill ?? c.paper,
                borderRadius: BorderRadius.circular(AppRadius.field),
                border: Border.all(
                  color: ringColor,
                  width: error != null || _focus.hasFocus ? 2 : 1,
                ),
              ),
              child: Row(
                crossAxisAlignment: widget.maxLines > 1 ? CrossAxisAlignment.start : CrossAxisAlignment.center,
                children: [
                  if (widget.icon != null) ...[
                    Padding(
                      padding: EdgeInsets.only(top: widget.maxLines > 1 ? 16 : 0),
                      child: Icon(widget.icon, size: 18, color: c.ink3),
                    ),
                    const SizedBox(width: 10),
                  ],
                  Expanded(
                    child: TextField(
                      controller: widget.controller,
                      focusNode: _focus,
                      obscureText: widget.obscure,
                      keyboardType: widget.keyboard,
                      // A name starts each word in capitals, a message each sentence; addresses, numbers and codes none.
                      textCapitalization: widget.obscure
                          ? TextCapitalization.none
                          : widget.keyboard == TextInputType.name
                          ? TextCapitalization.words
                          : widget.keyboard == null || widget.keyboard == TextInputType.text || widget.keyboard == TextInputType.multiline
                          ? TextCapitalization.sentences
                          : TextCapitalization.none,
                      maxLines: widget.maxLines,
                      minLines: 1,
                      textInputAction: widget.textInputAction,
                      autofillHints: widget.autofillHints,
                      onSubmitted: widget.onSubmitted,
                      inputFormatters: [...?widget.inputFormatters?.cast<TextInputFormatter>(), if (widget.maxLength != null) LengthLimitingTextInputFormatter(widget.maxLength)],
                      onChanged: (value) {
                        state.didChange(value);
                        if (_live || state.hasError) state.validate();
                        widget.onChanged?.call(value);
                      },
                      style: AppText.b(color: c.ink, height: 1.35),
                      cursorColor: c.ink,
                      decoration: InputDecoration(
                        isCollapsed: true,
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.symmetric(vertical: widget.maxLines > 1 ? 16 : 16),
                        hintText: widget.hint?.tr,
                        hintStyle: AppText.b(color: c.ink3, height: 1.35),
                      ),
                    ),
                  ),
                  if (widget.trailing != null) widget.trailing!,
                ],
              ),
            ),
            if (error == null && widget.help != null)
              Padding(
                padding: const EdgeInsetsDirectional.only(top: 8, start: 4),
                child: Text(widget.help!.tr, style: AppText.cap(color: c.ink3)),
              ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8, left: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.error_outline_rounded, size: 15, color: c.badText),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(error.tr, style: AppText.capB(color: c.badText)),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
