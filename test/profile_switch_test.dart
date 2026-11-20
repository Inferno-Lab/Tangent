import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/core/services/auth_service.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/dashboard/controllers/dashboard_controller.dart';
import 'package:tangent/features/profile/controllers/profile_controller.dart';
import 'package:tangent/features/profile/views/id_card.dart';
import 'package:tangent/features/profile/views/profile_view.dart';

import 'support/harness.dart';

/// Switching a child on Profile keeps the card and everything under it where it is: the account rows once jumped up for
/// a moment into the card's place while the next child loaded.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await bootMock();
    Get.testMode = false;
  });

  tearDown(Get.reset);

  testWidgets('a child switch keeps the card on screen while the next child loads', (tester) async {
    final user = (await real(tester, () => signIn(UserRole.parent)))!;
    final auth = Get.find<AuthService>();
    await real(tester, () => auth.setSession(user.copyWith(avatarUrl: '')));
    final dash = Get.put(DashboardController());
    await real(tester, dash.load);
    final profile = Get.put(ProfileController());
    await real(tester, profile.load);
    await tester.pumpWidget(testApp(home: const ProfileView()));
    // Let the entrances finish (each part rises 12 pt as it arrives).
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 400));
    }
    expect(find.byType(IdBadge), findsOneWidget);
    final before = tester.getTopLeft(find.text('Your account')).dy;

    final other = user.childIds.firstWhere((id) => id != auth.activeStudentId.value);
    // Start the switch and look while it is still loading.
    final switching = auth.switchChild(other);
    await tester.pump();
    expect(find.byType(IdBadge), findsWidgets, reason: 'the card stays while the next child loads');
    expect(tester.getTopLeft(find.text('Your account')).dy, before, reason: 'nothing under the card moves');
    await real(tester, () => switching);
    await real(tester, profile.load);
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 400));
    }
    expect(find.byType(IdBadge), findsOneWidget);
    expect(tester.getTopLeft(find.text('Your account')).dy, before);
  });
}
