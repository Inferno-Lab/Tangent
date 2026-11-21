@Tags(['school'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/user.dart';
import 'package:tangent/features/fees/controllers/fees_controller.dart';
import 'package:tangent/features/fees/views/fees_view.dart';

import 'support/harness.dart';

/// The family's real fees; the payment provider's checkout (a page outside the app) answers paid at once, as in its test mode.
class _Checkout extends FeesController {
  @override
  Future<Receipt?> pay(Installment item, String method) async => Receipt(
    id: 'rcp_test', installmentId: item.id, title: item.title, amount: item.amount, paidOn: DateTime.now(), method: method, reference: 'TEST',
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await bootLive();
    Get.testMode = false;
  });

  tearDown(Get.reset);

  Future<void> openSheet(WidgetTester tester) async {
    await real(tester, () => signIn(UserRole.parent));
    // The office bills a fee that is still to pay (a family may have paid everything the old system billed).
    final due = DateTime.now().add(const Duration(days: 10)).toIso8601String().substring(0, 10);
    await real(tester, () => admin('POST', '/v1/students/assign-fee', {'ids': [childId], 'head': 'activities', 'title': 'Science fair kit', 'amount': 750, 'dueOn': due}));
    final fees = await put<FeesController>(tester, _Checkout.new);
    await real(tester, fees.load);
    await tester.pumpWidget(testApp(home: Scaffold(body: SingleChildScrollView(child: PaySheet(item: fees.next!)))));
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('a flick on the track pays, wherever it starts', (tester) async {
    await openSheet(tester);
    expect(find.textContaining('Slide to pay'), findsWidgets);
    await tester.timedDrag(find.textContaining('Slide to pay').first, const Offset(160, 0), const Duration(milliseconds: 120));
    await real(tester, () => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.textContaining('Paid'), findsWidgets);
  });

  testWidgets('a short slow drag springs back without paying', (tester) async {
    await openSheet(tester);
    await tester.timedDrag(find.textContaining('Slide to pay').first, const Offset(40, 0), const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.textContaining('Processing'), findsNothing);
    expect(find.textContaining('Slide to pay'), findsWidgets);
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
  });
}
