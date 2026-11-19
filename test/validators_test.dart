import 'package:flutter_test/flutter_test.dart';
import 'package:tangent/core/utils/validators.dart';

void main() {
  test('phone numbers follow the school country, as the server does', () {
    expect(Validators.phone('98220 41200', country: 'IN'), isNull);
    expect(Validators.phone('09822041200', country: 'IN'), isNull);
    expect(Validators.phone('919822041200', country: 'IN'), isNull);
    expect(Validators.phone('982204120', country: 'IN'), 'validation.phone_invalid');
    expect(Validators.phone('5512 3456', country: 'QA'), isNull);
    expect(Validators.phone('050 123 4567', country: 'AE'), isNull);
    expect(Validators.phone('+44 20 7946 0958', country: 'IN'), isNull);
    expect(Validators.phone('12ab', country: 'GB'), 'validation.phone_invalid');
    expect(Validators.phone('', optional: true, country: 'GB'), isNull);
    expect(Validators.phone('', country: 'GB'), 'validation.phone_required');
  });

  test('names, text and links', () {
    expect(Validators.name('María-José O’Neil'), isNull);
    expect(Validators.name('अनन्या'), isNull);
    expect(Validators.name('12345'), 'validation.name_invalid');
    expect(Validators.text(min: 3)('ab'), 'validation.too_short');
    expect(Validators.text(optional: true)('  '), isNull);
    expect(Validators.link('https://meet.example.org/abc'), isNull);
    expect(Validators.link('http://meet.example.org'), 'validation.link_invalid');
    expect(Validators.link(''), isNull);
  });
}
