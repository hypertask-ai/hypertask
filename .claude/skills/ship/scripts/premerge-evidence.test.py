#!/usr/bin/env python3
"""Isolated poster regressions: all GitHub and systemctl calls are local fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('poster', HERE / 'premerge-evidence.py')
poster = importlib.util.module_from_spec(spec)
spec.loader.exec_module(poster)


class PosterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.state = self.root / 'state'
        self.production = self.root / 'production-check'
        self.log = self.root / 'calls'
        self.env = dict(os.environ, HOME=str(self.root),
                        PATH=f'{self.bin}:{os.environ["PATH"]}',
                        PREMERGE_STATUS_STATE=str(self.state),
                        VCC_EVIDENCE_DIR=str(self.root / 'evidence'),
                        POSTER_TEST_ROOT=str(self.root))
        self.write_checker('first')
        (self.bin / 'gh').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['POSTER_TEST_ROOT'])
args = sys.argv[1:]
with (root / 'calls').open('a') as log:
    log.write(json.dumps(args) + '\\n')
if args[:1] == ['api']:
    assert args == ['api', '-H', 'Accept: application/vnd.github.raw',
                    'repos/hypertask-ai/hypertask/contents/.claude/skills/ship/scripts/ship-check?ref=production']
    if (root / 'fetch-error').exists():
        sys.exit(1)
    sys.stdout.buffer.write((root / 'production-check').read_bytes())
elif args[:2] == ['pr', 'list']:
    assert args[args.index('--base') + 1] == 'production'
    print(json.dumps([{'number': n, 'title': f'YPER4-{n} [INFRA] Fixture',
                       'headRefOid': 'a' * 40,
                       'statusCheckRollup': [{'context': 'premerge-evidence', 'state': 'SUCCESS'}]}
                      for n in (998, 999)]))
else:
    raise AssertionError(args)
''')
        (self.bin / 'gh').chmod(0o755)
        (self.bin / 'systemctl').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
with (pathlib.Path(os.environ['POSTER_TEST_ROOT']) / 'systemctl-calls').open('a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
''')
        (self.bin / 'systemctl').chmod(0o755)

    def write_checker(self, version):
        self.production.write_text(f'''#!/usr/bin/env python3
import json, os, pathlib, sys
assert sys.argv[1] == 'premerge-status'
assert os.environ['SHIP_REPO'] == 'hypertask-ai/hypertask'
assert os.environ['SHIP_BASE'] == 'production'
with (pathlib.Path(os.environ['POSTER_TEST_ROOT']) / 'published').open('a') as log:
    log.write(json.dumps([{version!r}, sys.argv[2], __file__]) + '\\n')
print('premerge-evidence: success (fixture)')
''')

    def sweep(self, path=None):
        return subprocess.run(['python3', str(path or HERE / 'premerge-evidence.py')],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def publications(self):
        path = self.root / 'published'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_fetch_each_sweep_and_invalidate_every_pr_immediately(self):
        self.assertEqual(self.sweep().returncode, 0)
        first = json.loads((self.state / 'cache.json').read_text())
        self.assertEqual(len(self.publications()), 2)
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        self.write_checker('second')
        self.assertEqual(self.sweep().returncode, 0)
        second = json.loads((self.state / 'cache.json').read_text())
        self.assertEqual([p[:2] for p in self.publications()[2:]], [['second', '998'], ['second', '999']])
        for key in ('998', '999'):
            self.assertNotEqual(first[key]['fingerprint'], second[key]['fingerprint'])
        self.assertTrue(all(p[2] == str(self.state / 'ship-check') for p in self.publications()))
        self.assertEqual((self.state / 'ship-check').read_bytes(), self.production.read_bytes())
        self.assertEqual((self.state / 'ship-check').stat().st_mode & 0o777, 0o755)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(sum(c[0] == 'api' for c in calls), 3)
        self.assertEqual(sum(c[:2] == ['pr', 'list'] for c in calls), 3)

    def test_fetch_failure_after_deleted_evidence_publishes_nothing_new(self):
        folder = self.root / 'evidence/YPER4-999'
        folder.mkdir(parents=True)
        record = folder / 'premerge.md'
        record.write_text('Recording: click.webm\nClick: PASS fixture\n')
        (folder / 'click.webm').write_bytes(b'recording fixture')
        self.assertEqual(self.sweep().returncode, 0)
        cache = (self.state / 'cache.json').read_bytes()
        checker = (self.state / 'ship-check').read_bytes()
        record.unlink()
        (self.root / 'fetch-error').touch()
        result = self.sweep()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FAIL: premerge-evidence operation failed', result.stderr)
        self.assertEqual(len(self.publications()), 2)
        self.assertEqual((self.state / 'cache.json').read_bytes(), cache)
        self.assertEqual((self.state / 'ship-check').read_bytes(), checker)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual(sum(c[:2] == ['pr', 'list'] for c in calls), 1)
        (self.root / 'fetch-error').unlink()
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 3)
        self.assertEqual(self.publications()[-1][1], '999')
        self.assertNotEqual(json.loads(cache)['999']['fingerprint'],
                            json.loads((self.state / 'cache.json').read_text())['999']['fingerprint'])

    def test_empty_fetch_fails_without_publishing(self):
        self.production.write_bytes(b'')
        self.assertNotEqual(self.sweep().returncode, 0)
        self.assertEqual(self.publications(), [])
        self.assertFalse((self.state / 'cache.json').exists())

    def test_checker_replacement_is_atomic_and_executable_before_rename(self):
        self.assertEqual(self.sweep().returncode, 0)
        old = (self.state / 'ship-check').read_bytes()
        self.write_checker('second')
        replace = Path.replace
        observed = []

        def inspect(path, target):
            if path.name == 'ship-check.tmp':
                self.assertEqual(Path(target).read_bytes(), old)
                self.assertEqual(path.read_bytes(), self.production.read_bytes())
                self.assertTrue(os.access(path, os.X_OK))
                observed.append(target)
            return replace(path, target)

        with patch.dict(os.environ, self.env, clear=True), patch.object(Path, 'replace', inspect):
            poster.sweep()
        self.assertEqual(observed, [self.state / 'ship-check'])
        self.assertFalse((self.state / 'ship-check.tmp').exists())

    def test_install_in_fake_home_survives_without_installed_checker(self):
        result = subprocess.run(['python3', str(HERE / 'premerge-evidence.py'), '--install'],
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.root / '.local/lib/hypertask/premerge-evidence'
        for name in ('premerge-evidence.py', 'ship-check'):
            self.assertEqual((target / name).read_bytes(), (HERE / name).read_bytes())
        for suffix in ('service', 'timer'):
            name = f'premerge-evidence.{suffix}'
            self.assertEqual((self.root / '.config/systemd/user' / name).read_bytes(), (HERE / name).read_bytes())
        calls = [json.loads(line) for line in (self.root / 'systemctl-calls').read_text().splitlines()]
        self.assertEqual(calls, [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'premerge-evidence.timer']])
        (target / 'ship-check').unlink()
        self.assertEqual(self.sweep(target / 'premerge-evidence.py').returncode, 0)
        self.assertEqual(len(self.publications()), 2)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PosterTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    print('poster regressions passed')
