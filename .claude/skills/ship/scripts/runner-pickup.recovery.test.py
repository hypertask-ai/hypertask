import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(os.environ.get('RUNNER_PICKUP_RECOVERY_SCRIPT', Path(__file__).with_name('runner-pickup')))


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.tasks = {'success': True, 'total': 1, 'tasks': [{
            'ticketNumber': 'YPER4-1', 'uniqueIndex': 1, 'projectId': 4060,
            'section': 'Agent Blocked', 'title': 'Fixture',
            'blockerCommentId': None, 'createdAt': '2026-10-27T10:00:00Z',
            'updatedAt': '2026-10-28T10:00:00Z',
            'assignees': [{'agent': {'displayName': 'Runner 6'}}],
        }]}
        self.comments = {'success': True, 'comments': [{
            'id': 123, 'createdAt': '2026-10-27T10:00:00.000Z', 'editedAt': None,
            'agent': {'displayName': 'Runner 6'},
            'text': '<p><strong>Blocked on HT Product Lead.</strong> Release freeze active.</p>',
        }]}
        self.save()
        fake = self.root / 'vcc'
        fake.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE'])
a = sys.argv[1:]
with (root / 'calls').open('a') as f: f.write(json.dumps(a) + '\\n')
tasks = json.loads((root / 'tasks').read_text())
if a[:2] == ['task', 'list']:
    offset = int(a[a.index('--offset') + 1]) if '--offset' in a else 0
    tasks['tasks'] = tasks['tasks'][offset:offset + 100]
    print(json.dumps(tasks))
elif a[:2] == ['comment', 'list']: print((root / 'comments').read_text())
elif a[:2] == ['inbox', 'list']: print('{"success":true,"agent_notifications":[]}')
elif a[:2] == ['task', 'move']:
    if os.environ.get('FAIL_MOVE'): sys.exit(1)
    next(t for t in tasks['tasks'] if t['ticketNumber'] == a[2])['section'] = 'In Progress'
    (root / 'tasks').write_text(json.dumps(tasks))
elif a[:2] == ['task', 'get']:
    tasks['tasks'] = [t for t in tasks['tasks'] if t['ticketNumber'] == a[2]]
    print(json.dumps(tasks))
elif a[:2] != ['activity', 'add']: sys.exit(9)
''')
        fake.chmod(0o755)
        self.env = dict(os.environ, FIXTURE=str(self.root), HOME=str(self.root),
                        RUNNER_INBOX_DIR=str(self.state), RUNNER_PICKUP_VCC=str(fake),
                        RUNNER_PICKUP_NOW='1793188800')
        self.lift = '1793185200'
        (self.state / 'freeze-lift').write_text(self.lift)

    def save(self):
        (self.root / 'tasks').write_text(json.dumps(self.tasks))
        (self.root / 'comments').write_text(json.dumps(self.comments))

    def run_command(self, *args):
        self.save()
        return subprocess.run(['bash', str(SCRIPT), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def calls(self):
        path = self.root / 'calls'
        return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []

    def test_pickup_queues_old_block_without_mutating_board(self):
        result = self.run_command('run', '6')
        self.assertEqual(result.returncode, 0, result.stderr)
        items = json.loads((self.state / 'runner-6.json').read_text())['items']
        self.assertEqual([i['ticket'] for i in items], ['YPER4-1'])
        self.assertEqual(items[0]['resumeAfterFreeze'], int(self.lift))
        self.assertFalse(any(c[:2] == ['task', 'move'] for c in self.calls()))

    def test_drain_moves_and_audits_once(self):
        result = self.run_command('drain', '6')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Resume YPER4-1', result.stdout)
        self.assertEqual(json.loads((self.root / 'tasks').read_text())['tasks'][0]['section'], 'In Progress')
        self.assertEqual([c[:2] for c in self.calls()], [
            ['task', 'list'], ['comment', 'list'], ['activity', 'add'], ['task', 'move'], ['task', 'get']])
        self.tasks['tasks'][0]['section'] = 'In Progress'
        self.assertEqual(self.run_command('drain', '6').stdout, '')
        self.assertEqual(sum(c[:2] == ['activity', 'add'] for c in self.calls()), 1)

    def test_drain_finds_assigned_block_on_the_second_page(self):
        blocked = self.tasks['tasks'][0].copy()
        self.tasks['tasks'] = [blocked | {'ticketNumber': f'YPER4-{n}', 'section': 'Backlog'}
                               for n in range(2, 102)] + [blocked]
        self.tasks['total'] = 101
        result = self.run_command('drain', '6')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Resume YPER4-1', result.stdout)
        self.assertEqual(json.loads((self.root / 'tasks').read_text())['tasks'][-1]['section'], 'In Progress')

    def test_drain_resumes_only_one_ticket_per_run(self):
        self.tasks['tasks'].append(self.tasks['tasks'][0] | {'ticketNumber': 'YPER4-2'})
        self.tasks['total'] = 2
        result = self.run_command('drain', '6')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([t['section'] for t in json.loads((self.root / 'tasks').read_text())['tasks']],
                         ['In Progress', 'Agent Blocked'])

    def test_fresh_human_question_other_runner_and_nonfreeze_blocks_stay(self):
        original = self.comments['comments'][0].copy()
        for changes in [
            {'createdAt': '2026-10-28T12:00:00Z'},
            {'createdAt': '2026-10-28T11:00:00Z'},
            {'agent': None}, {'agent': {'displayName': 'Runner 7'}},
            {'text': '<p>Blocked: Phone verification failed.</p>'},
            {'text': '<p>Blocked: freeze; Question: approve keys?</p>'},
            {'editedAt': '2026-10-28T12:00:00Z'},
        ]:
            with self.subTest(changes=changes):
                self.comments['comments'] = [original | changes]
                result = self.run_command('drain', '6')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')
        self.assertFalse(any(c[:2] == ['task', 'move'] for c in self.calls()))

    def test_missing_invalid_future_epoch_and_partial_reads_never_clear(self):
        for lift in [None, 'invalid', '1793192400']:
            with self.subTest(lift=lift):
                path = self.state / 'freeze-lift'
                path.unlink(missing_ok=True)
                if lift: path.write_text(lift)
                self.assertEqual(self.run_command('drain', '6').stdout, '')
        (self.state / 'freeze-lift').write_text(self.lift)
        self.tasks['total'] = 2
        self.assertNotEqual(self.run_command('drain', '6').returncode, 0)
        self.tasks['total'] = 1
        self.comments['nextCursor'] = 'more'
        self.assertEqual(self.run_command('drain', '6').stdout, '')
        self.assertFalse(any(c[:2] == ['task', 'move'] for c in self.calls()))

    def test_explicit_blocker_review_parked_and_other_assignment_stay(self):
        original = self.tasks['tasks'][0].copy()
        for changes in [{'blockerCommentId': 123}, {'section': 'Valentin Review'},
                        {'section': 'Later (parked)'},
                        {'assignees': [{'agent': {'displayName': 'Runner 7'}}]}]:
            self.tasks['tasks'] = [original | changes]
            self.assertEqual(self.run_command('drain', '6').stdout, '')
        self.assertFalse(any(c[:2] == ['task', 'move'] for c in self.calls()))

    def test_fresh_block_removes_an_earlier_recovery_from_pickup(self):
        self.assertEqual(self.run_command('run', '6').returncode, 0)
        self.comments['comments'][0]['createdAt'] = '2026-10-28T12:00:00Z'
        self.assertEqual(self.run_command('run', '6').returncode, 0)
        self.assertEqual(json.loads((self.state / 'runner-6.json').read_text())['items'], [])

    def test_older_question_is_not_cleared_by_a_later_freeze_note(self):
        self.comments['comments'].append({
            'id': 122, 'createdAt': '2026-10-26T10:00:00Z',
            'agent': None, 'text': '<p>Question: Allow this access?</p>'})
        self.assertEqual(self.run_command('drain', '6').stdout, '')
        self.assertFalse(any(c[:2] == ['task', 'move'] for c in self.calls()))

    def test_failed_move_is_not_reported_as_resumed(self):
        self.env['FAIL_MOVE'] = '1'
        result = self.run_command('drain', '6')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_record_lift_persists_epoch(self):
        result = self.run_command('record-lift')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.state / 'freeze-lift').read_text().strip(), self.env['RUNNER_PICKUP_NOW'])


if __name__ == '__main__':
    unittest.main()
