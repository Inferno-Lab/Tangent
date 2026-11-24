import 'package:tangent/core/utils/app_exception.dart';
import 'package:tangent/data/datasources/remote_datasource.dart';
import 'package:tangent/data/models/user.dart';

/// The wait the school gives before another code (30 seconds when it does not say).
int _resendIn(Map<String, dynamic> c) => (c['resendInSeconds'] as num?)?.toInt() ?? 30;

/// The school sent a sign-in code (or asks for one from the person's authenticator app); the person has to type it. Thrown by
/// the first step of a sign-in.
class OtpRequired extends AppException {
  const OtpRequired(this.sentTo, {this.resendIn = 30, this.fromApp = false, this.setupKey, this.setupUri})
      : super(fromApp ? 'auth.app_code_toast' : 'auth.code_sent');

  /// What a challenge from the server says: a texted code, or the authenticator (with a key to add at the first sign-in).
  factory OtpRequired.from(Map<String, dynamic> c) {
    final enroll = c['enroll'] is Map ? Map<String, dynamic>.from(c['enroll'] as Map) : null;
    return OtpRequired(c['maskedTo'] as String? ?? '', resendIn: _resendIn(c), fromApp: c['channel'] == 'app',
        setupKey: enroll?['secret'] as String?, setupUri: enroll?['uri'] as String?);
  }

  final String sentTo;

  /// Seconds until another code may be asked for, as the school says (longer once several were sent).
  final int resendIn;

  /// The code comes from the person's authenticator app (staff who run the school), not a text.
  final bool fromApp;

  /// First sign-in with an authenticator: the key to add to it, and the address that adds it in one tap.
  final String? setupKey;
  final String? setupUri;
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
    throw OtpRequired.from(challenge);
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
    throw OtpRequired.from(challenge);
  }
}
