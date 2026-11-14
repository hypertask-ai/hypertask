import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name('pr-drain-pick')


class PickerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.claims = self.home / '.local/state/pr-drain/claims'
        self.env = dict(os.environ, HOME=str(self.home), SHIP_SESSION_NAME='RUNNER 16',
                        PATH=f'{self.bin}:/usr/bin:/bin')
        self.env.pop('SHIP_APP_FREEZE', None)
        self.env.pop('SHIP_FREEZE_FILE', None)
        self.env.pop('FLEET_PICK_STATE', None)
        self.command('gh-app-token', 'printf fixture-token')
        self.command('gh', '''
[ "$GH_TOKEN" = fixture-token ] || exit 99
printf '%s\n' "$*" > "$HOME/gh-args"
cat "$HOME/prs.json"
''')
        self.prs = []

    def command(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def pr(self, number, *, hours=8, draft=True, branch=None, checks=None, title=None):
        return dict(number=number, title=title or f'HTPR-{number} [BUGFIX] Example', isDraft=draft,
                    headRefName=branch or f'runner-1/htpr-{number}',
                    updatedAt=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat(),
                    statusCheckRollup=checks or [])

    def freeze(self):
        path = self.home / '.local/state/ht-or-runners/app-freeze'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('')
        return path

    def ci_pr(self, number, *, hours=2):
        return self.pr(number, hours=hours, title=f'HYCI-{number} [INFRA] Build once per change',
                       branch=f'runner2/hyci-{number}')

    def owner(self, number, runner='RUNNER 7', hours=1):
        path = self.claims / str(number)
        path.mkdir(parents=True, exist_ok=True)
        owner = path / 'owner'
        owner.write_text(f'{runner}\t{(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat()}')
        return owner

    def pick(self, *args):
        (self.home / 'prs.json').write_text(json.dumps(self.prs))
        return subprocess.run(['python3', str(SCRIPT), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_app_drafts_before_dependencies_then_stalled_red(self):
        self.prs = [self.pr(4, draft=False, hours=20, checks=[{'state': 'FAILURE'}]),
                    self.pr(3, hours=24, branch='dependabot/npm_and_yarn/library'),
                    self.pr(2, hours=9), self.pr(1, hours=8)]
        expected = [2, 1, 3, 4]
        for number in expected:
            result = self.pick()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.startswith(f'PR {number} '), result.stdout)
            self.assertTrue((self.claims / str(number) / 'owner').read_text().startswith('RUNNER 16\t'))
            self.prs = [pr for pr in self.prs if pr['number'] != number]
        self.assertEqual(self.pick().stdout, 'NONE\n')
        self.assertIn('--base production --state open --limit 1000', (self.home / 'gh-args').read_text())

    def test_ci_runner_prs_are_never_app_runner_queue_work(self):
        self.prs = [self.pr(1, hours=8, branch='ci-runner-2/htpr-1'),
                    self.pr(2, hours=20, draft=False, branch='ci-runner-3/htpr-2',
                            checks=[{'state': 'FAILURE'}]),
                    self.pr(3, hours=9)]
        self.assertEqual(self.pick().stdout.split()[1], '3')
        self.assertFalse((self.claims / '1').exists())
        self.assertFalse((self.claims / '2').exists())
        self.prs = [self.pr(1, hours=8, branch='ci-runner-2/htpr-1')]
        self.owner(1, runner='RUNNER 16', hours=4)
        self.assertEqual(self.pick().stdout, 'NONE\n')

    def test_active_and_claimed_drafts_wait_without_allowing_new_tickets(self):
        self.prs = [self.pr(1, hours=1), self.pr(2)]
        owner = self.owner(2)
        before = owner.read_text()
        result = self.pick()
        self.assertEqual((result.returncode, result.stdout), (0, 'WAIT\n'))
        self.assertEqual(owner.read_text(), before)
        self.assertFalse((self.claims / '1').exists())

    def test_owned_ready_pr_finishes_before_any_new_draft(self):
        self.prs = [self.pr(1, hours=20), self.pr(2, hours=0, draft=False)]
        self.owner(2, runner='RUNNER 16')
        result = self.pick()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('PR 2 '), result.stdout)
        self.assertFalse((self.claims / '1').exists())

    def test_stale_claim_replaced_and_own_active_claim_renewed(self):
        self.prs = [self.pr(1)]
        owner = self.owner(1, hours=4)
        self.assertTrue(self.pick().stdout.startswith('PR 1 '))
        self.assertTrue(owner.read_text().startswith('RUNNER 16\t'))
        before = owner.read_text()
        self.prs = [self.pr(1, hours=0)]
        self.assertTrue(self.pick().stdout.startswith('PR 1 '))
        self.assertNotEqual(owner.read_text(), before)

    def test_dry_run_does_not_claim_or_replace(self):
        self.prs = [self.pr(1)]
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))
        self.assertFalse((self.claims / '1').exists())
        owner = self.owner(1, hours=4)
        before = owner.read_text()
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))
        self.assertEqual(owner.read_text(), before)

    def test_fresh_red_green_and_pending_are_not_queue_work(self):
        self.prs = [self.pr(1, hours=1, draft=False, checks=[{'state': 'FAILURE'}]),
                    self.pr(2, draft=False, checks=[{'conclusion': 'SUCCESS'}]),
                    self.pr(3, draft=False, checks=[{'status': 'IN_PROGRESS'}])]
        self.assertEqual(self.pick().stdout, 'NONE\n')
        for check in [{'conclusion': 'FAILURE'}, {'conclusion': 'TIMED_OUT'}, {'state': 'ERROR'}]:
            self.prs = [self.pr(4, draft=False, checks=[check])]
            self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 4 '))

    def snapshot(self, prs=None, age=0):
        prs = prs if prs is not None else [dict(number=1, title='HTPR-1 [BUGFIX] Example',
            branch='runner-1/htpr-1', updated=self.pr(1)['updatedAt'], draft=True, red=False)]
        path = self.home / '.local/state/fleet-pick/open-prs.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(dict(at=time.time() - age, prs=prs)))
        return path

    def test_shared_snapshot_avoids_a_second_github_read(self):
        self.snapshot()
        self.command('gh', 'exit 99')
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))
        self.assertFalse((self.home / 'gh-args').exists())

    def test_shared_empty_snapshot_is_complete(self):
        self.snapshot([])
        self.command('gh', 'exit 99')
        self.assertEqual(self.pick().stdout, 'NONE\n')

    def test_shared_red_and_green_preserve_queue_ranking(self):
        self.snapshot([dict(number=n, title=f'HTPR-{n} [BUGFIX] Example', branch=f'runner1/htpr-{n}',
                            updated=self.pr(n)['updatedAt'], draft=False, red=(n == 2)) for n in [1, 2]])
        self.command('gh', 'exit 99')
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 2 '))

    def test_stale_future_and_malformed_snapshots_require_live_read(self):
        for age in [121, -60]:
            self.snapshot(age=age)
            self.assertEqual(self.pick().stdout, 'NONE\n')
        for invalid in ['bad', '{}', '{"at":0,"prs":{}}']:
            self.snapshot().write_text(invalid)
            self.assertEqual(self.pick().stdout, 'NONE\n')
        for field, value in [('red', None), ('number', '1'), ('updated', 'invalid')]:
            path = self.snapshot()
            data = json.loads(path.read_text())
            data['prs'][0][field] = value
            path.write_text(json.dumps(data))
            self.assertEqual(self.pick().stdout, 'NONE\n')
        self.assertTrue((self.home / 'gh-args').exists())

    def test_duplicate_snapshot_prs_require_live_read(self):
        path = self.snapshot()
        data = json.loads(path.read_text())
        data['prs'] *= 2
        path.write_text(json.dumps(data))
        self.assertEqual(self.pick().stdout, 'NONE\n')
        self.assertTrue((self.home / 'gh-args').exists())

    def test_shared_snapshot_state_override(self):
        path = self.snapshot()
        target = self.home / 'custom-state'
        target.mkdir()
        path.rename(target / path.name)
        self.env['FLEET_PICK_STATE'] = str(target)
        self.command('gh', 'exit 99')
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))

    def test_failed_or_empty_auth_never_calls_github(self):
        for command in ['exit 1', 'exit 0']:
            self.command('gh-app-token', command)
            result = self.pick()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(result.stdout, ['NONE\n', 'WAIT\n'])
            self.assertFalse((self.home / 'gh-args').exists())

    def test_unreadable_github_or_claim_state_fails_closed(self):
        for body in ['exit 1', 'echo invalid', 'echo "{}"']:
            self.command('gh', body)
            result = self.pick()
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
        self.command('gh', 'cat "$HOME/prs.json"')
        self.prs = [self.pr(1)]
        owner = self.owner(1)
        for malformed in ['bad', 'RUNNER 7\tbad']:
            owner.write_text(malformed)
            self.assertNotEqual(self.pick().returncode, 0)
            self.assertEqual(owner.read_text(), malformed)
        owner.unlink()
        self.assertNotEqual(self.pick().returncode, 0)

    def test_truncated_result_is_not_treated_as_complete(self):
        self.prs = [self.pr(number) for number in range(1000)]
        self.assertNotEqual(self.pick().returncode, 0)
        self.assertFalse(self.claims.exists())

    def test_concurrent_runners_receive_different_prs(self):
        self.prs = [self.pr(1), self.pr(2)]
        (self.home / 'prs.json').write_text(json.dumps(self.prs))
        processes = [subprocess.Popen(['python3', str(SCRIPT)],
                                     env=dict(self.env, SHIP_SESSION_NAME=f'RUNNER {number}'),
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                     for number in [16, 17]]
        outputs = [process.communicate(timeout=10)[0] for process in processes]
        self.assertEqual([process.returncode for process in processes], [0, 0])
        self.assertEqual({output.split()[1] for output in outputs}, {'1', '2'})
        owners = {(self.claims / str(number) / 'owner').read_text().split('\t')[0] for number in [1, 2]}
        self.assertEqual(owners, {'RUNNER 16', 'RUNNER 17'})

    def test_interrupted_publication_never_exposes_partial_owner(self):
        self.prs = [self.pr(1)]
        (self.home / 'prs.json').write_text(json.dumps(self.prs))
        for existing in [False, True]:
            with self.subTest(existing=existing):
                owner = self.owner(1, hours=4) if existing else self.claims / '1/owner'
                before = owner.read_text() if existing else None
                injection = """
from pathlib import Path
import runpy
import sys
original = Path.write_text
def broken(self, text, *args, **kwargs):
    if self.name == 'owner':
        original(self, 'partial')
        raise OSError('fixture interrupted write')
    return original(self, text, *args, **kwargs)
Path.write_text = broken
script = sys.argv[1]
sys.argv = [script]
runpy.run_path(script, run_name='__main__')
"""
                result = subprocess.run(['python3', '-c', injection, str(SCRIPT)], env=self.env,
                                        capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                if existing:
                    self.assertEqual(owner.read_text(), before)
                else:
                    self.assertFalse(owner.parent.exists())
                self.assertEqual(list(self.claims.glob('.claim-*')), [])
                self.assertTrue(self.pick().stdout.startswith('PR 1 '))
                self.assertTrue(owner.read_text().startswith('RUNNER 16\t'))

    def test_identity_and_arguments_are_required(self):
        self.assertNotEqual(self.pick('--unknown').returncode, 0)
        self.env.pop('SHIP_SESSION_NAME')
        self.assertNotEqual(self.pick().returncode, 0)
        self.assertFalse((self.home / 'gh-args').exists())

    def test_freeze_offers_only_idle_ci_fix_prs(self):
        self.freeze()
        self.prs = [self.pr(1, hours=9), self.pr(2, hours=20, draft=False, checks=[{'state': 'FAILURE'}]),
                    self.ci_pr(3, hours=3)]
        result = self.pick()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'PR 3 runner2/hyci-3 HYCI-3 HYCI-3 [INFRA] Build once per change\n')
        self.assertTrue((self.claims / '3' / 'owner').read_text().startswith('RUNNER 16\t'))
        for number in [1, 2]:
            self.assertFalse((self.claims / str(number)).exists())

    def test_freeze_names_the_freeze_when_nothing_ci_is_free(self):
        self.freeze()
        self.prs = [self.pr(1, hours=1), self.pr(2, hours=20, draft=False),
                    self.ci_pr(3, hours=0.1), self.pr(4, hours=9, branch='ci-runner-4/hyci-4')]
        result = self.pick()
        self.assertEqual((result.returncode, result.stdout),
                         (0, 'NONE app freeze: no CI fix PR waits; take CI work or end with '
                             'RUNNER IDLE app freeze\n'))
        self.assertEqual(list(self.claims.glob('*/owner')), [])

    def test_freeze_leaves_a_working_ci_owner_alone(self):
        self.freeze()
        self.prs = [self.ci_pr(3, hours=2)]
        owner = self.owner(3, runner='RUNNER 7', hours=0.1)
        before = owner.read_text()
        result = self.pick()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('NONE app freeze: '), result.stdout)
        self.assertEqual(owner.read_text(), before)

    def test_freeze_replaces_a_ci_owner_idle_thirty_minutes(self):
        self.freeze()
        self.prs = [self.ci_pr(3, hours=2)]
        owner = self.owner(3, runner='RUNNER 7', hours=0.6)
        self.assertTrue(self.pick().stdout.startswith('PR 3 '))
        self.assertTrue(owner.read_text().startswith('RUNNER 16\t'))

    def test_freeze_marker_and_override_decide_the_queue(self):
        self.prs = [self.pr(1), self.ci_pr(3)]
        marker = self.freeze()
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 3 '))
        marker.unlink()
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))
        self.env['SHIP_APP_FREEZE'] = '1'
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 3 '))
        self.env['SHIP_APP_FREEZE'] = '0'
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 1 '))

    def test_freeze_file_elsewhere_is_read(self):
        marker = self.home / 'freeze-flag'
        marker.write_text('')
        self.env['SHIP_FREEZE_FILE'] = str(marker)
        self.prs = [self.pr(1), self.ci_pr(3)]
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 3 '))

    def test_freeze_resumes_this_runners_own_ci_pr(self):
        self.freeze()
        self.prs = [self.ci_pr(3, hours=0.05)]
        self.owner(3, runner='RUNNER 16', hours=0.05)
        self.assertTrue(self.pick('--dry-run').stdout.startswith('PR 3 '))


if __name__ == '__main__':
    unittest.main()
