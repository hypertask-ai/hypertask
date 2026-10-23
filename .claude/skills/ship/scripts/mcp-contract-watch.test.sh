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
import time
import subprocess
import sys
import tempfile
import threading
import unittest

SCRIPT = Path(sys.argv[1]).resolve()
MODE = sys.argv[2] if len(sys.argv) > 2 else ''
if MODE in ('--dedupe-probe', '--review-probe'):
    SCRIPT = Path(sys.argv[3]).resolve()
TOKEN = 'private-test-credential-never-log-this'
ROTATED_TOKEN = 'rotated-test-credential-never-log-this'
COOKIE = 'private-browser-cookie-never-log-this'
APP_COOKIE = 'private-app-cookie-never-log-this'
OTHER_COOKIE = 'unrelated-cookie-never-log-this'

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
    if args[args.index('--project') + 1] == '15':
        assert args[args.index('--section') + 1] == 'Bugs'
    else:
        assert '--section' not in args
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
        self.rotations = []
        self.cookie_requests = []
        self.current_token = TOKEN
        self.expected_cookies = 'session=' + COOKIE + '; app-session=' + APP_COOKIE
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
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if 'Cookie' in self.headers:
                    harness.cookie_requests.append(self.path)
                if self.path == '/api/mcp/admin/agents/watcher-agent/token':
                    assert request == {}
                    assert 'Authorization' not in self.headers
                    assert self.headers['Cookie'] == harness.expected_cookies, 'rotation cookie selection incorrect'
                    harness.rotations.append(dict(path=self.path, body=request))
                    status = harness.fixture.get('rotate_status', 200)
                    body = {'error': COOKIE} if status != 200 else {'token': ROTATED_TOKEN}
                    if harness.fixture.get('rotate_no_token'):
                        body = {'error': COOKIE}
                    if status == 200 and 'token' in body:
                        harness.current_token = ROTATED_TOKEN
                    data = json.dumps(body).encode()
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                assert self.path == '/mcp'
                assert self.headers['Authorization'] == 'Bearer ' + harness.current_token
                assert 'Cookie' not in self.headers
                assert self.headers['Accept'] == 'application/json'
                assert self.headers['MCP-Protocol-Version'] == '2025-03-26'
                harness.requests.append(request)
                mode = harness.fixture['mode']
                method = request['method']
                status = int(mode) if mode in ('401', '403', '500') else 200
                if harness.fixture.get('revoked') and harness.current_token == TOKEN:
                    if not harness.fixture.get('revoke_step') or method == harness.fixture['revoke_step']:
                        status = 401
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
        self.launcher = self.home / 'isolated-watcher.py'
        self.launcher.write_text(r'''import runpy, sys, urllib.request
from urllib.parse import urlsplit
original_open = urllib.request.OpenerDirector.open
base = sys.argv.pop(1)
script = sys.argv.pop(1)
def isolated_open(opener, request, *args, **kwargs):
    url = request.full_url
    if url.startswith('https://app.hypertask.ai/'):
        request.full_url = base + urlsplit(url).path
    assert request.full_url.startswith(base + '/'), 'non-local HTTP request blocked'
    return original_open(opener, request, *args, **kwargs)
urllib.request.OpenerDirector.open = isolated_open
runpy.run_path(script, run_name='__main__')
''')

    def enable_rotation(self, production=True):
        storage = self.home / 'qa-storage.json'
        storage.write_text(json.dumps(dict(cookies=[
            dict(name='session', value=COOKIE, domain='.hypertask.ai', path='/', expires=-1, secure=True),
            dict(name='app-session', value=APP_COOKIE, domain='app.hypertask.ai', path='/api/mcp/admin', expires=-1, secure=True),
            dict(name='unrelated', value=OTHER_COOKIE, domain='other.example'),
            dict(name='lookalike', value=OTHER_COOKIE, domain='evilhypertask.ai'),
        ])))
        config_file = self.token_file.with_name('config.json')
        config = json.loads(config_file.read_text())
        config.update(qa_storage_state=str(storage), agent_id='watcher-agent')
        if production:
            config['url'] = 'https://app.hypertask.ai/mcp'
        config_file.write_text(json.dumps(config))

    def run(self, *flags):
        (self.home / 'fixture.json').write_text(json.dumps(self.fixture))
        result = subprocess.run(['python3', str(self.launcher), f'http://127.0.0.1:{self.server.server_port}', str(self.script), '--once', *flags], env=self.env, capture_output=True, text=True, timeout=110)
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

    def state(self, drill=False):
        name = 'state-drill.json' if drill else 'state.json'
        return json.loads((self.home / '.local/state/mcp-contract-watch' / name).read_text())['incident']

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

    def test_drill_state_isolated_from_real_outage(self):
        _, drill_tick = self.h.run('--force-fail', 'tools/list')
        root = self.h.home / '.local/state/mcp-contract-watch'
        self.assertFalse((root / 'state.json').exists())
        drill_before = (root / 'state-drill.json').read_bytes()
        self.assertTrue(self.h.state(drill=True)['test'])
        self.h.fixture['mode'] = 'empty'
        _, real_tick = self.h.run()
        self.assertNotEqual(real_tick['incident_id'], drill_tick['incident_id'])
        self.assertFalse(self.h.state()['test'])
        self.assertEqual((root / 'state-drill.json').read_bytes(), drill_before)
        bugs = self.h.records('bugs.json')
        alerts = self.h.records('alerts.jsonl')
        self.assertEqual(len(bugs), 2)
        self.assertTrue(bugs[0]['title'].startswith('[TEST] '))
        self.assertNotIn('[TEST]', bugs[1]['title'])
        self.assertIn('TEST DRILL', alerts[0]['text'])
        self.assertNotIn('TEST DRILL', alerts[1]['text'])
        real_before = (root / 'state.json').read_bytes()
        self.h.run('--force-fail', 'tools/list')
        self.assertEqual((root / 'state.json').read_bytes(), real_before)
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.h.run()
        self.assertIsNotNone(self.h.state()['closed_at'])
        self.assertIsNone(self.h.state(drill=True)['closed_at'])
        self.assert_secret_free()

    def test_nonproduction_origin_never_rotates_or_sends_cookie(self):
        self.h.enable_rotation(production=False)
        storage = self.h.home / 'qa-storage.json'
        cookies = json.loads(storage.read_text())['cookies']
        for cookie in cookies:
            cookie['secure'] = False
        storage.write_text(json.dumps(dict(cookies=cookies)))
        self.h.fixture['revoked'] = True
        _, tick = self.h.run()
        self.assertFalse(tick['ok'])
        self.assertEqual(tick['watcher_credential'], 'revoked')
        self.assertEqual(tick['rotation_status'], 'refused')
        self.assertEqual(self.h.rotations, [])
        self.assertEqual(self.h.cookie_requests, [])
        self.assertTrue(self.h.token_file.read_text().strip() == TOKEN, 'nonproduction rotation changed credential')
        self.assert_secret_free()

    def test_rotation_filters_cookie_domain_path_expiry_and_secure(self):
        self.h.enable_rotation()
        self.h.fixture['revoked'] = True
        storage = self.h.home / 'qa-storage.json'
        cookies = json.loads(storage.read_text())['cookies'][:2]
        rotate_path = '/api/mcp/admin/agents/watcher-agent/token'
        cookies += [dict(name='parent', value='parent-fixture', domain='hypertask.ai', path=rotate_path, expires=time.time() + 3600, secure=False)]
        for domain, path, expires in (
                ('qa.hypertask.ai', '/', -1), ('.app.hypertask.ai', '/', -1),
                ('evilhypertask.ai', '/', -1), ('other.example', '/', -1),
                ('app.hypertask.ai', '', -1),
                ('app.hypertask.ai', '/api/mcp/administer', -1),
                ('app.hypertask.ai', rotate_path + '/', -1),
                ('app.hypertask.ai', '/', time.time() - 1),
                ('app.hypertask.ai', '/', 0)):
            cookies.append(dict(name='excluded', value=OTHER_COOKIE, domain=domain, path=path, expires=expires, secure=True))
        storage.write_text(json.dumps(dict(cookies=cookies)))
        self.h.expected_cookies += '; parent=parent-fixture'
        _, tick = self.h.run()
        self.assertTrue(tick['ok'])
        self.assertTrue(tick['token_rotated'])
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(self.h.cookie_requests, [rotate_path])
        self.assert_secret_free()

    def test_rotate_failed_tick_delivers_open_and_pending_incidents(self):
        self.h.enable_rotation()
        self.h.fixture.update(mode='empty', wrong_identity=True, alert_fail=True)
        old = self.h.run()[1]['incident_id']
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.h.run()
        self.h.fixture['mode'] = 'empty'
        new = self.h.run()[1]['incident_id']
        self.assertNotEqual(old, new)
        self.assertEqual(len(self.h.records('.local/state/mcp-contract-watch/state.json')['pending_incidents']), 1)
        self.h.fixture.update(mode='green', revoked=True, rotate_status=403, wrong_identity=False, alert_fail=False)
        _, tick = self.h.run()
        self.assertEqual(tick['watcher_credential'], 'revoked')
        self.assertEqual(tick['incident_id'], new)
        self.assertIsNone(self.h.state()['closed_at'])
        self.assertEqual(len(self.h.records('bugs.json')), 2)
        self.assertTrue(all('[TEST]' not in bug['title'] for bug in self.h.records('bugs.json')))
        alerts = [a for a in self.h.records('alerts.jsonl') if ':rotate-failed:' not in a['id']]
        self.assertEqual({a['id'] for a in alerts}, {'mcp-contract-watch:' + old, 'mcp-contract-watch:' + new})
        self.assertEqual(self.h.state()['create_state'], 'done')
        self.assertEqual(self.h.state()['alert_state'], 'done')
        self.assertEqual(self.h.records('.local/state/mcp-contract-watch/state.json')['pending_incidents'], [])
        self.assert_secret_free()

    def test_revoked_token_rotates_once_then_green_without_incident(self):
        self.h.enable_rotation()
        self.h.fixture['revoked'] = True
        result, tick = self.h.run()
        self.assertEqual(result.returncode, 0)
        self.assertTrue(tick['ok'])
        self.assertTrue(tick['token_rotated'])
        self.assertIsNone(tick['incident_id'])
        self.assertIsNone(self.h.state())
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(len(self.h.requests), 6)
        self.assertTrue(self.h.token_file.read_text().strip() == ROTATED_TOKEN, 'new credential not saved')
        self.assertEqual(self.h.token_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.h.token_file.parent.glob('.token-*')), [])
        self.assertEqual(self.h.records('bugs.json'), [])
        alert = self.h.records('alerts.jsonl')
        self.assertEqual(len(alert), 1)
        self.assertEqual(alert[0]['id'], 'mcp-contract-watch:token-rotated:' + tick['time'])
        self.assertEqual(alert[0]['text'], "Watcher token revoked, MCP fine. The QA account's MCP tokens were revoked (revoke-all), the watcher rotated its own token and the check passed.\n")
        self.assertTrue(self.h.records('.local/state/mcp-contract-watch/ticks.jsonl')[0]['token_rotated'])
        self.h.run()
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_later_first_failure_401_also_rotates(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, revoke_step='tools/call')
        _, tick = self.h.run()
        self.assertTrue(tick['ok'])
        self.assertTrue(tick['token_rotated'])
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assert_secret_free()

    def test_fresh_token_401_is_one_real_incident(self):
        self.h.enable_rotation()
        self.h.fixture['mode'] = '401'
        ticks = [self.h.run()[1] for _ in range(3)]
        self.assertTrue(all(not tick['ok'] and tick['token_rotated'] for tick in ticks))
        self.assertEqual(len(self.h.rotations), 3)
        self.assertEqual(len({tick['incident_id'] for tick in ticks}), 1)
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        failure = self.h.state()['failure']
        self.assertEqual(failure['status'], 401)
        self.assertEqual(failure['reason'], '401 on a freshly rotated token')
        self.assertIn('401 on a freshly rotated token', self.h.records('alerts.jsonl')[0]['text'])
        self.assert_secret_free()

    def test_retry_non401_is_normal_incident(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, mode='500')
        _, tick = self.h.run()
        self.assertFalse(tick['ok'])
        self.assertTrue(tick['token_rotated'])
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(self.h.state()['failure']['status'], 500)
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_failed_rotation_alerts_once_per_day_without_bug(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, rotate_status=401, tick_time='2026-01-01T12:00:00.000000Z')
        clocked = self.h.home / 'clocked-watcher'
        source = self.h.script.read_text()
        old = "return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')"
        self.assertEqual(source.count(old), 1)
        clocked.write_text(source.replace(old, "return json.loads((HOME / 'fixture.json').read_text())['tick_time']"))
        clocked.chmod(0o755)
        self.h.script = clocked
        ticks = [self.h.run()[1] for _ in range(3)]
        self.assertTrue(all(not tick['ok'] and tick['watcher_credential'] == 'revoked' for tick in ticks))
        self.assertTrue(all(tick['incident_id'] is None for tick in ticks))
        self.assertTrue(all(tick['watcher_credential'] == 'revoked' for tick in self.h.records('.local/state/mcp-contract-watch/ticks.jsonl')))
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertIsNone(self.h.state())
        alerts = self.h.records('alerts.jsonl')
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0]['id'], 'mcp-contract-watch:rotate-failed:' + ticks[0]['time'][:10])
        self.assertEqual(alerts[0]['text'], 'Watcher token revoked and could not be rotated (status 401). MCP status unknown; refresh the QA session file and rotate the watcher token.\n')
        self.assertTrue(self.h.token_file.read_text().strip() == TOKEN, 'failed rotation changed credential')
        self.h.fixture['tick_time'] = '2026-01-02T00:00:00.000000Z'
        self.h.run()
        self.h.run()
        alerts = self.h.records('alerts.jsonl')
        self.assertEqual(len(alerts), 2)
        self.assertEqual(alerts[1]['id'], 'mcp-contract-watch:rotate-failed:2026-01-02')
        self.assert_secret_free()

    def test_rotation_missing_token_and_expired_session_do_not_file(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, rotate_no_token=True)
        _, tick = self.h.run()
        self.assertEqual(tick['watcher_credential'], 'revoked')
        self.assertEqual(tick['rotation_status'], 200)
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertTrue(self.h.token_file.read_text().strip() == TOKEN, 'missing token changed credential')
        (self.h.home / 'qa-storage.json').write_text('{')
        _, tick = self.h.run()
        self.assertEqual(tick['watcher_credential'], 'revoked')
        self.assertEqual(tick['rotation_status'], 'refused')
        self.assertEqual(len(self.h.rotations), 1)
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_unknown_credential_status_cannot_close_existing_incident(self):
        self.h.enable_rotation()
        self.h.fixture['mode'] = 'empty'
        self.h.run()
        self.h.fixture['mode'] = 'green'
        self.h.run()
        self.assertEqual(self.h.state()['consecutive_ok'], 1)
        self.h.fixture.update(revoked=True, rotate_status=403)
        for _ in range(2):
            _, tick = self.h.run()
            self.assertEqual(tick['watcher_credential'], 'revoked')
            self.assertEqual(self.h.state()['consecutive_ok'], 0)
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.h.fixture['revoked'] = False
        self.h.run()
        self.assertIsNone(self.h.state()['closed_at'])
        self.h.run()
        self.assertIsNotNone(self.h.state()['closed_at'])
        self.assert_secret_free()

    def test_invalid_storage_cookies_and_missing_file_are_rotation_failures(self):
        self.h.enable_rotation()
        self.h.fixture['revoked'] = True
        storage = self.h.home / 'qa-storage.json'
        for cookies in ([], [dict(domain=42, name='session', value=COOKIE)],
                        [dict(domain='.hypertask.ai', name='session', value=COOKIE + '\r\n')]):
            storage.write_text(json.dumps(dict(cookies=cookies)))
            _, tick = self.h.run()
            self.assertEqual(tick['watcher_credential'], 'revoked')
        storage.unlink()
        _, tick = self.h.run()
        self.assertEqual(tick['watcher_credential'], 'revoked')
        self.assertEqual(self.h.rotations, [])
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_rotate_failed_notice_retries_same_id_until_delivered(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, rotate_status=403, alert_fail_once=True)
        _, tick = self.h.run()
        identifier = 'mcp-contract-watch:rotate-failed:' + tick['time'][:10]
        self.assertIn('notices', self.h.records('.local/state/mcp-contract-watch/state.json'))
        notices = self.h.records('.local/state/mcp-contract-watch/state.json')['notices']
        self.assertFalse(notices[identifier]['delivered'])
        self.h.run()
        self.h.run()
        attempts = self.h.records('alert-attempts.jsonl')
        self.assertEqual([a['id'] for a in attempts], [identifier, identifier])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertTrue(self.h.records('.local/state/mcp-contract-watch/state.json')['notices'][identifier]['delivered'])
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assert_secret_free()

    def test_token_rotated_notice_retries_same_id_on_green_ticks(self):
        self.h.enable_rotation()
        self.h.fixture.update(revoked=True, alert_fail_once=True)
        _, tick = self.h.run()
        identifier = 'mcp-contract-watch:token-rotated:' + tick['time']
        self.assertIn('notices', self.h.records('.local/state/mcp-contract-watch/state.json'))
        self.assertFalse(self.h.records('.local/state/mcp-contract-watch/state.json')['notices'][identifier]['delivered'])
        self.h.run('--dry-run')
        self.assertEqual(len(self.h.records('alert-attempts.jsonl')), 1)
        self.h.run()
        self.h.run()
        self.assertEqual([a['id'] for a in self.h.records('alert-attempts.jsonl')], [identifier, identifier])
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assertEqual(len(self.h.rotations), 1)
        self.assertTrue(self.h.records('.local/state/mcp-contract-watch/state.json')['notices'][identifier]['delivered'])
        self.assertEqual(self.h.records('bugs.json'), [])
        self.assert_secret_free()

    def test_rotation_requires_both_config_fields(self):
        for missing in ('qa_storage_state', 'agent_id'):
            self.h.enable_rotation()
            path = self.h.token_file.with_name('config.json')
            config = json.loads(path.read_text())
            del config[missing]
            path.write_text(json.dumps(config))
            self.h.fixture['mode'] = '401'
            _, tick = self.h.run()
            self.assertFalse(tick['ok'])
            self.assertNotIn('token_rotated', tick)
            self.assertNotIn('watcher_credential', tick)
        self.assertEqual(self.h.rotations, [])
        self.assertEqual(len(self.h.records('bugs.json')), 1)
        self.assertEqual(len(self.h.records('alerts.jsonl')), 1)
        self.assert_secret_free()

    def test_drills_and_dry_runs_never_rotate(self):
        self.h.enable_rotation()
        self.h.fixture['mode'] = '401'
        _, tick = self.h.run('--force-fail', 'initialize')
        self.assertFalse(tick['ok'])
        self.assertTrue(self.h.state(drill=True)['test'])
        _, tick = self.h.run('--dry-run')
        self.assertFalse(tick['ok'])
        self.assertEqual(self.h.rotations, [])
        self.assertTrue(self.h.token_file.read_text().strip() == TOKEN, 'proof changed credential')
        self.assert_secret_free()

    def test_non401_first_failure_never_rotates(self):
        self.h.enable_rotation()
        self.h.fixture['mode'] = '500'
        _, tick = self.h.run()
        self.assertFalse(tick['ok'])
        self.assertEqual(self.h.rotations, [])
        self.assertEqual(len(self.h.records('bugs.json')), 1)

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
        self.assertIn('Bug filing FAILED (state unknown)', self.h.records('alerts.jsonl')[0]['text'])
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
            self.assertIsNone(planned['would_file']['section'])
            self.assertEqual(planned['would_send']['target'], 'ht-product-lead')
        self.assertEqual(self.h.records('commands.jsonl'), [])
        self.assertFalse((self.h.home / '.local/state/mcp-contract-watch/state.json').exists())
        self.h.run('--force-fail', 'tools/list', '--bug-project', '4060')
        creates = [c for c in self.h.records('commands.jsonl') if c['name'] == 'vcc' and c['args'][1] == 'create']
        self.assertEqual(creates[0]['args'][creates[0]['args'].index('--project') + 1], '4060')
        self.assertEqual(self.h.state(drill=True)['bug_project'], 4060)
        self.assertTrue(creates[0]['args'][creates[0]['args'].index('--title') + 1].startswith('[TEST] '))
        alert = self.h.records('alerts.jsonl')[0]['text']
        self.assertTrue(alert.startswith('TEST DRILL, not a real outage.'))
        self.assertIn('Bug filed: https://app.hypertask.ai/detail/project-4060/100', alert)
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
        self.h.env['USER_UNIT_CHECK'] = '/usr/bin/true'
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
        texts = [''.join(self.h.outputs), json.dumps(self.h.records('alerts.jsonl')),
                 json.dumps(self.h.records('alert-attempts.jsonl')), json.dumps(self.h.records('bugs.json')),
                 json.dumps(self.h.records('commands.jsonl'))]
        root = self.h.home / '.local/state/mcp-contract-watch'
        texts.extend(path.read_text() for path in root.rglob('*') if path.is_file())
        self.assertFalse(any(secret in text for secret in (TOKEN, ROTATED_TOKEN, COOKIE, APP_COOKIE, OTHER_COOKIE)
                             for text in texts), 'credential leaked into watcher output, state, or reporting')

    def test_secret_detection_rejects_known_leaks_without_echoing_values(self):
        for secret in (TOKEN, ROTATED_TOKEN, COOKIE, APP_COOKIE, OTHER_COOKIE):
            self.h.outputs.append(secret)
            with self.assertRaises(AssertionError):
                self.assert_secret_free()
            self.h.outputs.pop()
        self.assert_secret_free()


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

if MODE == '--dedupe-probe':
    suite = unittest.TestSuite([WatcherTests('test_three_red_ticks_dedupe_across_restarts')])
elif MODE == '--review-probe':
    suite = unittest.TestSuite(WatcherTests(name) for name in sys.argv[4:])
else:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(WatcherTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    sys.exit(1)
if MODE in ('--dedupe-probe', '--review-probe'):
    print('REGRESSION PROBE PASSED')
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
print('All tests passed: WATCHER TESTS PASSED: ALL PASS')
PY
