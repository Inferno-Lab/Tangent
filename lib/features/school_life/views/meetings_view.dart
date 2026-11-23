import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';
import 'package:url_launcher/url_launcher.dart';

String _hm(DateTime t) => DateFormat.Hm(Get.locale?.toLanguageTag()).format(t);
String _date(String d) => DateFormat('EEEE, d MMMM', Get.locale?.languageCode).format(DateTime.parse(d));
String _mode(String m) => 'meetings.mode_$m'.tr;

/// Parent-teacher meetings: for each child, each of their teachers there, the free times, and the one booked.
class MeetingsView extends GetView<MeetingsController> {
  const MeetingsView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    var i = 0;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      children: [
        const Rise(child: PageTitle('meetings.title')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.events,
          emptyTitle: 'meetings.empty',
          emptyBody: 'meetings.empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final m in controller.meetings) ...[
                Rise(index: ++i, child: SectionLabel(m.title, top: 16)),
                Rise(index: ++i, child: Text([_date(m.date), _mode(m.mode), if (m.place.isNotEmpty) m.place].join(' · '), style: context.type.cap)),
                if (!m.canBook) Rise(index: ++i, child: Padding(padding: const EdgeInsets.only(top: 6), child: Text('meetings.booking_closed'.tr, style: context.type.cap))),
                for (final child in m.children)
                  for (final t in child.teachers)
                    Rise(
                      index: ++i,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: EduCard(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(t.name, style: context.type.ts),
                              Text('meetings.for_child'.trp({'name': child.name.split(' ').first}), style: context.type.cap),
                              const SizedBox(height: 10),
                              if (t.booked != null)
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        'meetings.booked_at'.trp({'time': _hm(t.booked!.startsAt)}) + (t.booked!.mode != null ? ' · ${_mode(t.booked!.mode!)}' : ''),
                                        style: context.type.capB.copyWith(color: context.app.mariText),
                                      ),
                                    ),
                                    if (t.booked!.link.isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(right: 8),
                                        child: Btn('meetings.join', small: true, onPressed: () => unawaited(launchUrl(Uri.parse(t.booked!.link), mode: LaunchMode.externalApplication))),
                                      ),
                                    if (m.canCancel) Btn('meetings.cancel', small: true, kind: BtnKind.quiet, action: () => controller.cancel(t.booked!)),
                                  ],
                                )
                              else if (!m.canBook)
                                Text('meetings.not_booked'.tr, style: context.type.cap)
                              else if (t.slots.every((s) => s.state != 'open'))
                                Text('meetings.all_taken'.tr, style: context.type.cap)
                              else
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    for (final s in t.slots.where((s) => s.state == 'open'))
                                      Chip2(_hm(s.startsAt), onTap: () => unawaited(_book(m, s, child.studentId, t.name))),
                                  ],
                                ),
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

  Future<void> _book(FamilyMeeting m, MeetingSlot s, String studentId, String teacher) async {
    if (m.mode != 'either') {
      await controller.book(s, studentId, null);
      return;
    }
    // In person or online is the family's choice when the school offers both.
    await showSheet<void>(SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      child: Builder(
        builder: (context) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('meetings.book_with'.trp({'name': teacher, 'time': _hm(s.startsAt)}), style: context.type.h2),
            const SizedBox(height: 16),
            Btn('meetings.mode_inPerson', expand: true, icon: PhosphorIconsRegular.users, action: () async {
              // Closes once booked; a refusal (the slot just went) leaves the choice open with its reason.
              if (await controller.book(s, studentId, 'inPerson')) Get.back<void>();
            }),
            const SizedBox(height: 10),
            Btn('meetings.mode_online', expand: true, kind: BtnKind.quiet, icon: PhosphorIconsRegular.videoCamera, action: () async {
              // Closes once booked; a refusal (the slot just went) leaves the choice open with its reason.
              if (await controller.book(s, studentId, 'online')) Get.back<void>();
            }),
          ],
        ),
      ),
    ));
  }
}

/// A teacher's own meeting times: who booked which, closing a time, a link for online meetings.
class TeacherMeetingsView extends GetView<TeacherMeetingsController> {
  const TeacherMeetingsView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    var i = 0;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      children: [
        const Rise(child: PageTitle('meetings.my_times')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.events,
          emptyTitle: 'meetings.no_times',
          emptyBody: 'meetings.no_times_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final m in controller.meetings) ...[
                Rise(index: ++i, child: SectionLabel(m.title, top: 16)),
                Rise(index: ++i, child: Text([_date(m.date), _mode(m.mode), if (m.place.isNotEmpty) m.place].join(' · '), style: context.type.cap)),
                Rise(
                  index: ++i,
                  child: Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: EduCard(
                      child: Column(
                        children: [
                          for (final (j, s) in m.slots.indexed) ...[
                            if (j > 0) const Hr(),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                              child: Row(
                                children: [
                                  SizedBox(width: 56, child: Text(_hm(s.startsAt), style: context.type.capB)),
                                  Expanded(
                                    child: Text(
                                      s.state == 'booked' ? [s.studentName ?? '', if (s.mode != null) _mode(s.mode!)].join(' · ') : (s.state == 'closed' ? 'meetings.closed' : 'meetings.free').tr,
                                      style: context.type.s,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (s.state == 'booked' && s.mode == 'online')
                                    Pressable(
                                      label: 'meetings.link'.tr,
                                      onTap: () => unawaited(_link(s)),
                                      child: Padding(padding: const EdgeInsets.all(6), child: Icon(PhosphorIconsRegular.link, size: 18, color: context.app.ink)),
                                    ),
                                  Btn(
                                    s.state == 'closed' ? 'meetings.open_it' : 'meetings.close_it',
                                    small: true,
                                    kind: BtnKind.quiet,
                                    action: () => controller.setClosed(s, closed: s.state != 'closed'),
                                  ),
                                ],
                              ),
                            ),
                          ],
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

  Future<void> _link(MeetingSlot s) async {
    final ctl = TextEditingController(text: s.link);
    await showSheet<void>(SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: Btn('meetings.save_link', expand: true, action: () async {
        final v = ctl.text.trim();
        if (!SheetBody.valid()) return;
        if (await controller.setLink(s, v)) Get.back<void>();
      }),
      child: Builder(
        builder: (context) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('meetings.link_for'.trp({'name': s.studentName ?? ''}), style: context.type.h2),
            const SizedBox(height: 12),
            Field(controller: ctl, label: 'meetings.link'.tr, hint: 'https://', help: 'field.meeting_link', keyboard: TextInputType.url, maxLength: 500, validator: Validators.link),
          ],
        ),
      ),
    ));
    ctl.dispose();
  }
}
