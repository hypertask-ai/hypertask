#!/usr/bin/env python3
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader('prune', str(HERE / 'evidence-prune'))
spec = importlib.util.spec_from_loader(loader.name, loader)
prune = importlib.util.module_from_spec(spec)
loader.exec_module(prune)


class PruneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='evidence-prune-test-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.state = self.home / '.local/state'
        self.evidence = self.state / 'vcc-evidence'
        self.evidence.mkdir(parents=True)
        self.bin = self.home / 'bin'
        self.bin.mkdir()
        self.calls = self.home / 'calls'
        stub = self.bin / 'hypertask'
        stub.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['TEST_CALLS'], 'a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
if os.environ.get('TEST_BOARD') == 'error':
    sys.exit(1)
if os.environ.get('TEST_BOARD') == 'malformed':
    print('{')
elif os.environ.get('TEST_BOARD') == 'wrong-shape':
    print('[]')
else:
    print(json.dumps({'success': True, 'tasks': [{'section': os.environ.get('TEST_BOARD', 'Done')}]}))
''')
        stub.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TEST_CALLS=str(self.calls), VCC_EVIDENCE_DIR=str(self.evidence))

    def file(self, relative, days=3, root=None):
        path = (root or self.evidence) / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'evidence fixture' * 300)
        stamp = time.time() - days * prune.DAY
        os.utime(path, (stamp, stamp))
        return path

    def run_prune(self, *args, board='Done'):
        result = subprocess.run([str(HERE / 'evidence-prune'), *args], env=dict(self.env, TEST_BOARD=board),
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        summary = json.loads(result.stdout.splitlines()[-1])
        logs = (self.state / 'evidence-prune/log.jsonl').read_text().splitlines()
        self.assertEqual(json.loads(logs[-1]), summary)
        return result, summary

    def test_builds_dry_run_apply_and_retained_evidence(self):
        old = [self.file(f'YPER4-621/audit/{name}/payload') for name in (
            '.next', 'node_modules', 'build-candidate', 'build-baseline', 'build-a', 'build-profile',
            '.pnpm-store', '.cache/ms-playwright', 'node-v24.1.0-linux-x64', 'tmp-a/node_modules')]
        fresh = [self.file(f'YPER4-621/fresh/{name}/payload', 1) for name in ('.next', 'node_modules', 'build-new')]
        kept = [self.file(f'YPER4-621/{name}', 30) for name in (
            'proof.md', 'checklist.md', 'checklist', 'report.json', 'desktop.png', 'report.html', 'notes.md',
            'ordinary/data', '.cache/other/data', 'tmp-keep/data')]
        result, summary = self.run_prune()
        self.assertIn('WOULD DELETE', result.stdout)
        self.assertIn(' GB', result.stdout)
        self.assertGreater(summary['bytes_planned']['builds'], 0)
        self.assertEqual(summary['bytes_freed'], dict(builds=0, videos=0, tmp=0))
        self.assertTrue(all(path.exists() for path in old + fresh + kept))
        result, summary = self.run_prune('--apply')
        self.assertTrue(all(not path.parent.exists() for path in old))
        self.assertTrue(all(path.exists() for path in fresh + kept))
        self.assertGreater(summary['bytes_freed']['builds'], 0)
        self.assertIsInstance(summary['disk_used_pct_before'], int)
        self.assertIsInstance(summary['disk_used_pct_after'], int)
        self.assertEqual(len((self.state / 'evidence-prune/log.jsonl').read_text().splitlines()), 2)
        self.assertFalse(self.calls.exists())

    def test_newest_nested_file_protects_old_build(self):
        old = self.file('YPER4-621/build-old/old')
        fresh = self.file('YPER4-621/build-old/nested/new', 0)
        self.run_prune('--apply')
        self.assertTrue(old.exists() and fresh.exists())

    def test_empty_directory_age(self):
        old = self.evidence / 'YPER4-621/.next'
        old.mkdir(parents=True)
        stamp = time.time() - 3 * prune.DAY
        os.utime(old, (stamp, stamp))
        fresh = old.parent / 'build-fresh'
        fresh.mkdir()
        self.run_prune('--apply')
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())

    def test_symlink_boundaries_and_overridden_roots(self):
        outside = self.file('build-outside/payload', root=self.home)
        (self.evidence / 'node_modules').symlink_to(outside.parent, target_is_directory=True)
        (self.evidence / 'audit').symlink_to(self.home, target_is_directory=True)
        inside = self.file('YPER4-621/build-real/payload')
        link = inside.parent / 'outside'
        link.symlink_to(outside.parent, target_is_directory=True)
        stamp = time.time() - 3 * prune.DAY
        os.utime(link, (stamp, stamp), follow_symlinks=False)
        result, summary = self.run_prune('--apply', '--evidence-root', str(self.evidence))
        self.assertTrue(outside.exists())
        self.assertTrue((self.evidence / 'node_modules').is_symlink())
        self.assertFalse(inside.parent.exists())
        redirected = self.home / 'redirected'
        redirected.symlink_to(self.evidence, target_is_directory=True)
        result, summary = self.run_prune('--apply', '--evidence-root', str(redirected))
        self.assertIn('SKIP', result.stderr)
        self.assertGreater(summary['skipped_paths_count'], 0)

    def test_only_direct_tmp_entries_and_never_state_siblings(self):
        old = []
        kept = []
        for folder in ('hypertask-dev-one', 'hypertask-qa-two'):
            old.append(self.file(f'{folder}/tmp/old/deep/data', root=self.state))
            old.append(self.file(f'{folder}/tmp/old-file', root=self.state))
            kept.append(self.file(f'{folder}/tmp/new/data', 0, self.state))
            for sibling in ('queue.sqlite3', 'queue.sqlite3-wal', 'queue.sqlite3-shm',
                            'provider-homes/home', 'cache/data', 'unlazy/data', 'evidence/proof.md', 'full-trust-shims/bin'):
                kept.append(self.file(f'{folder}/{sibling}', 40, self.state))
        kept.append(self.file('hypertask-other/tmp/old', 40, self.state))
        outside = self.file('outside/payload', 40, self.home)
        (self.state / 'hypertask-dev-one/tmp/link').symlink_to(outside.parent, target_is_directory=True)
        (self.state / 'hypertask-qa-link').symlink_to(outside.parent, target_is_directory=True)
        self.run_prune('--dry-run')
        self.assertTrue(all(path.exists() for path in old + kept))
        result, summary = self.run_prune('--apply')
        self.assertTrue(all(not path.exists() for path in old))
        self.assertTrue(all(path.exists() for path in kept))
        self.assertTrue(outside.exists())
        self.assertGreater(summary['bytes_freed']['tmp'], 0)
        self.assertGreater(summary['skipped_paths_count'], 0)

    def test_done_videos_only_and_once_per_ticket(self):
        videos = [self.file(f'YPER4-621/run/{i}.webm', 15) for i in range(3)]
        fresh = self.file('YPER4-621/fresh.webm', 13)
        unknown = self.file('not-a-ticket/old.webm', 40)
        no_read = self.file('HTPR-123/fresh.webm', 1)
        self.run_prune('--dry-run')
        self.assertTrue(all(path.exists() for path in videos))
        self.calls.unlink()
        self.run_prune('--apply')
        self.assertTrue(all(not path.exists() for path in videos))
        self.assertTrue(all(path.exists() for path in (fresh, unknown, no_read)))
        self.assertEqual([json.loads(line) for line in self.calls.read_text().splitlines()],
                         [['tasks', 'get', 'YPER4-621', '--json']])

    def test_board_errors_non_done_and_malformed_keep_videos(self):
        videos = [self.file(f'YPER4-621/run/{i}.webm', 30) for i in range(2)]
        for board in ('error', 'malformed', 'wrong-shape', 'In Progress', 'done', ''):
            with self.subTest(board=board):
                self.calls.unlink(missing_ok=True)
                self.run_prune('--apply', board=board)
                self.assertTrue(all(path.exists() for path in videos))
                self.assertEqual(len(self.calls.read_text().splitlines()), 1)

    def test_board_timeout_and_missing_cli_keep_videos(self):
        for error in (subprocess.TimeoutExpired('hypertask', 30), FileNotFoundError('hypertask')):
            worker = prune.Pruner(True)
            with patch.object(prune.subprocess, 'run', side_effect=error) as command:
                self.assertFalse(worker.done('YPER4-621'))
                self.assertFalse(worker.done('YPER4-621'))
            self.assertEqual(command.call_count, 1)
            self.assertEqual(len(worker.skipped), 1)

    def test_exact_age_boundary_and_fresh_outer_build_prunes_discovery(self):
        worker = prune.Pruner(True)
        payload = self.file('YPER4-621/.next/payload')
        boundary = worker.now - 2 * prune.DAY
        os.utime(payload, (boundary, boundary))
        worker.candidate(self.evidence, payload.parent, 'builds', 2)
        self.assertTrue(payload.exists())
        os.utime(payload, (boundary - 1, boundary - 1))
        worker.candidate(self.evidence, payload.parent, 'builds', 2)
        self.assertFalse(payload.exists())
        nested = self.file('YPER4-621/build-active/node_modules/old')
        fresh = self.file('YPER4-621/build-active/new', 0)
        self.run_prune('--apply')
        self.assertTrue(nested.exists() and fresh.exists())

    def test_permission_denied_skips_and_continues(self):
        blocked = self.file('YPER4-335/audit/src/node_modules/payload')
        allowed = self.file('YPER4-621/.next/payload')
        blocked.parent.chmod(0)
        self.addCleanup(blocked.parent.chmod, 0o700)
        if os.geteuid() != 0:
            result, summary = self.run_prune('--apply')
            self.assertIn('Permission denied', result.stderr)
            self.assertGreater(summary['skipped_paths_count'], 0)
            self.assertFalse(allowed.exists())
        else:
            worker = prune.Pruner(True)
            with patch.object(worker, 'snapshot', side_effect=PermissionError('Permission denied')):
                worker.candidate(self.evidence, blocked.parent, 'builds', 2)
            self.assertEqual(len(worker.skipped), 1)
        blocked.parent.chmod(0o700)
        self.assertTrue(blocked.exists())

    def test_outside_path_filesystem_and_race_refused(self):
        payload = self.file('YPER4-621/.next/payload')
        worker = prune.Pruner(True)
        worker.candidate(self.evidence, self.home, 'builds', 2)
        self.assertIn(str(self.home), worker.skipped)
        with worker.parent(self.evidence, payload.parent) as (fd, name, device):
            with self.assertRaisesRegex(OSError, 'filesystem boundary'):
                worker.snapshot(fd, name, device + 1)
            tree = worker.snapshot(fd, name, device)
            payload.write_text('changed')
            with self.assertRaisesRegex(OSError, 'entry changed'):
                worker.remove(fd, name, tree)
        self.assertTrue(payload.exists())

    def test_premerge_build_copy_and_exit_cleanup_without_building(self):
        source = (HERE.parents[3] / 'scripts/premerge-local.sh').read_text()
        stage = source[source.index('source_root=$root'):source.index('npm ci --prefer-offline')]
        cleanup = source[source.index('cleanup() {'):source.index('# Logs can contain')]
        checkout = self.evidence / 'YPER4-621/manual-checkout'
        kept = ['package.json', 'src/changed.ts', 'scripts/build-summary.mjs']
        excluded = ['node_modules/large', '.next/large', 'build-candidate/large', '.env.local']
        for name in kept + excluded:
            self.file(name, root=checkout)
        paths = kept + excluded + ['deleted.ts']
        stub = self.bin / 'git'
        stub.write_text('#!/usr/bin/env python3\nimport sys\n'
                        f'paths = {paths!r}\n'
                        'if sys.argv[1] == "ls-files":\n'
                        '    sys.stdout.buffer.write(b"\\0".join(p.encode() for p in paths) + b"\\0")\n'
                        'else:\n    print("a" * 40)\n')
        stub.chmod(0o755)
        script = ('set -euo pipefail\ncd "$root"\nstop() { return 0; }\n' + cleanup + stage +
                  '\nprintf "%s\\n" "$scratch"\n'
                  'test -f scripts/build-summary.mjs\n'
                  'test -f src/changed.ts\n'
                  'test ! -e node_modules\ntest ! -e .next\n'
                  'test ! -e build-candidate\ntest ! -e .env.local\n'
                  'test "$BUILD_ID" = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n')
        for finish, status in (('exit 0', 0), ('exit 17', 17),
                               ('kill -INT "$$"', 130), ('kill -TERM "$$"', 143)):
            with self.subTest(finish=finish):
                result = subprocess.run(['bash', '-c', script + finish], cwd=checkout,
                                        env=dict(self.env, root=str(checkout), state=str(self.home)),
                                        capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                scratch = Path(result.stdout.strip())
                self.assertTrue(str(scratch).startswith('/tmp/ht-premerge-build.'))
                self.assertFalse(scratch.exists())
                self.assertTrue(all((checkout / name).exists() for name in kept + excluded))

    def test_ci_wires_the_direct_fixture_file(self):
        repo = HERE.parents[3]
        command = 'python3 .claude/skills/verify-qa/scripts/evidence-prune.test.py'
        self.assertIn(command, (repo / '.github/workflows/ship-scripts-tests.yml').read_text())
        self.assertIn(command, (repo / 'docs/ci-policy.yml').read_text())
        self.assertIn(command, (repo / 'docs/ci.md').read_text())

    def test_installer_and_units_offline(self):
        calls = self.home / 'install-calls'
        for name in ('systemctl', 'user-unit-check'):
            stub = self.bin / name
            stub.write_text(f'#!/bin/sh\nprintf "%s\\n" "{name} $*" >> "{calls}"\n')
            stub.chmod(0o755)
        result = subprocess.run(['bash', str(HERE / 'evidence-prune-install')],
                                env=dict(self.env, USER_UNIT_CHECK=str(self.bin / 'user-unit-check')),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lines = calls.read_text().splitlines()
        self.assertTrue(lines[0].startswith('user-unit-check '), lines)
        self.assertEqual(lines[1:], ['systemctl --user daemon-reload',
                                    'systemctl --user enable --now evidence-prune.timer'])
        target = self.home / '.local/lib/hypertask/evidence-prune'
        self.assertEqual((target / 'evidence-prune').read_bytes(), (HERE / 'evidence-prune').read_bytes())
        service = (self.home / '.config/systemd/user/evidence-prune.service').read_text()
        timer = (self.home / '.config/systemd/user/evidence-prune.timer').read_text()
        for setting in ('--apply', 'Nice=19', 'IOSchedulingClass=idle'):
            self.assertIn(setting, service)
        self.assertIn('OnCalendar=daily', timer)
        self.assertIn('RandomizedDelaySec=', timer)
        self.assertIn('Persistent=true', timer)
        calls.unlink()
        (self.bin / 'user-unit-check').write_text('#!/bin/sh\nexit 1\n')
        result = subprocess.run(['bash', str(HERE / 'evidence-prune-install')],
                                env=dict(self.env, USER_UNIT_CHECK=str(self.bin / 'user-unit-check')),
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(calls.exists())


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PruneTests))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print('evidence-prune tests passed')
