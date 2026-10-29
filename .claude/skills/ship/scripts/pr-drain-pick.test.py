import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import tempfile
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

    def pr(self, number, *, hours=8, draft=True, branch=None, checks=None):
        return dict(number=number, title=f'HTPR-{number} [BUGFIX] Example', isDraft=draft,
                    headRefName=branch or f'runner-1/htpr-{number}',
                    updatedAt=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat(),
                    statusCheckRollup=checks or [])

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

    def test_active_and_claimed_drafts_wait_without_allowing_new_tickets(self):
        self.prs = [self.pr(1, hours=1), self.pr(2)]
        owner = self.owner(2)
        before = owner.read_text()
        result = self.pick()
        self.assertEqual((result.returncode, result.stdout), (0, 'WAIT\n'))
        self.assertEqual(owner.read_text(), before)
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


if __name__ == '__main__':
    unittest.main()
