#!/usr/bin/env bash
set -euo pipefail

# Share a deadline across steps; GitHub job cancellation is asynchronous.
remaining=$((ARCO_CI_DEADLINE - $(date +%s)))
if ((remaining <= 0)); then
  echo "CI command budget exhausted." >&2
  exit 124
fi
exec timeout --kill-after=5s "${remaining}s" "$@"
