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
if args[:2] == ['api', 'repos/hypertask-ai/hypertask/statuses/' + 'a' * 40]:
    assert args[2:] == ['--method', 'POST', '-f', 'context=premerge-evidence', '-f', 'state=failure',
                        '-f', 'description=cannot load current premerge rules; retry']
    if (root / 'post-error-once').exists():
        (root / 'post-error-once').unlink()
        sys.exit(1)
    with (root / 'statuses').open('a') as log:
        log.write('failure\\n')
elif args[:1] == ['api']:
    assert args == ['api', 'repos/hypertask-ai/hypertask/contents/.claude/skills/ship/scripts/ship-check?ref=production']
    if (root / 'fetch-error').exists():
        sys.exit(1)
    import base64
    content = base64.encodebytes((root / 'production-check').read_bytes()).decode()
    print(json.dumps({'name': 'ship-check', 'encoding': 'base64', 'content': content}))
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

    def test_fetch_failure_after_deleted_evidence_revokes_passing_statuses(self):
        folder = self.root / 'evidence/YPER4-999'
        folder.mkdir(parents=True)
        record = folder / 'premerge.md'
        record.write_text('Recording: click.webm\nClick: PASS fixture\n')
        (folder / 'click.webm').write_bytes(b'recording fixture')
        self.assertEqual(self.sweep().returncode, 0)
        checker = (self.state / 'ship-check').read_bytes()
        record.unlink()
        (self.root / 'fetch-error').touch()
        result = self.sweep()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FAIL: premerge-evidence operation failed', result.stderr)
        # The stale checker never runs; every passing head turns red instead.
        self.assertEqual(len(self.publications()), 2)
        self.assertEqual(len((self.root / 'statuses').read_text().splitlines()), 2)
        self.assertFalse((self.state / 'cache.json').exists())
        self.assertEqual((self.state / 'ship-check').read_bytes(), checker)
        (self.root / 'fetch-error').unlink()
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(sorted(p[1] for p in self.publications()[2:]), ['998', '999'])

    def test_revocation_waits_for_publisher_lock_and_tries_every_pr(self):
        import fcntl, threading, time
        self.assertEqual(self.sweep().returncode, 0)
        (self.root / 'fetch-error').touch()
        (self.root / 'post-error-once').touch()
        lock = (self.state / 'publish.lock').open('w')
        fcntl.flock(lock, fcntl.LOCK_EX)
        released = []
        def release():
            time.sleep(1)
            released.append(time.time())
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
        threading.Thread(target=release).start()
        result = self.sweep()
        finished = time.time()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(released and finished >= released[0])
        # First PR's post fails, the second is still revoked.
        self.assertEqual(len((self.root / 'statuses').read_text().splitlines()), 1)

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
