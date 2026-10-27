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
        source = self.home / 'projects/hypertask/.claude/skills/ship/scripts/ht-hax-runner'
        source.parent.mkdir(parents=True)
        shutil.copy2(SCRIPT, source)
        installed = self.home / '.local/lib/hypertask/ht-hax-runner/ht-hax-runner'
        installed.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SCRIPT, installed)
        (self.home / '.local/bin/ht-hax-runner').symlink_to(installed)
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

    def run_loop(self, body, timeout='2'):
        self.env['HT_HAX_TICKET_TIMEOUT'] = timeout
        self.env['HAX_SUBAGENT_DEPTH'] = '1'
        picker = self.home / 'projects/hypertask/.claude/skills/ship/scripts/ship-claim'
        picker.write_text('''#!/bin/sh
[ "$1" = next ] || exit 99
echo "pick $SHIP_SESSION_NAME" >> "$HOME/events"
echo YPER4-842
''')
        picker.chmod(0o755)
        identity = picker.with_name('ship-identity')
        identity.write_text('#!/bin/sh\necho "$SHIP_SESSION_NAME"\n')
        identity.chmod(0o755)
        self.command('hax', body)
        self.command('sleep', '''
case "$1" in
  30)
    count=$(grep -c '^pick ' "$HOME/events")
    if [ "$count" -ge 2 ]; then kill -TERM "$PPID"; fi ;;
  *) exit 99 ;;
esac
''')
        result = subprocess.run(['bash', str(SCRIPT), '8', '--loop'], env=self.env,
                                capture_output=True, text=True, timeout=6)
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.events.read_text().splitlines()

    def test_missing_final_line_exits_and_starts_next_fresh_process(self):
        events = self.run_loop('''
printf 'hax %s depth=%s identity=%s\\n' "$*" "${HAX_SUBAGENT_DEPTH-unset}" "$SHIP_SESSION_NAME" >> "$HOME/events"
echo finished-without-marker
''')
        starts = [line for line in events if line.startswith('hax ')]
        self.assertEqual(len(starts), 2)
        for line in starts:
            self.assertIn('--provider=codex --model=gpt-6.1-sol --effort=high -p ', line)
            self.assertIn('Ticket: YPER4-842', line)
            self.assertIn('Exactly one ticket this run.', line)
            self.assertIn('Never pick another ticket.', line)
            self.assertNotIn('take the next ticket', line)
            self.assertIn('identity=RUNNER 8', line)
            self.assertIn('depth=unset', line)
        self.assertEqual((self.state / 'runner-8.result').read_text(), 'DONE-UNKNOWN\n')
        self.assertEqual((self.state / 'runner-8.latest.log').read_text(), 'finished-without-marker\n')
        self.assertEqual((self.state / 'runner-8.log').read_text().count('result=DONE-UNKNOWN'), 2)
        self.assertFalse(any('closed' in line for line in events))

    def test_hung_run_is_killed_at_deadline_and_next_run_starts(self):
        events = self.run_loop('echo hax >> "$HOME/events"; exec /bin/sleep 30', timeout='1')
        self.assertEqual(events, ['pick RUNNER 8', 'hax', 'pick RUNNER 8', 'hax'])
        self.assertEqual((self.state / 'runner-8.result').read_text(), 'TIMEOUT\n')

    def test_startup_failure_is_not_done_and_next_process_starts(self):
        events = self.run_loop('echo hax >> "$HOME/events"; exit 42')
        self.assertEqual(events, ['pick RUNNER 8', 'hax', 'pick RUNNER 8', 'hax'])
        self.assertEqual((self.state / 'runner-8.result').read_text(), 'EXIT-42\n')

    def test_completion_requires_the_claimed_ticket_on_the_final_line(self):
        for final, expected in [('RUNNER DONE YPER4-842 Done', 'DONE'),
                                ('RUNNER DONE YPER4-1 Done', 'DONE-UNKNOWN'),
                                ('RUNNER DONE YPER4-842 Done\nmore work', 'DONE-UNKNOWN')]:
            with self.subTest(final=final):
                self.events.write_text('')
                self.env['FINAL_LINE'] = final
                self.run_loop('printf "%s\\n" "$FINAL_LINE"')
                self.assertEqual((self.state / 'runner-8.result').read_text(), expected + '\n')

    def test_launcher_drift_refuses_keeper_and_explains_why(self):
        launcher = self.home / '.local/bin/ht-hax-runner'
        launcher.unlink()
        launcher.write_text('hand-edited launcher')
        self.assertEqual(self.run_keeper('top-up').returncode, 0)
        self.assertEqual(self.events.read_text(), '')
        self.assertIn('launcher drift', (self.state / 'keeper.log').read_text())
        launcher.unlink()
        launcher.symlink_to(self.home / 'bin/other')
        self.assertEqual(self.run_keeper('6').returncode, 1)
        self.assertEqual(self.events.read_text(), '')

    def test_changed_installed_copy_is_refused(self):
        installed = self.home / '.local/lib/hypertask/ht-hax-runner/ht-hax-runner'
        installed.write_text('edited installed copy')
        self.assertEqual(self.run_keeper('6').returncode, 1)
        self.assertEqual(self.events.read_text(), '')

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
        installed.parent.mkdir(parents=True, exist_ok=True)
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
