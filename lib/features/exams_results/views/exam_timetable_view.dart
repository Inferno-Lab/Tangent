import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:tangent/core/utils/extensions.dart';
import 'package:tangent/core/widgets/empty_kit.dart';
import 'package:tangent/core/widgets/page.dart';
import 'package:tangent/core/widgets/states.dart';
import 'package:tangent/core/widgets/ui.dart';
import 'package:tangent/data/models/academics.dart';
import 'package:tangent/features/exams_results/controllers/exam_timetable_controller.dart';

/// The exam timetable for the active child: each exam still to come, its papers by day with the time, the room and the
/// paper's maximum, as the school set them (Exams in the admin).
class ExamTimetableView extends GetView<ExamTimetableController> {
  const ExamTimetableView({super.key});

  @override
  Widget build(BuildContext context) => Obx(() {
    controller.state.value;
    final lang = Get.locale?.toLanguageTag();
    return PageFrame(
      leading: const BackGlass(),
      onRefresh: controller.load,
      children: [
        Rise(child: PageTitle('exams.timetable', subtitle: controller.childName)),
        ViewStateView(
          state: controller.state.value,
          onRetry: controller.load,
          errorKey: controller.errorMessage.value,
          emptyArt: EmptyArt.results,
          emptyTitle: 'exams.timetable_empty',
          emptyBody: 'exams.timetable_empty_body',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (i, e) in controller.exams.indexed) ...[
                Rise(
                  index: i + 1,
                  child: SectionLabel(
                    '${e.name} · ${DateFormat.MMMd(lang).format(e.startDate)}–${DateFormat.MMMd(lang).format(e.endDate)}',
                  ),
                ),
                Rise(
                  index: i + 1,
                  child: EduCard(
                    child: Column(
                      children: [
                        if (e.papers.isEmpty)
                          Padding(padding: const EdgeInsets.all(16), child: Text('exams.no_papers_yet'.tr, style: context.type.s))
                        else
                          for (final (j, p) in controller.papersOf(e).indexed) ...[
                            if (j > 0) const Hr(indent: 16),
                            _Paper(paper: p, lang: lang),
                          ],
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  });
}

class _Paper extends StatelessWidget {
  const _Paper({required this.paper, required this.lang});

  final ExamPaper paper;
  final String? lang;

  @override
  Widget build(BuildContext context) {
    final c = context.app;
    final when = [
      if (paper.date != null) DateFormat.MMMEd(lang).format(paper.date!) else 'exams.day_not_set'.tr,
      if (paper.startsAt.isNotEmpty) paper.endsAt.isEmpty ? paper.startsAt : '${paper.startsAt}–${paper.endsAt}',
      if (paper.room.isNotEmpty) paper.room,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(paper.subjectName.isEmpty ? paper.subject : paper.subjectName, style: context.type.ts, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(when, style: context.type.cap.copyWith(color: c.ink2)),
              ],
            ),
          ),
          if (paper.maxMarks > 0) ...[
            const SizedBox(width: 12),
            Text('exams.out_of'.trp({'n': '${paper.maxMarks}'}), style: context.type.cap),
          ],
        ],
      ),
    );
  }
}
