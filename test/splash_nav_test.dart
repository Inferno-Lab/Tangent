import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/app.dart';
import 'package:tangent/core/routes/app_routes.dart';

import 'support/harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('splash goes to sign-in', (tester) async {
    await bootMock();
    Get.testMode = false;
    await tester.pumpWidget(const TangentApp());
    await tester.pump();
    // Plain chalk until the window size settles, then the mark.
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Tangent'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 2400));
    await tester.pump(const Duration(milliseconds: 800));
    expect(Get.currentRoute, AppRoutes.login);
  });
}
