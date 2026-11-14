#!/usr/bin/env bash
# Offline ship-identity tests: a name resolves to its own token, a runner slot name resolves to that runner,
# and nothing ever falls back to Valentin for a runner (HYCI-408).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.config/hypertask-agents/credentials/sessions" "$T/bin"
export HOME="$T/home"
unset SHIP_SESSION_NAME VCC_CREDENTIALS_DIR VCC_SESSION_CREDENTIALS_DIR
creds="$HOME/.config/hypertask-agents/credentials"
sessions="$creds/sessions"
printf 'valentin-token\n' > "$creds/valentins-claude-code-agent-token"
printf 'runner-5-token\n' > "$sessions/runner-5-agent-token"
printf 'runner-6-token\n' > "$sessions/runner-6-agent-token"
printf 'ci-boss-token\n' > "$sessions/ci-boss-agent-token"

fail() { printf 'ship-identity.test: %s\n' "$*" >&2; exit 1; }
check() {  # name expected-name expected-token
  local got name want_token
  got=$(SHIP_SESSION_NAME="$1" bash "$here/ship-identity")
  [ "$(printf '%s' "$got" | cut -f1)" = "$2" ] || fail "\"$1\" gave name \"$(printf '%s' "$got" | cut -f1)\", wanted \"$2\""
  [ -s "$(printf '%s' "$got" | cut -f2)" ] || fail "\"$1\" gave no token file"
  [ "$(cat "$(printf '%s' "$got" | cut -f2)")" = "$3" ] || fail "\"$1\" gave the wrong token"
}

check 'ci-boss' 'ci-boss' 'ci-boss-token'
check 'RUNNER 6' 'RUNNER 6' 'runner-6-token'
check 'RUNNER 6 | HTPR-1 | fix' 'RUNNER 6' 'runner-6-token'
check 'ht-or-runner-5' 'RUNNER 5' 'runner-5-token'
check 'cursor-grok-runner-5 (Cursor Grok RUNNER 5)' 'RUNNER 5' 'runner-5-token'
check 'SPEED RUNNER 6' 'RUNNER 6' 'runner-6-token'
check 'runner-5' 'runner-5' 'runner-5-token'
# No slot, or a slot with no token, still falls back to Valentin; vcc then refuses a runner name, never writes as him.
check 'SPEED RUNNER' 'Valentins Claude Code' 'valentin-token'
check 'ht-or-runner-99' 'Valentins Claude Code' 'valentin-token'
check 'runner' 'Valentins Claude Code' 'valentin-token'
check 'HTPR-1 | fix' 'Valentins Claude Code' 'valentin-token'
printf 'ship-identity.test ok: literal token wins, a runner slot name resolves to that runner, no runner falls back to Valentin\n'
