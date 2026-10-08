#!/usr/bin/env python3
"""Safety fixtures never inspect or delete the real host's projects or tmp."""
import contextlib
import errno
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
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
        self.git(repo, 'remote', 'add', 'origin', 'https://example.invalid/fixture.git')
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
                      'open(os.environ["GH_CALLS"],"a").write("call\\n")\n'
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
        self.assertIn('other accounts could be using it', self.output.getvalue())

    def test_unreadable_root_allows_only_old_named_rebuildable_caches(self):
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
                        self.assertFalse(target.exists())

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
            self.fail(f'unexpected command {args}')
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
