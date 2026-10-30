import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('runner-pickup')


class PickupDomainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        fake = self.root / 'vcc'
        fake.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE'])
n = os.environ['SHIP_SESSION_NAME'].split()[-1]
a = sys.argv[1:]
if a[:2] == ['task', 'list']:
    data = json.loads((root / ('tasks' + n)).read_text())
    offset = int(a[a.index('--offset') + 1]) if '--offset' in a else 0
    if data.get('fail_offset') == offset: sys.exit(1)
    rows = data['tasks'][offset:offset + 100]
    print(json.dumps({'success': True, 'tasks': rows, 'total': data.get('total', len(data['tasks']))}))
elif a[:2] == ['task', 'get']:
    p = root / ('detail-' + a[2])
    if not p.exists(): sys.exit(1)
    print(p.read_text())
elif a[:2] == ['inbox', 'list']: print('{"success":true,"agent_notifications":[]}')
elif a[:2] == ['activity', 'add']: pass
else: sys.exit(9)
''')
        fake.chmod(0o755)
        self.env = dict(os.environ, FIXTURE=str(self.root), HOME=str(self.root),
                        RUNNER_INBOX_DIR=str(self.state), RUNNER_PICKUP_VCC=str(fake),
                        RUNNER_PICKUP_NOW='1793188800', RUNNER_PICKUP_RATE_MARKER=str(self.root / 'none'))

    def task(self, n, ticket, domain=None, section='Todo'):
        return {'ticketNumber': ticket, 'uniqueIndex': int(ticket.split('-')[1]), 'projectId': 15,
                'section': section, 'title': ticket, 'createdAt': '2026-10-28T10:00:00Z',
                'updatedAt': '2026-10-28T10:00:00Z', 'assignees': [{'agent': {'displayName': f'Runner {n}'}}],
                'labels': [{'name': 'Domain: ' + domain}] if domain else []}

    def board(self, n, tasks, **extra):
        (self.root / f'tasks{n}').write_text(json.dumps({'tasks': tasks, **extra}))

    def start(self, n):
        return subprocess.Popen(['bash', str(SCRIPT), 'run', str(n)], env=self.env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def finish(self, p):
        out, err = p.communicate(timeout=30)
        self.assertEqual(p.returncode, 0, out + err)

    def tick(self, n):
        self.finish(self.start(n))

    def items(self, n):
        return [x['ticket'] for x in json.loads((self.state / f'runner-{n}.json').read_text())['items']]

    def test_simultaneous_same_domain_and_retry_release(self):
        a, b = self.task(1, 'HTPR-1', 'Commands'), self.task(2, 'HTPR-2', 'Commands')
        self.board(1, [a]); self.board(2, [b])
        one, two = self.start(1), self.start(2)
        self.finish(one); self.finish(two)
        winner = 1 if self.items(1) else 2
        loser = 3 - winner
        self.assertEqual(len(self.items(winner)), 1)
        self.assertEqual(self.items(loser), [])
        self.tick(loser)
        self.assertEqual(self.items(loser), [])
        active = a if winner == 1 else b
        active['section'] = 'AI Review'
        self.board(winner, [active]); self.tick(winner); self.tick(loser)
        self.assertEqual(self.items(loser), [])
        active['section'] = 'Done'
        self.board(winner, [active]); self.tick(winner); self.tick(loser)
        self.assertEqual(len(self.items(loser)), 1)

    def test_distinct_domains_and_one_domain_per_runner(self):
        self.board(1, [self.task(1, 'HTPR-1', 'Commands'), self.task(1, 'HTPR-3', 'Flags')])
        self.board(2, [self.task(2, 'HTPR-2', 'Search')])
        one, two = self.start(1), self.start(2)
        self.finish(one); self.finish(two)
        self.assertEqual(self.items(1), ['HTPR-1'])
        self.assertEqual(self.items(2), ['HTPR-2'])
        self.tick(1)
        self.assertEqual(self.items(1), ['HTPR-1'])

    def test_shared_conflicts_and_pagination_failure_keeps_lease(self):
        a = self.task(1, 'HTPR-1')
        self.board(1, [a]); self.board(2, [self.task(2, 'HTPR-2', 'Search')])
        self.tick(1); self.tick(2)
        self.assertEqual(self.items(2), [])
        rows = [self.task(1, f'HTPR-{i}', 'Commands', 'Done') for i in range(10, 110)]
        self.board(1, rows, total=101, fail_offset=100)
        self.tick(1)
        self.tick(2)
        self.assertEqual(self.items(2), [])
        self.assertIn('HTPR-1', json.loads((self.state / 'domain-ownership.json').read_text())['1'])

    def test_legacy_delivered_inbox_blocks_other_runner(self):
        (self.state / 'runner-1.json').write_text(json.dumps({'items': [{'ticket': 'HTPR-1', 'delivered': True}]}))
        self.board(2, [self.task(2, 'HTPR-2', 'Search')])
        self.tick(2)
        self.assertEqual(self.items(2), [])
        self.assertEqual(json.loads((self.state / 'domain-ownership.json').read_text())['1']['HTPR-1']['held'], ['Shared'])

    def test_two_legacy_inboxes_admit_in_order_and_release(self):
        a, b = self.task(1, 'HTPR-1', 'Commands'), self.task(2, 'HTPR-2', 'Commands')
        for n, ticket in ((1, 'HTPR-1'), (2, 'HTPR-2')):
            (self.state / f'runner-{n}.json').write_text(json.dumps({'items': [{'ticket': ticket}]}))
        self.board(1, [a]); self.board(2, [b])
        self.tick(2); self.tick(1); self.tick(2)
        self.assertEqual(self.items(1), ['HTPR-1'])
        self.assertEqual(self.items(2), [])
        a['section'] = 'Done'
        self.board(1, [a]); self.tick(1); self.tick(2)
        self.assertEqual(self.items(2), ['HTPR-2'])
        b['section'] = 'Done'
        self.board(2, [b]); self.tick(2)
        self.assertEqual(json.loads((self.state / 'domain-ownership.json').read_text()), {})

    def test_existing_pending_leases_recover_deterministically(self):
        leases = {'1': {'HTPR-1': {'held': ['Shared', 'Commands'], 'current': 'Commands', 'pending': True}},
                  '2': {'HTPR-2': {'held': ['Shared', 'Commands'], 'current': 'Commands', 'pending': True}}}
        (self.state / 'domain-ownership.json').write_text(json.dumps(leases))
        self.board(1, [self.task(1, 'HTPR-1', 'Commands')])
        self.board(2, [self.task(2, 'HTPR-2', 'Commands')])
        self.tick(2); self.tick(1); self.tick(2)
        self.assertEqual(self.items(1), ['HTPR-1'])
        self.assertEqual(self.items(2), [])

    def test_pending_legacy_does_not_displace_acquired_owner(self):
        leases = {'1': {'HTPR-1': {'held': ['Shared'], 'current': 'Shared', 'pending': True}},
                  '2': {'HTPR-2': {'held': ['Commands'], 'current': 'Commands', 'pending': False}}}
        (self.state / 'domain-ownership.json').write_text(json.dumps(leases))
        self.board(1, [self.task(1, 'HTPR-1', 'Commands')])
        self.board(2, [self.task(2, 'HTPR-2', 'Commands')])
        self.tick(1); self.tick(2)
        self.assertEqual(self.items(1), [])
        self.assertEqual(self.items(2), ['HTPR-2'])

    def test_pending_relabel_preserves_acquired_scope_against_legacy(self):
        changed = self.task(2, 'HTPR-2', 'Commands')
        self.board(2, [changed]); self.tick(2)
        self.board(3, [self.task(3, 'HTPR-3', 'Search')]); self.tick(3)
        changed['labels'] = [{'name': 'Domain: Search'}]
        self.board(2, [changed]); self.tick(2)
        (self.state / 'runner-1.json').write_text(json.dumps({'items': [{'ticket': 'HTPR-1'}]}))
        self.board(1, [self.task(1, 'HTPR-1', 'Commands')]); self.tick(1)
        self.assertEqual(self.items(1), [])
        self.assertEqual(self.items(2), [])
        self.tick(3)
        self.assertEqual(self.items(3), ['HTPR-3'])

    def test_own_legacy_inbox_keeps_unknown_scope(self):
        (self.state / 'runner-1.json').write_text(json.dumps({'items': [{'ticket': 'HTPR-1'}]}))
        self.board(1, [self.task(1, 'HTPR-1', 'Commands')]); self.tick(1)
        lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['HTPR-1']
        self.assertEqual(set(lease['held']), {'Shared', 'Commands'})
        self.board(2, [self.task(2, 'HTPR-2', 'Search')]); self.tick(2)
        self.assertEqual(self.items(2), [])

    def test_known_lease_survives_legacy_inbox_seeding(self):
        (self.state / 'domain-ownership.json').write_text(json.dumps({'1': {'HTPR-1': 'Commands'}}))
        (self.state / 'runner-1.json').write_text(json.dumps({'items': [{'ticket': 'HTPR-1'}]}))
        self.board(2, [self.task(2, 'HTPR-2', 'Search')])
        self.tick(2)
        self.assertEqual(self.items(2), ['HTPR-2'])
        self.assertEqual(json.loads((self.state / 'domain-ownership.json').read_text())['1']['HTPR-1']['held'], ['Commands'])

    def test_relabel_waits_for_existing_winner_and_retains_scopes(self):
        changed = self.task(1, 'HTPR-1', 'Commands')
        winner = self.task(2, 'HTPR-2', 'Search')
        self.board(1, [changed]); self.board(2, [winner])
        self.tick(1); self.tick(2)
        self.assertEqual(self.items(1), ['HTPR-1'])
        self.assertEqual(self.items(2), ['HTPR-2'])
        changed['labels'] = [{'name': 'Domain: Search'}]
        extra = self.task(1, 'HTPR-3', 'Commands')
        self.board(1, [changed, extra]); self.tick(1)
        self.assertEqual(self.items(1), [])
        lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['HTPR-1']
        self.assertEqual(set(lease['held']), {'Commands', 'Search'})
        self.assertTrue(lease['pending'])
        self.tick(2)
        self.assertEqual(self.items(2), ['HTPR-2'])
        self.board(3, [self.task(3, 'HTPR-4', 'Commands')]); self.tick(3)
        self.assertEqual(self.items(3), [])
        self.tick(1)
        self.assertEqual(self.items(1), [])
        winner['section'] = 'Done'
        self.board(2, [winner]); self.tick(2); self.tick(1)
        self.assertEqual(self.items(1), ['HTPR-1'])
        lease = json.loads((self.state / 'domain-ownership.json').read_text())['1']['HTPR-1']
        self.assertEqual(set(lease['held']), {'Commands', 'Search'})
        self.assertFalse(lease['pending'])
        self.tick(3)
        self.assertEqual(self.items(3), [])
        changed['section'] = 'Done'
        self.board(1, [changed]); self.tick(1); self.tick(3)
        self.assertEqual(self.items(3), ['HTPR-4'])

    def test_active_delivered_pending_owner_keeps_acquired_scope(self):
        changed = self.task(2, 'HTPR-2', 'Commands')
        search = self.task(3, 'HTPR-3', 'Search')
        contender = self.task(1, 'HTPR-1', 'Flags')
        self.board(2, [changed]); self.tick(2)
        inbox = self.state / 'runner-2.json'
        data = json.loads(inbox.read_text())
        data['items'][0]['delivered'] = True
        inbox.write_text(json.dumps(data))
        self.board(3, [search]); self.tick(3)
        self.board(1, [contender]); self.tick(1)
        changed['section'] = 'In Progress'
        changed['labels'] = [{'name': 'Domain: Search'}]
        self.board(2, [changed]); self.tick(2)
        contender['labels'] = [{'name': 'Domain: Commands'}]
        self.board(1, [contender]); self.tick(1); self.tick(2); self.tick(1)
        self.assertEqual(self.items(1), [])
        leases = json.loads((self.state / 'domain-ownership.json').read_text())
        self.assertIn('Commands', leases['2']['HTPR-2']['acquired'])
        self.assertTrue(leases['1']['HTPR-1']['pending'])
        changed['section'] = 'Done'
        self.board(2, [changed]); self.tick(2); self.tick(1)
        self.assertEqual(self.items(1), ['HTPR-1'])

    def test_reciprocal_relabels_serialize_and_release(self):
        for first in (1, 2):
            with self.subTest(first=first):
                for path in self.state.iterdir():
                    path.unlink()
                a = self.task(1, 'HTPR-1', 'Commands')
                b = self.task(2, 'HTPR-2', 'Search')
                self.board(1, [a]); self.board(2, [b])
                self.tick(1); self.tick(2)
                a['labels'] = [{'name': 'Domain: Search'}]
                b['labels'] = [{'name': 'Domain: Commands'}]
                self.board(1, [a]); self.board(2, [b])
                self.tick(first)
                self.assertEqual(self.items(first), [])
                self.tick(3 - first); self.tick(first); self.tick(1)
                self.assertEqual(self.items(1), ['HTPR-1'])
                self.assertEqual(self.items(2), [])
                self.board(3, [self.task(3, 'HTPR-3', 'Commands')]); self.tick(3)
                self.assertEqual(self.items(3), [])
                a['section'] = 'Done'
                self.board(1, [a]); self.tick(1); self.tick(2); self.tick(3)
                self.assertEqual(self.items(2), ['HTPR-2'])
                self.assertEqual(self.items(3), [])
                b['section'] = 'Done'
                self.board(2, [b]); self.tick(2); self.tick(3)
                self.assertEqual(self.items(3), ['HTPR-3'])

    def test_pending_acquired_lease_precedes_legacy_after_winner_finishes(self):
        changed = self.task(2, 'HTPR-2', 'Commands')
        winner = self.task(3, 'HTPR-3', 'Search')
        self.board(2, [changed]); self.board(3, [winner])
        self.tick(2); self.tick(3)
        changed['labels'] = [{'name': 'Domain: Search'}]
        self.board(2, [changed]); self.tick(2)
        (self.state / 'runner-1.json').write_text(json.dumps({'items': [{'ticket': 'HTPR-1'}]}))
        self.board(1, [self.task(1, 'HTPR-1', 'Commands')]); self.tick(1)
        winner['section'] = 'Done'
        self.board(3, [winner]); self.tick(3); self.tick(2); self.tick(1)
        self.assertEqual(self.items(2), ['HTPR-2'])
        self.assertEqual(self.items(1), [])

    def test_relabel_to_shared_waits_without_displacing_winner(self):
        changed = self.task(1, 'HTPR-1', 'Commands')
        self.board(1, [changed]); self.tick(1)
        self.board(2, [self.task(2, 'HTPR-2', 'Search')]); self.tick(2)
        changed['labels'] = []
        self.board(1, [changed]); self.tick(1); self.tick(2)
        self.assertEqual(self.items(1), [])
        self.assertEqual(self.items(2), ['HTPR-2'])
        self.board(3, [self.task(3, 'HTPR-3', 'Flags')]); self.tick(3)
        self.assertEqual(self.items(3), [])

    def test_relabel_without_conflict_keeps_old_scope(self):
        changed = self.task(1, 'HTPR-1', 'Commands')
        self.board(1, [changed]); self.tick(1)
        changed['labels'] = [{'name': 'Domain: Search'}]
        self.board(1, [changed]); self.tick(1)
        self.assertEqual(self.items(1), ['HTPR-1'])
        self.board(2, [self.task(2, 'HTPR-2', 'Commands')]); self.tick(2)
        self.assertEqual(self.items(2), [])

    def test_archived_status_releases_lease_on_readback(self):
        task = self.task(1, 'HTPR-1', 'Flags', 'In Progress')
        self.board(1, [task]); self.tick(1)
        self.board(1, [])
        task['status'] = 'Archive'
        (self.root / 'detail-HTPR-1').write_text(json.dumps({'success': True, 'tasks': [task]}))
        self.tick(1)
        self.assertNotIn('1', json.loads((self.state / 'domain-ownership.json').read_text()))

    def test_preview_does_not_write_state(self):
        self.board(1, [self.task(1, 'HTPR-1', 'Flags')])
        result = subprocess.run(['bash', str(SCRIPT), 'preview', '1'], env=self.env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Domain: Flags', result.stdout)
        self.assertEqual(list(self.state.iterdir()), [])

    def test_absent_task_needs_detail_readback(self):
        task = self.task(1, 'HTPR-1', 'Flags')
        self.board(1, [task]); self.tick(1)
        self.board(1, []); self.tick(1)
        self.assertIn('HTPR-1', json.loads((self.state / 'domain-ownership.json').read_text())['1'])
        task['assignees'] = [{'user': {'displayName': 'Human'}}]
        (self.root / 'detail-HTPR-1').write_text(json.dumps({'success': True, 'tasks': [task]}))
        self.tick(1)
        self.assertNotIn('1', json.loads((self.state / 'domain-ownership.json').read_text()))


if __name__ == '__main__':
    unittest.main()
