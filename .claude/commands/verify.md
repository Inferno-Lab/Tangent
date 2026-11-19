---
description: Run the checks a push runs (only what the change reaches), then report what failed
---
Run `pnpm check` (tools/pre-push.mjs): the naming rules, the typecheck and tests of the packages the change reaches, the app's analyze and tests when the app changed, and the pages it reaches when the local server is up. If it fails, fix the cause (not the test, unless the test is wrong) and run it again. Finish by saying what is green, with the times it printed, and what you did not check (a real device, other roles, other themes).
