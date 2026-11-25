#!/usr/bin/env bash
set -euo pipefail
trusted=${1:?}
candidate=${2:?}
work=${3:?}
export WORK="$work"
mkdir -p "$work/evidence/shots"
ready="$work/ready.env"
stop="$work/stop"
rm -f "$ready" "$stop"
boot_pid=
cleanup() {
  touch "$stop" 2>/dev/null || true
  if [ -n "${boot_pid:-}" ]; then wait "$boot_pid" || true; fi
}
trap cleanup EXIT
head_flags=
if [ -z "${PSTACK_PLAN_FILE:-}" ] && [ -f "$work/plan/plan.json" ] && [ -f "$trusted/scripts/lib/verifier-flag-keys.mjs" ]; then
  if ! head_flags=$(node "$trusted/scripts/lib/verifier-flag-keys.mjs" --plan "$work/plan/plan.json" --candidate "$candidate"); then
    echo "verifier flag derivation failed; seeding flags as the checkout defines them" >&2
    head_flags=
  fi
fi
env -u OPENROUTER_EVAL_KEY -u OPENCODE_API_KEY -u GH_TOKEN -u GITHUB_TOKEN -u ACTIONS_RUNTIME_TOKEN \
  PSTACK_VERIFIER_HOLD=1 PSTACK_VERIFIER_READY="$ready" PSTACK_VERIFIER_STOP="$stop" \
  CORE_SMOKE_FLAG_KEYS="$head_flags" \
  CORE_SMOKE_TRUSTED_DEPENDENCIES="${CORE_SMOKE_TRUSTED_DEPENDENCIES:-false}" \
  bash "$trusted/scripts/run-app-smoke-isolated.sh" "$candidate" "$trusted" &
boot_pid=$!
for _ in $(seq 1 600); do [ -f "$ready" ] && break; kill -0 "$boot_pid" 2>/dev/null || break; sleep 2; done
if [ ! -f "$ready" ]; then node "$trusted/scripts/pstack-verifier-drive.mjs" --preview-down; fi
WORK="$work" PSTACK_READY="$ready" node "$trusted/scripts/pstack-verifier-drive.mjs"
