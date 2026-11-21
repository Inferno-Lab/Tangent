#!/usr/bin/env bash
# Analyzer (errors and warnings only) plus the whole test suite. Run before every commit.
set -euo pipefail
cd "$(dirname "$0")/.."
# Without the SDK the analyzer step would read as clean.
command -v flutter >/dev/null && command -v dart >/dev/null || { echo "flutter and dart must be on PATH"; exit 1; }
out=$(dart analyze lib test 2>&1 || true)
echo "$out" | tail -n 1
if echo "$out" | grep -E "^\s*(error|warning) -" ; then echo "analyze: fix the above"; exit 1; fi
# The tests tagged `school` read the school tools/dev-reset.sh moves in; without a local server only the rest run.
if curl -sf -o /dev/null "${API:-http://localhost:4000}/health"; then
  node tools/dataset/app-sessions.mjs
  flutter test
else
  echo "No local school (bash tools/dev-reset.sh): running the tests that need none."
  flutter test --exclude-tags school
fi
