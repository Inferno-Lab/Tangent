import 'package:get/get.dart';

/// Bumps after a write, a push or a live event so open screens reload.
class SessionBus extends GetxService {
  final revision = 0.obs;

  void bump() => revision.value++;
}
