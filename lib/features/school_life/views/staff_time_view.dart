import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/routes/app_routes.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/glass_controls.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';

String _time(DateTime? t) => t == null ? '–' : DateFormat.Hm(Get.locale?.toLanguageTag()).format(t);
String _day(String d) => DateFormat.MMMd(Get.locale?.toLanguageTag()).format(DateTime.parse(d));
String _days(double n) => n == n.roundToDouble() ? '${n.toInt()}' : n.toStringAsFixed(1);

/// A member of staff's day: check in and out, what is left of each kind of leave, and leave asked for.
class StaffTimeView extends GetView<StaffTimeController> {
  const StaffTimeView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    final d = controller.day.value;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      bottomBarHeight: 56,
      bottomBar: d == null || d.types.isEmpty ? null : Btn('staff.ask_for_leave', expand: true, icon: PhosphorIconsRegular.calendarPlus, onPressed: () => unawaited(showSheet<void>(_LeaveSheet(day: d)))),
      children: [
        const Rise(child: PageTitle('staff.my_day')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.leave,
          emptyTitle: 'staff.empty',
          emptyBody: 'staff.empty_body',
          child: d == null ? const SizedBox.shrink() : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              const Rise(index: 1, child: CheckInCard()),
              Rise(index: 2, child: SectionLabel('staff.balances'.tr, top: 24)),
              Rise(
                index: 3,
                child: EduCard(
                  child: Column(
                    children: [
                      for (final (i, b) in d.balances.indexed) ...[
                        if (i > 0) const Hr(),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Row(
                            children: [
                              Expanded(child: Text(b.name, style: context.type.ts, maxLines: 1, overflow: TextOverflow.ellipsis)),
                              const SizedBox(width: 12),
                              Text(b.available == null ? 'staff.taken_n'.trp({'n': _days(b.used)}) : 'staff.left_n'.trp({'n': _days(b.available!)}), style: context.type.capB),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (d.requests.isNotEmpty) ...[
                Rise(index: 4, child: SectionLabel('staff.requests'.tr, top: 24)),
                for (final (i, r) in d.requests.indexed)
                  Rise(
                    index: 5 + i,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: EduCard(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(r.typeName, style: context.type.ts),
                                  Text(
                                    '${r.from == r.to ? _day(r.from) : '${_day(r.from)} – ${_day(r.to)}'}${r.halfDay != null ? ' · ${(r.halfDay == 'am' ? 'staff.morning' : 'staff.afternoon').tr}' : ''} · ${'staff.days_n'.trn(r.days, {'n': _days(r.days)})}',
                                    style: context.type.cap,
                                  ),
                                  if (r.note.isNotEmpty) Text(r.note, style: context.type.cap, maxLines: 2, overflow: TextOverflow.ellipsis),
                                ],
                              ),
                            ),
                            const SizedBox(width: 12),
                            if (r.status == 'pending')
                              Btn('staff.withdraw', small: true, kind: BtnKind.quiet, action: () => controller.withdraw(r.id))
                            else
                              Chip2('staff.status_${r.status}'.tr),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
              const SizedBox(height: 80),
            ],
          ),
        ),
      ],
    );
  });
}

/// Today's check-in: the button while the window is open, the times once in, or why not (closed, on leave, outside the hours).
/// Also the first card of a teacher's or driver's Home.
class CheckInCard extends StatelessWidget {
  const CheckInCard({this.onHome = false, super.key});

  final bool onHome;

  @override
  Widget build(BuildContext context) {
    final c = Get.find<StaffTimeController>();
    return Obx(() {
      final d = c.day.value;
      if (d == null) return const SizedBox.shrink();
      final line = d.leave != null && d.leave!.half == null
          ? 'staff.on_leave_today'.trp({'type': d.leave!.name})
          : d.checkIn != null
          ? 'staff.in_at'.trp({'time': _time(d.checkIn)}) + (d.checkOut != null ? ' · ${'staff.out_at'.trp({'time': _time(d.checkOut)})}' : '') + (d.late ? ' · ${'staff.late'.tr}' : '')
          : d.why.isNotEmpty
          ? d.why.tr
          : d.needsPlace
          ? 'staff.window_place'.trp({'from': d.opens, 'until': d.closes})
          : 'staff.window'.trp({'from': d.opens, 'until': d.closes});
      return EduCard(
        onTap: onHome ? () => Get.toNamed<void>(AppRoutes.staffMe) : null,
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(DateFormat('EEEE · d MMMM', Get.locale?.languageCode).format(Clock.now()), style: context.type.cap),
                  const SizedBox(height: 2),
                  Text(line, style: context.type.ts, maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: 12),
            if (d.canCheckIn)
              Btn('staff.check_in', small: true, icon: PhosphorIconsRegular.signIn, loading: c.busy.value, action: () => c.checkIn())
            else if (d.checkIn != null && d.checkOut == null)
              Btn('staff.check_out', small: true, kind: BtnKind.quiet, icon: PhosphorIconsRegular.signOut, loading: c.busy.value, action: () => c.checkOut()),
          ],
        ),
      );
    });
  }
}

class _LeaveSheet extends StatefulWidget {
  const _LeaveSheet({required this.day});

  final MyStaffDay day;

  @override
  State<_LeaveSheet> createState() => _LeaveSheetState();
}

class _LeaveSheetState extends State<_LeaveSheet> {
  late var _type = widget.day.types.first;
  var _from = Clock.now();
  var _to = Clock.now();
  var _half = 0;
  final _reason = TextEditingController();

  StaffTimeController get _c => Get.find<StaffTimeController>();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<DateTime?> _pick(DateTime at, {DateTime? first}) {
    final now = Clock.now();
    return showDatePicker(context: context, firstDate: first ?? now.subtract(const Duration(days: 30)), lastDate: now.add(const Duration(days: 365)), initialDate: at);
  }

  Widget _date(String label, DateTime v, ValueChanged<DateTime> set, {DateTime? first}) => Pressable(
    label: label.tr,
    onTap: () async {
      final d = await _pick(v, first: first);
      if (d != null) setState(() => set(d));
    },
    child: EduCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Expanded(child: Text(label.tr, style: context.type.ts)),
          Text(DateFormat.yMMMd(Get.locale?.toLanguageTag()).format(v), style: context.type.cap),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final halves = _type.halfDays;
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: Obx(() => Btn('staff.send', expand: true, loading: _c.busy.value, onPressed: () async {
        if ((_to.isBefore(_from) && _half == 0) || !SheetBody.valid()) return;
        final ok = await _c.askLeave(type: _type.key, from: _from, to: _to, halfDay: halves && _half > 0 ? (_half == 1 ? 'am' : 'pm') : null, reason: _reason.text.trim());
        if (ok) Get.back<void>();
      })),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('staff.ask_for_leave'.tr, style: context.type.h2),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [for (final t in widget.day.types) Chip2(t.name, on: t.key == _type.key, onTap: () => setState(() => _type = t))],
          ),
          if (halves) ...[
            const SizedBox(height: 12),
            GlassSegmented(labels: const ['staff.whole_days', 'staff.morning', 'staff.afternoon'], index: _half, semanticLabel: 'staff.how_long'.tr, onChanged: (i) => setState(() => _half = i)),
          ],
          const SizedBox(height: 12),
          _date('staff.from', _from, (d) {
            _from = d;
            if (_to.isBefore(d)) _to = d;
          }),
          if (!halves || _half == 0) ...[const SizedBox(height: 8), _date('staff.to', _to, (d) => _to = d, first: _from)],
          const SizedBox(height: 12),
          Field(controller: _reason, label: 'staff.reason_optional'.tr, help: 'field.staff_reason', maxLines: 2, maxLength: 500, validator: Validators.text(max: 500, optional: true)),
        ],
      ),
    );
  }
}
