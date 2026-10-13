#!/usr/bin/env bash
# Offline self-update tests: local production remote, temporary HOME and fake systemctl/delivery.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HERE/runner-selfupdate
REPO=$(cd "$HERE/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes + 1)); }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }
commit() { git -C "$C/source" add .; git -C "$C/source" -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -qm fixture; }
setup() {
  C=$T/$1
  export HOME=$C/home RUNNER_SELFUPDATE_LIVE=$C/live RUNNER_SELFUPDATE_LIB=$C/lib
  export RUNNER_PICKUP_UNIT_DIR=$C/units RUNNER_PICKUP_SETTINGS=$C/settings.json
  export RUNNER_SELFUPDATE_STATE=$C/state RUNNER_SELFUPDATE_SYSTEMCTL=$C/systemctl
  export FAKE_SYSTEMCTL_LOG=$C/systemctl.log FAKE_EVENTS=$C/events FAKE_DELIVER_CALLS=$C/deliver-calls
  export FAKE_SYSTEMCTL_FAIL_MARKER=$C/failure-used
  unset RUNNER_SELFUPDATE_GIT FAKE_SYSTEMCTL_FAIL FAKE_NO_RUNNERS
  mkdir -p "$HOME" "$C/source/.claude/skills/ship/scripts" "$C/source/.claude/hooks" "$C/source/.claude/systemd" "$C/lib" "$C/units/agent-events.service.d"
  S=$C/source/.claude/skills/ship/scripts
  cp "$HERE/runner-pickup" "$S/"
  for file in runner-chat-reply ship-identity; do printf '#!/usr/bin/env bash\nexit 0\n' > "$S/$file"; done
  printf '#!/usr/bin/env bash\nexit 0\n' > "$C/source/.claude/hooks/runner-inbox-stop.sh"
  printf '#!/usr/bin/env python3\nprint("fixture")\n' > "$S/runner-webhook"
  cat > "$S/runner-deliver" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$RUNNER_DELIVER_ID" "$1" >> "$FAKE_DELIVER_CALLS"
text=$(cat)
mkdir -p "$FAKE_EVENTS.ids"
[ ! -e "$FAKE_EVENTS.ids/$RUNNER_DELIVER_ID" ] || exit 0
printf '%s|%s|%s\n' "$RUNNER_DELIVER_ID" "$1" "$text" >> "$FAKE_EVENTS"
touch "$FAKE_EVENTS.ids/$RUNNER_DELIVER_ID"
EOF
  chmod +x "$S/"*
  cp "$REPO/.claude/systemd/"* "$C/source/.claude/systemd/"
  cat > "$C/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_SYSTEMCTL_LOG"
case "$*" in
  *list-unit-files*)
    [ "${FAKE_NO_RUNNERS:-0}" != 1 ] || exit 0
    printf 'runner-pickup@12.timer enabled enabled\nrunner-pickup@3.timer enabled enabled\nrunner-pickup@1.timer disabled enabled\n';;
  *'enable --now runner-webhook.service') [ "${FAKE_SYSTEMCTL_FAIL:-}" != install ]; exit $?;;
  *'restart runner-webhook.service')
    if [ "${FAKE_SYSTEMCTL_FAIL:-}" = restart ] && [ ! -e "$FAKE_SYSTEMCTL_FAIL_MARKER" ]; then touch "$FAKE_SYSTEMCTL_FAIL_MARKER"; exit 1; fi;;
  *'is-active --quiet runner-webhook.service')
    if [ "${FAKE_SYSTEMCTL_FAIL:-}" = inactive ] && [ ! -e "$FAKE_SYSTEMCTL_FAIL_MARKER" ]; then touch "$FAKE_SYSTEMCTL_FAIL_MARKER"; exit 1; fi;;
esac
EOF
  chmod +x "$C/systemctl"
  git init -q --bare "$C/remote"
  git init -q -b production "$C/source"
  commit
  git -C "$C/source" remote add origin "$C/remote"
  git -C "$C/source" push -q origin production
  git clone -q --branch production "$C/remote" "$C/live"
  git -C "$C/live" checkout -q --detach origin/production
  cp "$S/"* "$C/lib/"
  cp "$C/source/.claude/hooks/runner-inbox-stop.sh" "$C/lib/"
  for file in runner-pickup@.service runner-pickup@.timer runner-webhook.service runner-selfupdate.service runner-selfupdate.timer; do
    cp "$C/source/.claude/systemd/$file" "$C/units/"
  done
  cp "$C/source/.claude/systemd/agent-events-port.conf" "$C/units/agent-events.service.d/port.conf"
  echo 'keep unrelated installed files' > "$C/lib/unrelated"
  cp -a "$C/lib" "$C/old-lib"; cp -a "$C/units" "$C/old-units"
  : > "$FAKE_SYSTEMCTL_LOG"; : > "$FAKE_EVENTS"; : > "$FAKE_DELIVER_CALLS"
}
merge() { printf '%s\n' "$2" >> "$S/$1"; commit; git -C "$C/source" push -q origin production; }
run_ok() { if "$SCRIPT" run > "$C/output" 2>&1; then ok "$1"; else bad "$1"; cat "$C/output"; fi; }
run_bad() { if "$SCRIPT" run > "$C/output" 2>&1; then bad "$1 unexpectedly succeeded"; else ok "$1"; fi; }
restored() {
  if diff -r "$C/old-lib" "$C/lib" && diff -r "$C/old-units" "$C/units"; then ok "$1 restored all lib and unit files"; else bad "$1 did not restore all files"; fi
}
events() { wc -l < "$FAKE_EVENTS" | tr -d ' '; }

setup no-change
run_ok 'case 1: unchanged production succeeds'
eq 'no-change is silent' "$(cat "$C/output")" ''
eq 'no install or service calls' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''
eq 'no event' "$(events)" 0

setup merged-change
merge runner-deliver '# merged production update'
run_ok 'case 2: merged delivery change installs'
if cmp -s "$S/runner-deliver" "$C/lib/runner-deliver"; then ok 'installed delivery equals production'; else bad 'delivery differs'; fi
eq 'lowest enabled runner installed once' "$(grep -c 'enable --now runner-pickup@3.timer' "$FAKE_SYSTEMCTL_LOG")" 1
eq 'webhook installed once' "$(grep -c 'enable --now runner-webhook.service' "$FAKE_SYSTEMCTL_LOG")" 1
if grep -q 'restart runner-webhook.service' "$FAKE_SYSTEMCTL_LOG"; then bad 'unchanged webhook restarted'; else ok 'unchanged webhook not restarted'; fi
eq 'success names production sha' "$(cat "$C/output")" "runner-selfupdate: installed production $(git -C "$C/source" rev-parse HEAD)"
eq 'successful install raises no event' "$(events)" 0
: > "$FAKE_SYSTEMCTL_LOG"
run_ok 'installed update is idempotent'
eq 'second run performs no install' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''

setup syntax-error
merge runner-deliver 'if then'
run_bad 'case 3: invalid source rejected'
restored syntax-error
eq 'validation precedes installation' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''
eq 'one failure event' "$(events)" 1
if grep -qE '^runner-selfupdate-syntax-[0-9a-f]{12}\|ht-product-lead\|.*old version still running$' "$FAKE_EVENTS"; then ok 'failure id and recipient and plain-language text'; else bad 'failure event format'; fi
run_bad 'invalid update remains rejected'
eq 'second run does not raise event again' "$(events)|$(wc -l < "$FAKE_DELIVER_CALLS" | tr -d ' ')" '1|1'
if find "$C/live" -name __pycache__ | grep -q .; then bad 'validation left a source cache'; else ok 'validation leaves no source cache'; fi

setup install-failure
merge runner-deliver '# update before failed installation'
# Also test that rollback removes unit files that did not exist before the attempt.
rm "$C/units/runner-selfupdate.timer" "$C/old-units/runner-selfupdate.timer"
export FAKE_SYSTEMCTL_FAIL=install
run_bad 'case 4: failed installation rejected'
restored install-failure
eq 'installation failure alerts once through old delivery' "$(events)" 1
if grep -q 'daemon-reload' "$FAKE_SYSTEMCTL_LOG"; then ok 'rollback reloads units'; else bad 'rollback did not reload'; fi

setup webhook-failure
merge runner-webhook '# merged receiver update'
export FAKE_SYSTEMCTL_FAIL=restart
run_bad 'case 5: failed webhook restart rejected'
restored webhook-failure
eq 'webhook failure alerts' "$(events)" 1
eq 'rollback restarts old webhook' "$(grep -c 'restart runner-webhook.service' "$FAKE_SYSTEMCTL_LOG")" 2
if grep -q 'is-active --quiet runner-webhook.service' "$FAKE_SYSTEMCTL_LOG"; then ok 'restored webhook must be active'; else bad 'missing active check'; fi

setup wrong-head
merge runner-deliver '# new production not checked out'
cat > "$C/git" <<'EOF'
#!/usr/bin/env bash
# Claim checkout succeeded but leave the old HEAD in place.
if [ "${3:-}" = checkout ]; then exit 0; fi
exec git "$@"
EOF
chmod +x "$C/git"; export RUNNER_SELFUPDATE_GIT=$C/git
run_bad 'case 6: HEAD not production rejected'
restored wrong-head
eq 'wrong HEAD never installs' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''
eq 'wrong HEAD alerts' "$(events)" 1

setup install-timer
rm "$C/units/runner-selfupdate.service" "$C/units/runner-selfupdate.timer"
if "$SCRIPT" install > "$C/output" 2>&1 &&
  cmp -s "$REPO/.claude/systemd/runner-selfupdate.service" "$C/units/runner-selfupdate.service" &&
  cmp -s "$REPO/.claude/systemd/runner-selfupdate.timer" "$C/units/runner-selfupdate.timer"; then
  ok 'case 7: install writes both timer units'
else bad 'timer install'; cat "$C/output"; fi
eq 'install reloads and enables timer' "$(cat "$FAKE_SYSTEMCTL_LOG")" $'--user daemon-reload\n--user enable --now runner-selfupdate.timer'

# Additional guards for the production-only, no-runner, active-check and locking contracts.
setup dirty-source
printf '# unmerged local edit\n' >> "$C/live/.claude/skills/ship/scripts/runner-deliver"
run_bad 'unmerged working-tree code rejected'
restored dirty-source
eq 'dirty source alerts before install' "$(events)|$(cat "$FAKE_SYSTEMCTL_LOG")" '1|'

setup no-runners
merge runner-deliver '# no enabled runner'
export FAKE_NO_RUNNERS=1
run_ok 'no enabled runner skips installation'
restored no-runners
eq 'no runner raises no event' "$(events)" 0

setup inactive-webhook
merge runner-webhook '# receiver must become active'
export FAKE_SYSTEMCTL_FAIL=inactive
run_bad 'inactive new webhook rolls back'
restored inactive-webhook
eq 'inactive webhook alerts' "$(events)" 1

setup webhook-success
merge runner-webhook '# healthy merged receiver'
run_ok 'changed webhook installs and becomes active'
if cmp -s "$S/runner-webhook" "$C/lib/runner-webhook"; then ok 'installed webhook equals production'; else bad 'webhook differs'; fi
eq 'healthy webhook restarts once' "$(grep -c 'restart runner-webhook.service' "$FAKE_SYSTEMCTL_LOG")" 1
eq 'healthy webhook checked active' "$(grep -c 'is-active --quiet runner-webhook.service' "$FAKE_SYSTEMCTL_LOG")" 1
if find "$C/live" -name __pycache__ | grep -q .; then bad 'compile validation left a source cache'; else ok 'compile validation writes no cache'; fi

setup invalid-python
merge runner-webhook 'def broken('
run_bad 'invalid webhook syntax rejected'
restored invalid-python
eq 'invalid Python alerts before installation' "$(events)|$(cat "$FAKE_SYSTEMCTL_LOG")" '1|'

setup lock-held
mkdir -p "$C/state"
exec 8>"$C/state/update.lock"; flock 8
run_ok 'overlapping updater skips its run'
eq 'overlap is silent and makes no service calls' "$(cat "$C/output")|$(cat "$FAKE_SYSTEMCTL_LOG")" '|'
flock -u 8; exec 8>&-

printf '%s passed, %s failed\n' "$passes" "$fails"
[ "$fails" = 0 ] && echo 'ALL PASS'
exit "$fails"
