#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CHECK=$HERE/user-unit-check
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME=$T/home TMPDIR=$T/tmp
mkdir -p "$HOME" "$TMPDIR" "$T/bin"
export PATH=$T/bin:$PATH UNIT_TEST_ROOT=$T
cat > "$T/bin/systemd-analyze" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == --user && $2 == --recursive-errors=no && $3 == verify && $# == 4 ]]
printf '%s\n' "$4" >> "$UNIT_TEST_ROOT/verify-calls"
if [[ ${VERIFY_FAIL:-0} == 1 ]]; then echo 'Failed to initialize manager: fixture error' >&2; exit 1; fi
if [[ ${VERIFY_WARN:-0} == 1 ]]; then echo 'unrelated.service: Unknown key name in section Service, ignoring.' >&2; fi
if grep -q '^WorkingDirectory="%h/x"' "$4"; then
  echo "$4:4: WorkingDirectory= path is not absolute: \"$HOME/x\"" >&2
  echo "$(basename "$4"): Unit configuration has fatal error, unit will not be started." >&2
  echo "Unit $(basename "$4") has a bad unit file setting." >&2
  exit 1
fi
SH
cat > "$T/bin/git" <<'SH'
#!/usr/bin/env bash
if [[ ${LINKED:-0} == 1 ]]; then printf '/srv/main/.git/worktrees/linked\n/srv/main/.git\n';
elif [[ ${MAIN_GIT:-0} == 1 ]]; then printf '/srv/main/.git\n/srv/main/.git\n';
else exit 128; fi
SH
cat > "$T/bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$UNIT_TEST_ROOT/systemctl-calls"
[[ $1 == --user ]]
case $2 in
  start) [[ $3 == --no-block && $4 == fixture.service ]]; exit "${START_EXIT:-0}" ;;
  show)
    [[ $3 == fixture.service ]]
    case ${FIRST_STATE:-success} in
      success)
        if [[ ! -f $UNIT_TEST_ROOT/shown ]]; then
          touch "$UNIT_TEST_ROOT/shown"; printf 'ActiveState=inactive\nResult=success\nJob=42\n'
        else printf 'ActiveState=inactive\nResult=success\nJob=\n'; fi ;;
      failed) printf 'ActiveState=failed\nResult=exit-code\nJob=\n' ;;
      bad-result) printf 'ActiveState=inactive\nResult=signal\nJob=\n' ;;
      missing-result) printf 'ActiveState=inactive\nJob=\n' ;;
      busy) printf 'ActiveState=active\nResult=success\nJob=\n' ;;
    esac ;;
  *) exit 99 ;;
esac
SH
cat > "$T/bin/journalctl" <<'SH'
#!/usr/bin/env bash
[[ $* == '--user -u fixture.service -n 20 --no-pager' ]] || exit 99
echo 'fixture last 20 journal lines'
SH
chmod +x "$T/bin/"*
unit() { printf '[Unit]\nDescription=Fixture\n[Service]\n%s\nExecStart=/usr/bin/true\n' "$1" > "$T/fixture.service"; }
pass() { "$CHECK" "$@" > "$T/out" 2>&1 || { cat "$T/out"; exit 1; }; }
fail() { if "$CHECK" "$@" > "$T/out" 2>&1; then cat "$T/out"; echo 'unexpected success' >&2; exit 1; fi; }
unit 'WorkingDirectory=/srv/durable'
pass "$T/fixture.service"
grep -q '^unit ok: fixture.service$' "$T/out"
echo 'ok valid unit'
VERIFY_WARN=1 pass "$T/fixture.service"
grep -q 'systemd warnings only: verifier exited zero' "$T/out"
echo 'ok unrelated warnings do not fail'
VERIFY_FAIL=1 fail "$T/fixture.service"
grep -q 'Failed to initialize manager: fixture error' "$T/out"
echo 'ok verifier errors fail closed'
unit 'WorkingDirectory="%h/x"'
fail "$T/fixture.service"
grep -Fq "WorkingDirectory= path is not absolute: \"$HOME/x\"" "$T/out"
grep -q 'Unit configuration has fatal error, unit will not be started.' "$T/out"
echo 'ok quoted WorkingDirectory reproduces real systemd error'
unit 'WorkingDirectory=/srv/linked'
LINKED=1 fail "$T/fixture.service"
grep -q 'linked git worktree' "$T/out"
MAIN_GIT=1 pass "$T/fixture.service"
echo 'ok linked worktree rejected, main checkout allowed'
for directive in \
  'WorkingDirectory=%h/projects/hypertask-yper4-605' \
  'WorkingDirectory=/srv/app/.worktrees/ticket' \
  'WorkingDirectory=/tmp/removed-checkout' \
  "WorkingDirectory=$TMPDIR/checkouts" \
  'ExecStartPre=/usr/bin/python3 /tmp/removed/script.py' \
  'ExecStart=/usr/bin/env bash -c "/tmp/removed/run"' \
  'Environment="PATH=/usr/bin:/tmp/removed/bin"' \
  'Environment=OTHER=ok "PATH=/usr/bin:%h/projects/hypertask-605/bin"' \
  'ExecStart=/usr/bin/python3 /srv/.worktrees/605/run.py' \
  'ExecStartPre=/tmp/first\nExecStartPre=/usr/bin/true'; do
  unit "$(printf '%b' "$directive")"
  fail "$T/fixture.service"
  grep -q 'disposable path:' "$T/out"
done
echo 'ok every monitored directive rejects disposable paths, including overwritten pre-start entries'
mkdir -p "$T/checkout"
ln -s "$T/checkout" "$T/disposable-link"
unit "WorkingDirectory=$T/disposable-link"
fail "$T/fixture.service"
echo 'ok temporary symlink target rejected'
unit 'WorkingDirectory=/srv/durable'
cp "$T/fixture.service" "$T/second.service"
VERIFY_FAIL=1 fail "$T/fixture.service" "$T/second.service"
grep -q 'unit refused: second.service' "$T/out"
echo 'ok all files checked after earlier failure'
pass --first-run fixture.service --timeout 3
grep -q 'first run ok: fixture.service (Result=success)' "$T/out"
[[ $(grep -c 'show fixture.service' "$T/systemctl-calls") == 2 ]]
echo 'ok first run waits for pending job then requires success'
for state in failed bad-result missing-result busy; do
  FIRST_STATE=$state fail --first-run fixture.service --timeout 0.05
  grep -q 'fixture last 20 journal lines' "$T/out"
done
START_EXIT=1 fail --first-run fixture.service
grep -q 'fixture last 20 journal lines' "$T/out"
echo 'ok first run failure, missing result, timeout and start failure show journal'
fail --timeout 0 --first-run fixture.service
fail
unit 'WorkingDirectory=/tmp/removed-checkout'
rm "$T/systemctl-calls"
fail --first-run fixture.service "$T/fixture.service"
[[ ! -f $T/systemctl-calls ]]
echo 'ok failed validation never starts a service'

python3 - "$HERE" <<'PY'
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

here = Path(sys.argv[1])
repo = here.parents[3]
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    home = root / 'home'
    home.mkdir()
    binary = root / 'bin'
    binary.mkdir()
    calls = root / 'calls'
    checker = binary / 'check'
    checker.write_text('#!/usr/bin/env bash\nset -eu\nfor unit in "$@"; do test -f "$unit"; done\necho checked >> "$INSTALL_TEST_CALLS"\nexit "${INSTALL_TEST_FAIL:-0}"\n')
    control = binary / 'systemctl'
    control.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_TEST_CALLS"\n')
    git = binary / 'git'
    git.write_text('#!/usr/bin/env bash\ncase "$*" in *--show-toplevel*) echo "$HOME/projects/durable";; *"worktree list"*) echo "worktree $HOME/projects/durable";; *) exit 99;; esac\n')
    for path in (checker, control, git):
        path.chmod(0o755)
    durable = home / 'projects/durable'
    (durable / '.git').mkdir(parents=True)
    identity = home / '.agents/skills/ship/scripts/ship-identity'
    identity.parent.mkdir(parents=True)
    token = home / '.config/hypertask-agents/credentials/sessions/infra-manager-agent-token'
    token.parent.mkdir(parents=True)
    token.write_text('offline-fixture')
    identity.write_text(f'#!/bin/sh\nprintf "INFRA MANAGER\\t%s\\n" "{token}"\n')
    identity.chmod(0o755)
    env = dict(os.environ, HOME=str(home), PATH=str(binary) + ':' + os.environ['PATH'],
               USER_UNIT_CHECK=str(checker), INSTALL_TEST_CALLS=str(calls), SHIP_SESSION_NAME='INFRA MANAGER',
               RUNNER_PICKUP_SETTINGS=str(home / 'settings.json'),
               RUNNER_PICKUP_UNIT_DIR=str(home / '.config/systemd/user'),
               RUNNER_SELFUPDATE_LIB=str(home / '.local/lib/hypertask/runner-pickup'),
               RUNNER_SELFUPDATE_SYSTEMCTL=str(control))
    env.pop('DAILY_STATS_NO_SYSTEMD', None)
    commands = [
        [str(here / 'runner-pickup'), 'install', '3'],
        [str(here / 'runner-pickup'), 'install-webhook'],
        [str(here / 'runner-selfupdate'), 'install'],
        ['python3', str(here / 'premerge-evidence.py'), '--install'],
        ['python3', str(here / 'disk-guard.py'), '--install'],
        [str(here / 'mcp-contract-watch'), '--install'],
        ['python3', str(repo / 'scripts/proc-watchdog.py'), '--install'],
        ['python3', str(repo / 'scripts/daily-stats.py'), '--install'],
        ['python3', str(repo / '.claude/skills/scriptify/scripts/scriptify-weekly'), 'install', '--repo', str(durable)],
        ['bash', str(repo / '.claude/skills/maintain-verification-skill/scripts/maintain-verification-weekly'), 'install', '--repo', str(durable)],
    ]
    if shutil.which('node'):
        commands.extend([
            ['node', str(here / 'production-red-alert'), 'install'],
            ['node', str(here / 'error-collector/collector.mjs'), '--install'],
        ])
    for command in commands:
        for failure in ('0', '1'):
            calls.write_text('')
            result = subprocess.run(command, env=dict(env, INSTALL_TEST_FAIL=failure), capture_output=True, text=True, timeout=30)
            lines = calls.read_text().splitlines()
            assert lines and lines[0] == 'checked', (command, result.stderr, result.stdout, lines)
            if failure == '0':
                assert result.returncode == 0, (command, result.stderr, result.stdout)
                assert any('enable --now' in line for line in lines), (command, lines)
            else:
                assert result.returncode != 0 and lines == ['checked'], (command, result.returncode, lines)
        print('ok installer checks before enabling and aborts on refusal:', Path(command[1] if command[0] in ('node', 'python3', 'bash') else command[0]).name, ' '.join(command[2:]))
PY
printf 'user-unit-check tests passed\n'
