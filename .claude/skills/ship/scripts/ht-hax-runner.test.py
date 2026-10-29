import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('ht-hax-runner')


class KeeperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.state = self.home / '.local/state/ht-hax-runners'
        self.state.mkdir(parents=True)
        self.events = self.home / 'events'
        self.events.touch()
        guard = self.home / '.local/bin/session-policy-guard'
        guard.parent.mkdir(parents=True)
        guard.write_text('#!/bin/sh\nexit "${POLICY_EXIT:-0}"\n')
        guard.chmod(0o755)
        self.proc = self.home / 'proc'
        self.proc.mkdir()
        self.pressure()
        self.env = dict(os.environ, HOME=str(self.home), HT_HAX_PROC_ROOT=str(self.proc),
                        PATH=f'{self.bin}:/usr/bin:/bin')
        self.command('nproc', 'echo 8')
        self.command('sleep', 'exit 0')
        self.command('token-ladder', 'echo quota-called >> "$HOME/events"; exit 99')
        self.command('tmux', '''
case "$1" in
  list-sessions|ls) cat "$HOME/live" 2>/dev/null || true ;;
  has-session) grep -qx -- "$3" "$HOME/live" 2>/dev/null ;;
  new-session) [ "${TMUX_START_EXIT:-0}" = 0 ] || exit 1; echo "start $4" >> "$HOME/events"; echo "$4" >> "$HOME/live" ;;
  select-pane|clear-history) : ;;
  *) exit 99 ;;
esac''')
        self.command('systemctl', 'echo "systemctl $*" >> "$HOME/events"')
        setup = self.home / 'projects/hypertask/.claude/skills/setup-runner/scripts/setup-runner'
        setup.parent.mkdir(parents=True)
        setup.write_text('#!/bin/sh\necho "login $SHIP_SESSION_NAME" >> "$HOME/events"\n')
        setup.chmod(0o755)

    def command(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def pressure(self, load='0.2', ram=25, status='add'):
        (self.proc / 'loadavg').write_text(f'0 {load} 0 1/1 1\n')
        (self.proc / 'meminfo').write_text(f'MemAvailable: {ram * 1048576} kB\n')
        path = self.home / '.local/state/vps-load/status'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(status)

    def run_keeper(self, *args, script=SCRIPT):
        return subprocess.run(['bash', str(script), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_policy_denied_topup_never_sets_up_or_starts(self):
        self.env['POLICY_EXIT'] = '1'
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        self.assertIn('launch refused by session policy', (self.state / 'keeper.log').read_text())

    def test_green_topup_starts_two_without_reading_quota(self):
        result = self.run_keeper('top-up')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events.read_text().splitlines(), [
            'login RUNNER 6', 'start ht-hax-runner-6',
            'login RUNNER 7', 'start ht-hax-runner-7'])

    def test_pressure_pause_stop_and_lock_never_launch(self):
        for load, ram, status in [('8', 25, 'add'), ('0.2', 24, 'add'), ('0.2', 25, 'hold'),
                                  ('0.2', 25, '')]:
            with self.subTest(load=load, ram=ram, status=status):
                self.pressure(load, ram, status)
                self.assertEqual(self.run_keeper('top-up').returncode, 0)
                self.assertEqual(self.events.read_text(), '')
        self.pressure()
        (self.state / 'PAUSED').touch()
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        (self.state / 'PAUSED').unlink()
        with (self.state / '.keeper.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.run_keeper('top-up').returncode, 0)
            self.assertEqual(self.events.read_text(), '')
        (self.state / 'target').write_text('1')
        (self.state / 'stop-6').touch()
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text().splitlines(), ['login RUNNER 7', 'start ht-hax-runner-7'])

    def test_unreadable_resource_inputs_never_launch(self):
        for filename in ['loadavg', 'meminfo']:
            with self.subTest(filename=filename):
                path = self.proc / filename
                original = path.read_text()
                for text in ['', 'invalid']:
                    path.write_text(text)
                    self.assertEqual(self.run_keeper('top-up').returncode, 0)
                    self.assertEqual(self.events.read_text(), '')
                path.unlink()
                self.assertEqual(self.run_keeper('top-up').returncode, 0)
                self.assertEqual(self.events.read_text(), '')
                path.write_text(original)
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertIn('start ht-hax-runner-6', self.events.read_text())

    def test_existing_session_is_not_restarted_and_growth_is_bounded(self):
        (self.home / 'live').write_text('ht-hax-runner-6\n')
        (self.state / 'target').write_text('1')
        (self.state / 'max').write_text('2')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        self.assertEqual((self.state / 'target').read_text().strip(), '1')
        stamp = self.state / 'last-start'
        os.utime(stamp, (stamp.stat().st_mtime - 901, stamp.stat().st_mtime - 901))
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual((self.state / 'target').read_text().strip(), '2')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text().splitlines(), ['login RUNNER 7', 'start ht-hax-runner-7'])
        self.events.write_text('')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        self.assertEqual((self.state / 'target').read_text().strip(), '2')

    def test_gaps_below_existing_sessions_do_not_exceed_target(self):
        (self.home / 'live').write_text('ht-hax-runner-7\nht-hax-runner-8\n')
        (self.state / 'target').write_text('2')
        (self.state / 'max').write_text('2')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        (self.state / 'target').write_text('3')
        (self.state / 'max').write_text('3')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text().splitlines(), ['login RUNNER 6', 'start ht-hax-runner-6'])

    def test_hax_startup_failure_reaches_retry_and_reaps_watcher(self):
        self.env['TMUX_PANE'] = '%fixture'
        (self.state / 'runner-6.log').write_text('RUNNER IDLE previous run\n')
        self.command('clear', 'exit 0')
        self.command('hax', 'echo "hax $1 $2 $3 $4" >> "$HOME/events"; exit 42')
        self.command('sleep', '''
case "$1" in
  30) echo retry >> "$HOME/events"; kill -TERM "$PPID" ;;
  *) exec /bin/sleep 30 ;;
esac''')
        process = subprocess.Popen(['bash', str(SCRIPT), '6', '--loop'], env=self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        try:
            process.communicate(timeout=3)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        self.assertEqual(self.events.read_text().splitlines(), [
            'hax --provider=codex --model=gpt-6.1-sol --effort=medium ', 'retry'])

    def test_interactive_run_sends_brief_records_final_output_and_closes(self):
        self.env['TMUX_PANE'] = '%fixture'
        self.env['HAX_SUBAGENT_DEPTH'] = '1'
        self.env['CLAUDE_CODE_SESSION_ID'] = 'inherited-claude-session'
        self.env['CODEX_SESSION_ID'] = 'inherited-codex-session'
        self.env['CODEX_THREAD_ID'] = 'inherited-codex-thread'
        recovery = self.home / '.local/lib/hypertask/runner-pickup/runner-pickup'
        recovery.parent.mkdir(parents=True)
        recovery.write_text('#!/bin/sh\necho "recovery $*" >> "$HOME/events"\necho "Resume YPER4-1: stale freeze block cleared"\n')
        recovery.chmod(0o755)
        self.command('clear', 'exit 0')
        self.command('hax', """
printf 'hax %s depth=%s identity=%s\\n' "$*" "${HAX_SUBAGENT_DEPTH-unset}" "$SHIP_SESSION_NAME" >> "$HOME/events"
printf 'session=%s claude=%s thread=%s\\n' "$CODEX_SESSION_ID" "${CLAUDE_CODE_SESSION_ID-unset}" "${CODEX_THREAD_ID-unset}" >> "$HOME/events"
mkdir -p "$HT_HAX_PROC_ROOT/$PPID/task/$PPID" "$HT_HAX_PROC_ROOT/$$/fd"
echo $$ > "$HT_HAX_PROC_ROOT/$PPID/task/$PPID/children"
ln -s "$HOME/session.jsonl" "$HT_HAX_PROC_ROOT/$$/fd/3"
touch "$HOME/started"
while [ ! -f "$HOME/closed" ]; do /bin/sleep 0.01; done
""")
        self.command('tmux', """
case "$1" in
  select-pane|clear-history) : ;;
  display-message) echo "0 2" ;;
  if-shell) echo submitted >> "$HOME/events"; touch "$HOME/recovered"; echo provider-retried ;;
  send-keys)
    case "$*" in
      *' -l '*) echo brief >> "$HOME/events"; printf '%s' "$*" > "$HOME/brief" ;;
      *C-m) echo submitted >> "$HOME/events" ;;
      *C-d) echo closed >> "$HOME/events"; touch "$HOME/closed" ;;
    esac ;;
  capture-pane)
    if [ "${RECOVER_PROVIDER:-0}" = 1 ] && [ ! -f "$HOME/recovered" ]; then
      printf '\\033[2m[provider error — enter to retry]\\033[0m\\n\\n❯\\n'
    else printf '  %s\\n' "$FINAL_LINE"; fi
    echo capture >> "$HOME/events" ;;
  *) exit 99 ;;
esac
""")
        self.command('sleep', """
case "$1" in
  30|900)
    if [ -f "$HOME/closed" ]; then
      echo "retry $1" >> "$HOME/events"; kill -TERM "$PPID"
    elif [ -f "$HOME/started" ]; then
      if [ ! -f "$HOME/tool-phase" ]; then
        echo tool-phase >> "$HOME/events"; touch "$HOME/tool-phase"
      elif [ "${RECOVER_PROVIDER:-0}" != 1 ] || [ -f "$HOME/recovered" ]; then
        printf '{"kind":"assistant","text":"%s"}\\n{"kind":"turn_usage"}\\n' "$FINAL_LINE" >> "$HOME/session.jsonl"
        echo final-phase >> "$HOME/events"
      fi
    fi ;;
esac
exec /bin/sleep 0.01
""")
        session_ids = set()
        for final_line, cooldown, recovery in [
            ('RUNNER DONE YPER4-1 Done', 30, False),
            ('RUNNER DONE https://app.hypertask.ai/detail/project-4060/1 Done', 30, False),
            ('RUNNER DONE YPER4-1 Agent Blocked', 30, False),
            ('RUNNER DONE YPER4-776 Done', 30, False),
            ('RUNNER DONE https://app.hypertask.ai/detail/project-4060/776 Done', 30, False),
            ('• RUNNER IDLE no free tickets', 900, False),
            ('RUNNER DONE YPER4-776 Done', 30, True),
        ]:
            with self.subTest(final_line=final_line):
                self.events.write_text('')
                for name in ['closed', 'started', 'tool-phase', 'recovered']:
                    (self.home / name).unlink(missing_ok=True)
                self.env['FINAL_LINE'] = final_line
                self.env['RECOVER_PROVIDER'] = '1' if recovery else '0'
                records = [
                    {'type': 'session', 'version': 1, 'cwd': str(self.home / 'projects/hypertask')},
                    {'kind': 'user', 'text': final_line},
                    {'kind': 'assistant', 'text': final_line},
                    {'kind': 'tool_call', 'tool_name': 'bash'},
                    {'kind': 'tool_result', 'output': final_line},
                    {'kind': 'turn_usage'},
                ]
                (self.home / 'session.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
                process = subprocess.Popen(['bash', str(SCRIPT), '8', '--loop'], env=self.env,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, start_new_session=True)
                try:
                    process.communicate(timeout=3)
                finally:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                events = self.events.read_text().splitlines()
                self.assertIn('hax --provider=codex --model=gpt-6.1-sol --effort=medium depth=unset identity=RUNNER 8', events)
                session = next(event for event in events if event.startswith('session='))
                self.assertRegex(session, r'^session=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12} claude=unset thread=unset$')
                session_id = session.split()[0]
                self.assertNotIn(session_id, session_ids)
                session_ids.add(session_id)
                self.assertIn('recovery drain 8', events)
                if final_line in [
                    'RUNNER DONE YPER4-1 Done',
                    'RUNNER DONE https://app.hypertask.ai/detail/project-4060/1 Done',
                ]:
                    self.assertIn('recovery ack 8 YPER4-1', events)
                    self.assertLess(events.index('final-phase'), events.index('recovery ack 8 YPER4-1'))
                else:
                    self.assertNotIn('recovery ack 8 YPER4-1', events)
                self.assertIn('Recovery: Resume YPER4-1: stale freeze block cleared', (self.home / 'brief').read_text())
                self.assertLess(events.index('recovery drain 8'), events.index('brief'))
                self.assertLess(events.index('brief'), events.index('submitted'))
                self.assertLess(events.index('tool-phase'), events.index('final-phase'))
                self.assertLess(events.index('final-phase'), len(events) - 1 - events[::-1].index('capture'))
                self.assertLess(len(events) - 1 - events[::-1].index('capture'), events.index('closed'))
                self.assertIn(f'retry {cooldown}', events)
                self.assertEqual(events.count('submitted'), 2 if recovery else 1)
                self.assertFalse((self.state / 'stop-8').exists())
                self.assertIn(final_line, (self.state / 'runner-8.latest.log').read_text())
                self.assertIn(final_line, (self.state / 'runner-8.log').read_text())

    def test_failed_launch_retains_recovery_without_acknowledging(self):
        self.env['TMUX_PANE'] = '%fixture'
        recovery = self.home / '.local/lib/hypertask/runner-pickup/runner-pickup'
        recovery.parent.mkdir(parents=True)
        recovery.write_text('#!/bin/sh\necho "recovery $*" >> "$HOME/events"\n[ "$1" = drain ] && echo "Resume YPER4-1: ready"\n')
        recovery.chmod(0o755)
        self.command('clear', 'exit 0')
        self.command('tmux', 'exit 0')
        self.command('hax', 'echo failed-start >> "$HOME/events"; exit 42')
        self.command('sleep', 'echo "retry $1" >> "$HOME/events"; kill -TERM "$PPID"')
        self.run_keeper('8', '--loop')
        events = self.events.read_text().splitlines()
        self.assertIn('recovery drain 8', events)
        self.assertIn('failed-start', events)
        self.assertFalse(any(event.startswith('recovery ack') for event in events))

    def test_missing_session_identity_never_launches_hax(self):
        self.env['TMUX_PANE'] = '%fixture'
        self.command('cat', """
if [ "$1" = /proc/sys/kernel/random/uuid ]; then exit 42; fi
exec /bin/cat "$@"
""")
        self.command('hax', 'echo launched >> "$HOME/events"')
        self.assertEqual(self.run_keeper('6', '--loop').returncode, 1)
        self.assertEqual(self.events.read_text(), '')

    def test_unreadable_completion_times_out_records_screen_and_retries(self):
        self.env['TMUX_PANE'] = '%fixture'
        self.command('clear', 'exit 0')
        self.command('python3', 'echo poll >> "$HOME/events"; exit 1')
        self.command('hax', 'while [ ! -f "$HOME/closed" ]; do /bin/sleep 0.01; done')
        self.command('tmux', """
case "$1" in
  select-pane|clear-history) : ;;
  send-keys) case "$*" in *C-d) touch "$HOME/closed" ;; esac ;;
  capture-pane) echo 'unfinished fixture screen' ;;
  *) exit 99 ;;
esac
""")
        self.command('sleep', """
if [ -f "$HOME/closed" ]; then
  echo "retry $1" >> "$HOME/events"; kill -TERM "$PPID"
fi
""")
        process = subprocess.Popen(['bash', str(SCRIPT), '8', '--loop'], env=self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        try:
            process.communicate(timeout=30)
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        self.assertEqual(self.events.read_text().splitlines(), ['poll'] * 480 + ['retry 30'])
        self.assertEqual((self.state / 'runner-8.result').read_text(), 'TIMEOUT\n')
        self.assertEqual((self.state / 'runner-8.latest.log').read_text(), 'unfinished fixture screen\n')
        self.assertIn('unfinished fixture screen', (self.state / 'runner-8.log').read_text())

    def test_provider_error_retries_back_off_and_stop_without_submitting_other_input(self):
        self.env['TMUX_PANE'] = '%fixture'
        self.command('clear', 'exit 0')
        self.command('python3', '[ "$(cat "$HOME/tick")" -ge 10 ] && { echo DONE; exit 0; }; exit 1')
        self.command('hax', 'while [ ! -f "$HOME/closed" ]; do /bin/sleep 0.01; done')
        self.command('tmux', """
case "$1" in
  select-pane|clear-history) : ;;
  display-message) echo "$PANE_STATE" ;;
  if-shell)
    if [ "${RACE_STATE:-0 2}" = '0 2' ]; then
      cat "$HOME/tick" >> "$HOME/retries"; echo provider-retried
    fi ;;
  send-keys)
    case "$*" in
      *' -l '*) touch "$HOME/brief" ;;
      *C-m)
        if [ -f "$HOME/submitted" ]; then
          cat "$HOME/tick" >> "$HOME/retries"
        else touch "$HOME/submitted"; fi ;;
      *C-d) touch "$HOME/closed" ;;
    esac ;;
  capture-pane) printf '%s\\n' "$PANE_TEXT" ;;
  *) exit 99 ;;
esac
""")
        self.command('sleep', """
if [ -f "$HOME/closed" ]; then
  echo "cooldown $1" >> "$HOME/events"; kill -TERM "$PPID"
fi
if [ "$1" = 30 ]; then
  tick=$(cat "$HOME/tick" 2>/dev/null || echo 0)
  echo $((tick + 1)) > "$HOME/tick"
fi
exec /bin/sleep 0.001
""")
        footer = '\x1b[2m[provider error — enter to retry]\x1b[0m'
        for text, pane_state, race_state, retries, stopped in [
            (footer + '\n\n❯', '0 2', '0 2', ['1', '3', '7'], True),
            (footer + '\n\n>', '0 2', '0 2', ['1', '3', '7'], True),
            ('quoted [provider error — enter to retry]\n❯', '0 2', '0 2', [], False),
            ('[provider error — enter to retry]\n❯', '0 2', '0 2', [], False),
            (footer + '\n❯ do not send', '0 13', '0 13', [], False),
            (footer + '\n❯', '0 3', '0 3', [], False),
            (footer + '\n❯', '1 2', '1 2', [], False),
            (footer + '\n❯', '0 2', '1 2', [], False),
            (footer + '\n❯', '0 2', '0 7', [], False),
            ('  ' + footer + '\n  ❯', '0 2', '0 2', [], False),
            (footer + '\nworking...', '0 2', '0 2', [], False),
            ('[paused — enter to continue]\n❯', '0 2', '0 2', [], False),
        ]:
            with self.subTest(text=text):
                for name in ['closed', 'brief', 'submitted', 'tick', 'retries']:
                    (self.home / name).unlink(missing_ok=True)
                (self.state / 'stop-8').unlink(missing_ok=True)
                self.events.write_text('')
                self.env['PANE_TEXT'] = text
                self.env['PANE_STATE'] = pane_state
                self.env['RACE_STATE'] = race_state
                process = subprocess.Popen(['bash', str(SCRIPT), '8', '--loop'], env=self.env,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, start_new_session=True)
                try:
                    process.communicate(timeout=10)
                finally:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                retry_file = self.home / 'retries'
                self.assertEqual(retry_file.read_text().splitlines() if retry_file.exists() else [], retries)
                self.assertEqual((self.state / 'stop-8').exists(), stopped)
                self.assertEqual((self.state / 'runner-8.result').read_text(),
                                 'PROVIDER_ERROR\n' if stopped else 'DONE\n')
                if stopped:
                    log = (self.state / 'runner-8.log').read_text()
                    self.assertIn('provider retry 3/3', log)
                    self.assertIn('provider retry limit reached', log)

    def test_invalid_targets_fail_before_launch(self):
        for target, cap in [('0', '20'), ('21', '21'), ('3', '2'), ('oops', '20'), ('9999999999999', '20')]:
            with self.subTest(target=target, cap=cap):
                (self.state / 'target').write_text(target)
                (self.state / 'max').write_text(cap)
                self.assertEqual(self.run_keeper('top-up').returncode, 2)
                self.assertEqual(self.events.read_text(), '')

    def test_setup_failure_never_creates_a_session(self):
        setup = self.home / 'projects/hypertask/.claude/skills/setup-runner/scripts/setup-runner'
        setup.write_text('#!/bin/sh\nexit 1\n')
        self.assertEqual(self.run_keeper('6').returncode, 1)
        self.assertEqual(self.events.read_text(), '')

    def test_tmux_failure_is_not_reported_as_a_started_runner(self):
        self.env['TMUX_START_EXIT'] = '1'
        result = self.run_keeper('6')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.events.read_text().splitlines(), ['login RUNNER 6'])
        self.assertNotIn('started:', result.stdout)
        self.env['TMUX_START_EXIT'] = '0'
        self.assertEqual(self.run_keeper('6').returncode, 0)
        self.assertIn('start ht-hax-runner-6', self.events.read_text())

    def test_install_validates_before_enabling_and_keeps_live_sessions(self):
        root = self.home / 'source/.claude'
        scripts = root / 'skills/ship/scripts'
        scripts.mkdir(parents=True)
        shutil.copy2(SCRIPT, scripts / SCRIPT.name)
        check = scripts / 'user-unit-check'
        check.write_text('#!/bin/sh\necho validate >> "$HOME/events"\nexit "${CHECK_EXIT:-0}"\n')
        check.chmod(0o755)
        shutil.copytree(SCRIPT.parents[3] / 'systemd', root / 'systemd')
        installed = self.home / '.local/lib/hypertask/ht-hax-runner/ht-hax-runner'
        installed.parent.mkdir(parents=True)
        installed.write_text('old version')
        self.env['CHECK_EXIT'] = '1'
        self.assertEqual(self.run_keeper('install', script=scripts / SCRIPT.name).returncode, 1)
        self.assertEqual(self.events.read_text().splitlines(), ['validate'])
        self.assertEqual(installed.read_text(), 'old version')
        self.events.write_text('')
        self.env['CHECK_EXIT'] = '0'
        self.assertEqual(self.run_keeper('install', script=scripts / SCRIPT.name).returncode, 0)
        self.assertEqual(self.events.read_text().splitlines(), [
            'validate', 'systemctl --user daemon-reload',
            'systemctl --user enable --now ht-hax-runner-keeper.timer'])
        launcher = self.home / '.local/bin/ht-hax-runner'
        self.assertEqual(launcher.resolve().read_bytes(), SCRIPT.read_bytes())
        unit = self.home / '.config/systemd/user/ht-hax-runner-keeper.service'
        self.assertNotIn(str(scripts), unit.read_text())


if __name__ == '__main__':
    unittest.main()
