#!/usr/bin/env bash
# Analyzer (errors and warnings only) plus the whole test suite. Run before every commit.
set -euo pipefail
cd "$(dirname "$0")/.."
# Without the SDK the analyzer step would read as clean.
command -v flutter >/dev/null && command -v dart >/dev/null || { echo "flutter and dart must be on PATH"; exit 1; }
out=$(dart analyze lib test 2>&1 || true)
echo "$out" | tail -n 1
if echo "$out" | grep -E "^\s*(error|warning) -" ; then echo "analyze: fix the above"; exit 1; fi
flutter test
