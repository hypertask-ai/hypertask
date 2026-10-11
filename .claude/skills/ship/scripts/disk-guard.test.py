#!/usr/bin/env python3
"""Safety fixtures never inspect or delete the real host's projects or tmp."""
import contextlib
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('disk_guard', HERE / 'disk-guard.py')
disk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(disk)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='disk-guard-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.tmp = self.root / 'tmp'
        self.home.mkdir()
        self.tmp.mkdir()
        self.guard = disk.Guard(self.home, self.tmp, verbose=True)
        self.guard.state.mkdir(parents=True)
        self.output = io.StringIO()
        redirect = contextlib.redirect_stdout(self.output)
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)
        self.process = patch.object(disk, 'process_paths', return_value=(set(), False))
        self.paths = self.process.start()
        self.addCleanup(self.process.stop)
        # Never read real command lines or reach the real Docker daemon from a test.
        self.cmdlines = patch.object(disk, 'cmdline_paths', return_value=(set(), set(), True)).start()
        self.docker = patch.object(disk, 'docker_available', return_value=False).start()
        # 79%: above the cache line, below the 80% cleanup and 90% alert. Tests override it explicitly.
        if not os.environ.get('DISK_GUARD_TEST_REAL_USAGE'):
            self.usage = patch.object(disk.Guard, 'usage', return_value=79).start()
        host = os.environ.get('DISK_GUARD_TEST_HOST_PERCENT')
        if host:
            # Simulate any host fill level to prove no test reads the real disk.
            used = int(float(host) * 10)
            fake = SimpleNamespace(f_blocks=1000, f_bfree=1000 - used, f_bavail=1000 - used, f_frsize=4096)
            patch.object(disk.os, 'statvfs', return_value=fake).start()
        self.addCleanup(patch.stopall)

    def old(self, path, days=4):
        paths = list(path.rglob('*')) if path.is_dir() else []
        for item in paths + [path]:
            if not item.is_symlink():
                os.utime(item, (self.guard.now - days * disk.DAY,) * 2)

    def output_dir(self, path, days=4):
        path.mkdir(parents=True)
        (path / 'output').write_text('cache\n' * 1000)
        self.old(path, days)
        return path

    def git(self, repo, *args):
        return disk.command(['git', *args], repo)

    def repo(self):
        repo = self.home / 'projects/repo'
        repo.mkdir(parents=True)
        self.git(repo, 'init', '-b', 'production')
        self.git(repo, 'remote', 'add', 'origin', 'https://github.com/fixture/repo.git')
        self.git(repo, 'config', 'user.name', 'Fixture')
        self.git(repo, 'config', 'user.email', 'fixture@example.invalid')
        (repo / 'file').write_text('tracked\n')
        self.git(repo, 'add', 'file')
        self.git(repo, 'commit', '-m', 'fixture')
        self.git(repo, 'update-ref', 'refs/remotes/origin/production', 'HEAD')
        self.git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/production')
        tree = repo.parent / 'linked'
        self.git(repo, 'worktree', 'add', '-b', 'feature', str(tree))
        self.old(tree)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        gh = bin_dir / 'gh'
        gh.write_text('#!/usr/bin/env python3\nimport os,sys\n'
                      'open(os.environ["GH_CALLS"],"a").write("call " + " ".join(sys.argv[1:]) + "\\n")\n'
                      'print(os.environ.get("GH_ROWS", "[]"))\n'
                      'sys.exit(int(os.environ.get("GH_EXIT", "0")))\n')
        gh.chmod(0o755)
        env = patch.dict(os.environ, {'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'GH_ROWS': '[]',
                                     'GH_EXIT': '0', 'GH_CALLS': str(self.root / 'gh-calls')})
        env.start()
        self.addCleanup(env.stop)
        return repo, tree


class TemporaryTests(Fixture):
    def test_old_removed_fresh_kept_and_bytes_recorded(self):
        old = self.output_dir(self.tmp / 'old')
        fresh = self.output_dir(self.tmp / 'fresh', 1)
        self.guard.temporary()
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())
        self.assertGreater(self.guard.freed, 0)
        self.assertIn('bytes_freed=', (self.guard.state / 'log').read_text())

    def test_spent_time_budget_starts_no_removal(self):
        old = self.output_dir(self.tmp / 'old')
        self.guard.deadline = 0
        self.guard.temporary()
        self.assertTrue(old.exists())
        self.assertIn('time budget reached', self.output.getvalue())

    def test_newest_nested_mtime_blocks_removal(self):
        path = self.output_dir(self.tmp / 'old')
        (path / 'output').touch()
        self.guard.temporary()
        self.assertTrue(path.exists())

    def test_foreign_descendant_kept(self):
        path = self.output_dir(self.tmp / 'old')
        with patch.object(disk.os, 'getuid', return_value=os.getuid() + 1):
            self.guard.temporary()
        self.assertTrue(path.exists())
        self.assertIn('foreign owner', self.output.getvalue())

    def test_open_file_held_by_real_process_kept(self):
        path = self.output_dir(self.tmp / 'held')
        child = subprocess.Popen([sys.executable, '-c',
            'import sys; f=open(sys.argv[1]); print("ready",flush=True); sys.stdin.read()', str(path / 'output')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            self.process.stop()
            self.guard.temporary()
            self.assertTrue(path.exists())
            paths, _ = disk.process_paths()
            self.assertIn(path / 'output', paths)
            self.assertIn('process has cwd/fd/root inside', self.output.getvalue())
        finally:
            child.communicate('', timeout=10)

    def test_cwd_fd_and_root_link_targets_detected(self):
        proc = self.root / 'proc/123'
        (proc / 'fd').mkdir(parents=True)
        paths = [self.tmp / name for name in ('cwd', 'root', 'fd')]
        for name, target in zip(('cwd', 'root', 'fd/1'), paths):
            (proc / name).symlink_to(target)
        self.process.stop()
        with patch.object(disk.subprocess, 'run', side_effect=FileNotFoundError('sudo unavailable')):
            found, unknown = disk.process_paths(proc.parent)
        self.assertEqual(found, set(paths))
        self.assertFalse(unknown)

    def test_incomplete_process_scan_keeps(self):
        path = self.output_dir(self.tmp / 'old')
        self.paths.return_value = (set(), {Path('/proc/123')})
        self.guard.temporary()
        self.assertTrue(path.exists())

    def test_registered_tmp_worktree_kept(self):
        repo, tree = self.repo()
        tmp_tree = self.tmp / 'registered'
        self.git(repo, 'worktree', 'add', '-b', 'tmp-feature', str(tmp_tree))
        self.old(tmp_tree)
        self.guard.discover()
        self.guard.temporary()
        self.assertTrue(tmp_tree.exists())
        self.assertIn('registered git worktree', self.output.getvalue())

    def test_bad_repo_does_not_block_unrelated_tmp_cleanup(self):
        path = self.output_dir(self.tmp / 'old')
        broken = self.output_dir(self.home / 'projects/orphan')
        (broken / '.git').write_text('gitdir: /missing-main-repo/.git/worktrees/orphan\n')
        self.old(broken)
        self.guard.discover()
        self.guard.temporary()
        self.assertFalse(path.exists())
        self.assertTrue(broken.exists())

    def test_claude_scratch_only_named_old_caches_removed(self):
        scratch = self.output_dir(self.tmp / 'claude-123')
        build = self.output_dir(scratch / 'build')
        cache = self.output_dir(scratch / 'build/.next/cache')
        compile_cache = self.output_dir(scratch / 'node-compile-cache')
        self.guard.temporary()
        self.assertTrue(scratch.exists())
        self.assertTrue(build.exists())
        self.assertTrue((scratch / 'output').exists())
        self.assertFalse(cache.exists())
        self.assertFalse(compile_cache.exists())

    def test_live_cache_kept_even_under_claude(self):
        cache = self.output_dir(self.tmp / 'claude-123/.next/cache')
        self.paths.return_value = ({cache / 'output'}, False)
        self.guard.temporary()
        self.assertTrue(cache.exists())

    def test_symlink_never_followed(self):
        target = self.output_dir(self.root / 'valuable')
        (self.tmp / 'link').symlink_to(target)
        self.guard.temporary()
        self.assertTrue(target.exists())
        self.assertTrue((self.tmp / 'link').is_symlink())

    def test_process_scan_is_refreshed_before_deletion(self):
        path = self.output_dir(self.tmp / 'old')
        self.paths.side_effect = [(set(), False), ({path / 'output'}, False)]
        self.guard.temporary()
        self.assertTrue(path.exists())
        self.assertEqual(self.paths.call_count, 2)

    def test_special_file_kept(self):
        fifo = self.tmp / 'pipe'
        os.mkfifo(fifo)
        self.old(fifo)
        self.guard.temporary()
        self.assertTrue(fifo.exists())
        self.assertIn('special file', self.output.getvalue())

    def test_dry_run_has_no_cleanup_or_state_writes(self):
        path = self.output_dir(self.tmp / 'old')
        self.guard.dry = True
        self.guard.temporary()
        self.assertTrue(path.exists())
        self.assertFalse((self.guard.state / 'log').exists())
        self.assertGreater(self.guard.planned, 0)

    def test_nested_git_file_or_directory_keeps_tmp_entry(self):
        for depth in (0, 1, 4, 5, 12):
            for directory in (False, True):
                with self.subTest(depth=depth, directory=directory):
                    entry = self.output_dir(self.tmp / f'git-{depth}-{directory}')
                    repo = entry.joinpath(*(['nested'] * depth))
                    repo.mkdir(parents=True, exist_ok=True)
                    marker = repo / '.git'
                    if directory:
                        marker.mkdir()
                    else:
                        marker.write_text('gitdir: /missing/repo\n')
                    self.old(entry)
                    self.guard.temporary()
                    self.assertTrue(entry.exists())
                    self.assertTrue(marker.exists())

    def test_git_inspection_errors_keep_candidate(self):
        entry = self.output_dir(self.tmp / 'old')
        for method in ('lstat', 'iterdir'):
            real = getattr(disk.Path, method)
            def inspect(path, *args, **kwargs):
                if path == entry:
                    raise PermissionError('fixture')
                return real(path, *args, **kwargs)
            with self.subTest(method=method), patch.object(disk.Path, method, inspect):
                self.assertTrue(disk.contains_git(entry))
                self.guard.temporary()
            self.assertTrue(entry.exists())

    def test_git_inspection_does_not_follow_symlinks(self):
        entry = self.output_dir(self.tmp / 'old')
        (entry / 'loop').symlink_to(entry)
        self.assertFalse(disk.contains_git(entry))
        self.guard.temporary()
        self.assertTrue(entry.exists())  # The existing symlink safety rule still applies.

    def test_failed_discovery_still_protects_successfully_registered_tree(self):
        repo, _ = self.repo()
        registered = self.tmp / 'registered'
        self.git(repo, 'worktree', 'add', '-b', 'tmp-feature', str(registered))
        self.old(registered)
        broken = self.output_dir(self.home / 'projects/orphan')
        (broken / '.git').write_text('gitdir: /missing-main-repo/.git/worktrees/orphan\n')
        unrelated = self.output_dir(self.tmp / 'old')
        self.guard.discover()
        # Successful registration protects even if the marker disappears afterwards.
        (registered / '.git').unlink()
        self.old(registered)
        self.guard.temporary()
        self.assertTrue(registered.exists())
        self.assertFalse(unrelated.exists())


class ProcessTests(Fixture):
    def setUp(self):
        super().setUp()
        sudo = patch.object(disk.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['sudo']))
        self.sudo = sudo.start()
        self.addCleanup(sudo.stop)

    def test_privileged_scan_keeps_used_candidate(self):
        target = self.output_dir(self.tmp / 'old')
        self.process.stop()
        self.sudo.side_effect = None
        self.sudo.return_value = subprocess.CompletedProcess([], 0, json.dumps([str(target / 'output')]))
        self.guard.temporary()
        self.assertTrue(target.exists())
        self.assertIn('process has cwd/fd/root inside', self.output.getvalue())
        self.sudo.assert_called_once_with(
            ['sudo', '-n', '/usr/bin/python3', '-I', '-c', disk.PRIVILEGED_PROCESS_SCAN],
            capture_output=True, text=True, check=True, timeout=60)
        self.assertEqual(self.guard.process_snapshot, ({target / 'output'}, set()))

    def test_privileged_scan_removes_unused_old_candidate(self):
        target = self.output_dir(self.tmp / 'old')
        self.process.stop()
        self.sudo.side_effect = None
        self.sudo.return_value = subprocess.CompletedProcess([], 0, '[]')
        # A successful privileged scan must not consult the unprivileged scan.
        with patch.object(disk.Path, 'iterdir', wraps=disk.Path.iterdir) as entries:
            found, uncertain = disk.process_paths()
            entries.assert_not_called()
        self.assertEqual((found, uncertain), (set(), set()))
        self.guard.temporary()
        self.assertFalse(target.exists())
        self.assertEqual(self.sudo.call_count, 3)  # Direct call, initial scan, pre-delete refresh.

    def test_invalid_privileged_output_falls_back_and_keeps_root_cache(self):
        process = self.proc(123)
        target = self.output_dir(self.tmp / 'claude-123/.next/cache')
        self.process.stop()
        self.sudo.side_effect = None
        for output in ('not JSON', '{}', '[null]', '["relative"]'):
            with self.subTest(output=output):
                self.sudo.return_value = subprocess.CompletedProcess([], 0, output)
                with self.foreign_owner(process, 0), \
                     patch.object(disk.os, 'readlink', side_effect=PermissionError('root')):
                    snapshot = disk.process_paths(process.parent)
                    self.assertEqual(snapshot, (set(), {process}))
                    with patch.object(disk, 'process_paths', return_value=snapshot):
                        self.guard.temporary()
                self.assertTrue(target.exists())
        self.assertIn('privileged process scan unavailable', self.output.getvalue())

    def test_sudo_unavailable_or_timeout_falls_back(self):
        process = self.proc(123)
        self.process.stop()
        for error in (FileNotFoundError('sudo'), subprocess.TimeoutExpired(['sudo'], 60),
                      subprocess.CalledProcessError(1, ['sudo'])):
            with self.subTest(error=type(error).__name__):
                self.sudo.side_effect = error
                found, uncertain = disk.process_paths(process.parent)
                self.assertEqual(found, {self.home, Path('/')})
                self.assertFalse(uncertain)

    def test_embedded_scan_reads_links_and_strips_deleted_suffix(self):
        entries = [contextlib.nullcontext(iter([Path('/proc/123')])),
                   contextlib.nullcontext(iter([SimpleNamespace(path='/proc/123/fd/1')]))]
        with patch.object(disk.os, 'scandir', side_effect=entries), \
             patch.object(disk.os, 'readlink', side_effect=['/tmp/used (deleted)', '/', '/usr/bin/node', 'socket:[1]']) as links:
            exec(disk.PRIVILEGED_PROCESS_SCAN, {})
        self.assertEqual(json.loads(self.output.getvalue()), ['/', '/tmp/used', '/usr/bin/node'])
        self.assertEqual([call.args[0] for call in links.call_args_list],
                         ['/proc/123/cwd', '/proc/123/root', '/proc/123/exe', '/proc/123/fd/1'])

    def test_embedded_scan_skips_vanished_processes_and_descriptors(self):
        with patch.object(disk.os, 'scandir', side_effect=[
                contextlib.nullcontext(iter([Path('/proc/123')])), FileNotFoundError('vanished')]), \
             patch.object(disk.os, 'readlink', side_effect=[FileNotFoundError('vanished'),
                                                          ProcessLookupError('vanished'),
                                                          FileNotFoundError('kernel thread')]):
            exec(disk.PRIVILEGED_PROCESS_SCAN, {})
        self.assertEqual(json.loads(self.output.getvalue()), [])

    def test_embedded_scan_fails_on_permission_or_io_errors(self):
        for operation in ('scandir', 'readlink'):
            for error in (PermissionError('unreadable'), OSError(errno.EIO, 'I/O error')):
                with self.subTest(operation=operation, error=type(error).__name__):
                    entries = [contextlib.nullcontext(iter([Path('/proc/123')])),
                               error if operation == 'scandir' else contextlib.nullcontext(iter([]))]
                    with patch.object(disk.os, 'scandir', side_effect=entries), \
                         patch.object(disk.os, 'readlink', side_effect=error), \
                         self.assertRaises(type(error)):
                        exec(disk.PRIVILEGED_PROCESS_SCAN, {})
        self.assertEqual(self.output.getvalue(), '')

    def proc(self, pid):
        process = self.root / 'proc' / str(pid)
        (process / 'fd').mkdir(parents=True)
        (process / 'cwd').symlink_to(self.home)
        (process / 'root').symlink_to('/')
        return process

    def test_unreadable_login_agent_or_zombie_does_not_make_scan_uncertain(self):
        self.process.stop()
        for pid, comm, state, harmless in [(201, 'sshd', 'S', True), (202, 'codex', 'Z', True), (203, 'node', 'S', False)]:
            process = self.proc(pid)
            (process / 'comm').write_text(comm + '\n')
            (process / 'status').write_text(f'Name:\t{comm}\nState:\t{state} (x)\n')
            with patch.object(disk.os, 'readlink', side_effect=PermissionError('not dumpable')):
                _, uncertain = disk.process_paths(process.parent, [process])
            self.assertEqual(bool(uncertain), not harmless, comm)

    def foreign_owner(self, process, uid):
        real_stat = disk.Path.stat
        def owner(path, *args, **kwargs):
            info = real_stat(path, *args, **kwargs)
            if path == process:
                fields = list(info)
                fields[4] = uid
                return os.stat_result(fields)
            return info
        return patch.object(disk.Path, 'stat', owner)

    def test_other_uid_readable_fd_keeps_candidate(self):
        process = self.proc(123)
        target = self.output_dir(self.tmp / 'old')
        (process / 'fd/1').symlink_to(target / 'output')
        self.process.stop()
        with self.foreign_owner(process, os.getuid() + 1):
            found, uncertain = disk.process_paths(process.parent)
        self.assertIn(target / 'output', found)
        self.assertFalse(uncertain)
        with patch.object(disk, 'process_paths', return_value=(found, uncertain)):
            self.guard.temporary()
        self.assertTrue(target.exists())
        self.assertIn('process has cwd/fd/root inside', self.output.getvalue())

    def test_other_uid_unreadable_process_keeps_ordinary_candidate(self):
        process = self.proc(123)
        # The harmless list and zombie exemption apply only to our own UID.
        (process / 'comm').write_text('sshd\n')
        (process / 'status').write_text('State:\tZ (zombie)\n')
        self.process.stop()
        for uid in (os.getuid() + 1, 0):
            for mode in (0o755, 0o700):
                with self.subTest(uid=uid, mode=oct(mode)):
                    target = self.output_dir(self.tmp / f'old-{uid}-{mode}')
                    target.chmod(mode)
                    with self.foreign_owner(process, uid), \
                         patch.object(disk.os, 'readlink', side_effect=PermissionError('other uid')) as links:
                        found, uncertain = disk.process_paths(process.parent)
                        self.assertEqual(found, set())
                        self.assertEqual(uncertain, {process})
                        self.assertTrue(links.called)
                        with patch.object(disk, 'process_paths', return_value=(found, uncertain)):
                            self.guard.temporary()
                    self.assertTrue(target.exists())
        self.assertIn('privileged process scan unavailable', self.output.getvalue())

    def test_sudo_failure_and_unreadable_root_keeps_all_old_named_caches(self):
        process = self.proc(123)
        self.process.stop()
        with self.foreign_owner(process, 0), \
             patch.object(disk.os, 'readlink', side_effect=PermissionError('root')):
            found, uncertain = disk.process_paths(process.parent)
            self.assertEqual(uncertain, {process})
            with patch.object(disk, 'process_paths', return_value=(found, uncertain)):
                for name in ('claude-123/.next/cache', 'node-compile-cache-123',
                             '.zig-cache', 'zig-cache', 'zig-cache-123', 'zig016-123'):
                    with self.subTest(name=name):
                        target = self.output_dir(self.tmp / name)
                        (target / 'output').touch()
                        self.guard.temporary()
                        self.assertTrue(target.exists())
                        self.old(target)
                        self.guard.temporary()
                        self.assertTrue(target.exists())
                        self.assertIn('privileged process scan unavailable', self.output.getvalue())

                checkout = self.output_dir(self.tmp / 'zig016-checkout')
                (checkout / '.git').mkdir()
                self.old(checkout)
                self.guard.temporary()
                self.assertTrue(checkout.exists())

    def test_unreadable_root_does_not_override_readable_cache_usage(self):
        process = self.proc(123)
        target = self.output_dir(self.tmp / 'claude-123/.next/cache')
        self.paths.return_value = ({target / 'output'}, {process})
        with self.foreign_owner(process, 0):
            self.guard.temporary()
        self.assertTrue(target.exists())
        self.assertIn('process has cwd/fd/root inside', self.output.getvalue())

    def test_readable_other_uid_fd_keeps_even_when_cwd_is_unreadable(self):
        process = self.proc(123)
        target = self.output_dir(self.tmp / 'old')
        (process / 'fd/1').symlink_to(target / 'output')
        self.process.stop()
        real_readlink = disk.os.readlink
        def readlink(path):
            if path == process / 'cwd':
                raise PermissionError('fixture')
            return real_readlink(path)
        with self.foreign_owner(process, os.getuid() + 1), patch.object(disk.os, 'readlink', readlink):
            found, uncertain = disk.process_paths(process.parent)
        self.assertIn(target / 'output', found)
        self.assertEqual(uncertain, {process})
        with patch.object(disk, 'process_paths', return_value=(found, uncertain)):
            self.guard.temporary()
        self.assertTrue(target.exists())

    def test_readable_other_uid_cwd_keeps_even_when_fd_listing_is_unreadable(self):
        process = self.proc(123)
        target = self.output_dir(self.tmp / 'old')
        (process / 'cwd').unlink()
        (process / 'cwd').symlink_to(target)
        self.process.stop()
        real_iterdir = disk.Path.iterdir
        def entries(path):
            if path == process / 'fd':
                raise PermissionError('fixture')
            return real_iterdir(path)
        with self.foreign_owner(process, os.getuid() + 1), patch.object(disk.Path, 'iterdir', entries):
            found, uncertain = disk.process_paths(process.parent)
        self.assertIn(target, found)
        self.assertEqual(uncertain, {process})
        with patch.object(disk, 'process_paths', return_value=(found, uncertain)):
            self.guard.temporary()
        self.assertTrue(target.exists())

    def test_own_unreadable_process_keeps_one_candidate_then_retries(self):
        process = self.proc(123)
        held = self.output_dir(self.tmp / 'held')
        other = self.output_dir(self.tmp / 'other')
        self.process.stop()
        with patch.object(disk.os, 'readlink', side_effect=PermissionError('own uid')):
            incomplete = disk.process_paths(process.parent)
        self.assertTrue(incomplete[1])
        real_iterdir = disk.Path.iterdir
        def entries(path):
            return iter([held, other]) if path == self.tmp else real_iterdir(path)
        with patch.object(disk.Path, 'iterdir', entries), \
             patch.object(disk, 'process_paths', side_effect=[incomplete, (set(), set()), (set(), set())]) as scan:
            self.guard.temporary()
            self.assertEqual(scan.call_count, 3)
            self.assertEqual(scan.call_args_list[1].kwargs, {'processes': {process}})
            self.assertEqual(scan.call_args_list[2].kwargs, {})
        self.assertTrue(held.exists())
        self.assertFalse(other.exists())


class LoggingTests(Fixture):
    def setUp(self):
        super().setUp()
        self.guard = disk.Guard(self.home, self.tmp)

    def test_summary_only_with_reason_counts_no_keep_detail_on_disk(self):
        for i in range(100):
            self.output_dir(self.tmp / f'fresh-{i}', 1)
        with patch.object(self.guard, 'usage', return_value=80), patch.object(self.guard, 'images'):
            self.guard.run()
        text = (self.guard.state / 'log').read_text()
        self.assertEqual(len(text.splitlines()), 1)
        self.assertIn('summary:', text)
        self.assertNotIn('fresh-', text)
        self.assertEqual(self.output.getvalue(), text)
        status = json.loads((self.guard.state / 'status.json').read_text())
        self.assertEqual(status['keep_reasons'], {'newest mtime is not older than 2 days': 100})
        self.assertEqual(status['freed'], 0)
        self.assertEqual(status['kept'], 100)

    def test_default_removals_and_errors_are_logged(self):
        self.guard.verbose = False
        removed = self.output_dir(self.tmp / 'old')
        failed = self.output_dir(self.tmp / 'failed')
        real_inventory = disk.inventory
        def inspect(path, *args, **kwargs):
            if path == failed:
                raise PermissionError('fixture')
            return real_inventory(path, *args, **kwargs)
        with patch.object(disk, 'inventory', side_effect=inspect), \
             patch.object(self.guard, 'usage', return_value=80), patch.object(self.guard, 'images'):
            self.guard.run()
        text = (self.guard.state / 'log').read_text()
        self.assertEqual(len(text.splitlines()), 3)
        self.assertIn('removed:', text)
        self.assertIn('error:', text)
        self.assertEqual(text.count('summary:'), 1)
        self.assertFalse(removed.exists())
        self.assertTrue(failed.exists())

    def test_verbose_keep_details_are_opt_in(self):
        self.guard.verbose = True
        kept = self.output_dir(self.tmp / 'fresh', 1)
        self.guard.temporary()
        self.assertIn(str(kept), self.output.getvalue())
        self.assertIn('kept:', self.output.getvalue())
        self.assertIn(str(kept), (self.guard.state / 'log').read_text())

    def test_rotation_at_five_mib_retains_only_one_previous_file(self):
        self.guard.verbose = False
        log = self.guard.state / 'log'
        previous = self.guard.state / 'log.1'
        previous.write_text('older rotation')
        with log.open('wb') as stream:
            stream.truncate(5 * 1024 * 1024 - 1)
        self.guard.log('error', 'fixture', 'rotation test')
        self.assertEqual(previous.stat().st_size, 5 * 1024 * 1024 - 1)
        self.assertLess(log.stat().st_size, 1024)
        self.assertEqual(sorted(p.name for p in self.guard.state.glob('log*')), ['log', 'log.1'])


class ReportTests(Fixture):
    def test_orphan_report_includes_size_newest_mtime_and_never_deletes(self):
        orphan = self.output_dir(self.home / 'projects/orphan')
        (orphan / '.git').write_text('gitdir: /missing-main-repo/.git/worktrees/orphan\n')
        self.old(orphan)
        newest, size = disk.inventory(orphan)
        with patch.object(disk, 'command', side_effect=subprocess.CalledProcessError(128, 'fixture')):
            report = self.guard.report().read_text()
        row = next(line for line in report.splitlines() if str(orphan) in line)
        self.assertIn('orphan worktree folder, main repo missing', row)
        self.assertIn(str(size), row)
        self.assertIn(disk.datetime.fromtimestamp(newest, disk.timezone.utc).isoformat(), row)
        self.assertIn('keep', row)
        self.assertTrue(orphan.exists())


class WorktreeTests(Fixture):
    def sweep(self):
        self.guard.worktrees(self.guard.discover())

    def test_merged_old_removed_and_branch_deleted(self):
        repo, tree = self.repo()
        self.sweep()
        self.assertFalse(tree.exists())
        self.assertTrue(repo.exists())
        self.assertNotIn('refs/heads/feature', self.git(repo, 'for-each-ref', '--format=%(refname)'))

    def test_merged_pr_proves_squash_merged_tip(self):
        repo, tree = self.repo()
        (tree / 'file').write_text('squash merged work')
        self.git(tree, 'commit', '-am', 'feature')
        tip = self.git(tree, 'rev-parse', 'HEAD')
        os.environ['GH_ROWS'] = json.dumps([{'state': 'MERGED', 'headRefName': 'feature', 'headRefOid': tip}])
        self.old(tree)
        self.sweep()
        self.assertFalse(tree.exists())
        self.assertTrue(repo.exists())

    def test_reused_merged_pr_branch_with_new_commits_kept(self):
        repo, tree = self.repo()
        prior = self.git(tree, 'rev-parse', 'HEAD')
        (tree / 'file').write_text('new unmerged work')
        self.git(tree, 'commit', '-am', 'new feature work')
        os.environ['GH_ROWS'] = json.dumps([{'state': 'MERGED', 'headRefName': 'feature', 'headRefOid': prior}])
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())

    def test_malformed_or_truncated_gh_results_keep(self):
        _, tree = self.repo()
        for result in ['invalid', '{}', json.dumps([{'state': 'OPEN', 'headRefName': 'feature'}] * 100)]:
            os.environ['GH_ROWS'] = result
            self.guard.gh_cache.clear()
            self.sweep()
            self.assertTrue(tree.exists())

    def test_missing_origin_default_keeps(self):
        repo, tree = self.repo()
        self.git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD')
        self.sweep()
        self.assertTrue(tree.exists())

    def test_locked_worktree_kept(self):
        repo, tree = self.repo()
        self.git(repo, 'worktree', 'lock', str(tree))
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertIn('locked', self.output.getvalue())

    def test_untracked_dirty_kept(self):
        _, tree = self.repo()
        (tree / 'untracked').write_text('valuable')
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertIn('dirty worktree', self.output.getvalue())

    def test_tracked_dirty_kept(self):
        _, tree = self.repo()
        (tree / 'file').write_text('uncommitted')
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())

    def test_open_pr_kept_even_when_ancestor(self):
        _, tree = self.repo()
        os.environ['GH_ROWS'] = json.dumps([{'state': 'OPEN', 'headRefName': 'feature'}])
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertIn('OPEN PR', self.output.getvalue())

    def test_gh_failure_kept_and_cached(self):
        repo, tree = self.repo()
        os.environ['GH_EXIT'] = '1'
        self.sweep()
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertEqual((self.root / 'gh-calls').read_text().count('call'), 1)

    def test_fresh_kept_without_gh_call(self):
        _, tree = self.repo()
        (tree / 'file').touch()
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertFalse((self.root / 'gh-calls').exists())

    def test_live_process_kept(self):
        _, tree = self.repo()
        self.paths.return_value = ({tree / 'file'}, False)
        self.sweep()
        self.assertTrue(tree.exists())

    def test_node_modules_mtime_excluded(self):
        _, tree = self.repo()
        self.git(tree, 'config', 'core.excludesFile', str(self.root / 'ignore'))
        (self.root / 'ignore').write_text('node_modules/\n')
        self.old(tree)
        self.output_dir(tree / 'node_modules', 0)
        self.old(tree / 'file')
        os.utime(tree, (self.guard.now - 4 * disk.DAY,) * 2)
        self.sweep()
        self.assertFalse(tree.exists())

    def test_ignored_local_files_keep_worktree(self):
        _, tree = self.repo()
        ignore = self.root / 'ignore'
        ignore.write_text('*\n')
        self.git(tree, 'config', 'core.excludesFile', str(ignore))
        for name in ('.env', '.env.local', 'local-notes/notes', '.vercel/project.json', 'node_modules-backup/cache'):
            with self.subTest(name=name):
                self.output.seek(0)
                self.output.truncate(0)
                local = tree / name
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_text('valuable ignored data\n')
                self.old(tree)
                self.sweep()
                self.assertTrue(local.exists())
                self.assertIn('ignored local files present', self.output.getvalue())
                local.unlink()

    def test_ignored_disposable_outputs_allow_worktree_removal(self):
        _, tree = self.repo()
        ignore = self.root / 'ignore'
        ignore.write_text('*\n')
        self.git(tree, 'config', 'core.excludesFile', str(ignore))
        for name in ('node_modules', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache',
                     '.vercel/output', 'target', 'zig-cache', '.zig-cache', 'zig-out', '__pycache__', '.pytest_cache'):
            self.output_dir(tree / name)
        (tree / 'app.tsbuildinfo').write_text('build metadata\n')
        (tree / '.eslintcache').write_text('lint cache\n')
        self.old(tree)
        self.sweep()
        self.assertFalse(tree.exists())

    def test_ignored_local_file_created_during_inspection_keeps_worktree(self):
        _, tree = self.repo()
        ignore = self.root / 'ignore'
        ignore.write_text('.env*\n')
        self.git(tree, 'config', 'core.excludesFile', str(ignore))
        merged = self.guard.merged
        def inspect(*args):
            (tree / '.env.local').write_text('valuable local configuration\n')
            self.old(tree)
            return merged(*args)
        with patch.object(self.guard, 'merged', side_effect=inspect):
            self.sweep()
        self.assertTrue((tree / '.env.local').exists())
        self.assertIn('ignored local files present', self.output.getvalue())

    def test_unmerged_upstream_kept(self):
        repo, tree = self.repo()
        (tree / 'file').write_text('new work')
        self.git(tree, 'commit', '-am', 'unmerged')
        self.git(repo, 'update-ref', 'refs/remotes/origin/feature', self.git(tree, 'rev-parse', 'HEAD'))
        self.git(tree, 'branch', '--set-upstream-to=origin/feature')
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())

    def test_detached_remote_contained_kept(self):
        repo, tree = self.repo()
        self.git(tree, 'checkout', '--detach')
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertIn('detached worktree; open PR cannot be ruled out', self.output.getvalue())
        self.assertIn('refs/heads/feature', self.git(repo, 'for-each-ref', '--format=%(refname)'))

    def test_detached_uncontained_kept(self):
        repo, tree = self.repo()
        self.git(tree, 'checkout', '--detach')
        (tree / 'file').write_text('unmerged')
        self.git(tree, 'commit', '-am', 'not remote')
        self.old(tree)
        self.sweep()
        self.assertTrue(tree.exists())

    def test_protected_main_checkout_never_touched(self):
        repo, tree = self.repo()
        repo.rename(self.guard.protected)
        self.guard.worktrees([(tree, [{'path': self.guard.protected}, {'path': self.guard.protected, 'HEAD': 'fixture'}])])
        self.assertTrue(self.guard.protected.exists())
        self.assertIn('protected main checkout', self.output.getvalue())

    def test_nested_repositories_discovered(self):
        repo, tree = self.repo()
        parent = self.home / 'projects/wazig-worker-trees'
        parent.mkdir()
        nested = parent / 'worker'
        self.git(repo, 'worktree', 'add', '-b', 'worker', str(nested))
        repos = self.guard.discover()
        self.assertIn(nested, self.guard.trees)
        self.assertEqual(len(repos), 1)

    def test_dry_run_preserves_worktree_branch(self):
        repo, tree = self.repo()
        self.guard.dry = True
        self.sweep()
        self.assertTrue(tree.exists())
        self.assertIn('refs/heads/feature', self.git(repo, 'for-each-ref', '--format=%(refname)'))
        self.assertGreater(self.guard.planned, 0)


REAL_CMDLINE_PATHS = disk.cmdline_paths


class CacheTests(Fixture):
    def sweep(self):
        self.guard.caches(self.guard.discover())

    def stats(self, category):
        return self.guard.categories[category]

    def test_cache_idle_worktree_next_removed_and_reported(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        self.sweep()
        self.assertFalse(build.exists())
        self.assertTrue((tree / 'file').exists())
        self.assertEqual(self.stats('next-build')['paths'], 1)
        self.assertGreater(self.stats('next-build')['freed'], 0)
        self.assertEqual(list((self.guard.state / 'trash').iterdir()), [])
        self.assertIn('next-build: next build output of an idle worktree', (self.guard.state / 'log').read_text())

    def test_cache_open_pr_worktree_and_its_next_both_kept(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        ignore = self.root / 'ignore'
        ignore.write_text('.next/\n')
        self.git(tree, 'config', 'core.excludesFile', str(ignore))
        self.old(tree)
        os.environ['GH_ROWS'] = json.dumps([{'state': 'OPEN', 'headRefName': 'feature'}])
        repos = self.guard.discover()
        self.guard.worktrees(repos)
        self.guard.caches(repos)
        self.assertTrue((tree / 'file').exists())
        self.assertIn('OPEN PR', self.output.getvalue())
        self.assertTrue(build.exists())
        self.assertIn('next-build: OPEN PR for branch; worktree never touched', self.output.getvalue())

    def test_cache_next_kept_when_a_process_uses_the_worktree(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        self.paths.return_value = ({tree / 'src'}, False)  # cwd elsewhere in the worktree, not in .next
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('next-build: process has cwd/fd/root inside', self.output.getvalue())

    def test_cache_next_kept_when_a_command_line_names_the_worktree(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        self.cmdlines.return_value = ({tree}, {'bash'}, True)
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('process command line names a path inside', self.output.getvalue())

    def test_cache_next_kept_when_a_running_container_mounts_the_worktree(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        with patch.object(disk, 'docker_mounts', return_value={tree}), patch.object(self.guard, 'volumes'):
            self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('running container mounts this path', self.output.getvalue())

    def test_cache_failed_mount_or_command_line_scan_keeps(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        self.cmdlines.return_value = (set(), set(), False)
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('command-line scan incomplete', self.output.getvalue())
        self.cmdlines.return_value = (set(), set(), True)
        self.guard.cmdlines = None
        with patch.object(disk, 'docker_mounts', side_effect=subprocess.CalledProcessError(1, 'docker')):
            self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('docker mount scan failed', self.output.getvalue())

    def test_cache_young_files_keep_every_category(self):
        _, tree = self.repo()
        paths = [self.output_dir(tree / '.next', 1), self.output_dir(self.home / '.cache/go-build', 1),
                 self.output_dir(self.home / '.npm/_npx/abc', 6), self.output_dir(self.home / '.npm/_cacache', 0)]
        self.sweep()
        self.assertTrue(all(p.exists() for p in paths))
        self.assertIn('newest mtime is not older than 60 minutes', self.output.getvalue())
        self.assertEqual(self.guard.planned + self.guard.freed, 0)

    def test_cache_protected_main_checkout_next_kept(self):
        build = self.output_dir(self.guard.protected / '.next')
        self.guard.caches([(self.guard.protected, [{'path': self.guard.protected}])])
        self.assertTrue(build.exists())

    def test_cache_listed_tool_and_npx_caches_removed_unlisted_kept(self):
        tools = [self.output_dir(self.home / '.cache' / name) for name in disk.TOOL_CACHES]
        others = [self.output_dir(self.home / '.cache' / name) for name in ('puppeteer', 'prisma', 'google-chrome')]
        npx = self.output_dir(self.home / '.npm/_npx/0123abcd', 8)
        self.sweep()
        self.assertTrue(all(not p.exists() for p in tools + [npx]))
        self.assertTrue(all(p.exists() for p in others))
        self.assertEqual(self.stats('tool-caches')['paths'], len(disk.TOOL_CACHES))
        self.assertEqual(self.stats('npx-cache')['paths'], 1)

    def test_cache_links_inside_a_cache_are_removed_never_followed(self):
        valuable = self.output_dir(self.root / 'valuable', 60)
        npx = self.output_dir(self.home / '.npm/_npx/abc', 8)
        (npx / 'node_modules/.bin').mkdir(parents=True)
        (npx / 'node_modules/.bin/tool').symlink_to(valuable / 'output')
        (npx / 'node_modules/escape').symlink_to(valuable)
        self.old(npx, 8)
        for link in (npx / 'node_modules/.bin/tool', npx / 'node_modules/escape'):
            os.utime(link, (self.guard.now - 8 * disk.DAY,) * 2, follow_symlinks=False)
        self.sweep()
        self.assertFalse(npx.exists())
        self.assertTrue((valuable / 'output').exists())

    def test_cache_never_touches_credentials_evidence_or_transcripts(self):
        kept = [self.output_dir(self.home / rel, 60) for rel in
                ('.config/gh', '.config/hypertask-secrets', '.claude/projects/session', '.codex/sessions',
                 '.local/state/vcc-evidence/YPER4-1')]
        # A tool cache that is a symlink into ~/.config is never followed.
        (self.home / '.cache').mkdir(exist_ok=True)
        (self.home / '.cache/uv').symlink_to(self.home / '.config/gh')
        self.sweep()
        for rel in ('.config/gh', '.claude/projects', '.local/state/vcc-evidence'):
            self.guard.cache_remove('tool-caches', self.home / rel, DAY_FIXTURE, 'fixture')
        self.assertTrue(all(p.exists() and (p / 'output').exists() for p in kept))
        self.assertTrue((self.home / '.cache/uv').is_symlink())
        self.assertIn('credential, evidence or transcript folder', self.output.getvalue())

    def test_cache_env_or_storage_state_inside_keeps_candidate(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        (build / '.env.production').write_text('SECRET=fixture\n')
        npx = self.output_dir(self.home / '.npm/_npx/abc', 8)
        (npx / 'qa-storageState.json').write_text('{}')
        self.old(build)
        self.old(npx, 8)
        self.sweep()
        self.assertTrue((build / '.env.production').exists())
        self.assertTrue((npx / 'qa-storageState.json').exists())
        self.assertEqual(self.output.getvalue().count('.env or storageState file inside'), 2)

    def test_cache_npm_cacache_only_when_no_npm_runs(self):
        cacache = self.output_dir(self.home / '.npm/_cacache')
        self.cmdlines.return_value = (set(), {'node', 'npm-cli.js'}, True)
        self.sweep()
        self.assertTrue(cacache.exists())
        self.assertIn('npm-cache: npm or npx process running', self.output.getvalue())
        self.cmdlines.return_value = (set(), {'node', 'next'}, True)
        self.guard.cmdlines = None
        self.sweep()
        self.assertFalse(cacache.exists())
        self.assertEqual(self.stats('npm-cache')['paths'], 1)

    def test_cache_npm_command_starting_before_delete_keeps(self):
        cacache = self.output_dir(self.home / '.npm/_cacache')
        self.cmdlines.side_effect = [(set(), set(), True), (set(), {'npx'}, True)]
        self.sweep()
        self.assertTrue(cacache.exists())

    def test_cache_playwright_keeps_newest_and_referenced_revisions(self):
        root = self.home / '.cache/ms-playwright'
        old = self.output_dir(root / 'chromium-1217', 8)
        shell_old = self.output_dir(root / 'chromium_headless_shell-1217', 8)
        used = self.output_dir(root / 'chromium-1234', 8)
        shell_used = self.output_dir(root / 'chromium_headless_shell-1234', 8)
        newest = self.output_dir(root / 'chromium-1243', 8)
        shell_newest = self.output_dir(root / 'chromium_headless_shell-1243', 8)
        ffmpeg = self.output_dir(root / 'ffmpeg-1011', 8)
        core = self.root / 'install/node_modules/playwright-core'
        core.mkdir(parents=True)
        (core / 'browsers.json').write_text(json.dumps({'browsers': [
            {'name': 'chromium', 'revision': '1234'}, {'name': 'chromium-headless-shell', 'revision': '1234'}]}))
        (root / '.links').mkdir()
        (root / '.links/hash').write_text(str(core))
        self.sweep()
        self.assertFalse(old.exists())
        self.assertFalse(shell_old.exists())
        self.assertTrue(all(p.exists() for p in (used, shell_used, newest, shell_newest, ffmpeg)))
        self.assertEqual(self.stats('playwright-old')['paths'], 2)

    def test_cache_playwright_worktree_reference_keeps_revision(self):
        _, tree = self.repo()
        root = self.home / '.cache/ms-playwright'
        pinned = self.output_dir(root / 'chromium-1217', 8)
        self.output_dir(root / 'chromium-1243', 8)
        core = tree / 'node_modules/playwright-core'
        core.mkdir(parents=True)
        (core / 'browsers.json').write_text(json.dumps({'browsers': [{'name': 'chromium', 'revision': '1217'}]}))
        self.sweep()
        self.assertTrue(pinned.exists())

    def test_cache_playwright_without_references_or_bad_json_keeps_all(self):
        root = self.home / '.cache/ms-playwright'
        old = self.output_dir(root / 'chromium-1217', 8)
        self.output_dir(root / 'chromium-1243', 8)
        self.sweep()
        self.assertTrue(old.exists())
        (root / '.links').mkdir()
        (root / '.links/hash').write_text(str(self.root / 'install'))
        (self.root / 'install').mkdir()
        (self.root / 'install/browsers.json').write_text('not json')
        self.sweep()
        self.assertTrue(old.exists())
        self.assertIn('cannot prove which browser revisions are in use', self.output.getvalue())

    def docker_cli(self, rows, created):
        calls = []
        def run(args, cwd=None):
            calls.append(args)
            if args[1:3] == ['system', 'df']:
                return json.dumps(rows)
            if args[1:3] == ['volume', 'inspect']:
                return created[args[-1]]
            if args[1:3] == ['volume', 'rm']:
                return args[-1]
            self.fail(f'unexpected docker command {args}')
        return calls, run

    def test_round2_only_leaked_smoke_volumes_removed(self):
        old = disk.datetime.fromtimestamp(self.guard.now - 8 * disk.DAY, disk.timezone.utc).isoformat()
        day = disk.datetime.fromtimestamp(self.guard.now - 2 * disk.DAY, disk.timezone.utc).isoformat()
        young = disk.datetime.fromtimestamp(self.guard.now - 3600, disk.timezone.utc).isoformat()
        anonymous = 'com.docker.volume.anonymous='
        rows = [{'Name': 'a' * 64, 'Links': '0', 'Labels': anonymous, 'Size': '55.12MB'},
                {'Name': 'b' * 64, 'Links': '0', 'Labels': anonymous, 'Size': '1GB'},
                {'Name': 'c' * 64, 'Links': '1', 'Labels': anonymous, 'Size': '1GB'},
                {'Name': 'postgres-data', 'Links': '0', 'Labels': '', 'Size': '2GB'},
                {'Name': 'ht-smoke-build-123-1-abc', 'Links': '0', 'Labels': '', 'Size': '300MB'},
                {'Name': 'ht-smoke-state-456-1-def', 'Links': '0', 'Labels': '', 'Size': '1MB'}]
        created = {'a' * 64: old, 'b' * 64: day, 'c' * 64: old, 'postgres-data': old,
                   'ht-smoke-build-123-1-abc': day, 'ht-smoke-state-456-1-def': young}
        calls, run = self.docker_cli(rows, created)
        self.docker.return_value = True
        with patch.object(disk, 'command', side_effect=run):
            self.guard.volumes()
        removed = [c[-1] for c in calls if c[1:3] == ['volume', 'rm']]
        self.assertEqual(removed, ['ht-smoke-build-123-1-abc'])
        self.assertFalse(any('prune' in c for c in calls))
        self.assertEqual(self.stats('docker-volumes'), {'freed': 300000000, 'would_free': 0, 'paths': 1})
        text = self.output.getvalue()
        self.assertEqual(text.count('not a leaked smoke volume; kept'), 3)  # two anonymous, one named
        self.assertIn('volume attached to a container', text)
        self.assertIn('created within 1 day', text)

    def test_cache_stops_once_below_target(self):
        first = self.output_dir(self.home / '.npm/_npx/a', 8)
        second = self.output_dir(self.home / '.npm/_npx/b', 8)
        with patch.object(self.guard, 'usage', side_effect=[76] + [69] * 10):
            self.sweep()
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())
        self.assertIn(f'disk below {disk.CACHE_TARGET}% target', self.output.getvalue())

    def test_cache_dry_run_reports_without_deleting(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        npx = self.output_dir(self.home / '.npm/_npx/a', 8)
        self.guard.dry = True
        with patch.object(self.guard, 'usage', return_value=50):
            self.guard.run()
        self.assertTrue(build.exists() and npx.exists())
        self.assertFalse((self.guard.state / 'log').exists())
        summary = json.loads(self.output.getvalue().split("summary: '/' reason=")[1].rsplit(' bytes_freed', 1)[0].strip("'"))
        self.assertGreater(summary['caches']['next-build']['would_free'], 0)
        self.assertEqual(summary['caches']['npx-cache']['paths'], 1)
        self.assertEqual(summary['thresholds']['caches_from'], 75)

    def test_cache_thresholds(self):
        for percent, expected in [(74.99, 0), (75, 1), (80, 1)]:
            with patch.object(self.guard, 'usage', return_value=percent), \
                 patch.object(self.guard, 'caches') as caches, patch.object(self.guard, 'temporary') as temporary, \
                 patch.object(self.guard, 'images'), patch.object(self.guard, 'critical'):
                self.guard.run()
            self.assertEqual(caches.call_count, expected, percent)
            self.assertEqual(temporary.call_count, int(percent >= 80), percent)
        self.assertLess(disk.CACHE_TARGET, disk.CACHE_AT)
        self.assertLess(disk.CACHE_AT, disk.CLEAN_AT)

    def test_cache_interrupted_trash_is_emptied_next_run(self):
        leftover = self.output_dir(self.guard.state / 'trash/123-.next', 0)
        self.sweep()
        self.assertFalse(leftover.exists())

    def test_cache_report_lists_categories_without_deleting(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        text = self.guard.report().read_text()
        self.assertIn('## Re-creatable caches', text)
        row = next(line for line in text.splitlines() if line.startswith('| next-build |'))
        self.assertIn('| 1 |', row)
        self.assertTrue(build.exists())

    def test_cache_cmdline_scan_reads_a_real_process(self):
        target = self.output_dir(self.tmp / 'argument')
        child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()', f'--dir={target}'],
                                 stdin=subprocess.PIPE, text=True)
        try:
            paths, programs, _ = REAL_CMDLINE_PATHS()
            self.assertIn(target, paths)
            self.assertIn(Path(sys.executable).name, programs)
        finally:
            child.communicate('', timeout=10)

    def test_cache_docker_sizes_parse(self):
        self.assertEqual(disk.docker_bytes('55.12MB'), 55120000)
        self.assertEqual(disk.docker_bytes('1.5GB'), 1500000000)
        self.assertEqual(disk.docker_bytes('0B'), 0)
        self.assertEqual(disk.docker_bytes('N/A'), 0)


class ReviewTests(Fixture):
    def sweep(self):
        self.guard.caches(self.guard.discover())

    def test_review_real_npm_title_process_blocks_npm_cache(self):
        node = shutil.which('node')
        if node is None:
            self.skipTest('node not installed')
        child = subprocess.Popen([node, '-e', 'process.title="npm ci"; setTimeout(()=>{},5000)'])
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if Path(f'/proc/{child.pid}/cmdline').read_bytes().startswith(b'npm ci'):
                    break
                time.sleep(0.05)
            self.guard.cmdlines = REAL_CMDLINE_PATHS()
            self.assertIn('npm', self.guard.cmdlines[1])
            self.assertEqual(self.guard.npm_running(), 'npm or npx process running')
            self.guard.cmdlines = (set(), {'node', 'bash'}, True)
            self.assertIsNone(self.guard.npm_running())  # Positive control: no npm, no keep.
        finally:
            child.kill()  # Exactly the pid this test started.
            child.wait(timeout=10)

    def test_review_open_pr_check_failure_or_detached_keeps_next(self):
        repo, tree = self.repo()
        build = self.output_dir(tree / '.next')
        os.environ['GH_EXIT'] = '1'
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('next-build: open PR check failed', self.output.getvalue())
        self.git(tree, 'checkout', '--detach')
        self.old(build)
        self.guard.gh_cache.clear()
        os.environ['GH_EXIT'] = '0'
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('next-build: detached worktree', self.output.getvalue())

    def test_review_cache_phase_exception_keeps_tmp_cleanup_and_status(self):
        old = self.output_dir(self.tmp / 'old')
        with patch.object(self.guard, 'caches', side_effect=RuntimeError('fixture bug')), \
             patch.object(self.guard, 'usage', return_value=80), patch.object(self.guard, 'images') as images:
            self.guard.run()
        self.assertFalse(old.exists())
        images.assert_called_once()
        status = json.loads((self.guard.state / 'status.json').read_text())
        self.assertEqual(status['keep_reasons']['cache phase failed; remaining caches kept'], 1)

    def test_review_bad_docker_rows_and_unreadable_npx_do_not_raise(self):
        self.docker.return_value = True
        with patch.object(disk, 'command', return_value=json.dumps(['text', None, 3])):
            self.guard.volumes()
        with patch.object(disk, 'command', return_value=json.dumps({'not': 'a list'})):
            self.guard.volumes()
        self.assertIn('unexpected volume row', self.output.getvalue())
        npx = self.output_dir(self.home / '.npm/_npx/abc', 8).parent
        npx.chmod(0)
        try:
            self.sweep()
        finally:
            npx.chmod(0o755)
        self.assertIn('npx-cache: folder not readable', self.output.getvalue())

    def test_review_rename_error_keeps_cache_only_exdev_deletes_in_place(self):
        npx = self.output_dir(self.home / '.npm/_npx/abc', 8)
        with patch.object(disk.Path, 'rename', side_effect=PermissionError('fixture')):
            self.sweep()
        self.assertTrue(npx.exists())
        self.assertIn('cannot move cache aside; kept', self.output.getvalue())
        with patch.object(disk.Path, 'rename', side_effect=OSError(errno.EXDEV, 'cross-device')):
            self.sweep()
        self.assertFalse(npx.exists())

    def test_review_symlinked_trash_is_never_emptied_or_used(self):
        valuable = self.output_dir(self.root / 'valuable', 60)
        self.guard.state.joinpath('trash').symlink_to(valuable)
        npx = self.output_dir(self.home / '.npm/_npx/abc', 8)
        self.sweep()
        self.assertTrue((valuable / 'output').exists())
        self.assertTrue(npx.exists())
        self.assertIn('trash folder is a link', self.output.getvalue())

    def test_review_privileged_scan_reads_exe_link(self):
        entries = [contextlib.nullcontext(iter([Path('/proc/7')])), contextlib.nullcontext(iter([]))]
        with patch.object(disk.os, 'scandir', side_effect=entries), \
             patch.object(disk.os, 'readlink', side_effect=['/', '/', '/tmp/cache/bin/tool']) as links:
            exec(disk.PRIVILEGED_PROCESS_SCAN, {})
        self.assertIn('/proc/7/exe', [call.args[0] for call in links.call_args_list])
        self.assertIn('/tmp/cache/bin/tool', json.loads(self.output.getvalue()))


class Round2Tests(Fixture):
    def sweep(self):
        self.guard.caches(self.guard.discover())

    def test_round2_linked_cache_roots_into_protected_folders_remove_nothing(self):
        config = self.output_dir(self.home / '.config/tools', 60)
        go = self.output_dir(config / 'go-build', 60)
        claude = self.output_dir(self.home / '.claude/projects/npm', 60)
        npx = self.output_dir(claude / '_npx/abc', 60)
        cacache = self.output_dir(claude / '_cacache', 60)
        (self.home / '.cache').symlink_to(config)
        (self.home / '.npm').symlink_to(claude)
        self.sweep()
        self.assertTrue(all((p / 'output').exists() for p in (go, npx, cacache)))
        self.assertEqual(self.guard.freed + self.guard.planned, 0)
        # Direct calls on the linked lexical paths are refused too.
        for path in (self.home / '.cache/go-build', self.home / '.npm/_npx/abc'):
            self.guard.cache_remove('tool-caches', path, 0, 'fixture')
        self.assertTrue(go.exists() and npx.exists())
        self.assertIn('real path differs', self.output.getvalue())

    def test_round2_linked_ancestor_outside_protected_folders_still_kept(self):
        elsewhere = self.output_dir(self.root / 'elsewhere/_npx/abc', 60)
        (self.home / '.npm').symlink_to(self.root / 'elsewhere')
        self.guard.cache_remove('npx-cache', self.home / '.npm/_npx/abc', 0, 'fixture')
        self.assertTrue(elsewhere.exists())
        self.assertIn('path or an ancestor is a link', self.output.getvalue())

    def test_round2_command_line_keeps_whole_paths_and_key_values(self):
        proc = self.root / 'proc'
        (proc / '41').mkdir(parents=True)
        (proc / '41/cmdline').write_bytes(b'node\0/home/x/my tree/node_modules/.bin/next\0--dir=/a b/c\0npm exec next\0')
        (proc / '41/comm').write_text('node\n')
        paths, programs, complete = REAL_CMDLINE_PATHS(proc)
        self.assertTrue(complete)
        self.assertIn(Path('/home/x/my tree/node_modules/.bin/next'), paths)
        self.assertIn(Path('/a b/c'), paths)
        self.assertIn(Path('/home/x/my'), paths)  # fragments are still added
        self.assertIn('node', programs)

    def test_round2_one_open_pr_lookup_per_run_independent_of_sweep_cap(self):
        repo, tree = self.repo()
        other = repo.parent / 'other'
        self.git(repo, 'worktree', 'add', '-b', 'other', str(other))
        builds = [self.output_dir(t / '.next') for t in (tree, other)]
        # The worktree sweep's per-branch budget is already spent.
        self.guard.gh_cache.update({(Path('/fixture'), str(i)): None for i in range(60)})
        self.sweep()
        calls = (self.root / 'gh-calls').read_text().splitlines()
        self.assertEqual(calls, ['call pr list --repo fixture/repo --state open --limit 500 --json headRefName'])
        self.assertTrue(all(not b.exists() for b in builds))

    def test_round2_open_pr_list_failure_or_truncation_keeps_every_next(self):
        _, tree = self.repo()
        build = self.output_dir(tree / '.next')
        for rows, code in ((json.dumps([{'headRefName': f'b{i}'} for i in range(500)]), '0'), ('[]', '1'),
                           ('[{"state": "OPEN"}]', '0')):
            with self.subTest(code=code, rows=rows[:20]):
                os.environ['GH_ROWS'], os.environ['GH_EXIT'] = rows, code
                self.guard.open_cache.clear()
                self.sweep()
                self.assertTrue(build.exists())
        self.assertIn('open PR list unavailable, malformed or truncated', self.output.getvalue())

    def test_round2_open_pr_lookup_needs_a_github_origin(self):
        repo, tree = self.repo()
        self.git(repo, 'remote', 'set-url', 'origin', 'https://example.invalid/fixture.git')
        build = self.output_dir(tree / '.next')
        self.sweep()
        self.assertTrue(build.exists())
        self.assertIn('origin is not a GitHub repository', self.output.getvalue())

    def test_round2_report_survives_cache_preview_failure(self):
        with patch.object(disk.Guard, 'caches', side_effect=RuntimeError('fixture bug')):
            text = self.guard.report().read_text()
        self.assertIn('Re-creatable caches: preview failed', text)


DAY_FIXTURE = 0


class OperationTests(Fixture):
    def test_component_containment_matches_parent_boundaries(self):
        for child, parent in [('/tmp/cache/output', '/tmp/cache'), ('/tmp/cache', '/tmp/cache'),
                              ('/tmp/cache-other', '/tmp/cache'), ('/tmp/cache', '/'),
                              ('/tmp/cache', '.'), ('relative/cache', '.'), ('relative/cache', 'relative')]:
            child, parent = Path(child), Path(parent)
            with self.subTest(child=child, parent=parent):
                self.assertEqual(disk.inside(child, parent), child == parent or parent in child.parents)

    def test_log_is_bounded_with_one_rotation(self):
        log = self.guard.state / 'log'
        with log.open('wb') as stream:
            stream.truncate(10 * 1024 * 1024)
        self.guard.log('kept', 'fixture', 'rotation test')
        self.assertTrue((self.guard.state / 'log.1').exists())
        self.assertLess(log.stat().st_size, 1024)

    def test_thresholds_and_status(self):
        for level, percent in [('ok', 79.99), ('clean', 80), ('critical', 90)]:
            with patch.object(self.guard, 'usage', return_value=percent), \
                 patch.object(self.guard, 'temporary') as temporary, \
                 patch.object(self.guard, 'images') as images, \
                 patch.object(self.guard, 'critical') as critical, \
                 patch.object(self.guard, 'worktrees') as worktrees:
                self.guard.run()
                self.assertEqual(temporary.call_count, int(percent >= 80))
                self.assertEqual(images.call_count, int(percent >= 80))
                worktrees.assert_called_once()
                self.assertEqual(critical.call_count, 2)
                status = json.loads((self.guard.state / 'status.json').read_text())
                self.assertEqual(status['level'], level)
                self.assertEqual(status['used_percent'], percent)
                self.assertIn('last_run', status)
                self.assertIn('freed', status)

    def test_critical_flag_enospc_still_runs_temporary_cleanup(self):
        old = self.output_dir(self.tmp / 'old')
        real_write = disk.Path.write_text
        def write(path, *args, **kwargs):
            if path == self.guard.state / 'critical':
                raise OSError(errno.ENOSPC, 'fixture full disk')
            return real_write(path, *args, **kwargs)
        with patch.object(disk.Path, 'write_text', write), \
             patch.object(self.guard, 'usage', return_value=90), patch.object(self.guard, 'images'), \
             patch.object(self.guard, 'temporary', wraps=self.guard.temporary) as temporary:
            self.guard.run()
        temporary.assert_called_once()
        self.assertFalse(old.exists())
        self.assertIn('summary:', self.output.getvalue())

    def test_status_enospc_does_not_abort_summary(self):
        real_write = disk.Path.write_text
        def write(path, *args, **kwargs):
            if path == self.guard.state / 'status.tmp':
                raise OSError(errno.ENOSPC, 'fixture full disk')
            return real_write(path, *args, **kwargs)
        with patch.object(disk.Path, 'write_text', write), patch.object(self.guard, 'usage', return_value=79):
            self.guard.run()
        self.assertIn('summary:', self.output.getvalue())
        self.assertIn('status write failed', self.output.getvalue())

    def test_log_enospc_uses_stderr_and_continues_cleanup(self):
        paths = [self.output_dir(self.tmp / name) for name in ('old-a', 'old-b')]
        real_open = disk.Path.open
        def open_file(path, *args, **kwargs):
            if path == self.guard.state / 'log':
                raise OSError(errno.ENOSPC, 'fixture full disk')
            return real_open(path, *args, **kwargs)
        stderr = io.StringIO()
        with patch.object(disk.Path, 'open', open_file), contextlib.redirect_stderr(stderr), \
             patch.object(self.guard, 'usage', return_value=80), patch.object(self.guard, 'images'):
            self.guard.run()
        self.assertTrue(all(not path.exists() for path in paths))
        self.assertIn('removed:', stderr.getvalue())
        self.assertIn('summary:', stderr.getvalue())
        self.assertIn('log write failed', stderr.getvalue())

    def test_alert_marker_enospc_does_not_abort_cleanup_or_send_alert(self):
        real_touch = disk.Path.touch
        def touch(path, *args, **kwargs):
            if path == self.guard.state / 'last-alert':
                raise OSError(errno.ENOSPC, 'fixture full disk')
            return real_touch(path, *args, **kwargs)
        with patch.object(disk.Path, 'touch', touch), patch.object(self.guard, 'usage', return_value=90), \
             patch.object(self.guard, 'temporary') as temporary, patch.object(self.guard, 'images'), \
             patch.object(disk.urllib.request, 'urlopen') as notify:
            self.guard.run()
        temporary.assert_called_once()
        notify.assert_not_called()

    def test_critical_alert_hourly_and_cleared_after_recovery(self):
        class Response(io.StringIO):
            pass
        with patch.dict(os.environ, {'TELEGRAM_HYPERTASK_BOT_TOKEN': 'fixture', 'TELEGRAM_HYPERTASK_CHAT_ID': 'fixture'}), \
             patch.object(disk.urllib.request, 'urlopen', side_effect=lambda *a, **k: Response('{"ok":true}')) as notify:
            self.guard.critical(90)
            self.assertTrue((self.guard.state / 'critical').exists())
            self.guard.now += 900
            self.guard.critical(95)
            self.assertEqual(notify.call_count, 1)
            self.assertIn('INFRA+MANAGER', notify.call_args.args[0].data.decode())
            self.guard.now += 2701
            self.guard.critical(91)
            self.assertEqual(notify.call_count, 2)
            self.guard.critical(89.99)
            self.assertFalse((self.guard.state / 'critical').exists())

    def test_alert_failure_does_not_leak_or_spam(self):
        with patch.dict(os.environ, {'TELEGRAM_HYPERTASK_BOT_TOKEN': 'secret-fixture', 'TELEGRAM_HYPERTASK_CHAT_ID': 'fixture'}), \
             patch.object(disk.urllib.request, 'urlopen', side_effect=ValueError('secret-fixture')) as notify:
            self.guard.critical(90)
            self.guard.critical(95)
            self.assertEqual(notify.call_count, 1)
            self.assertNotIn('secret-fixture', self.output.getvalue())

    def test_images_only_no_volume_prune(self):
        with patch.object(disk, 'command') as commands:
            self.guard.images()
        self.assertEqual(commands.call_args.args[0], ['docker', 'image', 'prune', '-f'])

    def test_report_old_and_new_items_no_deletion(self):
        old = self.output_dir(self.home / '.local/state/br7-runs/old', 31)
        fresh = self.output_dir(self.home / '.local/state/br7-runs/fresh', 1)
        proof = self.output_dir(self.home / '.local/state/vcc-evidence/proof', 31)
        retired = self.output_dir(self.home / '.local/state/retired-agents-2026-08-23/archive', 31)
        npm = self.output_dir(self.home / '.npm/_cacache/content-v2', 31)
        def docker(args, cwd=None):
            if args[1:4] == ['system', 'df', '-v']:
                return 'Local Volumes space usage: fixture 1GB'
            if args[1:3] == ['volume', 'ls']:
                return 'persistent-volume'
            if args[1:3] == ['volume', 'inspect']:
                return '[{"CreatedAt":"2020-01-01"}]'
            if args[1:3] == ['ps', '-q']:
                return ''
            self.fail(f'unexpected command {args}')
        self.docker.return_value = True
        with patch.object(disk, 'command', side_effect=docker):
            path = self.guard.report()
        text = path.read_text()
        self.assertIn('safe to delete', next(l for l in text.splitlines() if str(old) in l))
        self.assertIn('keep', next(l for l in text.splitlines() if str(fresh) in l))
        self.assertIn('retain audit proof', text)
        self.assertIn(str(retired), text)
        self.assertIn('files older than 30 days', text)
        self.assertIn('persistent-volume: keep', text)
        self.assertTrue(all(p.exists() for p in [old, fresh, proof, retired, npm]))

    def test_install_copies_script_and_replaces_old_timer_without_deleting_files(self):
        with patch.object(disk, 'command') as calls:
            self.guard.install()
        installed = self.guard.state / 'disk-guard.py'
        self.assertEqual(installed.read_bytes(), (HERE / 'disk-guard.py').read_bytes())
        units = self.home / '.config/systemd/user'
        self.assertIn('OnCalendar=*-*-* *:00/15:00', (units / 'disk-guard.timer').read_text())
        self.assertIn('Persistent=true', (units / 'disk-guard.timer').read_text())
        self.assertIn('%h/.local/state/disk-guard/disk-guard.py', (units / 'disk-guard.service').read_text())
        self.assertIn(['systemctl', '--user', 'disable', '--now', 'host-disk-sweep.timer'], [c.args[0] for c in calls.call_args_list])
        self.assertIn('old files retained', (self.guard.state / 'log').read_text())
        result = subprocess.run([sys.executable, str(installed), '--help'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
