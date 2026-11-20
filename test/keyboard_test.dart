import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/theme/tokens.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/ui.dart';

import 'support/harness.dart';

/// A page's field that takes focus is scrolled above the keyboard, not left under it (it was, on every page form).
void main() {
  setUpAll(bootMock);

  testWidgets('a focused field on a long page ends above the keyboard', (tester) async {
    const keyboard = 320.0;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    const target = ValueKey('target');
    final controllers = List.generate(12, (_) => TextEditingController());
    await tester.pumpWidget(testApp(home: PageFrame(children: [
      for (final (i, c) in controllers.indexed)
        Padding(padding: const EdgeInsets.only(bottom: 16), child: Field(key: i == 6 ? target : null, controller: c, label: 'Field $i')),
    ])));
    await tester.pump();
    final input = find.descendant(of: find.byKey(target), matching: find.byType(TextField));
    // A field near the bottom of the screen: visible now, under the keyboard once it opens.
    final before = tester.getRect(input);
    expect(before.bottom, inInclusiveRange(844 - keyboard + 1, 844), reason: 'the test needs a field the keyboard would cover');
    // As on a phone: the field takes focus, then the keyboard opens.
    await tester.showKeyboard(input);
    await tester.pump();
    tester.view.viewInsets = const FakeViewPadding(bottom: keyboard);
    await tester.pumpAndSettle();
    // The field waits for the keyboard to stop moving before it scrolls.
    await tester.pump(AppMotion.t3);
    await tester.pumpAndSettle();
    final field = tester.getRect(input);
    expect(field.bottom, lessThanOrEqualTo(844 - keyboard), reason: 'the field is under the keyboard');
    expect(field.top, greaterThanOrEqualTo(0));
  });

  testWidgets('a sheet with the keyboard up stays below the status bar and shows the focused field', (tester) async {
    const keyboard = 320.0;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 47);
    addTearDown(tester.view.reset);
    const target = ValueKey('target');
    final controllers = List.generate(8, (_) => TextEditingController());
    await tester.pumpWidget(testApp(home: const Scaffold(body: SizedBox.expand())));
    unawaited(showSheet<void>(SheetBody(child: Column(children: [
      for (final (i, c) in controllers.indexed)
        Padding(padding: const EdgeInsets.only(bottom: 12), child: Field(key: i == 6 ? target : null, controller: c, label: 'Field $i')),
    ]))));
    await tester.pumpAndSettle();
    final input = find.descendant(of: find.byKey(target), matching: find.byType(TextField));
    await tester.showKeyboard(input);
    await tester.pump();
    tester.view.viewInsets = const FakeViewPadding(bottom: keyboard);
    await tester.pumpAndSettle();
    await tester.pump(AppMotion.t3);
    await tester.pumpAndSettle();
    final field = tester.getRect(input);
    expect(field.bottom, lessThanOrEqualTo(844 - keyboard), reason: 'the field is under the keyboard');
    expect(field.top, greaterThanOrEqualTo(47), reason: 'the field is under the status bar');
    // The sheet's top is its handle.
    expect(tester.getRect(find.byType(Grab)).top, greaterThanOrEqualTo(47), reason: 'the sheet ran past the top of the screen');
  });
}
