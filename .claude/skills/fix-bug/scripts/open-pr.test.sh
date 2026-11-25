#!/usr/bin/env bash
# Offline open-pr.sh tests: a chat with no board login is refused before any push or PR (HTPR-9710).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

fail() { printf 'open-pr.test: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || { printf 'open-pr.test: skipped, node is not on PATH\n'; exit 0; }

work="$T/work"
mkdir -p "$work"
git init -q -b production "$work"
git -C "$work" config user.email 'test@example.com'
git -C "$work" config user.name 'open-pr test'
git -C "$work" config commit.gpgsign false
mkdir -p "$T/no-hooks"
git -C "$work" config core.hooksPath "$T/no-hooks"
mkdir -p "$work/.github/scripts" "$work/.claude/skills/ship/scripts"
cp "$repo/.github/scripts/pr-preflight.cjs" "$repo/.github/scripts/pr-size-policy.json" \
  "$repo/.github/scripts/pr-title-shape.cjs" "$work/.github/scripts/"
cp "$repo/.claude/skills/ship/scripts/ship-identity" "$work/.claude/skills/ship/scripts/"
printf 'base\n' > "$work/README.md"
git -C "$work" add -A
git -C "$work" commit -qm base
git init -q --bare "$T/origin.git"
git -C "$work" remote add origin "$T/origin.git"
git -C "$work" push -q origin production
git -C "$work" checkout -q -b feature

mkdir -p "$T/home/.config/hypertask-agents/credentials/sessions" "$T/home/.claude/sessions" "$T/bin"
home=$(cd "$T/home" && pwd)
creds="$home/.config/hypertask-agents/credentials"
body="$T/pr-body.md"
cat > "$body" <<'BODY'
**Summary for non-engineers:** a refused board login stops before the PR opens.

What went wrong: the chat fell back to a shared login.

What changes: the chat is refused instead.

What you will see: an error naming the token file this chat needs.

Watch out for: nothing.
BODY
printf '#!/bin/sh\nprintf "[]\\n"\n' > "$T/bin/gh"
chmod 755 "$T/bin/gh"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/vcc"
chmod 755 "$T/bin/vcc"

run_open_pr() {
  ( cd "$work" && HOME="$home" VCC_CREDENTIALS_DIR="$creds" PATH="$T/bin:$PATH" \
      "$@" bash "$here/open-pr.sh" HTPR-1 BUGFIX 'stop the shared login' \
      --body-file "$body" --dry-run )
}

status=0
err=$(run_open_pr env SHIP_SESSION_NAME='Some Chat | HTPR-1' 2>&1 >/dev/null) || status=$?
[ "$status" -ne 0 ] || fail 'a chat with SHIP_SESSION_NAME set but no login was not refused'
case "$err" in
  *'no board login of its own'*) ;;
  *) fail "the refusal does not say why: $err" ;;
esac
case "$err" in
  *"$creds/sessions/some-chat-agent-token"*) ;;
  *) fail "the refusal does not name the token file this chat needs: $err" ;;
esac
git -C "$T/origin.git" rev-parse --verify --quiet feature >/dev/null \
  && fail 'the branch was pushed before the board login was checked'

printf 'some-chat-token\n' > "$creds/sessions/some-chat-agent-token"
out=$(run_open_pr env SHIP_SESSION_NAME='Some Chat | HTPR-1' 2>&1) || fail "a chat with its own login was refused: $out"
case "$out" in
  *'DRY RUN OK'*) ;;
  *) fail "a chat with its own login did not reach the dry run: $out" ;;
esac

printf 'open-pr.test ok: a chat with no board login is refused before the push, and one with its own login proceeds\n'
