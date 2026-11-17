import 'package:get/get.dart';
import 'package:tangent/core/config/app_config.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens what the server serves (a receipt or report card as a PDF, a file, a calendar file) outside the app, where the
/// phone views, saves, shares or adds it as it does anything it opens. [ask] returns the server's `{url}`: a short-lived
/// signed link. Sample content has no server, so it says so.
Future<void> openFromServer(Future<dynamic> Function(RemoteDataSource remote) ask) async {
  if (!AppConfig.live) {
    ToastHelper.show('common.sample_only');
    return;
  }
  var ok = false;
  try {
    final json = Map<String, dynamic>.from(await ask(Get.find<RemoteDataSource>()) as Map);
    ok = await launchUrl(Uri.parse(json['url'] as String), mode: LaunchMode.externalApplication);
  } on Object {
    ok = false;
  }
  if (!ok) ToastHelper.show('errors.cant_open', kind: ToastKind.error);
}

/// A file the school attached (homework, a notice), opened outside the app to read or save.
Future<void> openFile(String? fileId) =>
    fileId == null ? Future.sync(() => ToastHelper.show('common.sample_only')) : openFromServer((r) => r.get('/v1/files/$fileId/url', query: {'download': '1'}));
