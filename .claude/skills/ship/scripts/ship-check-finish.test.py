#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('ship-check')


class FinishChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.repo = self.root / 'repo'
        self.run_git('init', '-q', str(self.repo), cwd=self.root)
        self.run_git('config', 'user.email', 'fixture@example.com')
        self.run_git('config', 'user.name', 'Fixture')
        self.run_git('commit', '-q', '--allow-empty', '-m', 'fixture')
        origin = self.root / 'origin.git'
        self.run_git('init', '-q', '--bare', str(origin))
        self.run_git('remote', 'add', 'origin', str(origin))
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        VCC_EVIDENCE_DIR=str(self.root / 'evidence'),
                        SHIP_CHECKOUT=str(self.repo), CODEX_SESSION_ID='session-a',
                        FIXTURE_ROOT=str(self.root))
        self.env.pop('CLAUDE_CODE_SESSION_ID', None)
        self.env.pop('CODEX_THREAD_ID', None)
        self.write('hypertask', '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['FIXTURE_ROOT'])
if sys.argv[1:3] in [['tasks', 'get'], ['task', 'get']]:
    print(json.dumps({'success': True, 'tasks': [{'ticketNumber': sys.argv[3], 'boardId': 15, 'section': os.environ.get('SECTION', 'In Progress')}]}))
elif sys.argv[1:3] in [['section', 'list'], ['sections', 'list']]:
    print(json.dumps({'success': True, 'sections': [
        {'id': 1, 'section_title': 'Flag: Everyone', 'isDone': True},
        {'id': 2, 'section_title': 'Flag: Only Me + QA', 'isDone': True},
        {'id': 3, 'section_title': 'No Flag', 'isDone': True},
        {'id': 4, 'section_title': 'Flag: Off', 'isDone': None},
        {'id': 5, 'section_title': 'Agent Blocked (Infra)', 'isDone': False},
        {'id': 6, 'section_title': 'In Progress', 'isDone': False}]}))
elif sys.argv[1:3] == ['comment', 'list']:
    print((root / 'comments.json').read_text())
else:
    sys.exit(10)
''')
        self.comments('Local tests got SIGKILL on the VPS. Exit 137.')

    def run_git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.repo,
                              check=True, capture_output=True, text=True)

    def write(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def comments(self, text):
        (self.root / 'comments.json').write_text(json.dumps({
            'success': True, 'comments': [{'text': text, 'createdAt': '2026-10-28T10:00:00Z'}]}))

    def check(self, *args, success=True, **env):
        result = subprocess.run([str(SCRIPT), *args], env=dict(self.env, **env),
                                cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def guard(self, command):
        result = subprocess.run([str(SCRIPT), 'guard'], env=self.env, cwd=self.repo,
                                input=json.dumps({'tool_input': {'command': command}, 'cwd': str(self.repo)}),
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stderr

    def test_three_released_ticket_replays(self):
        for ticket, section in [('HTPR-7950', 'Flag: Everyone'),
                                ('HTPR-7753', 'Flag: Only Me + QA'),
                                ('YPER4-697', 'No Flag')]:
            with self.subTest(ticket=ticket):
                self.assertEqual(self.check('done', ticket, SECTION=section), 'done ok\n')
                self.check('branch', ticket, 'none')
                self.assertIn('cleaned ok', self.check('cleaned', ticket))
        self.check('done', 'HTPR-7950', success=False, SECTION='Flag: Off')

    def test_killed_local_check_refuses_blocked_handoff_by_title_and_id(self):
        for section in ['Agent Blocked (Infra)', '5']:
            self.assertIn('push and let CI decide', self.check(
                'move', 'HTPR-7950', section, success=False))

    def test_real_blocker_still_allowed(self):
        self.comments('<p>Local tests got SIGKILL.</p><p>Blocker: provider returned HTTP 403.</p>')
        self.assertIn('move ok', self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)'))
        self.comments('<p>Blocker: local test exit code 137.</p>')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)
        self.comments('Provider returned HTTP 403.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')

    def test_local_success_does_not_turn_ci_failure_into_local_failure(self):
        for text in ['Local tests passed. CI tests got SIGKILL, exit 137.',
                     'Local tests passed, but CI tests got SIGKILL, exit 137.',
                     'CI tests got SIGKILL, exit 137, but local tests passed.']:
            self.comments(text)
            self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')
        self.comments('CI tests passed, but local tests got SIGKILL, exit 137.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)
        self.comments('<p>Local tests got SIGKILL.</p><p>Blocker: CI tests got SIGKILL, exit 137.</p>')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')

    def test_ci_failure_and_working_moves_still_allowed(self):
        self.comments('CI test job got SIGKILL, exit 137.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')
        self.comments('Local tests got SIGKILL.')
        self.check('move', 'HTPR-7950', 'In Progress')

    def test_ci_and_factory_tickets_finish_through_the_normal_step(self):
        for ticket in ['HYCI-31', 'IGSH-1335']:
            with self.subTest(ticket=ticket):
                self.assertIn('move ok', self.check('move', ticket, 'In Progress'))

    def test_guard_enforces_done_moves_on_the_ci_board(self):
        for ticket in ['HYCI-31', 'IGSH-1335']:
            with self.subTest(ticket=ticket):
                out = self.guard(f'vcc task move {ticket} --section Done')
                self.assertIn('blocked moving ' + ticket, out)

    def test_unreadable_handoff_fails_closed(self):
        (self.root / 'comments.json').write_text('{bad')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)

    def test_foreign_worktree_and_remote_branch_do_not_block(self):
        self.check('branch', 'YPER4-697', 'old/yper4-697')
        self.run_git('worktree', 'add', '-q', '-b', 'old/yper4-697', str(self.root / 'old'))
        self.run_git('push', '-q', 'origin', 'old/yper4-697')
        self.check('branch', 'YPER4-697', 'none', CODEX_SESSION_ID='session-b')
        self.assertIn('cleaned ok', self.check('cleaned', 'YPER4-697', CODEX_SESSION_ID='session-b'))
        self.check('cleaned', 'YPER4-697', success=False)
        self.assertTrue((self.root / 'old').exists())
        self.assertIn('old/yper4-697', self.run_git('branch', '--list').stdout)

    def test_own_resources_require_cleanup(self):
        ticket, branch = 'YPER4-697', 'new/yper4-697'
        self.check('branch', ticket, branch)
        self.run_git('worktree', 'add', '-q', '-b', branch, str(self.root / 'own'))
        self.run_git('push', '-q', 'origin', branch)
        self.assertIn('worktree', self.check('cleaned', ticket, success=False))
        self.run_git('worktree', 'remove', str(self.root / 'own'))
        self.assertIn('local branch', self.check('cleaned', ticket, success=False))
        self.run_git('branch', '-D', branch)
        self.assertIn('GitHub branch', self.check('cleaned', ticket, success=False))
        self.run_git('push', '-q', 'origin', '--delete', branch)
        self.assertIn('cleaned ok', self.check('cleaned', ticket))

    def test_missing_ownership_is_not_a_pass(self):
        self.check('cleaned', 'YPER4-697', success=False)
        self.check('branch', 'YPER4-697', 'none', success=False, CODEX_SESSION_ID='')
        self.check('branch', 'YPER4-697', 'none', success=False, CODEX_SESSION_ID='../other')

    def test_cannot_replace_ownership_with_none(self):
        self.check('branch', 'YPER4-697', 'own/one')
        self.check('branch', 'YPER4-697', 'none', success=False)
        self.check('branch', 'YPER4-697', 'own/two')
        self.run_git('branch', 'own/two')
        self.check('cleaned', 'YPER4-697', success=False)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FinishChecks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.wasSuccessful():
        print('finish checks passed')
    raise SystemExit(not result.wasSuccessful())
