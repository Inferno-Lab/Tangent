import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:get/get.dart';
import 'package:tangent/core/routes/middlewares.dart';
import 'package:tangent/core/services/session_bus.dart';
import 'package:tangent/core/widgets/toast.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';

/// Phone notifications. The school connects Firebase Cloud Messaging in the console (Integrations), the build workflow
/// puts its app files into the school's build, and this registers the phone with the school so the Hub can reach it.
/// A build without those files (a developer's, or sample data) has no Firebase and simply gets no push.
class PushService extends GetxService {
  PushService(this._remote);

  final RemoteDataSource _remote;
  String? _token;
  final _subs = <StreamSubscription<Object?>>[];

  /// After sign-in: asks once for permission, registers this phone, and keeps the token current.
  Future<void> start() async {
    if (_subs.isNotEmpty || !(Platform.isAndroid || Platform.isIOS)) return;
    try {
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    } on Object {
      return; // No Firebase files in this build: notifications stay in the app's own list.
    }
    final fm = FirebaseMessaging.instance;
    try {
      final allowed = await fm.requestPermission();
      if (allowed.authorizationStatus == AuthorizationStatus.denied) return;
      final token = await fm.getToken();
      if (token != null) await _register(token);
    } on Object {
      return; // No Play services, or Google unreachable: tried again at the next start.
    }
    _subs
      ..add(fm.onTokenRefresh.listen((t) => unawaited(_register(t))))
      // In front: the same words as a toast, and the screens reload (a new notice, a decided request).
      ..add(FirebaseMessaging.onMessage.listen((m) {
        final n = m.notification;
        if (n?.title != null) ToastHelper.show(n!.title!, body: n.body);
        if (Get.isRegistered<SessionBus>()) Get.find<SessionBus>().bump();
      }))
      ..add(FirebaseMessaging.onMessageOpenedApp.listen(_open));
    final first = await fm.getInitialMessage();
    if (first != null) _open(first);
  }

  /// On sign-out: this phone's token is thrown away, so nothing more reaches it for this account (the Hub forgets the
  /// token when Google calls it unregistered). Not a call to the school: a refused session would sign out again.
  Future<void> stop() async {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    _subs.clear();
    if (_token == null) return;
    _token = null;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } on Object {
      // Offline: Google drops it later.
    }
  }

  Future<void> _register(String token) async {
    try {
      await _remote.post('/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
      _token = token;
    } on Object {
      // Tried again at the next start or token refresh.
    }
  }

  /// A tapped notification opens the screen it is about (the Hub sends its route), once the app is up.
  void _open(RemoteMessage m) {
    final route = m.data['route'];
    if (route is! String || !route.startsWith('/')) return;
    DeepLinks.pending = route;
    if (DeepLinks.booted) DeepLinks.openPending();
  }
}
