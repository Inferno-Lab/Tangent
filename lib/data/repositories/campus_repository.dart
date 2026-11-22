import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/campus.dart';
import 'package:tangent/data/models/student.dart';
import 'package:url_launcher/url_launcher.dart';

class FeeRepository {
  FeeRepository(this._remote);

  final RemoteDataSource _remote;

  Future<FeeAccount?> forStudent(String studentId) async {
    final json = await _remote.get('/students/$studentId/fees');
    return FeeAccount.fromJson(Map<String, dynamic>.from(json as Map));
  }

  /// Opens the provider's checkout in the browser (no payment SDK in the app), then waits for the provider to confirm:
  /// the receipt comes back once its webhook marks the order paid. Null when the family left without paying.
  /// Pays an installment and returns the stored receipt.
  Future<Receipt?> pay({
    required String studentId,
    required String installmentId,
    required String method,
  }) async {
    final order = Map<String, dynamic>.from(await _remote.post('/fees/$installmentId/order', {'studentId': studentId}) as Map);
    final opened = await launchUrl(Uri.parse(order['url'] as String), mode: LaunchMode.externalApplication);
    if (!opened) throw const AppException('fees.pay_open_failed');
    // ponytail: polls every 3 s for 5 minutes; the checkout's page links back with tangent://open/fees.
    for (var i = 0; i < 100; i++) {
      await Future<void>.delayed(const Duration(seconds: 3));
      final status = Map<String, dynamic>.from(await _remote.get('/orders/${order['orderId']}') as Map);
      if (status['status'] == 'paid' && status['receipt'] is Map) {
        return Receipt.fromJson(Map<String, dynamic>.from(status['receipt'] as Map));
      }
      if (status['status'] == 'failed') throw const AppException('fees.pay_failed');
    }
    return null;
  }
}

class NoticeRepository {
  NoticeRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<Notice>> all() async {
    final json = await _remote.get('/notices');
    return [
      for (final item in json as List)
        Notice.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  /// A teacher's notice, published now: to their own class when [classId] is given, else to everyone.
  Future<void> post(Notice notice, {String? classId}) => _remote.post('/notices', {
    'title': notice.title,
    'body': notice.body,
    'category': notice.category,
    'pinned': notice.pinned,
    'needsAck': notice.needsAck,
    'publish': true,
    'audience': classId == null ? 'everyone' : 'class',
    if (classId != null) 'classId': classId,
  });

  Future<void> read(String id) => _remote.post('/notices/$id/read', const {});

  /// "I have read this", for a notice that asks for it.
  Future<void> acknowledge(String id) => _remote.post('/notices/$id/acknowledge', const {});
}

class EventRepository {
  EventRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<SchoolEvent>> all() async {
    final json = await _remote.get('/events');
    return [
      for (final item in json as List)
        SchoolEvent.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<void> rsvp({
    required String eventId,
    required String userId,
    required RsvpStatus status,
  }) => _remote.post('/events/$eventId/rsvp', {
    'userId': userId,
    'status': status.name,
  });
}

class ChatRepository {
  ChatRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<ChatThread>> threadsFor(String userId) async {
    final json = await _remote.get('/users/$userId/threads');
    return [
      for (final item in json as List)
        ChatThread.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<List<ChatMessage>> messages(String threadId) async {
    final json = await _remote.get('/threads/$threadId/messages');
    return [
      for (final item in json as List)
        ChatMessage.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<void> send({
    required String threadId,
    required String senderId,
    required String text,
    List<String> fileIds = const [],
  }) => _remote.post('/threads/$threadId/messages', {
    'senderId': senderId,
    'text': text,
    if (fileIds.isNotEmpty) 'fileIds': fileIds,
  });

  /// One round trip for the inbox, so the list does not wait per thread.
  Future<({List<ChatThread> threads, List<ChatMessage> messages})> inbox(
    String userId,
  ) async {
    final threads = await threadsFor(userId);
    final json = await _remote.get('/users/$userId/messages');
    return (
      threads: threads,
      messages: [
        for (final item in json as List)
          ChatMessage.fromJson(Map<String, dynamic>.from(item as Map)),
      ],
    );
  }

  /// Tells the other side this person is typing.
  Future<void> typing(String threadId) => _remote.post('/threads/$threadId/typing', const {});

  /// Takes back one's own message (it shows as deleted to both sides).
  Future<void> delete(String messageId) => _remote.client.send('DELETE', '/messages/$messageId');

  /// Reports someone else's message to the school office.
  Future<void> report(String messageId, String reason) => _remote.post('/messages/$messageId/report', {'reason': reason});

  Future<void> markRead({required String threadId, required String userId}) =>
      _remote.post('/threads/$threadId/read', {'userId': userId});

  /// Opens (or finds) a one-to-one thread with [teacher]; returns its id.
  Future<String> start({
    required String userId,
    required Teacher teacher,
  }) async {
    final json = await _remote.post('/threads', {
      'userId': userId,
      'teacherId': teacher.id,
    });
    return (json as Map)['id'] as String;
  }
}

class LibraryRepository {
  LibraryRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<LibraryBook>> all() async {
    final json = await _remote.get('/library/books');
    // The server answers with the books, the history, the reservations and the rules; the shelf is the books.
    final books = json is Map ? json['books'] : json;
    return [
      for (final item in books as List)
        LibraryBook.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<void> reserve({required String bookId, required String studentId}) =>
      _remote.post('/library/books/$bookId/reserve', {'studentId': studentId});

  Future<void> renew(String bookId) =>
      _remote.post('/library/books/$bookId/renew', const {});
}

class TransportRepository {
  TransportRepository(this._remote);

  final RemoteDataSource _remote;

  Future<TransportInfo?> forStudent(String studentId) async {
    final json = await _remote.get('/students/$studentId/transport');
    return json is Map ? TransportInfo.fromJson(Map<String, dynamic>.from(json)) : null;
  }
}

class LeaveRepository {
  LeaveRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<LeaveRequest>> forStudent(String studentId) async {
    final json = await _remote.get('/students/$studentId/leave');
    return [
      for (final item in json as List)
        LeaveRequest.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<void> apply(LeaveRequest request) =>
      _remote.post('/leave', request.toJson());

  /// Takes back a request the school has not answered yet.
  Future<void> withdraw(String id) => _remote.post('/leave/$id/withdraw', const {});

  /// A class teacher approves or declines a request.
  Future<void> review({
    required String id,
    required LeaveStatus status,
    required String reviewer,
    String? note,
  }) => _remote.post('/leave/$id/review', {
    'status': status.name,
    'reviewer': reviewer,
    'note': ?note,
  });
}

class GalleryRepository {
  GalleryRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<GalleryAlbum>> all() async {
    final json = await _remote.get('/gallery');
    return [
      for (final item in json as List)
        GalleryAlbum.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  /// Tells the school office something is wrong with a photo; it shows in the admin's reports.
  Future<void> report(String photoId, String reason) => _remote.post('/photos/$photoId/report', {'reason': reason});
}

class NotificationRepository {
  NotificationRepository(this._remote);

  final RemoteDataSource _remote;

  Future<List<AppNotification>> forUser(String userId) async {
    final json = await _remote.get('/users/$userId/notifications');
    return [
      for (final item in json as List)
        AppNotification.fromJson(Map<String, dynamic>.from(item as Map)),
    ];
  }

  Future<void> dismiss(String id) =>
      _remote.post('/notifications/$id/dismiss', {});

  /// Brings back one dismissed by mistake.
  Future<void> restore(String id) => _remote.post('/notifications/$id/restore', const {});

  Future<void> markAllRead(String userId) =>
      _remote.post('/users/$userId/notifications/read', {});
}
