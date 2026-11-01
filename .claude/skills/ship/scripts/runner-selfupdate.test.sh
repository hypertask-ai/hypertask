#!/usr/bin/env bash
# Offline self-update tests: local production remote, temporary HOME and fake systemctl/delivery.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HERE/runner-selfupdate
REPO=$(cd "$HERE/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export USER_UNIT_CHECK=/usr/bin/true
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes + 1)); }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3' got '$2')"; fi; }
commit() { git -C "$C/source" add .; git -C "$C/source" -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false commit -qm fixture; }
setup() {
  C=$T/$1
  export HOME=$C/home RUNNER_SELFUPDATE_LIVE=$C/live RUNNER_SELFUPDATE_LIB=$C/lib
  export RUNNER_SELFUPDATE_DISPATCH=$HOME/.claude/skills/runners/scripts/runner-dispatch
  export RUNNER_PICKUP_UNIT_DIR=$C/units RUNNER_PICKUP_SETTINGS=$C/settings.json
  export RUNNER_SELFUPDATE_STATE=$C/state RUNNER_SELFUPDATE_SYSTEMCTL=$C/systemctl
  export FAKE_SYSTEMCTL_LOG=$C/systemctl.log FAKE_EVENTS=$C/events FAKE_DELIVER_CALLS=$C/deliver-calls
  export FAKE_SYSTEMCTL_FAIL_MARKER=$C/failure-used
  export RUNNER_SELFUPDATE_RETRY_DELAY=0
  unset RUNNER_SELFUPDATE_GIT FAKE_SYSTEMCTL_FAIL FAKE_NO_RUNNERS FAKE_UPDATER_PID
  export TMPDIR=$C/backups
  mkdir -p "$TMPDIR"
  mkdir -p "$HOME" "$C/source/.claude/skills/ship/scripts" "$C/source/.claude/hooks" "$C/source/.claude/systemd" "$C/lib" "$C/units/agent-events.service.d"
  S=$C/source/.claude/skills/ship/scripts
  cp "$HERE/runner-pickup" "$HERE/runner-domain-pickup.py" "$HERE/runner_domains.py" "$HERE/user-unit-check" "$SCRIPT" "$S/"
  for file in runner-chat-reply ship-identity ci-wait; do printf '#!/usr/bin/env bash\nexit 0\n' > "$S/$file"; done
  printf '#!/usr/bin/env bash\nexit 0\n' > "$C/source/.claude/hooks/runner-inbox-stop.sh"
  for file in runner-webhook runner-dispatch; do printf '#!/usr/bin/env python3\nprint("fixture")\n' > "$S/$file"; done
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
  *list-units*)
    [ "${FAKE_NO_RUNNERS:-0}" != 1 ] || exit 0
    printf 'runner-pickup@12.timer loaded active waiting\nrunner-pickup@3.timer loaded active waiting\nrunner-pickup@1.timer loaded inactive dead\n';;
  *'enable --now runner-webhook.service')
    if [ -n "${FAKE_UPDATER_PID:-}" ]; then
      python3 - "$FAKE_UPDATER_PID" <<'PYEOF'
import os, pathlib, signal, subprocess, sys
sleeper = subprocess.Popen(["sleep", "0.2"])
os.kill(int(pathlib.Path(sys.argv[1]).read_text()), signal.SIGTERM)
sleeper.wait()
PYEOF
    fi
    [ "${FAKE_SYSTEMCTL_FAIL:-}" != install ]; exit $?;;
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
  rm "$C/lib/runner-dispatch"
  install -D -m 0755 "$S/runner-dispatch" "$RUNNER_SELFUPDATE_DISPATCH"
  cp -a "$RUNNER_SELFUPDATE_DISPATCH" "$C/old-dispatch"
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
run_ok() { if "$C/lib/runner-selfupdate" run > "$C/output" 2>&1; then ok "$1"; else bad "$1"; cat "$C/output"; fi; }
run_bad() { if "$C/lib/runner-selfupdate" run > "$C/output" 2>&1; then bad "$1 unexpectedly succeeded"; else ok "$1"; fi; }
restored() {
  if diff -r "$C/old-lib" "$C/lib" && diff -r "$C/old-units" "$C/units" &&
    cmp -s "$C/old-dispatch" "$RUNNER_SELFUPDATE_DISPATCH" && [ "$(stat -c %a "$RUNNER_SELFUPDATE_DISPATCH")" = 755 ]; then
    ok "$1 restored all lib, dispatcher and unit files"
  else bad "$1 did not restore all files"; fi
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

setup domain-helper-change
merge runner-domain-pickup.py '# merged domain helper update'
run_ok 'domain helper change installs'
if cmp -s "$S/runner-domain-pickup.py" "$C/lib/runner-domain-pickup.py"; then ok 'domain helper equals production'; else bad 'domain helper differs'; fi

setup domain-helper-syntax-error
merge runner-domain-pickup.py 'def broken('
run_bad 'invalid domain helper syntax rejected'
restored domain-helper-syntax-error
eq 'domain helper validation precedes installation' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''

setup dispatcher-change
merge runner-dispatch '# merged dispatcher update'
run_ok 'dispatcher-only change installs'
if cmp -s "$S/runner-dispatch" "$RUNNER_SELFUPDATE_DISPATCH" && [ "$(stat -c %a "$RUNNER_SELFUPDATE_DISPATCH")" = 755 ]; then
  ok 'dispatcher installed executable at the existing unit path'
else bad 'dispatcher installation differs'; fi
if [ -e "$C/lib/runner-dispatch" ]; then bad 'dispatcher installed into pickup library'; else ok 'dispatcher stays outside pickup library'; fi
: > "$FAKE_SYSTEMCTL_LOG"
run_ok 'installed dispatcher update is idempotent'
eq 'dispatcher second run performs no install' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''

setup dispatcher-first-install
rm "$RUNNER_SELFUPDATE_DISPATCH"
run_ok 'missing dispatcher triggers installation'
if cmp -s "$S/runner-dispatch" "$RUNNER_SELFUPDATE_DISPATCH"; then ok 'missing dispatcher installed'; else bad 'missing dispatcher not installed'; fi

setup dispatcher-syntax-error
merge runner-dispatch 'def broken('
run_bad 'invalid dispatcher syntax rejected'
restored dispatcher-syntax-error
eq 'dispatcher validation precedes installation' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''
eq 'invalid dispatcher alerts' "$(events)" 1

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
merge runner-dispatch '# dispatcher restored after webhook failure'
merge runner-selfupdate '# updater installed before webhook restart fails'
export FAKE_SYSTEMCTL_FAIL=restart
run_bad 'case 5: failed webhook restart rejected'
restored webhook-failure
eq 'webhook failure alerts' "$(events)" 1
eq 'rollback restarts old webhook' "$(grep -c 'restart runner-webhook.service' "$FAKE_SYSTEMCTL_LOG")" 2
if grep -q 'is-active --quiet runner-webhook.service' "$FAKE_SYSTEMCTL_LOG"; then ok 'restored webhook must be active'; else bad 'missing active check'; fi

setup dispatcher-first-install-failure
rm "$RUNNER_SELFUPDATE_DISPATCH"
merge runner-webhook '# fail restart after first dispatcher install'
export FAKE_SYSTEMCTL_FAIL=restart
run_bad 'failed update rolls back first dispatcher installation'
if [ -e "$RUNNER_SELFUPDATE_DISPATCH" ]; then bad 'rollback left a newly installed dispatcher'; else ok 'rollback removes newly installed dispatcher'; fi

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

eq 'wrong HEAD is retried once before alerting' "$(grep -c 'retrying in 0s' "$C/output")" 1

setup fetch-race
merge runner-deliver '# production moved while another fetch held the ref'
cat > "$C/git" <<'EOF'
#!/usr/bin/env bash
if [ "${3:-}" = fetch ] && [ ! -e "$FAKE_EVENTS.raced" ]; then
  touch "$FAKE_EVENTS.raced"
  echo "error: cannot lock ref 'refs/remotes/origin/production'" >&2; exit 1
fi
exec git "$@"
EOF
chmod +x "$C/git"; export RUNNER_SELFUPDATE_GIT=$C/git
run_ok 'case 6b: one lost fetch race is retried and installs'
if cmp -s "$S/runner-deliver" "$C/lib/runner-deliver"; then ok 'retried update installs production'; else bad 'retried update did not install'; fi
eq 'recovered race raises no alert' "$(events)|$(wc -l < "$FAKE_DELIVER_CALLS" | tr -d ' ')" '0|0'

setup fetch-down
cat > "$C/git" <<'EOF'
#!/usr/bin/env bash
if [ "${3:-}" = fetch ]; then echo fetch >> "$FAKE_EVENTS.fetches"; exit 1; fi
exec git "$@"
EOF
chmod +x "$C/git"; export RUNNER_SELFUPDATE_GIT=$C/git
run_bad 'case 6c: fetch failing twice alerts'
eq 'fetch tried exactly twice' "$(wc -l < "$FAKE_EVENTS.fetches" | tr -d ' ')" 2
if grep -qE '^runner-selfupdate-fetch-[0-9a-f]{12}\|ht-product-lead\|Could not fetch' "$FAKE_EVENTS"; then ok 'persistent fetch failure alerts once'; else bad 'fetch alert missing'; cat "$FAKE_EVENTS"; fi

setup install-timer
rm "$C/units/runner-selfupdate.service" "$C/units/runner-selfupdate.timer" "$C/lib/runner-selfupdate"
if "$SCRIPT" install > "$C/output" 2>&1 &&
  cmp -s "$REPO/.claude/systemd/runner-selfupdate.service" "$C/units/runner-selfupdate.service" &&
  cmp -s "$REPO/.claude/systemd/runner-selfupdate.timer" "$C/units/runner-selfupdate.timer" &&
  cmp -s "$SCRIPT" "$C/lib/runner-selfupdate" &&
  [ "$(stat -c %a "$C/lib/runner-selfupdate")" = 755 ]; then
  ok 'case 7: install writes timer units and executable updater'
else bad 'timer install'; cat "$C/output"; fi
eq 'service runs the installed updater' "$(sed -n 's/^ExecStart=//p' "$C/units/runner-selfupdate.service")" '%h/.local/lib/hypertask/runner-pickup/runner-selfupdate run'
eq 'install reloads and enables timer' "$(cat "$FAKE_SYSTEMCTL_LOG")" $'--user daemon-reload\n--user enable --now runner-selfupdate.timer'

setup updater-syntax-error
merge runner-selfupdate 'if then'
run_bad 'invalid changed updater rejected by the installed copy'
restored updater-syntax-error
eq 'updater validation precedes installation' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''
eq 'invalid updater raises one alert' "$(events)" 1
run_bad 'invalid updater stays rejected on retry'
eq 'invalid updater alert is not repeated' "$(events)|$(wc -l < "$FAKE_DELIVER_CALLS" | tr -d ' ')" '1|1'

setup updater-change
merge runner-selfupdate '# valid merged updater change'
run_ok 'installed updater updates itself from live production'
if cmp -s "$S/runner-selfupdate" "$C/lib/runner-selfupdate" && [ "$(stat -c %a "$C/lib/runner-selfupdate")" = 755 ]; then
  ok 'installed updater equals production and is executable'
else bad 'updater installation differs'; fi
: > "$FAKE_SYSTEMCTL_LOG"
run_ok 'updated installed updater can run again'
eq 'updated updater is idempotent' "$(cat "$FAKE_SYSTEMCTL_LOG")" ''

setup rollback-failure
merge runner-deliver '# update before failed recovery'
export FAKE_SYSTEMCTL_FAIL=install
mkdir "$C/bin"
cat > "$C/bin/cp" <<'EOF'
#!/usr/bin/env bash
# Fail the recovery copy, not the backup or installation.
if [[ ${2:-} == "$TMPDIR/"*/lib ]]; then exit 1; fi
exec /usr/bin/cp "$@"
EOF
chmod +x "$C/bin/cp"
PATH="$C/bin:$PATH" run_bad 'failed recovery exits nonzero'
eq 'failed recovery raises exactly one alert' "$(events)" 1
kept=$(find "$TMPDIR" -mindepth 1 -maxdepth 1 -type d)
if [ -n "$kept" ] && diff -r "$C/old-lib" "$kept/lib" && [ -d "$kept/units" ]; then
  ok 'failed recovery keeps its complete backup'
else bad 'failed recovery deleted or damaged backup'; fi
if grep -qE '^runner-selfupdate-rollback-[0-9a-f]{12}\|ht-product-lead\|.*recovery failed$' "$FAKE_EVENTS" &&
  grep -Fq "backup kept at $kept " "$FAKE_EVENTS"; then
  ok 'rollback alert names the kept backup and recovery failure'
else bad 'missing rollback-specific recovery alert'; fi
if [ -f "$C/lib/runner-deliver" ]; then ok 'failed recovery did not delete the installed library'; else bad 'failed recovery deleted installed library'; fi

setup interrupted-install
merge runner-deliver '# change before interruption'
merge runner-selfupdate '# updater must also be restored after interruption'
export FAKE_UPDATER_PID=$C/updater.pid
if bash -c 'echo $$ > "$FAKE_UPDATER_PID"; exec "$1" run' bash "$C/lib/runner-selfupdate" > "$C/output" 2>&1; then
  bad 'interrupted install unexpectedly succeeded'
else ok 'TERM during sleeping installer exits nonzero'; fi
restored interrupted-install
eq 'interrupted install raises one alert' "$(events)" 1
eq 'successful recovery removes its backup' "$(find "$TMPDIR" -mindepth 1 -maxdepth 1 -type d)" ''

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
