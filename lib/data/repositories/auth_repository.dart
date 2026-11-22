import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/user.dart';

/// The wait the school gives before another code (30 seconds when it does not say).
int _resendIn(Map<String, dynamic> c) => (c['resendInSeconds'] as num?)?.toInt() ?? 30;

/// The school sent a sign-in code; the person has to type it. Thrown by the first step of a sign-in.
class OtpRequired extends AppException {
  const OtpRequired(this.sentTo, {this.resendIn = 30}) : super('auth.code_sent');

  final String sentTo;

  /// Seconds until another code may be asked for, as the school says (longer once several were sent).
  final int resendIn;
}

class AuthRepository {
  AuthRepository(this._remote);

  final RemoteDataSource _remote;
  String? _challenge;

  Future<AppUser> login({required String email, required String password}) async {
    final json = Map<String, dynamic>.from(await _remote.post('/v1/auth/login', {'identifier': email.trim(), 'password': password, 'client': 'mobile'}) as Map);
    if (json['step'] == 'done') return _enter(Map<String, dynamic>.from(json['tokens'] as Map));
    final challenge = Map<String, dynamic>.from(json['challenge'] as Map);
    _challenge = challenge['challengeId'] as String;
    throw OtpRequired(challenge['maskedTo'] as String? ?? '', resendIn: _resendIn(challenge));
  }

  Future<AppUser> _enter(Map<String, dynamic> tokens) async {
    await _remote.client.saveTokens(tokens);
    return AppUser.fromJson(Map<String, dynamic>.from(await _remote.get('/me') as Map));
  }

  Future<AppUser> loginWithOtp({
    required String email,
    required String otp,
  }) async {
    final challenge = _challenge;
    if (challenge == null) throw const AppException('errors.code_expired');
    final json = await _remote.post('/v1/auth/verify', {'challengeId': challenge, 'code': otp, 'client': 'mobile'});
    _challenge = null;
    return _enter(Map<String, dynamic>.from(json as Map));
  }

  /// Sends a sign-in code to a family's phone or email, with no password. Always ends in [OtpRequired].
  Future<Never> requestCode(String identifier) async {
    final challenge = Map<String, dynamic>.from(await _remote.post('/v1/auth/code', {'identifier': identifier.trim(), 'client': 'mobile'}) as Map);
    _challenge = challenge['challengeId'] as String;
    throw OtpRequired(challenge['maskedTo'] as String? ?? '', resendIn: _resendIn(challenge));
  }
}
