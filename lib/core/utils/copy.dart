import 'package:flutter/services.dart';
import 'package:tangent/core/widgets/toast.dart';

/// Copies text to paste into any app (sharing without a share plugin), and says so.
Future<void> copyText(String text) async {
  await Clipboard.setData(ClipboardData(text: text.trim()));
  ToastHelper.show('common.copied', kind: ToastKind.success);
}
