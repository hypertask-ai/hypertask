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
if 'sequence' in route:
    counter = root / 'sequence-count'
    count = int(counter.read_text()) if counter.exists() else 0
    counter.write_text(str(count + 1))
    route = route['sequence'][min(count, len(route['sequence']) - 1)]
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
        for target in ('9000000001', URL, URL + '/job/101'):
            with self.subTest(target=target):
                self.assert_diagnosis(self.invoke(target))

    def test_attempt_url_is_refused_not_read_as_latest(self):
        result = self.invoke(URL + '/attempts/1')
        self.assertEqual(result.returncode, 2)
        self.assertIn('attempt URLs are not supported', result.stderr)
        self.assertNotIn('Failed step', result.stdout)

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
                    target = production_run['html_url'] if conclusion == 'success' else '1771'
                    self.assertEqual(result.stdout.splitlines()[-1], f'run ci-why {target} for the failed step')

    def release_routes(self):
        sha = 'a' * 40
        self.routes[f'{BASE}/pulls/1771']['json']['base'] = {'ref': 'production', 'sha': 'c' * 40}
        self.routes[f'{BASE}/branches/production'] = {'json': {'protection': {
            'enabled': True, 'required_status_checks': {
                'checks': [{'context': 'ci-tests', 'app_id': 15368}], 'contexts': ['ci-tests']}}}}
        self.routes[f'{BASE}/rules/branches/production?per_page=100&page=1'] = {'json': [
            {'type': 'required_status_checks', 'parameters': {'required_status_checks': [
                {'context': 'ai-review'}, {'context': 'claude-review'}]}}]}
        self.routes[f'{BASE}/commits/{sha}/statuses?per_page=100&page=1'] = {'json': []}
        self.routes[f'{BASE}/commits/{sha}/check-runs?filter=all&per_page=100&page=1'] = {'json': {
            'check_runs': [{'id': 1, 'name': 'ci-tests', 'head_sha': sha, 'status': 'completed',
                            'conclusion': 'success', 'app': {'id': 15368}, 'html_url': 'https://example.test/ci'}]}}

    def test_release_missing_reviews_despite_green_jobs(self):
        self.release_routes()
        result = self.invoke('1771', '--release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ci-tests app_id=15368 check_run: success https://example.test/ci', result.stdout)
        self.assertIn('ai-review: missing', result.stdout)
        self.assertIn('claude-review: missing', result.stdout)

    def test_release_review_states_and_current_head(self):
        self.release_routes()
        sha = 'a' * 40
        endpoint = f'{BASE}/commits/{sha}/statuses?per_page=100&page=1'
        self.routes[endpoint]['json'] = [
            {'id': 1, 'context': 'ai-review', 'state': 'failure', 'target_url': 'https://example.test/ai'},
            {'id': 2, 'context': 'claude-review', 'state': 'pending', 'target_url': 'https://example.test/claude'},
            {'id': 3, 'context': 'ai-review', 'state': 'success', 'head_sha': 'b' * 40}]
        result = self.invoke('1771', '--release', '--json')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['head'], sha)
        checks = {check['name']: check for check in data['checks']}
        self.assertEqual(checks['ai-review']['state'], 'failure')
        self.assertEqual(checks['ai-review']['url'], 'https://example.test/ai')
        self.assertEqual(checks['claude-review']['state'], 'pending')
        self.routes[endpoint]['json'][0]['state'] = 'success'
        self.routes[endpoint]['json'][1]['state'] = 'success'
        result = self.invoke('1771', '--release', '--json')
        self.assertTrue(all(check['state'] == 'success' for check in json.loads(result.stdout)['checks']))
        self.assertTrue(any(f'/commits/{sha}/statuses?' in call[1] for call in self.calls()))

    def test_release_pinned_apps_and_api_failure(self):
        self.release_routes()
        rules = self.routes[f'{BASE}/rules/branches/production?per_page=100&page=1']['json']
        rules[0]['parameters']['required_status_checks'][0]['integration_id'] = 42
        endpoint = f'{BASE}/commits/{"a" * 40}/statuses?per_page=100&page=1'
        self.routes[endpoint]['json'] = [{'id': 1, 'context': 'ai-review', 'state': 'success',
                                          'target_url': 'https://example.test/ai'}]
        for state in ('failure', 'pending', 'success'):
            with self.subTest(state=state):
                self.routes[endpoint]['json'][0]['state'] = state
                result = self.invoke('1771', '--release', '--json')
                checks = {check['name']: check for check in json.loads(result.stdout)['checks']}
                self.assertEqual(checks['ai-review']['state'], state)
                self.assertIs(checks['ai-review']['app_verified'], False)
                self.assertIs(checks['ci-tests']['app_verified'], True)
                self.assertIsNone(checks['claude-review']['app_verified'])
                result = self.invoke('1771', '--release')
                self.assertIn(f'ai-review app_id=42 status: {state} https://example.test/ai (app pin unverified)', result.stdout)
        self.routes[endpoint]['json'][0]['app'] = {'id': 43}
        result = self.invoke('1771', '--release', '--json')
        check = json.loads(result.stdout)['checks'][0]
        self.assertEqual(check['state'], 'missing')
        self.assertIs(check['app_verified'], False)
        self.routes[endpoint] = {'error': 'gh: unavailable (HTTP 503)'}
        result = self.invoke('1771', '--release', '--json')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        self.assertIn('cannot read GitHub API', result.stderr)

    def test_release_unknown_classic_still_reports_rules(self):
        self.release_routes()
        self.routes[f'{BASE}/branches/production']['json']['protection'].pop('required_status_checks')
        result = self.invoke('1771', '--release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('classic protection requirements unknown', result.stdout)
        self.assertIn('ai-review: missing', result.stdout)
        self.assertNotIn('no required checks', result.stdout)
        self.assertFalse(any('/protection/required_status_checks' in call[1] for call in self.calls()))

    def test_release_no_rules_and_unknown_classic(self):
        self.release_routes()
        self.routes[f'{BASE}/rules/branches/production?per_page=100&page=1']['json'] = []
        protection = self.routes[f'{BASE}/branches/production']['json']['protection']
        protection['enabled'] = False
        result = self.invoke('1771', '--release')
        self.assertIn('no required checks', result.stdout)
        protection['enabled'] = True
        protection.pop('required_status_checks')
        result = self.invoke('1771', '--release')
        self.assertIn('classic protection requirements unknown', result.stdout)
        self.assertNotIn('no required checks', result.stdout)

    def test_release_rerun_selection_and_unpinned_success(self):
        self.release_routes()
        sha = 'a' * 40
        protection = self.routes[f'{BASE}/branches/production']['json']['protection']
        protection['required_status_checks']['checks'] = [{'context': 'ci-tests'}]
        runs = self.routes[f'{BASE}/commits/{sha}/check-runs?filter=all&per_page=100&page=1']['json']['check_runs']
        runs[0].update(id=20, created_at='2026-01-01T00:00:00Z')
        runs.append(dict(runs[0], id=19, created_at='2026-02-01T00:00:00Z', conclusion='failure'))
        result = self.invoke('1771', '--release', '--json')
        checks = json.loads(result.stdout)['checks']
        self.assertEqual(next(c for c in checks if c['name'] == 'ci-tests')['state'], 'success')

    def test_release_paginates_rules_and_check_runs(self):
        self.release_routes()
        rules = f'{BASE}/rules/branches/production?per_page=100&page='
        self.routes[rules + '1']['json'] = [{'type': 'other'}] * 100
        self.routes[rules + '2'] = {'json': [{'type': 'required_status_checks', 'parameters': {
            'required_status_checks': [{'context': 'extra'}]}}]}
        runs = f'{BASE}/commits/{"a" * 40}/check-runs?filter=all&per_page=100&page='
        original = self.routes[runs + '1']['json']['check_runs']
        self.routes[runs + '1']['json']['check_runs'] = [dict(original[0], name='other')] * 100
        self.routes[runs + '2'] = {'json': {'check_runs': original}}
        result = self.invoke('1771', '--release')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('extra: missing', result.stdout)
        self.assertIn('ci-tests app_id=15368 check_run: success', result.stdout)

    def test_release_warns_if_head_or_base_changes(self):
        for field in ('head', 'base', 'base_sha'):
            with self.subTest(field=field):
                self.release_routes()
                endpoint = f'{BASE}/pulls/1771'
                first = self.routes[endpoint]['json']
                second = json.loads(json.dumps(first))
                if field == 'head':
                    second['head']['sha'] = 'b' * 40
                elif field == 'base':
                    second['base']['ref'] = 'other'
                else:
                    second['base']['sha'] = 'd' * 40
                self.routes[endpoint] = {'sequence': [{'json': first}, {'json': second}]}
                (self.root / 'sequence-count').unlink(missing_ok=True)
                result = self.invoke('1771', '--release', '--json')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('changed during reads', json.loads(result.stdout)['warnings'][0])
                self.routes[endpoint] = {'json': first}

    def calls(self):
        return [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]


if __name__ == '__main__':
    unittest.main(verbosity=2)
