import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/core/utils/loadable.dart';
import 'package:tangent/core/utils/view_state.dart';

class _Screen extends GetxController with Loadable {
  var fail = false;

  @override
  bool get watchRevision => false;

  @override
  Future<void> load() => run(() async {
    if (fail) throw const AppException('errors.network');
  });
}

void main() {
  setUp(() => Get.testMode = true);

  test('a failed first load shows the error page; a failed reload keeps what the screen shows', () async {
    final screen = _Screen()..fail = true;
    await screen.load();
    expect(screen.state.value, ViewState.error);

    screen.fail = false;
    await screen.load();
    expect(screen.state.value, ViewState.success);

    screen.fail = true;
    await screen.load();
    expect(screen.state.value, ViewState.success);
    expect(screen.errorMessage.value, 'errors.network');
  });
}
