---
description: Add an AI or chatbot feature behind the assistant seam
argument-hint: "<what the assistant should do>"
---
Follow `docs/adding-a-feature.md` → "An AI feature" for $ARGUMENTS. Depend on `AssistantRepository` only. The app never holds a model key; the backend does (its route is part of the work: `POST /users/:userId/assistant` in the family API). Gate the entry point with `AppConfig.assistantEnabled`. Give it a loading, an error and an empty state, and test it against the local school; in a widget test a small class implementing `AssistantRepository` stands in for the answers.
