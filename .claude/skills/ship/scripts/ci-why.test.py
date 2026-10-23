#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
REPO = 'hypertask-ai/hypertask'
BASE = f'repos/{REPO}'
URL = f'https://github.com/{REPO}/actions/runs/9000000001'
ADVICE = "Fix the failed step above; a credential or secret is only the cause if the failed step's own error names it."
TOKEN = '::error::HYPERTASK_MCP_TOKEN missing'
HEADING = 'Not the failure (from passing steps)'


def step(number, name, conclusion, start, end):
    return {'number': number, 'name': name, 'conclusion': conclusion,
            'started_at': f'2026-10-22T00:00:{start:02d}Z',
            'completed_at': f'2026-10-22T00:00:{end:02d}Z'}


class CiWhyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.env = dict(os.environ, HOME=str(self.root), CI_WHY_FIXTURES=str(self.root),
                        PATH=f'{self.root}:{os.environ["PATH"]}')
        gh = self.root / 'gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['CI_WHY_FIXTURES'])
args = sys.argv[1:]
with (root / 'calls').open('a') as log:
    log.write(json.dumps(args) + '\\n')
assert args[0] == 'api' and args[2:] in ([], ['--paginate'], ['--jq', '.head.sha']), args
route = json.loads((root / 'routes').read_text()).get(args[1])
if route is None:
    sys.exit('unexpected GitHub API read: ' + args[1])
if 'error' in route:
    sys.exit(route['error'])
if args[2:] == ['--jq', '.head.sha']:
    print(route['json']['head']['sha'])
else:
    print(route['raw'] if 'raw' in route else json.dumps(route['json']))
''')
        gh.chmod(0o755)
        self.steps = [step(1, 'Set up job', 'success', 0, 1),
                      step(2, 'Run actions/checkout@fixture', 'success', 1, 2),
                      step(3, 'Skipped', 'skipped', 2, 2),
                      step(4, 'Offline fixture checks', 'success', 2, 4),
                      step(5, 'Test full suite', 'failure', 4, 9),
                      step(6, 'Post cleanup', 'success', 9, 10)]
        self.log = '\n'.join([
            '2026-10-22T00:00:00.1Z Set up runner',
            '2026-10-22T00:00:01.1Z ##[group]Run actions/checkout@fixture',
            '2026-10-22T00:00:01.2Z ##[endgroup]',
            '2026-10-22T00:00:02.1Z ##[group]Run python3 fixture.py',
            '2026-10-22T00:00:02.2Z ##[endgroup]',
            f'2026-10-22T00:00:03.1Z {TOKEN}',
            '2026-10-22T00:00:03.2Z ##[error]fake passing fixture annotation',
            '2026-10-22T00:00:03.3Z test at tests/passing-fixture.test.cjs:99:1',
            '2026-10-22T00:00:04.1Z ##[group]Run npm test',
            '2026-10-22T00:00:04.2Z ##[endgroup]',
            '2026-10-22T00:00:05.1Z ##[group]nested test output',
            '2026-10-22T00:00:05.2Z ##[group]Run nested fake command',
            '2026-10-22T00:00:05.3Z ##[endgroup]',
            '2026-10-22T00:00:05.4Z ##[endgroup]',
            *[f'2026-10-22T00:00:06.1Z test at tests/real-{n}.test.cjs:{40+n}:1' for n in range(6)],
            '2026-10-22T00:00:06.2Z   AssertionError: actual test assertion',
            '2026-10-22T00:00:09.1Z ##[error]Process completed with exit code 1.',
            '2026-10-22T00:00:09.2Z ##[group]Post cleanup',
            '2026-10-22T00:00:09.3Z ##[endgroup]',
            '2026-10-22T00:00:09.4Z ##[error]cleanup fake annotation',
        ])
        self.job = {'id': 101, 'name': 'ci-tests', 'html_url': URL + '/job/101',
                    'conclusion': 'failure', 'steps': self.steps}
        self.run = {'id': 9000000001, 'name': 'CI Tests', 'workflow_id': 11, 'run_attempt': 1}
        self.routes = {
            f'{BASE}/pulls/1771': {'json': {'head': {'sha': 'a' * 40}}},
            f'{BASE}/pulls/9000000001': {'error': 'gh: Not Found (HTTP 404)'},
            f'{BASE}/actions/runs/9000000001': {'json': self.run},
            f'{BASE}/actions/runs?head_sha={"a" * 40}&per_page=100&page=1': {'json': {'workflow_runs': [self.run]}},
            f'{BASE}/actions/runs/9000000001/jobs?filter=latest&per_page=100&page=1': {'json': {'jobs': [self.job]}},
            f'{BASE}/actions/jobs/101/logs': {'raw': self.log},
        }

    def invoke(self, target='1771', *args):
        (self.root / 'routes').write_text(json.dumps(self.routes))
        return subprocess.run([str(HERE / 'ci-why'), target, *args], env=self.env,
                              capture_output=True, text=True, timeout=15)

    def assert_diagnosis(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ci-tests (failure)', result.stdout)
        self.assertIn(URL + '/job/101', result.stdout)
        self.assertIn('Failed step 5: Test full suite', result.stdout)
        for n in range(6):
            self.assertIn(f'tests/real-{n}.test.cjs:{40+n}:1', result.stdout)
        before, after = result.stdout.split(HEADING, 1)
        self.assertNotIn('HYPERTASK_MCP_TOKEN', before)
        self.assertIn(TOKEN, after)
        self.assertEqual(result.stdout.count(TOKEN), 1)
        self.assertNotIn('tests/passing-fixture.test.cjs', result.stdout)
        self.assertIn('##[error]Process completed with exit code 1.', before)
        self.assertIn('##[error]cleanup fake annotation', after)
        self.assertEqual(result.stdout.splitlines()[-1], ADVICE)

    def test_pr_names_failed_step_and_all_real_tests_not_passing_annotations(self):
        self.assert_diagnosis(self.invoke())

    def test_empty_output_is_rejected_by_the_behavioral_oracle(self):
        with self.assertRaises(AssertionError):
            self.assert_diagnosis(subprocess.CompletedProcess([], 0, '', ''))

    def test_run_id_and_url(self):
        for target in ('9000000001', URL):
            with self.subTest(target=target):
                self.assert_diagnosis(self.invoke(target))

    def test_json_separates_passing_annotations(self):
        result = self.invoke('1771', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        finding = data['jobs'][0]
        self.assertEqual(finding['failed_step'], {'name': 'Test full suite', 'number': 5})
        self.assertIn('tests/real-5.test.cjs:45:1', finding['failures'])
        self.assertNotIn(TOKEN, finding['failures'] + '\n'.join(finding['errors']))
        self.assertIn(TOKEN, finding['passing_step_annotations'][0]['annotations'])
        self.assertEqual(data['advice'], ADVICE)

    def test_no_failed_jobs(self):
        self.job['conclusion'] = 'success'
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'no failed jobs\n')
        self.assertFalse(any('/logs' in call[1] for call in self.calls()))

    def test_cancelled_job_does_not_invent_a_failed_step(self):
        self.job['conclusion'] = 'cancelled'
        self.steps[4]['conclusion'] = 'cancelled'
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ci-tests (cancelled)', result.stdout)
        self.assertIn('No step concluded failure', result.stdout)
        self.assertNotIn('tests/real-', result.stdout)
        self.assertNotIn('Failed step 5', result.stdout)

    def test_first_failure_by_step_number_wins(self):
        self.steps[3]['conclusion'] = 'failure'
        self.job['steps'] = list(reversed(self.steps))
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Failed step 4: Offline fixture checks', result.stdout)
        self.assertNotIn('tests/real-', result.stdout)
        self.assertNotIn('Step 4: Offline fixture checks', result.stdout)

    def test_unreadable_api_and_logs_exit_two(self):
        for endpoint in (f'{BASE}/pulls/1771', f'{BASE}/actions/jobs/101/logs'):
            with self.subTest(endpoint=endpoint):
                previous = self.routes[endpoint]
                self.routes[endpoint] = {'error': 'gh: unavailable (HTTP 503)'}
                result = self.invoke()
                self.assertEqual(result.returncode, 2)
                self.assertIn('cannot read GitHub API', result.stderr)
                self.assertIn(endpoint, result.stderr)
                self.assertEqual(result.stdout, '')
                self.routes[endpoint] = previous

    def test_malformed_api_is_not_no_failed_jobs(self):
        self.routes[f'{BASE}/pulls/1771'] = {'raw': 'not JSON'}
        result = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertIn('invalid JSON', result.stderr)

    def test_latest_run_per_workflow_not_only_latest_overall(self):
        endpoint = f'{BASE}/actions/runs?head_sha={"a" * 40}&per_page=100&page=1'
        older = dict(self.run, id=9000000000)
        other = dict(self.run, id=9000000002, workflow_id=12)
        self.routes[endpoint] = {'json': {'workflow_runs': [other, older, self.run]}}
        self.routes[f'{BASE}/actions/runs/9000000002/jobs?filter=latest&per_page=100&page=1'] = {'json': {'jobs': []}}
        self.assert_diagnosis(self.invoke())
        self.assertFalse(any('/9000000000/' in call[1] for call in self.calls()))

    def test_jobs_are_paginated(self):
        endpoint = f'{BASE}/actions/runs/9000000001/jobs?filter=latest&per_page=100&page='
        self.routes[endpoint + '1'] = {'json': {'jobs': [dict(self.job, conclusion='success')] * 100}}
        self.routes[endpoint + '2'] = {'json': {'jobs': [self.job]}}
        self.assert_diagnosis(self.invoke())

    def test_boundaries_work_without_timestamps(self):
        self.routes[f'{BASE}/actions/jobs/101/logs']['raw'] = '\n'.join(line.split('Z ', 1)[1] for line in self.log.splitlines())
        self.assert_diagnosis(self.invoke())

    def test_post_cleanup_boundary_with_an_unrelated_group_title(self):
        self.routes[f'{BASE}/actions/jobs/101/logs']['raw'] = self.log.replace(
            '##[group]Post cleanup', 'Post job cleanup.\n2026-10-22T00:00:09.25Z ##[group]Logout from ghcr.io')
        self.assert_diagnosis(self.invoke())

    def test_tap_locations_reuse_the_shared_parser(self):
        self.routes[f'{BASE}/actions/jobs/101/logs']['raw'] = self.log.replace(
            'test at tests/real-0.test.cjs:40:1',
            "not ok 1 - actual failure\n2026-10-22T00:00:06.15Z   location: '/home/runner/tests/tap.test.cjs:42:1'")
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('tests/tap.test.cjs:42:1', result.stdout)

    def test_repo_override_is_used_for_every_api_read(self):
        other = 'hypertask-ai/fixture'
        self.routes = {key.replace(REPO, other): value for key, value in self.routes.items()}
        self.assert_diagnosis(self.invoke('1771', '--repo', other))
        self.assertTrue(all(call[1].startswith(f'repos/{other}/') for call in self.calls()))

    def test_mismatched_run_url_fails_clearly(self):
        result = self.invoke(URL, '--repo', 'hypertask-ai/fixture')
        self.assertEqual(result.returncode, 2)
        self.assertIn(f'use --repo {REPO}', result.stderr)

    def test_ship_check_preserves_summaries_and_adds_diagnostic_hint(self):
        head_run = {'id': 101, 'name': 'ci-tests', 'html_url': URL + '/job/101',
                    'status': 'completed', 'conclusion': 'failure', 'started_at': '2026-10-22T00:00:00Z'}
        production_run = dict(head_run, id=102, conclusion='success', started_at='2026-10-22T01:00:00Z')
        self.routes[f'{BASE}/commits/{"a" * 40}/check-runs?per_page=100&filter=all'] = {'json': {'check_runs': [head_run]}}
        self.routes[f'{BASE}/commits/production/check-runs?per_page=100&filter=all'] = {'json': {'check_runs': [production_run]}}
        self.routes[f'{BASE}/actions/jobs/102/logs'] = {'raw': 'not ok 1 - production assertion'}
        for conclusion, production, expected in (
            ('failure', 'success', 'production ci-tests is green, so this PR broke it'),
            ('success', 'failure', 'passed before that on an older production; rerun ci-tests on head aaaaaaa'),
            ('success', 'success', 'ci-tests ok'),
        ):
            with self.subTest(head=conclusion, production=production):
                head_run['conclusion'] = conclusion
                production_run['conclusion'] = production
                (self.root / 'routes').write_text(json.dumps(self.routes))
                result = subprocess.run([str(HERE / 'ship-check'), 'ci-tests', '1771'],
                                        env=dict(self.env, SHIP_REPO=REPO, SHIP_BASE='production',
                                                 VCC_EVIDENCE_DIR=str(self.root / 'evidence')),
                                        capture_output=True, text=True, timeout=15)
                self.assertIn(expected, result.stdout)
                if conclusion == production == 'success':
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, 'ci-tests ok\n')
                else:
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertTrue(result.stdout.startswith('FAIL: '), result.stdout)
                    self.assertEqual(result.stdout.splitlines()[-1], 'run ci-why 1771 for the failed step')

    def calls(self):
        return [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]


if __name__ == '__main__':
    unittest.main(verbosity=2)
