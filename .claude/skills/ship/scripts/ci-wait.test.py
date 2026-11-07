#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('ci-wait')
A, B = 'a' * 40, 'b' * 40
GREEN = {'name': 'CI', 'status': 'COMPLETED', 'conclusion': 'SUCCESS'}
RED = {'name': 'CI', 'status': 'COMPLETED', 'conclusion': 'FAILURE'}
PENDING = {'name': 'Lint', 'status': 'IN_PROGRESS', 'conclusion': None}


def response(head=A, nodes=None, state='OPEN', truncated=False, oid=A):
    contexts = {'nodes': nodes, 'pageInfo': {'hasNextPage': truncated}}
    return {'data': {'repository': {
        'pullRequest': {'state': state, 'headRefOid': head},
        'object': {'oid': oid, 'statusCheckRollup': {'contexts': contexts}} if oid else None,
    }}}


class WaiterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'gh').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['FIXTURE'])
with (p / 'calls').open('a') as f: f.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1:3] == ['pr', 'view']:
    print(json.dumps({'headRefName': 'branch', 'headRefOid': os.environ['INITIAL']}))
elif sys.argv[1:3] == ['api', '--paginate'] and any('/actions/runs?' in arg for arg in sys.argv):
    print(json.dumps([{'workflow_runs': []}]))
else:
    n = int((p / 'count').read_text()) if (p / 'count').exists() else 0
    (p / 'count').write_text(str(n + 1))
    replies = json.loads((p / 'replies').read_text())
    print(json.dumps(replies[min(n, len(replies) - 1)]))
''')
        (self.root / 'gh').chmod(0o755)
        (self.root / 'sleep').write_text('''#!/bin/sh
mkdir -p "$GH_NOTIFY_DIR/owner__repo"
printf '%s' x > "$GH_NOTIFY_DIR/owner__repo/branch.json"
''')
        (self.root / 'sleep').chmod(0o755)

    def run_waiter(self, replies, *args, initial=A, timeout=0, default_head=True):
        (self.root / 'replies').write_text(json.dumps(replies))
        (self.root / 'count').unlink(missing_ok=True)
        env = dict(os.environ, FIXTURE=str(self.root), INITIAL=initial,
                   CI_WAIT_GH=str(self.root / 'gh'), GH_NOTIFY_DIR=str(self.root / 'notify'),
                   CI_WAIT_GAP='0', CI_WAIT_TICK='0', PATH=str(self.root) + ':' + os.environ['PATH'])
        head_args = ['--head', A] if default_head else []
        return subprocess.run([str(SCRIPT), '1', '--repo', 'owner/repo', '--timeout', str(timeout), *head_args, *args],
                              env=env, text=True, capture_output=True, timeout=10)

    def test_current_results(self):
        for nodes, code in [([GREEN], 0), ([RED], 1), ([PENDING, RED], 1), ([PENDING], 2),
                            ([{**GREEN, 'conclusion': 'SKIPPED'}], 0),
                            ([{**GREEN, 'conclusion': 'CANCELLED'}], 1),
                            ([{'context': 'legacy', 'state': 'SUCCESS'}], 0),
                            ([{'context': 'legacy', 'state': 'FAILURE'}], 1)]:
            with self.subTest(nodes=nodes):
                result = self.run_waiter([response(nodes=nodes)])
                self.assertEqual(result.returncode, code)
                if nodes == [RED]:
                    self.assertIn('CI (failure)', result.stdout)

    def test_mismatch_and_incomplete_never_decide(self):
        cases = [response(head=B, nodes=[RED]), response(head=B, nodes=[GREEN]),
                 response(nodes=[]), response(nodes=None), response(nodes=[RED], truncated=True),
                 response(nodes=[GREEN], truncated=True), response(nodes=[RED], oid=None),
                 response(nodes=[RED, None]), response(nodes=[RED], oid=B)]
        absent = response(nodes=[GREEN])
        absent['data']['repository']['object']['statusCheckRollup'] = None
        cases.append(absent)
        for value in cases:
            with self.subTest(value=value):
                self.assertEqual(self.run_waiter([value]).returncode, 2)

    def test_state_and_errors(self):
        for value, code in [(response(head=B, state='MERGED'), 0),
                            (response(head=B, state='CLOSED'), 1),
                            ({'errors': [{'message': 'bad'}], **response(nodes=[GREEN])}, 2),
                            ({'data': None}, 2)]:
            with self.subTest(value=value):
                self.assertEqual(self.run_waiter([value]).returncode, code)

    def test_missing_head_never_reads_github(self):
        result = self.run_waiter([], default_head=False)
        self.assertEqual(result.returncode, 3)
        self.assertFalse((self.root / 'calls').exists())

    def test_stale_initial_and_rollup_do_not_override_expected_head(self):
        for nodes in ([RED], [GREEN]):
            with self.subTest(nodes=nodes):
                result = self.run_waiter([response(head=A, oid=A, nodes=nodes)], '--head', B, initial=A)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_head_argument_is_explicit(self):
        for head in ['', 'a' * 39, 'z' * 40, 'a' * 41]:
            with self.subTest(head=head):
                self.assertEqual(self.run_waiter([], '--head', head).returncode, 3)
        self.assertFalse((self.root / 'calls').exists())
        self.assertEqual(self.run_waiter([response(head=B, oid=B, nodes=[GREEN])], '--head', B.upper()).returncode, 0)
        calls = [call for line in (self.root / 'calls').read_text().splitlines()
                 if (call := json.loads(line))[:2] == ['api', 'graphql']]
        self.assertTrue(calls)
        self.assertIn('head=' + B, calls[-1])
        (self.root / 'calls').unlink()
        self.assertEqual(self.run_waiter([response(nodes=[GREEN])], initial=A).returncode, 0)
        calls = [call for line in (self.root / 'calls').read_text().splitlines()
                 if (call := json.loads(line))[:2] == ['api', 'graphql']]
        self.assertTrue(calls)
        self.assertIn('head=' + A, calls[-1])

    def test_head_change_does_not_adopt_new_commit(self):
        replies = [response(nodes=[PENDING]), response(head=B, oid=B, nodes=[GREEN]),
                   response(head=A, oid=A, nodes=[RED])]
        result = self.run_waiter(replies, timeout=4)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        calls = [json.loads(line) for line in (self.root / 'calls').read_text().splitlines() if 'graphql' in line]
        self.assertGreaterEqual(len(calls), 3)
        self.assertTrue(all('head=' + A in call for call in calls))


if __name__ == '__main__':
    unittest.main()
