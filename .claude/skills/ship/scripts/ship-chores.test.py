#!/usr/bin/env python3
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('ship-chores')
M = runpy.run_path(str(SCRIPT), run_name='chores_test')
G = M['step'].__globals__
PR = dict(state='OPEN', isDraft=False, mergeable='MERGEABLE', baseRefName='production', headRefOid='abc')
GREEN = [dict(name='ci-tests', state='SUCCESS', link='https://github.com/hypertask-ai/hypertask/actions/runs/9')]
STATE = dict(repo='hypertask-ai/hypertask', pr=1, ticket='HYCI-352', base='production', head='abc', url='https://app.hypertask.ai', expect='Hypertask')


class Chores(unittest.TestCase):
    def test_replay(self):
        events = [(PR, [dict(GREEN[0], state='IN_PROGRESS')], 'WAIT')] * 17
        events += [(PR, GREEN, 'MERGE'), (dict(PR, mergeable='CONFLICTING'), GREEN, 'CONFLICT'),
                   (PR, [dict(GREEN[0], state='FAILURE')], 'RERUN')]
        actions = [M['decide'](pr, rows, 'abc', 'production') for pr, rows, _ in events]
        self.assertEqual(actions, [wanted for _, _, wanted in events])
        wakes = sum(a in ('CONFLICT', 'RERUN') for a in actions)
        self.assertLess(wakes, len(events))
        print(f'REPLAY model wakes {len(events)} -> at most {wakes}; waits and green merge scripted')
        self.assertEqual(M['decide'](dict(PR, headRefOid='changed'), GREEN, 'abc', 'production'), 'HOLD')
        self.assertEqual(M['decide'](PR, [dict(GREEN[0], state='SKIPPED')], 'abc', 'production'), 'WAIT')

    def test_discovery_excludes_protected_and_human_prs(self):
        pr = dict(number=1, title='HYCI-352 [INFRA] chores', headRefOid='abc', isDraft=False,
                  author=dict(login='app/hypertask-runners'), files=[dict(path='scripts/safe')], changedFiles=1)
        rows = [pr, dict(pr, number=2, title='HYCI-353 [INFRA] guard', files=[dict(path='AGENTS.md')]),
                dict(pr, number=3, title='HYCI-354 [INFRA] human', author=dict(login='human')),
                dict(pr, number=4, title='HYCI-355 [INFRA] truncated', changedFiles=2),
                dict(pr, number=5, title='HYCI-356 [INFRA] guard', files=[dict(path='.claude/skills/ship/scripts/gh-merge-guard')]),
                dict(pr, number=6, title='HYCI-357 [INFRA] unbound')]
        with tempfile.TemporaryDirectory() as root, patch.dict(G, ROOT=Path(root), gh=lambda *a: rows, bound=lambda t, n: n != 6):
            M['discover']()
            self.assertEqual([p.name for p in Path(root).glob('*.json')], ['HYCI-352.json'])
            state = json.loads((Path(root) / 'HYCI-352.json').read_text())
            state['reran'] = ['9']; M['save'](Path(root) / 'HYCI-352.json', state)
            pr['headRefOid'] = 'new'
            M['discover']()
            self.assertEqual(json.loads((Path(root) / 'HYCI-352.json').read_text())['head'], 'abc')
            self.assertEqual(json.loads((Path(root) / 'HYCI-352.json').read_text())['reran'], ['9'])

    def test_binding_requires_exact_pr_repo_and_base(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, VCC_EVIDENCE_DIR=root):
            folder = Path(root) / 'HYCI-352'; folder.mkdir()
            self.assertFalse(M['bound']('HYCI-352', 1))
            for name, value in dict(pr='1', repo=STATE['repo'], base='production').items():
                (folder / name).write_text(value)
            self.assertTrue(M['bound']('HYCI-352', 1))
            self.assertFalse(M['bound']('HYCI-352', 2))

    def test_merge_is_pinned_and_guarded(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(G, pull=lambda *a: PR, checks=lambda *a: GREEN, bound=lambda *a: True):
            with patch('subprocess.run') as call:
                self.assertEqual(M['step'](dict(STATE), Path(root) / 'job.json'), 'WAIT')
            argv = call.call_args.args[0]
            self.assertTrue(argv[0].endswith('/merge-guard/gh-merge-guard'))
            self.assertEqual(argv[1:], ['--', '/usr/bin/gh', 'pr', 'merge', '1', '-R', STATE['repo'], '--squash', '--match-head-commit', 'abc'])

    def test_rerun_is_once_on_the_same_head(self):
        rows = [dict(GREEN[0], state='FAILURE')]
        state = dict(STATE)
        with patch.dict(G, gh=lambda *a: dict(head_sha='abc', run_attempt=1)):
            self.assertEqual(M['rerun'](STATE['repo'], rows, state), ['9'])
            self.assertEqual(M['rerun'](STATE['repo'], rows, state), 'RED')
        with patch.dict(G, gh=lambda *a: dict(head_sha='abc', run_attempt=2)):
            self.assertEqual(M['rerun'](STATE['repo'], rows, dict(STATE)), 'RED')
        with patch.dict(G, gh=lambda *a: dict(head_sha='new', run_attempt=1)):
            self.assertEqual(M['rerun'](STATE['repo'], rows, dict(STATE)), 'RED')

    def test_rerun_history_saved_before_api_write(self):
        rows = [dict(GREEN[0], state='FAILURE')]
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'job.json'
            state = dict(STATE)
            def fail(*a, **kw):
                self.assertEqual(json.loads(path.read_text())['reran'], ['9'])
                raise RuntimeError('write failed')
            with patch.dict(G, bound=lambda *a: True, pull=lambda *a: PR, checks=lambda *a: rows,
                            gh=lambda *a: dict(head_sha='abc', run_attempt=1)):
                with patch('subprocess.run', side_effect=fail), self.assertRaises(RuntimeError):
                    M['step'](state, path)

    def test_live_no_redirect_and_real_body(self):
        self.assertIsNone(M['NoRedirect']().redirect_request(None, None, 302, '', {}, 'https://other.example'))
        with self.assertRaises(RuntimeError):
            M['live']('http://app.example', 'ok', 1)
        response = io.BytesIO(b'not the feature')
        response.status = 200
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch('urllib.request.build_opener', return_value=opener), self.assertRaises(RuntimeError):
            M['live']('https://app.example', 'wanted text', 1)

    def test_deploy_before_live(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(G, pull=lambda *a: dict(PR, state='MERGED'), bound=lambda *a: True):
            with patch.dict(G, run=lambda *a: subprocess.CompletedProcess([], 1, '', ''), live=lambda *a: self.fail('premature live')):
                self.assertEqual(M['step'](dict(STATE), Path(root) / 'job.json'), 'WAIT_DEPLOY')
            with patch.dict(G, run=lambda *a: subprocess.CompletedProcess([], 0, '', ''), live=lambda *a: 'LIVE'):
                with patch('subprocess.run') as call:
                    self.assertEqual(M['step'](dict(STATE), Path(root) / 'job.json'), 'LIVE')
                    self.assertEqual(call.call_args.args[0][:3], ['vcc', 'activity', 'add'])

    def test_real_rebase_and_conflict_rollback(self):
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as root:
            def git(*args):
                return subprocess.check_output(['git', *args], text=True, stderr=subprocess.DEVNULL).strip()
            os.chdir(root)
            try:
                git('init', '--bare', 'origin.git')
                git('clone', 'origin.git', 'work')
                os.chdir('work')
                git('config', 'user.email', 'test@example.invalid')
                git('config', 'user.name', 'Fixture')
                git('checkout', '-b', 'production')
                Path('shared').write_text('base\n')
                git('add', '.'); git('commit', '-m', 'base'); git('push', 'origin', 'production')
                git('checkout', '-b', 'ticket')
                Path('shared').write_text('ticket\n')
                git('commit', '-am', 'ticket')
                original = git('rev-parse', 'HEAD')
                git('checkout', 'production')
                Path('shared').write_text('upstream\n')
                git('commit', '-am', 'upstream'); git('push', 'origin', 'production'); git('checkout', 'ticket')
                with self.assertRaisesRegex(RuntimeError, 'original branch restored'):
                    M['rebase']('production')
                self.assertEqual(git('rev-parse', 'HEAD'), original)
                git('checkout', '-b', 'clean', 'production')
                self.assertEqual(M['rebase']('production'), 'REBASED')
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
