#!/usr/bin/env bash
# Offline ship-identity tests: a name resolves to its own token, a runner slot name resolves to that runner,
# and a chat with no login of its own is refused, never written as Valentins Claude Code (HYCI-408, HTPR-9710).
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
printf 'new-chat-token\n' > "$sessions/new-chat-agent-token"

fail() { printf 'ship-identity.test: %s\n' "$*" >&2; exit 1; }
check() {  # name expected-name expected-token
  local got name want_token
  got=$(SHIP_SESSION_NAME="$1" bash "$here/ship-identity")
  [ "$(printf '%s' "$got" | cut -f1)" = "$2" ] || fail "\"$1\" gave name \"$(printf '%s' "$got" | cut -f1)\", wanted \"$2\""
  [ -s "$(printf '%s' "$got" | cut -f2)" ] || fail "\"$1\" gave no token file"
  [ "$(cat "$(printf '%s' "$got" | cut -f2)")" = "$3" ] || fail "\"$1\" gave the wrong token"
}

check 'ci-boss' 'ci-boss' 'ci-boss-token'
check 'New Chat | HTPR-2 | fix' 'New Chat' 'new-chat-token'
check 'RUNNER 6' 'RUNNER 6' 'runner-6-token'
check 'RUNNER 6 | HTPR-1 | fix' 'RUNNER 6' 'runner-6-token'
check 'ht-or-runner-5' 'RUNNER 5' 'runner-5-token'
check 'cursor-grok-runner-5 (Cursor Grok RUNNER 5)' 'RUNNER 5' 'runner-5-token'
check 'SPEED RUNNER 6' 'RUNNER 6' 'runner-6-token'
check 'runner-5' 'runner-5' 'runner-5-token'
# No matching login: refused, no identity printed, and the refusal names the token file this chat needs.
refused() {  # name expected-token-file
  local got status=0
  got=$(SHIP_SESSION_NAME="$1" bash "$here/ship-identity" 2> "$T/err") || status=$?
  [ "$status" -ne 0 ] || fail "\"$1\" was not refused; got \"$got\""
  [ -z "$got" ] || fail "\"$1\" printed an identity instead of refusing: $got"
  grep -qF "$2" "$T/err" || fail "\"$1\" refusal does not name $2: $(cat "$T/err")"
}
refused 'SPEED RUNNER' "$sessions/speed-runner-agent-token"
refused 'ht-or-runner-99' "$sessions/runner-99-agent-token"
refused 'runner' "$sessions/runner-agent-token"
refused 'HTPR-1 | fix' "$sessions/htpr-1-agent-token"
refused 'HT Features' "$sessions/ht-features-agent-token"
SHIP_SESSION_NAME='' bash "$here/ship-identity" > "$T/out" 2> "$T/err" && fail 'an unnamed session with no login was not refused'
[ ! -s "$T/out" ] || fail "an unnamed session printed an identity: $(cat "$T/out")"
grep -qF "$sessions/<chat-name>-agent-token" "$T/err" || fail "unnamed refusal does not name the token file needed: $(cat "$T/err")"
named=$(SHIP_SESSION_NAME='ci-boss | HTPR-1' bash "$here/ship-identity" --name)
[ "$named" = 'ci-boss' ] || fail "--name gave \"$named\", wanted \"ci-boss\""
[ -z "$(SHIP_SESSION_NAME='' bash "$here/ship-identity" --name)" ] || fail '--name invented a name for an unnamed session'
printf 'ship-identity.test ok: a chat with its own login resolves to itself, a runner slot name resolves to that runner, everything else is refused\n'
