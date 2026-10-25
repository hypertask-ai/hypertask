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
            'hax --provider=codex --model=gpt-6.1-sol --effort=high ', 'retry'])

    def test_interactive_run_sends_brief_records_final_output_and_closes(self):
        self.env['TMUX_PANE'] = '%fixture'
        self.env['HAX_SUBAGENT_DEPTH'] = '1'
        self.command('clear', 'exit 0')
        self.command('hax', """
printf 'hax %s depth=%s identity=%s\\n' "$*" "${HAX_SUBAGENT_DEPTH-unset}" "$SHIP_SESSION_NAME" >> "$HOME/events"
mkdir -p "$HT_HAX_PROC_ROOT/$PPID/task/$PPID" "$HT_HAX_PROC_ROOT/$$/fd"
echo $$ > "$HT_HAX_PROC_ROOT/$PPID/task/$PPID/children"
ln -s "$HOME/session.jsonl" "$HT_HAX_PROC_ROOT/$$/fd/3"
touch "$HOME/started"
while [ ! -f "$HOME/closed" ]; do /bin/sleep 0.01; done
""")
        self.command('tmux', """
case "$1" in
  select-pane|clear-history) : ;;
  send-keys)
    case "$*" in
      *' -l '*) echo brief >> "$HOME/events" ;;
      *C-m) echo submitted >> "$HOME/events" ;;
      *C-d) echo closed >> "$HOME/events"; touch "$HOME/closed" ;;
    esac ;;
  capture-pane)
    printf '  %s\\n' "$FINAL_LINE"
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
      else
        printf '{"kind":"assistant","text":"%s"}\\n{"kind":"turn_usage"}\\n' "$FINAL_LINE" >> "$HOME/session.jsonl"
        echo final-phase >> "$HOME/events"
      fi
    fi ;;
esac
exec /bin/sleep 0.01
""")
        for final_line, cooldown in [
            ('RUNNER DONE YPER4-776 Done', 30),
            ('RUNNER DONE https://app.hypertask.ai/detail/project-4060/776 Done', 30),
            ('• RUNNER IDLE no free tickets', 900),
        ]:
            with self.subTest(final_line=final_line):
                self.events.write_text('')
                for name in ['closed', 'started', 'tool-phase']:
                    (self.home / name).unlink(missing_ok=True)
                self.env['FINAL_LINE'] = final_line
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
                self.assertIn('hax --provider=codex --model=gpt-6.1-sol --effort=high depth=unset identity=RUNNER 8', events)
                self.assertLess(events.index('brief'), events.index('submitted'))
                self.assertLess(events.index('tool-phase'), events.index('final-phase'))
                self.assertLess(events.index('final-phase'), events.index('capture'))
                self.assertLess(events.index('capture'), events.index('closed'))
                self.assertIn(f'retry {cooldown}', events)
                self.assertIn(final_line, (self.state / 'runner-8.latest.log').read_text())
                self.assertIn(final_line, (self.state / 'runner-8.log').read_text())

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
            process.communicate(timeout=10)
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
