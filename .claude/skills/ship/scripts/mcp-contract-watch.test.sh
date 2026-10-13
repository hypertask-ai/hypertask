#!/usr/bin/env bash
# All HTTP and command fixtures are isolated. Never call production or real delivery.
set -euo pipefail
python3 - "$(dirname "$0")/mcp-contract-watch" "$@" <<'PY'
import concurrent.futures
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = Path(sys.argv[1]).resolve()
MODE = sys.argv[2] if len(sys.argv) > 2 else ''
if MODE == '--dedupe-probe':
    SCRIPT = Path(sys.argv[3]).resolve()
TOKEN = 'private-test-credential-never-log-this'

MOCK = r'''#!/usr/bin/env python3
import json, os
from pathlib import Path
import sys
home = Path.home()
name = Path(sys.argv[0]).name
args = sys.argv[1:]
fixture = json.loads((home / 'fixture.json').read_text())
log = home / 'commands.jsonl'
with log.open('a') as out:
    out.write(json.dumps(dict(name=name, args=args, id=os.environ.get('RUNNER_DELIVER_ID'))) + '\n')
if name == 'ship-identity':
    print(('RUNNER 5' if fixture.get('wrong_identity') else 'MCP Contract Watcher') + '\t' + str(home / 'report-token'))
    sys.exit(0)
if name == 'runner-deliver':
    assert args == ['ht-product-lead']
    assert os.environ['RUNNER_DELIVER_ID'].startswith('mcp-contract-watch:')
    text = sys.stdin.read()
    attempts = home / 'alert-attempts.jsonl'
    previous = attempts.read_text().splitlines() if attempts.exists() else []
    with attempts.open('a') as out:
        out.write(json.dumps(dict(id=os.environ['RUNNER_DELIVER_ID'], text=text)) + '\n')
    if fixture.get('alert_fail') or (fixture.get('alert_fail_once') and not previous):
        print(fixture['secret'], file=sys.stderr)
        sys.exit(3)
    with (home / 'alerts.jsonl').open('a') as out:
        out.write(json.dumps(dict(id=os.environ['RUNNER_DELIVER_ID'], text=text)) + '\n')
    sys.exit(0)
assert name == 'vcc'
assert os.environ['SHIP_SESSION_NAME'] == 'MCP Contract Watcher'
assert '--json' in args
bugs_file = home / 'bugs.json'
bugs = json.loads(bugs_file.read_text()) if bugs_file.exists() else []
if args[:2] == ['task', 'create']:
    assert args[args.index('--priority') + 1] == 'urgent'
    assert args[args.index('--section') + 1] == 'Bugs'
    assert '--assignee' not in args
    if fixture.get('create_fail'):
        print(fixture['secret'], file=sys.stderr)
        sys.exit(1)
    task = dict(id=100 + len(bugs), ticketNumber='TEST-' + str(100 + len(bugs)),
                title=args[args.index('--title') + 1], description=args[args.index('--description') + 1])
    bugs.append(task)
    bugs_file.write_text(json.dumps(bugs))
    if fixture.get('unknown_create'):
        print(fixture['secret'], file=sys.stderr)
        sys.exit(1)
    if fixture.get('malformed_receipt'):
        print(json.dumps(dict(success=True, task=dict(ticketNumber=fixture['secret']))))
    else:
        print(json.dumps(dict(success=True, task=task)))
elif args[:2] == ['task', 'list']:
    if fixture.get('search_fail'):
        print(fixture['secret'], file=sys.stderr)
        sys.exit(1)
    offset = int(args[args.index('--offset') + 1])
    tasks = bugs
    if fixture.get('search_pages'):
        tasks = [dict(id=i, description='unrelated') for i in range(100)] + bugs
    if fixture.get('search_bad'):
        print(json.dumps(dict(success=True, tasks=[])))
    else:
        print(json.dumps(dict(success=True, tasks=tasks[offset:offset+100], total=len(tasks))))
else:
    raise AssertionError(args)
'''


class Harness:
    def __init__(self, script=SCRIPT):
        self.temp = tempfile.TemporaryDirectory(prefix='mcp-watch-test-')
        self.home = Path(self.temp.name)
        self.script = script
        self.requests = []
        self.fixture = dict(mode='green', secret=TOKEN)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        for name in ('vcc', 'runner-deliver', 'ship-identity'):
            path = self.bin / name
            path.write_text(MOCK)
            path.chmod(0o755)
        (self.home / 'report-token').write_text('test-reporter-placeholder')
        (self.home / 'report-token').chmod(0o600)
        config = self.home / '.config/hypertask-agents/mcp-contract-watch'
        config.mkdir(parents=True)
        (config / 'token').write_text(TOKEN)
        (config / 'token').chmod(0o600)
        self.token_file = config / 'token'
        harness = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                assert self.path == '/mcp'
                assert self.headers['Authorization'] == 'Bearer ' + TOKEN
                assert self.headers['Accept'] == 'application/json'
                assert self.headers['MCP-Protocol-Version'] == '2025-03-26'
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                harness.requests.append(request)
                mode = harness.fixture['mode']
                method = request['method']
                status = int(mode) if mode in ('401', '403', '500') else 200
                if mode == 'timeout':
                    threading.Event().wait(16)
                if mode == 'slow-body' and method == 'initialize':
                    threading.Event().wait(8)
                if method == 'initialize':
                    result = dict(protocolVersion='2025-03-26', capabilities={}, serverInfo=dict(name='fake'))
                elif method == 'tools/list':
                    names = ['hypertask_list_projects', 'hypertask_get_tasks', 'hypertask_list_labels']
                    if mode in ('consolidated', 'structured'):
                        names = ['hypertask_projects', 'hypertask_tasks', 'hypertask_labels']
                    if mode == 'missing':
                        names.pop()
                    result = dict(tools=[] if mode == 'empty' else [dict(name=name) for name in names])
                else:
                    assert method == 'tools/call', request
                    params = request['params']
                    name = params['name']
                    fields = params['arguments']
                    consolidated = name in ('hypertask_projects', 'hypertask_tasks', 'hypertask_labels')
                    if consolidated:
                        assert fields['response_format'] == 'detailed'
                        assert fields['limit'] == 50
                        action = fields['action']
                        fields = fields['input']
                        assert action == ('get' if name == 'hypertask_tasks' else 'list')
                    if name in ('hypertask_list_projects', 'hypertask_projects'):
                        assert fields == dict(limit=50)
                        value = dict(success=True, projects=[dict(id=999 if mode == 'missing-board' else 15)])
                    elif name in ('hypertask_get_tasks', 'hypertask_tasks'):
                        assert fields == dict(ticket_number=['HTPR-7190'])
                        value = dict(success=True, tasks=[dict(ticketNumber='HTPR-999' if mode == 'wrong-task' else 'HTPR-7190')])
                    else:
                        assert name in ('hypertask_list_labels', 'hypertask_labels')
                        assert fields == dict(project_id=15, limit=50)
                        value = dict(success=True, labels=[])
                    if mode == 'success-false':
                        value = dict(success=False, error=TOKEN)
                    if consolidated:
                        value = dict(data=value, response_format='detailed')
                    result = dict(content=[dict(type='text', text=json.dumps(value))])
                    if mode == 'structured':
                        result = dict(structuredContent=value)
                    if mode == 'isError':
                        result = dict(isError=True, content=[dict(type='text', text=TOKEN)])
                    if mode == 'malformed-labels' and name == 'hypertask_list_labels':
                        result = dict(content=[dict(type='text', text='{}')])
                body = dict(jsonrpc='2.0', id=request['id'], result=result)
                if mode == 'rpc-error':
                    body = dict(jsonrpc='2.0', id=request['id'], error=dict(code=-32603, message=TOKEN))
                if mode == 'wrong-rpc-id':
                    body['id'] = 999
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                if mode == 'slow-body' and method == 'initialize':
                    threading.Event().wait(8)
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        (config / 'config.json').write_text(json.dumps(dict(url=f'http://127.0.0.1:{self.server.server_port}/mcp')))
        self.env = dict(os.environ, HOME=str(self.home), PATH=str(self.bin) + ':/usr/bin:/bin',
                        MCP_CONTRACT_WATCH_VCC=str(self.bin / 'vcc'),
                        MCP_CONTRACT_WATCH_DELIVER=str(self.bin / 'runner-deliver'),
                        MCP_CONTRACT_WATCH_IDENTITY=str(self.bin / 'ship-identity'))
        self.outputs = []

    def run(self, *flags):
        (self.home / 'fixture.json').write_text(json.dumps(self.fixture))
        result = subprocess.run([str(self.script), '--once', *flags], env=self.env, capture_output=True, text=True, timeout=110)
        self.outputs.append(result.stdout + result.stderr)
        assert result.returncode in (0, 1), result.stderr
        return result, json.loads(result.stdout.splitlines()[-1])

    def records(self, name):
        path = self.home / name
        if not path.exists():
            return []
        if name.endswith('.jsonl'):
            return [json.loads(line) for line in path.read_text().splitlines()]
        return json.loads(path.read_text())

    def state(self):
        return json.loads((self.home / '.local/state/mcp-contract-watch/state.json').read_text())['incident']

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()


class WatcherTests(unittest.TestCase):
    def setUp(self):
        self.h = Harness()
        self.addCleanup(self.h.close)

    def test_green_has_exactly_three_reads_and_no_external_writes(self):
        for mode in ('green', 'consolidated', 'structured'):
            self.h.fixture['mode'] = mode
            _, tick = self.h.run()
            self.assertTrue(tick['ok'])
            self.assertEqual(tick['tools_count'], 3)
            self.assertEqual(len(tick['calls']), 5)
            self.assertEqual([r['method'] for r in self.h.requests[-5:]], ['initialize', 'tools/list', 'tools/call', 'tools/call', 'tools/call'])
        self.assertEqual(self.h.records('commands.jsonl'), [])
        self.assertFalse((self.h.home / '.local/state/mcp-contract-watch/state.json').exists())
        self.assertEqual(len(self.h.records('.local/state/mcp-contract-watch/ticks.jsonl')), 3)

    def test_empty_tools_and_missing_core_fail(self):
        for mode in ('empty', 'missing'):
            self.h.fixture['mode'] = mode
            _, tick = self.h.run('--dry-run')
            self.assertFalse(tick['ok'])
            self.assertFalse(tick['calls'][-1]['ok'])
            self.assertEqual(len(tick['calls']), 2)

    def test_response_failures_are_red_and_secret_free(self):
        for mode in ('isError', '401', '403', '500', 'rpc-error', 'success-false', 'wrong-rpc-id', 'missing-board', 'wrong-task', 'malformed-labels'):
            with self.subTest(mode=mode):
                self.h.fixture['mode'] = mode
                result, tick = self.h.run()
                self.assertEqual(result.returncode, 1)
                self.assertFalse(tick['ok'])
        self.assert_secret_free()

    def test_timeout_is_red(self):
        self.h.fixture['mode'] = 'timeout'
        _, tick = self.h.run()
        self.assertEqual(tick['calls'][0]['status'], 'timeout')

    def test_deadline_bounds_headers_and_body_together(self):
        self.h.fixture['mode'] = 'slow-body'
        _, tick = self.h.run()
        self.assertEqual(tick['calls'][0]['status'], 'timeout')
        self.assertFalse(tick['ok'])

    def test_malformed_create_receipt_cannot_leak_secret_or_refile(self):
        self.h.fixture.update(mode='empty', malformed_receipt=True)
        self.h.run()
        self.assertEqual(self.h.state()['create_state'], 'unknown')
        self.h.run()
        self.assertEqual(self.h.state()['create_state'], 'done')
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assert_secret_free()

    def test_three_red_ticks_dedupe_across_restarts(self):
        self.h.fixture['mode'] = 'empty'
        ids = [self.h.run()[1]['incident_id'] for _ in range(3)]
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertEqual(self.h.state()['create_state'], 'done')
        self.assertEqual(self.h.state()['alert_state'], 'done')
        bug = self.h.records('bugs.json')[0]
        self.assertEqual(bug['title'], '[MCP watcher] MCP stopped working for allowed users: tools/list')
        self.assertIn('mcp-contract-watch:' + ids[0], bug['description'])
        self.assertIn('<p>', bug['description'])
        self.assertIn('tools/list', bug['description'])
        self.assert_secret_free()

    def test_failed_alert_retries_same_id_without_refiling(self):
        self.h.fixture.update(mode='empty', alert_fail_once=True)
        self.h.run()
        self.assertEqual(self.h.state()['alert_state'], 'pending')
        self.h.run()
        self.h.run()
        attempts = self.h.records('alert-attempts.jsonl')
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0]['id'], attempts[1]['id'])
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_two_green_ticks_close_then_red_rearms(self):
        self.h.fixture['mode'] = 'empty'
        old = self.h.run()[1]['incident_id']
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.assertIsNone(self.h.state()['closed_at'])
        self.h.fixture['mode'] = 'empty'
        self.h.run()
        self.assertEqual(self.h.state()['consecutive_ok'], 0)
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.h.run()
        self.assertIsNotNone(self.h.state()['closed_at'])
        self.h.fixture['mode'] = 'empty'
        new = self.h.run()[1]['incident_id']
        self.assertNotEqual(old, new)
        self.assertEqual(len(self.h.records('bugs.json')), 2)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 2)

    def test_pending_alert_survives_closure_and_next_incident(self):
        self.h.fixture.update(mode='empty', alert_fail=True)
        old = self.h.run()[1]['incident_id']
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.h.run()
        self.assertIsNotNone(self.h.state()['closed_at'])
        self.h.run()
        attempts = self.h.records('alert-attempts.jsonl')
        self.assertEqual(len(attempts), 4)
        self.assertEqual({a['id'] for a in attempts}, {'mcp-contract-watch:' + old})
        self.h.fixture['mode'] = 'empty'
        new = self.h.run()[1]['incident_id']
        self.assertNotEqual(old, new)
        path = self.h.home / '.local/state/mcp-contract-watch/state.json'
        self.assertEqual(len(json.loads(path.read_text())['pending_incidents']), 1)
        self.h.fixture['alert_fail'] = False
        self.h.run()
        self.assertEqual(len(self.h.records('bugs.json')), 2)
        self.assertEqual({a['id'] for a in self.h.records('alerts.jsonl')}, {'mcp-contract-watch:' + old, 'mcp-contract-watch:' + new})
        self.assertEqual(json.loads(path.read_text())['pending_incidents'], [])
        self.assert_secret_free()

    def test_unknown_create_reconciles_before_retry_with_pagination(self):
        self.h.fixture.update(mode='empty', unknown_create=True, search_pages=True)
        self.h.run()
        self.assertEqual(self.h.state()['create_state'], 'unknown')
        self.h.run()
        self.assertEqual(self.h.state()['create_state'], 'done')
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        calls = [c for c in self.h.records('commands.jsonl') if c['name'] == 'vcc']
        self.assertEqual([c['args'][1] for c in calls], ['create', 'list', 'list'])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_creation_failure_still_alerts_and_retries_only_after_complete_search(self):
        self.h.fixture.update(mode='empty', create_fail=True)
        self.h.run()
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertIn('Bug filing: unknown', self.h.records('alerts.jsonl')[0]['text'])
        self.h.fixture.update(create_fail=False, search_fail=True)
        self.h.run()
        self.assertEqual(self.h.records('bugs.json'), [])
        self.h.fixture.update(search_fail=False, search_bad=True)
        self.h.run()
        self.assertEqual(self.h.records('bugs.json'), [])
        self.h.fixture['search_bad'] = False
        self.h.run()
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        calls = [c['args'][1] for c in self.h.records('commands.jsonl') if c['name'] == 'vcc']
        self.assertEqual(calls, ['create', 'list', 'list', 'list', 'create'])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)

    def test_no_fallback_reporter_identity(self):
        self.h.fixture.update(mode='empty', wrong_identity=True)
        self.h.run()
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertEqual(self.h.state()['create_state'], 'pending')
        self.h.fixture['wrong_identity'] = False
        self.h.run()
        self.assertEqual(len(self.h.records('bugs.json')), 1)

    def test_concurrent_red_ticks_share_one_incident(self):
        self.h.fixture['mode'] = 'empty'
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            ticks = list(pool.map(lambda _: self.h.run()[1], range(3)))
        self.assertEqual(len({tick['incident_id'] for tick in ticks}), 1)
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertEqual(len(self.h.records('.local/state/mcp-contract-watch/ticks.jsonl')), 3)

    def test_token_permissions_refused_before_http(self):
        self.h.token_file.chmod(0o644)
        _, tick = self.h.run()
        self.assertFalse(tick['ok'])
        self.assertEqual(tick['calls'][0]['status'], 'refused')
        self.assertEqual(self.h.requests, [])
        self.assert_secret_free()

    def test_token_symlink_refused(self):
        source = self.h.home / 'linked-token'
        self.h.token_file.rename(source)
        self.h.token_file.symlink_to(source)
        _, tick = self.h.run('--dry-run')
        self.assertFalse(tick['ok'])
        self.assertEqual(self.h.requests, [])

    def test_state_and_ticks_are_private(self):
        self.h.fixture.update(mode='empty', alert_fail=True)
        self.h.run()
        root = self.h.home / '.local/state/mcp-contract-watch'
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)
        for path in root.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assert_secret_free()

    def test_force_fail_and_bug_project_override_only_response_checks(self):
        for step in ('initialize', 'tools/list', 'list-boards', 'get-task', 'list-labels'):
            _, tick = self.h.run('--force-fail', step, '--bug-project', '4060', '--dry-run')
            self.assertFalse(tick['ok'])
            self.assertEqual([c['step'] for c in tick['calls'] if not c['ok']], [step])
            planned = json.loads(self.h.outputs[-1].splitlines()[0])
            self.assertEqual(planned['would_file']['project'], 4060)
            self.assertEqual(planned['would_send']['target'], 'ht-product-lead')
        self.assertEqual(self.h.records('commands.jsonl'), [])
        self.assertFalse((self.h.home / '.local/state/mcp-contract-watch/state.json').exists())
        self.h.run('--force-fail', 'tools/list', '--bug-project', '4060')
        creates = [c for c in self.h.records('commands.jsonl') if c['name'] == 'vcc' and c['args'][1] == 'create']
        self.assertEqual(creates[0]['args'][creates[0]['args'].index('--project') + 1], '4060')
        self.assertEqual(self.h.state()['bug_project'], 4060)
        self.assert_secret_free()

    def test_dry_run_keeps_existing_incident_state_unchanged(self):
        self.h.fixture['mode'] = 'empty'
        self.h.run()
        path = self.h.home / '.local/state/mcp-contract-watch/state.json'
        before = path.read_bytes()
        commands = self.h.records('commands.jsonl')
        self.h.fixture['mode'] = 'green'
        self.h.run('--dry-run')
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(commands, self.h.records('commands.jsonl'))

    def test_install_templates_match_runtime_and_cadence(self):
        source = Path(sys.argv[1]).resolve().parent
        timer = (source / 'mcp-contract-watch.timer').read_text()
        service = (source / 'mcp-contract-watch.service').read_text()
        self.assertIn('OnCalendar=*:0/5', timer)
        self.assertIn('Persistent=true', timer)
        self.assertIn('Type=oneshot', service)
        self.assertIn('TimeoutStartSec=210s', service)
        self.assertIn('/usr/bin/flock --nonblock', service)
        self.assertIn('%h/.local/lib/hypertask/mcp-contract-watch/mcp-contract-watch --once', service)
        self.assertIn('UMask=0077', service)
        # Test the installer with a fake systemctl, never the user's service manager.
        control = self.h.bin / 'systemctl'
        control.write_text('#!/usr/bin/env python3\nimport json, sys\nfrom pathlib import Path\nwith (Path.home() / "systemctl.jsonl").open("a") as out: out.write(json.dumps(sys.argv[1:]) + "\\n")\n')
        control.chmod(0o755)
        result = subprocess.run([str(self.h.script), '--install'], env=self.h.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        installed = self.h.home / '.local/lib/hypertask/mcp-contract-watch/mcp-contract-watch'
        self.assertEqual(installed.read_bytes(), self.h.script.read_bytes())
        self.assertTrue(os.access(installed, os.X_OK))
        for suffix in ('service', 'timer'):
            self.assertEqual((self.h.home / f'.config/systemd/user/mcp-contract-watch.{suffix}').read_bytes(), (source / f'mcp-contract-watch.{suffix}').read_bytes())
        self.assertEqual(self.h.records('systemctl.jsonl'), [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'mcp-contract-watch.timer']])

    def assert_secret_free(self):
        self.assertNotIn(TOKEN, ''.join(self.h.outputs))
        root = self.h.home / '.local/state/mcp-contract-watch'
        for path in root.rglob('*'):
            if path.is_file():
                self.assertNotIn(TOKEN, path.read_text())
        self.assertNotIn(TOKEN, json.dumps(self.h.records('alerts.jsonl')))


if MODE == '--dry-run-proof':
    harness = Harness()
    try:
        result, tick = harness.run('--dry-run', '--force-fail', 'tools/list', '--bug-project', '4060')
        assert result.returncode == 1 and not tick['ok']
        assert harness.records('commands.jsonl') == []
        assert not (harness.home / '.local/state/mcp-contract-watch/state.json').exists()
        assert TOKEN not in result.stdout + result.stderr
        print(result.stdout, end='')
        print('DRY RUN PROOF PASSED')
    finally:
        harness.close()
    sys.exit(0)

suite = unittest.TestSuite([WatcherTests('test_three_red_ticks_dedupe_across_restarts')]) if MODE == '--dedupe-probe' else unittest.defaultTestLoader.loadTestsFromTestCase(WatcherTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    sys.exit(1)
if MODE == '--dedupe-probe':
    sys.exit(0)

with tempfile.TemporaryDirectory(prefix='mcp-watch-mutation-') as directory:
    mutant = Path(directory) / 'mcp-contract-watch'
    source = SCRIPT.read_text()
    old = "if incident['create_state'] != 'done':"
    assert source.count(old) == 1
    changed = source.replace(old, 'if True:').replace("if incident['create_state'] == 'pending':", "if incident['create_state'] in ('pending', 'done'):")
    mutant.write_text(changed)
    mutant.chmod(0o755)
    probe = subprocess.run(['/bin/bash', str(SCRIPT.with_name('mcp-contract-watch.test.sh')), '--dedupe-probe', str(mutant)], capture_output=True, text=True)
    assert probe.returncode == 1 and '3 != 1' in probe.stderr, probe.stdout + probe.stderr
    print('DEDUPE MUTATION REJECTED: repeated red ticks created three bugs')
print('WATCHER TESTS PASSED')
PY
