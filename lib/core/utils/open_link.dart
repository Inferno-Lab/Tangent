import 'package:get/get.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens what the server serves (a receipt or report card as a PDF, a file, a calendar file) outside the app, where the
/// phone views, saves, shares or adds it as it does anything it opens. [ask] returns the server's `{url}`: a short-lived
/// signed link.
Future<void> openFromServer(Future<dynamic> Function(RemoteDataSource remote) ask) async {
  var ok = false;
  try {
    final json = Map<String, dynamic>.from(await ask(Get.find<RemoteDataSource>()) as Map);
    ok = await launchUrl(Uri.parse(json['url'] as String), mode: LaunchMode.externalApplication);
  } on Object {
    ok = false;
  }
  if (!ok) ToastHelper.show('errors.cant_open', kind: ToastKind.error);
}

/// Opens a web address someone typed (a meeting's video call) in the browser, and nothing else: another scheme could open any
/// app on the phone with whatever the address carries. Says so when it cannot.
Future<void> openWeb(String link, {String failKey = 'errors.cant_open'}) async {
  final uri = Uri.tryParse(link.trim());
  final ok = uri != null && (uri.scheme == 'https' || uri.scheme == 'http') && uri.host.isNotEmpty && await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok) ToastHelper.show(failKey, kind: ToastKind.error);
}

/// A file the school attached (homework, a notice), opened outside the app to read or save.
Future<void> openFile(String? fileId) =>
    fileId == null ? Future.sync(() => ToastHelper.show('common.file_missing')) : openFromServer((r) => r.get('/v1/files/$fileId/url', query: {'download': '1'}));
