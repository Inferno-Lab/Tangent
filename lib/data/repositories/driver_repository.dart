import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/driver.dart';

/// A bus driver's trips: start, share where the bus is, mark each child, say it is running late, end.
abstract class DriverRepository {
  Future<List<DriverRoute>> day();

  /// Starts a trip on a route and returns its id.
  Future<String> start({required String routeId, required String kind});

  Future<void> end(String tripId);

  Future<void> position(String tripId, {required double lat, required double lng});

  Future<void> mark(String tripId, {required String studentId, required String event, String? stopId});

  Future<void> delay(String tripId, {required int minutes, required String reason});
}

class RemoteDriverRepository implements DriverRepository {
  RemoteDriverRepository(this._remote);

  final RemoteDataSource _remote;

  @override
  Future<List<DriverRoute>> day() async {
    final json = Map<String, dynamic>.from(await _remote.get('/driver/day') as Map);
    return [for (final r in (json['routes'] as List? ?? const [])) DriverRoute.fromJson(Map<String, dynamic>.from(r as Map))];
  }

  @override
  Future<String> start({required String routeId, required String kind}) async {
    final json = Map<String, dynamic>.from(await _remote.post('/driver/trips', {'routeId': routeId, 'kind': kind}) as Map);
    return json['id'] as String;
  }

  @override
  Future<void> end(String tripId) => _remote.post('/driver/trips/$tripId/end', const {});

  @override
  Future<void> position(String tripId, {required double lat, required double lng}) => _remote.post('/driver/trips/$tripId/position', {'lat': lat, 'lng': lng});

  @override
  Future<void> mark(String tripId, {required String studentId, required String event, String? stopId}) =>
      _remote.post('/driver/trips/$tripId/marks', {'studentId': studentId, 'event': event, 'stopId': stopId});

  @override
  Future<void> delay(String tripId, {required int minutes, required String reason}) =>
      _remote.post('/driver/trips/$tripId/delay', {'minutes': minutes, 'reason': reason});
}
