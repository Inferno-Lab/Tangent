import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/theme/app_colors.dart';
import 'package:tangent/core/theme/app_theme.dart';
import 'package:tangent/core/widgets/ui.dart';

void main() {
  testWidgets('a button that sends shows it is working and never sends twice', (tester) async {
    var sent = 0;
    final reply = Completer<void>();
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.build(AppColors.light),
        home: Scaffold(
          body: Center(
            child: Btn('common.send', action: () {
              sent++;
              return reply.future;
            }),
          ),
        ),
      ),
    );
    await tester.tap(find.byType(Btn));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byType(Btn));
    await tester.pump();
    expect(sent, 1);
    reply.complete();
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await tester.tap(find.byType(Btn));
    expect(sent, 2);
  });
}
