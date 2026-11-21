---
description: Render screens headlessly and review them as contact sheets
argument-hint: "[parent|teacher|guest] [dark] [popups]"
---
Render the screens for the role in $ARGUMENTS (default parent) with `test/tool/shoot_test.dart` (see AGENTS.md → Commands; it reads the local school, so run `tools/dev-reset.sh` and `node tools/dataset/app-sessions.mjs` first), into a folder outside the repo. Combine them into contact sheets of about 10 phones each and look at every sheet. List visual bugs found (clipped or overlapping text, misaligned chips, raw translation keys, unstyled empty states, glass blocks behind content). Fix them, re-shoot the affected screens, and say what you could not judge headlessly (touch, speed and the keyboard on a real device).
