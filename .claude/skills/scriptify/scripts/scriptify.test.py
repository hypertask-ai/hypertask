#!/usr/bin/env python3
import datetime as dt
import fcntl
import importlib.machinery
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
SCAN = importlib.machinery.SourceFileLoader('scriptify_scan', str(HERE / 'scriptify-scan')).load_module()
WEEKLY = HERE / 'scriptify-weekly'


def fixture(home, commands, codex=False, index=0, errors=(), usage=False):
    path = home / (f'.codex/sessions/2026/test-{index}.jsonl' if codex else f'.claude/projects/test/session-{index}.jsonl')
    path.parent.mkdir(parents=True, exist_ok=True)
    events = []
    now = time.time() - 600
    for step, command in enumerate(commands):
        stamp = dt.datetime.fromtimestamp(now + step * 60, dt.timezone.utc).isoformat()
        call_id = f'call-{step}'
        if codex:
            payload = {'type': 'function_call', 'name': 'exec_command', 'call_id': call_id,
                       'arguments': json.dumps({'cmd': command})}
            events.append({'type': 'response_item', 'timestamp': stamp, 'payload': payload})
            events.append({'type': 'response_item', 'timestamp': stamp, 'payload': {
                'type': 'function_call_output', 'call_id': call_id,
                'output': f'Process exited with code {1 if step in errors else 0}'}})
        else:
            message = {'content': [{'type': 'tool_use', 'name': 'Bash', 'id': call_id, 'input': {'command': command}}]}
            if usage:
                message['usage'] = {'input_tokens': 80, 'output_tokens': 20}
            events.append({'type': 'assistant', 'timestamp': stamp, 'sessionId': f'session-{index}', 'message': message})
            events.append({'type': 'user', 'timestamp': stamp, 'message': {'content': [{
                'type': 'tool_result', 'tool_use_id': call_id, 'is_error': step in errors, 'content': 'result'}]}})
    path.write_text(''.join(json.dumps(event) + '\n' for event in events))
    return path


def stub(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('#!/usr/bin/env python3\n' + content)
    path.chmod(0o755)


class Sandbox(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), PATH=str(self.bin) + ':' + os.environ['PATH'])
        self.directory = self.home / '.local/state/scriptify' / dt.date.today().isoformat()

    def scan(self, **kwargs):
        return subprocess.run([sys.executable, str(HERE / 'scriptify-scan'), '--json'],
                              env=self.env, capture_output=True, text=True, **kwargs)

    def weekly(self, *args, **kwargs):
        return subprocess.run([sys.executable, str(WEEKLY), *args], env=self.env,
                              capture_output=True, text=True, **kwargs)


class ScannerTests(Sandbox):
    def test_normalization(self):
        self.assertEqual(SCAN.normalize('git -C /tmp/one status --short && gh pr view 233 --json title,url'),
                         'git -C <PATH> status --short && gh pr view <NUM> --json <ARG>')
        self.assertEqual(SCAN.normalize('curl https://example.test/42 -H "Authorization: Bearer value" --password=hunter2'),
                         'curl <URL> -H <ARG> --password=<ARG>')
        self.assertEqual(SCAN.normalize('git show ab12cd34 --format="%h %s"'), 'git show <ID> --format=<ARG>')
        self.assertEqual(SCAN.normalize('node /tmp/test.js 123 foo "quoted words"'), 'node <PATH> <NUM> <ARG> <ARG>')
        self.assertEqual(SCAN.normalize('FOO=secret /tmp/scriptify-scan --days=7'), '<ARG> scriptify-scan --days=<NUM>')

    def test_rank_sequences_usage_and_errors(self):
        for index in range(3):
            fixture(self.home, ['git status --short', f'gh pr view {index}', 'git diff --stat'], index=index,
                    errors=(1,) if index == 0 else (), usage=True)
        result = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        best = report['candidates'][0]
        self.assertEqual(best['pattern'], ['git status --short', 'gh pr view <NUM>', 'git diff --stat'])
        self.assertEqual((best['sessions'], best['occurrences'], best['minutes'], best['tokens']), (3, 3, 6.0, 900))
        self.assertEqual(best['error_rate'], 0.3333)
        self.assertEqual(len(report['candidates']), 3)

    def test_error_nonzero_and_exact_retry(self):
        for index in range(3):
            fixture(self.home, ['git status', 'git diff'], codex=True, index=index, errors=(0,) if index == 0 else ())
        sessions, _ = SCAN.read_sessions(self.home, time.time() - 86400)
        self.assertEqual(SCAN.candidates(sessions, set())[0]['error_rate'], 0.3333)
        fixture(self.home, ['cat /tmp/a', 'cat /tmp/a', 'cat /tmp/b'], index=9)
        sessions, _ = SCAN.read_sessions(self.home, time.time() - 86400)
        retry = sessions['session-9']
        self.assertEqual([step['error'] for step in retry], [True, True, False])
        self.assertTrue(SCAN.failed([{'type': 'text', 'text': json.dumps({'exit_code': 2, 'output': 'hidden'})}]))

    def test_custom_exec_real_format_and_token_count(self):
        command = 'git status --short'
        path = fixture(self.home, ['ignored'], codex=True)
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        path.write_text('\n'.join(json.dumps({'type': kind, 'timestamp': stamp, 'payload': payload}) for kind, payload in [
            ('session_meta', {'id': 'codex-test'}),
            ('response_item', {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'a',
                               'input': "r = tools.exec_command(" + repr({'cmd': command}) + "); text(r)"}),
            ('response_item', {'type': 'custom_tool_call_output', 'call_id': 'a',
                               'output': [{'type': 'text', 'text': json.dumps({'exit_code': 1, 'output': 'hidden'})}]}),
            ('event_msg', {'type': 'token_count', 'info': {'last_token_usage': {'total_tokens': 42}}})]))
        sessions, _ = SCAN.read_sessions(self.home, time.time() - 86400)
        self.assertEqual(sessions['codex-test'][0]['pattern'], command)
        self.assertTrue(sessions['codex-test'][0]['error'])
        self.assertEqual(sessions['codex-test'][0]['tokens'], 42)
        self.assertEqual(SCAN.command_inputs({'name': 'exec', 'input': '__import__("os").system("false")'}), [])

    def test_async_exit_and_usage_record(self):
        path = fixture(self.home, ['git diff'], codex=True)
        events = [json.loads(line) for line in path.read_text().splitlines()]
        events[1]['payload']['output'] = 'Process running with session ID 123'
        stamp = events[0]['timestamp']
        events += [
            {'type': 'response_item', 'timestamp': stamp, 'payload': {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'wait',
                'input': "r = tools.write_stdin({'session_id': 123, 'chars': ''}); text(r)"}},
            {'type': 'response_item', 'timestamp': stamp, 'payload': {'type': 'custom_tool_call_output', 'call_id': 'wait',
                'output': [{'type': 'text', 'text': json.dumps({'exit_code': 7, 'output': 'hidden'})}]}},
            {'type': 'token_usage_record', 'timestamp': stamp, 'payload': {'usage': {'total_tokens': 88}}}]
        path.write_text('\n'.join(map(json.dumps, events)))
        sessions, _ = SCAN.read_sessions(self.home, time.time() - 86400)
        step = next(iter(sessions.values()))[0]
        self.assertTrue(step['error'])
        self.assertEqual(step['tokens'], 88)
        self.assertEqual(SCAN.process_ids([{'text': json.dumps({'session_id': 456})}]), [456])
        self.assertEqual(SCAN.continuation_ids({'name': 'write_stdin', 'arguments': '{"session_id": 456}'}), [456])

    def test_scripted_time_filter_malformed_and_missing_usage(self):
        stub(self.home / '.local/bin/already-scripted', 'pass\n')
        for index in range(3):
            path = fixture(self.home, ['already-scripted 42', 'git status'], index=index)
            with path.open('a') as stream:
                stream.write('not json\n')
        old = fixture(self.home, ['other-program', 'git diff'], index=8)
        events = [json.loads(line) for line in old.read_text().splitlines()]
        for event in events:
            event['timestamp'] = '2001-01-01T00:00:00Z'
        old.write_text('\n'.join(map(json.dumps, events)))
        result = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['malformed_lines'], 3)
        self.assertEqual(report['sessions'], 3)
        self.assertTrue(report['candidates'][0]['already_scripted'])
        self.assertNotIn('tokens', report['candidates'][0])
        self.assertNotIn('## 1.', (self.directory / 'candidates.md').read_text())
        self.assertEqual(self.scan().returncode, 0)

    def test_redacted_long_script_name_still_excluded(self):
        name = 'premerge-browser-verification-reconciliation'
        self.assertTrue(SCAN.secret_like(name))
        stub(self.home / '.local/bin' / name, 'pass\n')
        for index in range(3):
            fixture(self.home, [str(self.home / '.local/bin' / name), 'git status'], index=index)
        result = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['candidates'][0]['already_scripted'])
        self.assertNotIn(name, (self.directory / 'candidates.json').read_text())

    def test_sessions_count_not_occurrences_and_six_steps(self):
        steps = [{'pattern': f'git step{n}', 'time': n * 60, 'error': False} for n in range(7)]
        self.assertEqual(SCAN.candidates({'one': steps * 10}, set()), [])
        result = SCAN.candidates({str(i): steps for i in range(3)}, set())
        self.assertEqual(max(len(item['pattern']) for item in result), 6)
        self.assertEqual(result[0]['minutes'], 15)

    def test_plain_shell_reading_is_not_a_routine(self):
        reading = [{'pattern': 'cd <PATH> && grep -n <ARG> <PATH> | head <NUM>', 'time': 0, 'error': False},
                   {'pattern': 'cd <PATH> && sed -n <ARG> <PATH>', 'time': 60, 'error': False}]
        self.assertEqual(SCAN.candidates({str(i): reading for i in range(3)}, set()), [])
        mixed = reading + [{'pattern': 'gh pr checks <NUM>', 'time': 120, 'error': False}]
        result = SCAN.candidates({str(i): mixed for i in range(3)}, set())
        self.assertTrue(result)
        self.assertTrue(all(any(step.startswith('gh ') for step in item['pattern']) for item in result))


class SecurityTests(Sandbox):
    def test_planted_secrets_never_persist_claude_and_codex(self):
        secrets = ['sk-' + 'FAKEabcd1234' * 4, 'ghp_' + 'FAKEwxyz5678' * 4,
                   '0123456789abcdef' * 2 + 'deadbeef', 'BearerValueAbCd9876ZYXwvuts543210TOKEN',
                   'NeverPersistPasswordValue', '.'.join(['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiJmYWtlIn0', 'fakeSignature']),
                   'AKIA' + 'FAKE1234567890123456', 'xoxb-' + 'FAKE123abc' * 4]
        commands = [f'curl https://private.example/{index} -H "Authorization: Bearer {value}" --password={value} '
                    f'--token {value} --key={value} "/private/{value}"' for index, value in enumerate(secrets)]
        commands += [f'{secrets[0]} --key={secrets[1]}', 'git status --short']
        for index in range(3):
            fixture(self.home, commands, index=index)
            fixture(self.home, commands, codex=True, index=index)
        result = self.scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertGreater(len(report['candidates']), 0)
        for name in ('candidates.json', 'candidates.md'):
            text = (self.directory / name).read_text()
            for value in secrets:
                self.assertNotIn(value, text)
            for command in commands[:-1]:
                self.assertNotIn(command, text)
            self.assertFalse(SCAN.secret_like(text))
        # Prove the oracle catches its positive controls, not only absence.
        for value in secrets[:4] + secrets[5:]:
            self.assertTrue(SCAN.secret_like(value))

    def test_refuse_secret_report_before_creating_files(self):
        for value in ['sk-' + 'FAKEa1b2c3' * 4, '7f' * 20, 'aZ9kP4mQ8nR2tU6vW0xY3cD5eF1gH7jL']:
            self.assertTrue(SCAN.secret_like(value))
            with self.assertRaises(ValueError):
                SCAN.write_reports({'sessions': 3, 'commands': 6, 'malformed_lines': 0,
                                    'candidates': [{'pattern': [value], 'sessions': 3, 'occurrences': 3,
                                                    'minutes': 1, 'error_rate': 0, 'already_scripted': False}]}, self.directory)
            self.assertFalse(self.directory.exists())


class WeeklyTests(Sandbox):
    def setUp(self):
        super().setUp()
        stub(self.bin / 'hax', 'raise SystemExit(99)\n')

    def git(self, *args, repo=None):
        return subprocess.check_output(['git', '-C', str(repo or self.repo), *args], text=True, stderr=subprocess.DEVNULL).strip()

    def prepare_repo(self):
        self.repo = self.home / 'repo'
        self.repo.mkdir()
        self.git('init', '-b', 'production')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.test')
        (self.repo / 'seed').write_text('seed\n')
        self.git('add', '.')
        self.git('commit', '-m', 'seed')
        self.git('remote', 'add', 'origin', str(self.repo))
        self.git('fetch', 'origin', 'production')
        for index in range(3):
            fixture(self.home, ['git status --short', f'gh pr view {index}'], index=index)
        stub(self.home / 'projects/token-ladder/bin/token-ladder',
             'print("Token ladder: CLAUDE mode. Keep this line.")\nprint("IGNORE SECOND LINE")\n')

    def test_scan_only_temp_home_never_hax(self):
        for index in range(3):
            fixture(self.home, ['git status', f'gh pr view {index}'], index=index)
        result = self.weekly('--scan-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.directory / 'candidates.md').exists())
        self.assertTrue((self.directory / 'candidates.json').exists())
        self.assertFalse((self.directory / 'handoff.md').exists())

    def test_full_handoff_exact_prompt_one_helper(self):
        self.prepare_repo()
        stub(self.bin / 'hax', '''import sys, subprocess
from pathlib import Path
args = sys.argv[1:]
assert args[:4] == ['--provider=codex', '--model=gpt-6.1-sol', '--effort=high', '--no-session']
assert args[4] == '-p'
prompt = args[5]
assert prompt.startswith('Token ladder: CLAUDE mode. Keep this line.\\nUse the unlazy skill')
assert 'IGNORE SECOND LINE' not in prompt
for phrase in ['top 1 to 3', 'scoreboard.md', 'deterministic test', 'Do not push', 'no vcc or hypertask writes', 'stack-key']:
    assert phrase in prompt
marker = Path.home() / 'hax-called'
assert not marker.exists()
marker.touch()
Path('script.py').write_text('print(1)\\n')
subprocess.run(['git', 'add', '.'], check=True)
subprocess.run(['git', 'commit', '-m', 'script routine'], check=True)
''')
        result = self.weekly('--repo', str(self.repo))
        self.assertEqual(result.returncode, 0, result.stderr)
        handoff = (self.directory / 'handoff.md').read_text()
        self.assertIn('scriptify/' + dt.date.today().isoformat(), handoff)
        self.assertIn(self.git('rev-parse', 'HEAD', repo=self.directory / 'worktree'), handoff)
        self.assertTrue((self.home / 'hax-called').exists())
        self.assertNotEqual(self.weekly('--repo', str(self.repo)).returncode, 0)

    def test_failure_propagates_without_handoff(self):
        self.prepare_repo()
        self.assertNotEqual(self.weekly('--repo', str(self.repo)).returncode, 0)
        self.assertFalse((self.directory / 'handoff.md').exists())

    def test_success_without_commit_is_not_handoff(self):
        self.prepare_repo()
        stub(self.bin / 'hax', 'pass\n')
        self.assertNotEqual(self.weekly('--repo', str(self.repo)).returncode, 0)
        self.assertFalse((self.directory / 'handoff.md').exists())

    def test_lock_and_no_candidates(self):
        state = self.home / '.local/state/scriptify'
        state.mkdir(parents=True)
        with (state / 'weekly.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertNotEqual(self.weekly('--scan-only').returncode, 0)
            self.assertFalse(self.directory.exists())
        result = self.weekly()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('No Codex session started', (self.directory / 'handoff.md').read_text())

    def test_install_isolated_units_and_executables(self):
        stub(self.bin / 'systemctl', '''import sys
from pathlib import Path
with (Path.home() / 'systemctl-calls').open('a') as stream:
    stream.write(' '.join(sys.argv[1:]) + '\\n')
''')
        result = self.weekly('install', '--repo', str(self.home / 'durable-repo'))
        self.assertEqual(result.returncode, 0, result.stderr)
        lib = self.home / '.local/lib/hypertask/scriptify'
        self.assertTrue(os.access(lib / 'scriptify-weekly', os.X_OK))
        self.assertEqual((lib / 'repo').read_text().strip(), str(self.home / 'durable-repo'))
        self.assertEqual((self.home / 'systemctl-calls').read_text(),
                         '--user daemon-reload\n--user enable --now scriptify.timer\n')
        self.assertIn('Persistent=true', (self.home / '.config/systemd/user/scriptify.timer').read_text())
        service = (self.home / '.config/systemd/user/scriptify.service').read_text()
        for setting in ('Nice=19', 'IOSchedulingClass=idle', 'MemoryMax=2G', 'TimeoutStartSec=3h'):
            self.assertIn(setting, service)
        self.assertEqual(subprocess.run([str(lib / 'scriptify-weekly'), '--scan-only'], env=self.env,
                                        capture_output=True).returncode, 0)


if __name__ == '__main__':
    result = unittest.main(verbosity=2, exit=False).result
    if result.wasSuccessful():
        print('SCRIPTIFY TESTS PASSED')
    sys.exit(0 if result.wasSuccessful() else 1)
