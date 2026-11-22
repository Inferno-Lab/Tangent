import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/widgets/ui.dart';

void main() {
  testWidgets('a field says what is wrong once it is left, then as it is fixed', (tester) async {
    final first = TextEditingController();
    String? check(String? v) => (v ?? '').contains('@') ? null : 'Not an email';
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.build(AppColors.light),
        home: Scaffold(
          body: Form(
            child: Column(children: [Field(controller: first, validator: check), Field(validator: check)]),
          ),
        ),
      ),
    );
    final fields = find.byType(TextField);
    await tester.enterText(fields.first, 'ann');
    await tester.pump();
    // Still typing: nothing said yet, and the field not reached is not judged at all.
    expect(find.text('Not an email'), findsNothing);
    await tester.tap(fields.last);
    await tester.pump();
    expect(find.text('Not an email'), findsOneWidget);
    await tester.enterText(fields.first, 'ann@school.org');
    await tester.pump();
    expect(find.text('Not an email'), findsNothing);
  });
}
