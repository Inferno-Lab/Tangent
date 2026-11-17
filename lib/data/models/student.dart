import 'package:json_annotation/json_annotation.dart';

part 'student.g.dart';

@JsonSerializable()
class Student {
  const Student({
    required this.id,
    required this.name,
    required this.classId,
    required this.rollNo,
    required this.dob,
    required this.bloodGroup,
    required this.house,
    required this.avatarUrl,
    required this.guardianName,
    required this.guardianPhone,
    required this.address,
    this.userId,
    this.fields = const {},
    this.admissionNo = '',
    this.nameLocal = '',
  });

  factory Student.fromJson(Map<String, dynamic> json) => _$StudentFromJson(json);

  final String id;
  final String? userId;
  final String name;
  final String classId;
  final String rollNo;
  final String dob;
  final String bloodGroup;
  final String house;
  final String avatarUrl;
  final String guardianName;
  final String guardianPhone;
  final String address;

  /// The school's own fields it shows in the app, by their name in the reader's language (label → value).
  @JsonKey(defaultValue: <String, String>{})
  final Map<String, String> fields;

  /// The school's own number for the child (its admission series); empty in sample data.
  @JsonKey(defaultValue: '')
  final String admissionNo;

  /// The child's name in a second script (Arabic, Devanagari…), shown under the name; empty when the school keeps none.
  @JsonKey(defaultValue: '')
  final String nameLocal;

  Map<String, dynamic> toJson() => _$StudentToJson(this);
}

@JsonSerializable()
class SchoolClass {
  const SchoolClass({
    required this.id,
    required this.name,
    required this.section,
    required this.classTeacherId,
    required this.room,
    required this.studentIds,
  });

  factory SchoolClass.fromJson(Map<String, dynamic> json) =>
      _$SchoolClassFromJson(json);

  final String id;
  final String name;
  final String section;
  final String classTeacherId;
  final String room;
  final List<String> studentIds;

  String get label => '$name $section';

  Map<String, dynamic> toJson() => _$SchoolClassToJson(this);
}

@JsonSerializable()
class Teacher {
  const Teacher({
    required this.id,
    required this.name,
    required this.subject,
    required this.email,
    required this.phone,
    required this.avatarUrl,
    required this.classIds,
    this.userId,
  });

  factory Teacher.fromJson(Map<String, dynamic> json) => _$TeacherFromJson(json);

  final String id;
  final String? userId;
  final String name;
  final String subject;
  final String email;
  final String phone;
  final String avatarUrl;
  final List<String> classIds;

  Map<String, dynamic> toJson() => _$TeacherToJson(this);
}

@JsonSerializable()
class SchoolInfo {
  const SchoolInfo({
    required this.name,
    required this.tagline,
    required this.address,
    required this.phone,
    required this.email,
    required this.website,
    required this.principal,
    required this.founded,
    required this.officeHours,
    required this.about,
    this.termStart = '',
  });

  factory SchoolInfo.fromJson(Map<String, dynamic> json) =>
      _$SchoolInfoFromJson(json);

  final String name;
  final String tagline;
  final String address;
  final String phone;
  final String email;
  final String website;
  final String principal;
  final int founded;
  final String officeHours;
  /// When the term the school is in started (ISO day); empty without terms or in sample data.
  @JsonKey(defaultValue: '')
  final String termStart;
  final String about;

  Map<String, dynamic> toJson() => _$SchoolInfoToJson(this);
}

/// A class as the school writes it: "8 A", "Year 7 Blue", "Grade 3 – Rose". The section is added only when the name does not
/// end with it already; nothing is stripped from the school's own name.
extension SchoolClassLabel on SchoolClass {
  String get label {
    final n = name.trim();
    final s = section.trim();
    if (s.isEmpty || n.toLowerCase().endsWith(s.toLowerCase())) return n;
    return n.isEmpty ? s : '$n $s';
  }
}
