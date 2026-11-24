import 'package:tangent/core/network/api_client.dart';

/// Same calls a real backend will expose. See docs/API_CONTRACT.md.
class RemoteDataSource {
  RemoteDataSource(this.client);

  final ApiClient client;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      client.get(path, query: query);

  Future<dynamic> post(String path, Map<String, dynamic> body, {Map<String, dynamic>? query}) =>
      client.post(path, body, query: query);

  Future<dynamic> patch(String path, Map<String, dynamic> body) =>
      client.patch(path, body);

  Future<dynamic> delete(String path) => client.delete(path);
}
