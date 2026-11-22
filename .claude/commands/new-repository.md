---
description: Add a repository for the family API and register it
argument-hint: "<area> <what it loads>"
---
Follow `docs/adding-a-feature.md` → "A repository" for $ARGUMENTS: one class `XRepository(RemoteDataSource)` in `lib/data/repositories/<area>_repository.dart` calling `_remote.get/post`, registered in `lib/core/bindings/initial_binding.dart` and in `bootLive` (`test/support/harness.dart`), the HTTP shape in `docs/API_CONTRACT.md`, and a test tagged `school` against the local school.
