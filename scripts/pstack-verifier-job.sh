#!/usr/bin/env bash
set -euo pipefail
trusted=${1:?}
candidate=${2:?}
work=${3:?}
key=${OPENROUTER_EVAL_KEY:-}
unset OPENROUTER_EVAL_KEY OPENCODE_API_KEY
mkdir -p "$work/shots"
ready="$work/ready.env"
stop="$work/stop"
rm -f "$ready" "$stop"
boot_pid=
cleanup() {
  if [ -n "$stop" ]; then touch "$stop" || true; fi
  if [ -n "${boot_pid:-}" ]; then wait "$boot_pid" || true; fi
}
trap cleanup EXIT
env -u OPENROUTER_EVAL_KEY -u OPENCODE_API_KEY \
  PSTACK_VERIFIER_HOLD=1 \
  PSTACK_VERIFIER_READY="$ready" \
  PSTACK_VERIFIER_STOP="$stop" \
  CORE_SMOKE_TRUSTED_DEPENDENCIES="${CORE_SMOKE_TRUSTED_DEPENDENCIES:-false}" \
  bash "$trusted/scripts/run-app-smoke-isolated.sh" "$candidate" "$trusted" &
boot_pid=$!
if ! (cd "$trusted" && npx playwright install chromium); then
  printf '%s\n' '{"verdict":"FAIL","notes":"Chromium did not install.","clicked":[],"shots":[]}' > "$work/verdict.json"
  exit 0
fi
for _ in $(seq 1 600); do
  if [ -f "$ready" ]; then break; fi
  if ! kill -0 "$boot_pid" 2>/dev/null; then break; fi
  sleep 2
done
if [ ! -f "$ready" ]; then
  printf '%s\n' '{"verdict":"FAIL","notes":"The candidate app did not become ready.","clicked":[],"shots":[]}' > "$work/verdict.json"
  exit 0
fi
WORK="$work" PSTACK_READY="$ready" OPENROUTER_EVAL_KEY="$key" node "$trusted/scripts/pstack-verifier.mjs" drive
