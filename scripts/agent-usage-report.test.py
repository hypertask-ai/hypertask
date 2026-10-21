#!/usr/bin/env python3
"""Tests for agent-usage-report.py (YPER4-382). Fixture transcripts only; no real sessions read."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('usage_report', HERE / 'agent-usage-report.py')
ur = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ur)


def call(sid, mid, ts, inp, creation, read):
    return {'type': 'assistant', 'sessionId': sid, 'timestamp': ts,
            'message': {'id': mid, 'model': 'claude-opus-5-5',
                        'usage': {'input_tokens': inp, 'cache_creation_input_tokens': creation,
                                  'cache_read_input_tokens': read, 'output_tokens': 5}}}


def write(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(json.dumps(r) + '\n' for r in records))


class UsageReportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        write(root / 'proj' / 'r1.jsonl', [
            {'type': 'custom-title', 'sessionId': 'r1', 'customTitle': 'RUNNER 7'},
            call('r1', 'm1', '2026-10-14T10:00:00Z', 10, 30000, 0),
            # Streaming repeats the same message id: counted once, fullest record kept.
            call('r1', 'm2', '2026-10-14T10:01:00Z', 0, 0, 1000),
            call('r1', 'm2', '2026-10-14T10:01:00Z', 10, 100, 30000),
        ])
        write(root / 'proj' / 'l1.jsonl', [
            {'type': 'custom-title', 'sessionId': 'l1', 'customTitle': 'HT Product Lead'},
            call('l1', 'm3', '2026-10-14T11:00:00Z', 0, 0, 50000),
        ])
        write(root / 'proj' / 'r1' / 'subagents' / 'a1.jsonl', [
            call('r1', 'm4', '2026-10-14T10:02:00Z', 0, 20000, 0),
        ])
        requests, _, _ = ur.scan(root)
        since = ur.timestamp('2026-10-14T00:00:00Z')
        until = ur.timestamp('2026-10-15T00:00:00Z')
        self.data = ur.report(requests, since, until, {}, 0.0)

    def tearDown(self):
        self.tmp.cleanup()

    def test_roles_and_dedupe(self):
        roles = self.data['roles']
        self.assertEqual(roles['runner']['api_calls'], 2)
        self.assertEqual(roles['runner']['total_read'], 30000)
        self.assertEqual(roles['lead']['api_calls'], 1)
        self.assertEqual(roles['subagent']['api_calls'], 1)
        self.assertEqual(self.data['overall']['api_calls'], 4)

    def test_first_call_and_mean(self):
        runner = self.data['roles']['runner']
        self.assertEqual(runner['median_first_call_size'], 30010)
        self.assertEqual(runner['mean_input_size'], (30010 + 30110) / 2)

    def test_text_report_has_every_role(self):
        text = ur.text_report(self.data)
        for name in ('runner', 'lead', 'growth', 'subagent', 'other', 'overall'):
            self.assertIn(name, text)


if __name__ == '__main__':
    unittest.main()
