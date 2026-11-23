import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:tangent/core/utils/validators.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:tangent/core/utils/clock.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/utils/open_link.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/glass_controls.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/sheets.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/school_life.dart';
import 'package:tangent/features/school_life/controllers/school_life_controllers.dart';

String _dayLabel(String d) {
  final day = DateTime.parse(d);
  final today = DateTime(Clock.now().year, Clock.now().month, Clock.now().day);
  final diff = DateTime(day.year, day.month, day.day).difference(today).inDays;
  if (diff == 0) return 'diary.today'.tr;
  if (diff == 1) return 'diary.tomorrow'.tr;
  if (diff == -1) return 'diary.yesterday'.tr;
  return DateFormat('EEEE, d MMM', Get.locale?.languageCode).format(day);
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.e, this.trailing});

  final DiaryEntry e;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    return EduCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: Text([e.kindName, if (e.subject != null) e.subject!].join(' · '), style: context.type.capB.copyWith(color: c.mariText), maxLines: 1, overflow: TextOverflow.ellipsis)),
              ?trailing,
            ],
          ),
          const SizedBox(height: 6),
          Text(e.text, style: context.type.b),
          if (e.remark != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: c.mariSoft, borderRadius: BorderRadius.circular(12)),
              child: Text(e.remark!, style: context.type.s.copyWith(color: c.mariText)),
            ),
          ],
          for (final f in e.files)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Chip2(f.name, icon: PhosphorIconsRegular.paperclip, onTap: () => unawaited(openFile(f.key))),
            ),
          const SizedBox(height: 6),
          Text(e.by, style: context.type.cap),
        ],
      ),
    );
  }
}

/// The class diary for a family or a student: each day's entries, the remark for this child, and a tick once read.
class DiaryView extends GetView<DiaryController> {
  const DiaryView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    final byDay = <String, List<DiaryEntry>>{};
    for (final e in controller.entries) {
      byDay.putIfAbsent(e.date, () => []).add(e);
    }
    var i = 0;
    return PageFrame(
      leading: Navigator.canPop(context) ? const BackGlass() : null,
      onRefresh: controller.load,
      children: [
        Rise(child: PageTitle('diary.title', subtitle: controller.unread > 0 ? 'diary.to_read_n'.trn(controller.unread) : null)),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.homework,
          emptyTitle: 'diary.empty',
          emptyBody: 'diary.empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final day in byDay.entries) ...[
                Rise(index: ++i, child: SectionLabel(_dayLabel(day.key), top: 16)),
                for (final e in day.value)
                  Rise(
                    index: ++i,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _EntryCard(
                        e: e,
                        trailing: e.needsAck
                            ? Btn('diary.mark_read', small: true, kind: BtnKind.quiet, icon: PhosphorIconsRegular.check, action: () => controller.acknowledge(e))
                            : e.acknowledged
                            ? Icon(PhosphorIconsBold.checkCircle, size: 18, color: context.app.mariText)
                            : null,
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

/// A teacher's diary: their classes, the entries written, and writing one.
class TeacherDiaryView extends GetView<TeacherDiaryController> {
  const TeacherDiaryView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    final cls = controller.current;
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      bottomBarHeight: 56,
      bottomBar: cls == null ? null : Btn('diary.write', expand: true, icon: PhosphorIconsRegular.pencilSimple, onPressed: () => unawaited(showSheet<void>(const _WriteSheet()))),
      children: [
        const Rise(child: PageTitle('diary.class_diary')),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.assign,
          emptyTitle: 'diary.no_classes',
          emptyBody: 'diary.no_classes_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 12),
              if (controller.classes.length > 1)
                Wrap(spacing: 8, runSpacing: 8, children: [for (final c in controller.classes) Chip2(c.name, on: c.id == cls?.id, onTap: () => unawaited(controller.pick(c.id)))]),
              if (controller.entries.isEmpty)
                const Padding(padding: EdgeInsets.only(top: 24), child: EmptyState(art: EmptyArt.assign, title: 'diary.nothing_yet', body: 'diary.nothing_yet_body'))
              else
                for (final (i, e) in controller.entries.indexed)
                  Rise(
                    index: i + 1,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: _EntryCard(
                        e: e,
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('${_dayLabel(e.date)} · ${'diary.read_n'.trp({'n': '${e.acks}', 'of': '${e.families}'})}', style: context.type.cap),
                            if (e.byId == 'me' || e.byId.isEmpty)
                              Pressable(
                                label: 'diary.remove'.tr,
                                onTap: () => unawaited(controller.remove(e)),
                                child: Padding(padding: const EdgeInsets.only(left: 10), child: Icon(PhosphorIconsRegular.trash, size: 18, color: context.app.ink)),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
              const SizedBox(height: 80),
            ],
          ),
        ),
      ],
    );
  });
}

class _WriteSheet extends StatefulWidget {
  const _WriteSheet();

  @override
  State<_WriteSheet> createState() => _WriteSheetState();
}

class _WriteSheetState extends State<_WriteSheet> {
  final _text = TextEditingController();
  late String _kind = _c.kinds.firstOrNull?.key ?? 'classwork';
  late String? _subject = _c.current?.classTeacher ?? true ? null : _c.current?.subjects.firstOrNull?.key;
  var _tomorrow = 0;

  TeacherDiaryController get _c => Get.find<TeacherDiaryController>();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cls = _c.current!;
    return SheetBody(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 20),
      footer: Obx(() => Btn('diary.send', expand: true, loading: _c.busy.value, onPressed: () async {
        if (!SheetBody.valid()) return;
        final ok = await _c.write(kind: _kind, subjectId: _subject, text: _text.text.trim(), date: Clock.now().add(Duration(days: _tomorrow)));
        if (ok) Get.back<void>();
      })),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('diary.write_for'.trp({'class': cls.name}), style: context.type.h2),
          const SizedBox(height: 12),
          GlassSegmented(labels: const ['diary.today', 'diary.tomorrow'], index: _tomorrow, semanticLabel: 'diary.day'.tr, onChanged: (i) => setState(() => _tomorrow = i)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [for (final k in _c.kinds) Chip2(k.name, on: k.key == _kind, onTap: () => setState(() => _kind = k.key))]),
          if (cls.subjects.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [for (final s in cls.subjects) Chip2(s.name, on: s.key == _subject, onTap: () => setState(() => _subject = s.key))]),
          ],
          const SizedBox(height: 12),
          Field(controller: _text, label: 'diary.entry'.tr, help: 'field.diary_entry', keyboard: TextInputType.multiline, maxLines: 5, maxLength: 2000, validator: Validators.text(min: 2, max: 2000)),
        ],
      ),
    );
  }
}
