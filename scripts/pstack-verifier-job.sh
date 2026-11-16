#!/usr/bin/env bash
set -euo pipefail
trusted=${1:?}
candidate=${2:?}
work=${3:?}; export WORK="$work"
unset OPENROUTER_EVAL_KEY OPENCODE_API_KEY
mkdir -p "$work/shots"
ready="$work/ready.env"
stop="$work/stop"
rm -f "$ready" "$stop"
boot_pid=
fail() { printf '%s\n' "$1" > "$work/verdict.json"; exit 0; }
cleanup() {
  node "$trusted/scripts/pstack-verifier.mjs" done || true
  if [ -n "$stop" ]; then touch "$stop" || true; fi
  if [ -n "${boot_pid:-}" ]; then wait "$boot_pid" || true; fi
}
trap cleanup EXIT
env -u OPENROUTER_EVAL_KEY -u OPENCODE_API_KEY -u GH_TOKEN -u GITHUB_TOKEN \
  PSTACK_VERIFIER_HOLD=1 \
  PSTACK_VERIFIER_READY="$ready" \
  PSTACK_VERIFIER_STOP="$stop" \
  CORE_SMOKE_TRUSTED_DEPENDENCIES="${CORE_SMOKE_TRUSTED_DEPENDENCIES:-false}" \
  bash "$trusted/scripts/run-app-smoke-isolated.sh" "$candidate" "$trusted" &
boot_pid=$!
(cd "$trusted" && npx playwright install chromium) || fail '{"verdict":"FAIL","notes":"Chromium did not install.","clicked":[],"shots":[]}'
for _ in $(seq 1 600); do [ -f "$ready" ] && break; kill -0 "$boot_pid" 2>/dev/null || break; sleep 2; done
[ -f "$ready" ] || fail '{"verdict":"FAIL","notes":"The candidate app did not become ready.","clicked":[],"shots":[]}'
WORK="$work" PSTACK_READY="$ready" node "$trusted/scripts/pstack-verifier.mjs" drive
