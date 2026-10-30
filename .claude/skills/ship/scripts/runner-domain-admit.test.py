import importlib.machinery
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'inbox'
        self.state.mkdir()
        self.board = self.root / 'board.json'
        self.board.write_text('[]')
        ht = self.root / 'hypertask'
        ht.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
tasks = json.loads(Path(os.environ['BOARD']).read_text())
if args[:2] == ['tasks', 'list']:
    project = int(args[args.index('--project') + 1])
    rows = [t for t in tasks if t['projectId'] == project]
    offset = int(args[args.index('--offset') + 1])
    print(json.dumps({'success': True, 'total': len(rows) + int(os.environ.get('BAD_PAGE', '0')), 'tasks': rows[offset:offset+100], 'nextCursor': 'full-page' if len(rows[offset:offset+100]) == 100 else None}))
elif args[:2] == ['tasks', 'get']:
    print(json.dumps({'success': True, 'tasks': [t for t in tasks if t['ticketNumber'] == args[2]]}))
elif args[:2] == ['comment', 'list']:
    print(json.dumps({'success': True, 'comments': [{'id': 1, 'createdAt': '2026-10-01T00:00:00Z', 'agent': {'id': 'a', 'displayName': 'Runner 1'}, 'text': 'Claimed. Claim id: [test resume]'}]}))
else: sys.exit(1)
''')
        ht.chmod(0o755)
        gh = self.root / 'gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os
print(json.dumps([{'number': 1, 'headRefName': 'runner' + os.environ['SHIP_SESSION_NAME'].split()[-1] + '/work', 'title': os.environ['TARGET'] + ' [INFRA] work', 'isDraft': False}]))
''')
        gh.chmod(0o755)
        vcc = self.root / 'vcc'
        vcc.write_text('''#!/usr/bin/env python3
import os, sys
with open(os.environ['WRITES'], 'a') as f: f.write(' '.join(sys.argv[1:]) + '\\n')
''')
        vcc.chmod(0o755)
        api = self.root / 'ht'
        api.write_text('#!/bin/sh\necho \'{"success":true,"activities":[]}\'\n')
        api.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.root), RUNNER_INBOX_DIR=str(self.state), BOARD=str(self.board),
                        WRITES=str(self.root / 'writes'), SHIP_CLAIM_HYPERTASK=str(ht), SHIP_CLAIM_GH=str(gh),
                        SHIP_CLAIM_VCC=str(vcc), SHIP_CLAIM_HT=str(api), SHIP_CLAIM_RESUME='test resume')

    def task(self, ticket, domain, runner=None, section='Todo'):
        return {'ticketNumber': ticket, 'projectId': 4060, 'section': section,
                'labels': [{'name': 'Domain: ' + domain}],
                'assignees': [{'agent': {'displayName': f'Runner {runner}'}}] if runner else []}

    def set_tasks(self, tasks):
        self.board.write_text(json.dumps(tasks))

    def claim(self, runner, ticket, **extra):
        env = dict(self.env, SHIP_SESSION_NAME=f'RUNNER {runner}', TARGET=ticket, **extra)
        return subprocess.run([str(HERE / 'ship-claim'), ticket], env=env, capture_output=True, text=True)

    def admit(self, runner, ticket):
        return subprocess.run(['python3', str(HERE / 'runner-domain-admit.py'), str(runner), ticket],
                              env=self.env, capture_output=True, text=True)

    def test_conflict_before_write_and_distinct_and_retry(self):
        self.set_tasks([self.task('YPER4-1', 'Commands', 2, 'QA'), self.task('YPER4-2', 'Commands'),
                        self.task('YPER4-3', 'Flags')])
        denied = self.claim(1, 'YPER4-2')
        self.assertEqual(denied.returncode, 4, denied.stderr)
        self.assertFalse((self.root / 'writes').exists())
        allowed = self.claim(1, 'YPER4-3')
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        self.assertEqual(self.claim(1, 'YPER4-3').returncode, 0)
        self.assertIn('task assign YPER4-3', (self.root / 'writes').read_text())

    def test_imported_conflict_only_blocks_overlapping_resumes(self):
        self.set_tasks([self.task('YPER4-1', 'Flags', 2, 'QA'),
                        self.task('YPER4-2', 'Flags', 3, 'Review'),
                        self.task('YPER4-3', 'Commands')])
        result = self.admit(1, 'YPER4-3')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('existing conflicts', result.stderr)
        self.assertNotEqual(self.admit(2, 'YPER4-1').returncode, 0)
        leases = json.loads((self.state / 'domain-ownership.json').read_text())
        self.assertFalse(leases['2']['YPER4-1']['pending'])
        self.assertFalse(leases['3']['YPER4-2']['pending'])
        self.set_tasks([self.task('YPER4-1', 'Flags', 2, 'QA'),
                        self.task('YPER4-2', 'Flags', None, 'Done'),
                        self.task('YPER4-3', 'Commands')])
        self.assertEqual(self.admit(2, 'YPER4-1').returncode, 0)

    def test_reconcile_terminal_unassigned_and_missing(self):
        leases = {'1': {key: {'held': ['Flags'], 'current': 'Flags', 'pending': False, **extra}
                         for key, extra in [('YPER4-1', {}), ('YPER4-2', {}),
                                            ('YPER4-3', {'admission': True}), ('YPER4-4', {})]}}
        (self.state / 'domain-ownership.json').write_text(json.dumps(leases))
        self.set_tasks([self.task('YPER4-1', 'Flags', section='Done'),
                        self.task('YPER4-2', 'Flags'), self.task('YPER4-3', 'Flags'),
                        self.task('YPER4-5', 'Commands')])
        self.assertEqual(self.admit(2, 'YPER4-5').returncode, 0)
        remaining = json.loads((self.state / 'domain-ownership.json').read_text())['1']
        self.assertEqual(set(remaining), {'YPER4-3', 'YPER4-4'})
        self.assertTrue(remaining['YPER4-3']['admission'])

    def test_malformed_page_has_no_board_write(self):
        self.set_tasks([self.task('YPER4-1', 'Flags')])
        result = self.claim(1, 'YPER4-1', BAD_PAGE='1')
        self.assertEqual(result.returncode, 4)
        self.assertFalse((self.root / 'writes').exists())

    def test_full_final_page_and_multiple_pages(self):
        for count in (100, 101, 200):
            with self.subTest(count=count):
                self.set_tasks([self.task(f'YPER4-{n}', 'Flags') for n in range(1, count + 1)])
                result = self.admit(1, 'YPER4-1')
                self.assertEqual(result.returncode, 0, result.stderr)
                lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['YPER4-1']
                self.assertEqual(lease['held'], ['Flags'])

    def test_concurrent_real_admission(self):
        self.set_tasks([self.task('YPER4-1', 'Flags'), self.task('YPER4-2', 'Flags')])
        procs = [subprocess.Popen(['python3', str(HERE / 'runner-domain-admit.py'), str(n), f'YPER4-{n}'],
                                  env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for n in (1, 2)]
        for proc in procs:
            proc.communicate(timeout=30)
        self.assertEqual(sorted(p.returncode for p in procs), [0, 1])

    def test_dispatch_uses_admission_before_delivery(self):
        loader = importlib.machinery.SourceFileLoader('dispatch_admission', str(HERE / 'runner-dispatch'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        owner = self.task('YPER4-10', 'Commands', 2, 'QA')
        denied = self.task('YPER4-1', 'Commands')
        allowed = self.task('YPER4-2', 'Flags')
        for task in (denied, allowed):
            task.update(title=task['ticketNumber'], section='Backlog')
        self.set_tasks([owner, denied, allowed])
        rows = [{'runner': 'RUNNER 1', 'pane': '%1', 'state': 'idle'},
                {'runner': 'RUNNER 2', 'pane': '%2', 'state': 'done'}]
        boards = {15: [], 4060: [owner, denied, allowed]}
        comments = {t['ticketNumber']: [] for t in boards[4060]}
        loop = self.root / 'loop'
        loop.mkdir()
        delivered = []
        with patch.dict(os.environ, self.env), patch.object(module, 'maintain_runner', return_value=False), \
                patch.object(module, 'snapshots', return_value=rows), \
                patch.object(module.os, 'getloadavg', return_value=(1, 1, 1)), \
                patch.object(module, 'command', return_value=''), \
                patch.object(module, 'send', side_effect=lambda pane, text, claim: delivered.append(text)):
            result = module.dispatch(rows, boards, comments, 1, 1800000000, go=True,
                                     claim_dir=self.root / 'claims', loop=loop, state=self.root)
        self.assertEqual(delivered, ['/ship YPER4-2', '/ship YPER4-1'])
        self.assertEqual(result[0]['ticket'], 'YPER4-2')
        self.assertEqual(result[1]['ticket'], 'YPER4-1')
        self.assertTrue((self.root / 'claims' / 'YPER4-1.json').exists())

    def test_deployed_dispatch_fallback_and_missing_helper(self):
        loader = importlib.machinery.SourceFileLoader('dispatch_deployed', str(HERE / 'runner-dispatch'))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
        deployed = self.root / '.claude/skills/runners/scripts'
        deployed.mkdir(parents=True)
        helper = self.root / '.agents/skills/ship/scripts/runner-domain-admit.py'
        helper.parent.mkdir(parents=True)
        self.set_tasks([self.task('YPER4-1', 'Flags')])
        with patch.dict(os.environ, self.env), patch.object(module, 'SCRIPTS', deployed):
            with self.assertRaises(FileNotFoundError):
                module.admit_domain('RUNNER 1', 'YPER4-1', self.root)
            shutil.copyfile(HERE / 'runner-domain-admit.py', helper)
            module.admit_domain('RUNNER 1', 'YPER4-1', self.root)
        lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['YPER4-1']
        self.assertTrue(lease['admission'])

    def test_pickup_keeps_preassignment_reservation(self):
        task = self.task('YPER4-1', 'Flags')
        self.set_tasks([task])
        self.assertEqual(self.admit(1, 'YPER4-1').returncode, 0)
        result = subprocess.run(['python3', str(HERE / 'runner-domain-pickup.py'), str(self.state), '1'],
                                input=json.dumps({'tasks': [task], 'previous': [], 'candidates': []}),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['YPER4-1']
        self.assertTrue(lease['admission'])
        self.assertEqual(self.admit(2, 'YPER4-1').returncode, 1)


if __name__ == '__main__':
    unittest.main()
