#!/usr/bin/env python3
"""Isolated poster regressions: all GitHub and systemctl calls are local fixtures."""
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
        for leaked in ('SHIP_GIT', 'SHIP_GIT_CACHE', 'SHIP_GIT_REMOTE', 'GH_PAUSE_FILE'):
            os.environ.pop(leaked, None)
        self.env = dict(os.environ, HOME=str(self.root),
                        PATH=f'{self.bin}:{os.environ["PATH"]}',
                        PREMERGE_STATUS_STATE=str(self.state),
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
elif args[:2] == ['api', 'graphql']:
    assert args[2:6] == ['--paginate', '--jq', '@json', '-f'], args
    query = args[6]
    for field in ('number', 'headRefOid', 'title', 'updatedAt', 'baseRefName: "production"', 'pageInfo'):
        assert field in query, query
    sha = (root / 'head').read_text() if (root / 'head').exists() else 'a' * 40
    rows = [{'number': n, 'title': f'YPER4-{n} [INFRA] Fixture', 'headRefOid': sha if n == 999 else 'a' * 40, 'updatedAt': '2026-10-21T00:00:00Z'}
            for n in (998, 999)]
    groups = [[rows[0]], [rows[1]]] if (root / 'two-pages').exists() else [rows]
    pages = [{'data': {'repository': {'pullRequests': {'nodes': group, 'pageInfo': {'hasNextPage': i < len(groups) - 1, 'endCursor': str(i)}}},
                       'rateLimit': {'remaining': 4000}}} for i, group in enumerate(groups)]
    if (root / 'page2-error').exists():
        pages[-1] = {'errors': [{'message': 'fixture failure'}]}
    for page in pages:
        print(json.dumps(page))
elif args[:1] == ['api']:
    raise AssertionError('the contents API must not be called: ' + repr(args))
else:
    raise AssertionError(args)
''')
        (self.bin / 'gh').chmod(0o755)
        (self.bin / 'git').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['POSTER_TEST_ROOT'])
args = sys.argv[1:]
with (root / 'gitcalls').open('a') as log:
    log.write(json.dumps(args) + '\\n')
if args[:2] == ['init', '--bare']:
    os.makedirs(args[-1], exist_ok=True)
    open(args[-1] + '/HEAD', 'w').close()
elif args[2:3] == ['fetch']:
    if (root / 'fetch-error').exists():
        sys.exit(1)
elif args[2:3] == ['show']:
    assert args[3] == 'refs/premerge/production:.claude/skills/ship/scripts/ship-check', args
    sys.stdout.buffer.write((root / 'production-check').read_bytes())
else:
    sys.exit(1)
''')
        (self.bin / 'git').chmod(0o755)
        (self.bin / 'systemctl').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
with (pathlib.Path(os.environ['POSTER_TEST_ROOT']) / 'systemctl-calls').open('a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
''')
        (self.bin / 'systemctl').chmod(0o755)

    def write_checker(self, version, state='success'):
        self.production.write_text(f'''#!/usr/bin/env python3
import json, os, pathlib, sys
assert sys.argv[1] in ('premerge-status', 'premerge')
assert os.environ['SHIP_REPO'] == 'hypertask-ai/hypertask'
assert os.environ['SHIP_BASE'] == 'production'
with (pathlib.Path(os.environ['POSTER_TEST_ROOT']) / 'published').open('a') as log:
    log.write(json.dumps([{version!r}, sys.argv[2], __file__]) + '\\n')
print('premerge-evidence: {state} (test click removed (Valentin 2026-10-21))' if sys.argv[1] == 'premerge-status' else 'test click removed (Valentin 2026-10-21)')
sys.exit(1 if sys.argv[1] == 'premerge-status' and {state!r} == 'failure' else 0)
''')

    def sweep(self, path=None, dry_run=False):
        return subprocess.run(['python3', str(path or HERE / 'premerge-evidence.py'), *(['--dry-run'] if dry_run else [])],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def publications(self):
        path = self.root / 'published'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_one_off_pr_failures_retry_and_only_repeated_failures_fail_the_unit(self):
        self.production.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
if sys.argv[2] == '999' and (pathlib.Path(os.environ['POSTER_TEST_ROOT']) / 'pr-999-broken').exists():
    print('FAIL: premerge status requires an open production PR with a full head sha; no status posted')
    sys.exit(1)
print('premerge-evidence: success (fixture)')
''')
        (self.root / 'pr-999-broken').touch()
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(self.sweep().returncode, 0)
        third = self.sweep()
        self.assertEqual(third.returncode, 1, third.stderr)
        cache = json.loads((self.state / 'cache.json').read_text())
        self.assertEqual(cache['999'], {'misses': 3})
        self.assertEqual(cache['998']['state'], 'SUCCESS')
        (self.root / 'pr-999-broken').unlink()
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(json.loads((self.state / 'cache.json').read_text())['999']['state'], 'SUCCESS')
        (self.root / 'pr-999-broken').touch()
        (self.root / 'head').write_text('b' * 40)
        self.assertEqual(self.sweep().returncode, 0)

    def test_only_confirmed_posts_are_cached_including_failure_statuses(self):
        self.production.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
root = pathlib.Path(os.environ['POSTER_TEST_ROOT'])
with (root / 'published').open('a') as log:
    log.write('[]\\n')
if (root / 'post-error').exists():
    print('FAIL: cannot post premerge-evidence; retry')
else:
    print('premerge-evidence: failure (cannot confirm unchanged PR head; retry)')
sys.exit(1)
''')
        (self.root / 'post-error').touch()
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 4, 'unposted results retry next sweep')
        cache = json.loads((self.state / 'cache.json').read_text())
        self.assertTrue(all(entry == {'misses': 2} for entry in cache.values()))
        (self.root / 'post-error').unlink()
        self.assertEqual(self.sweep().returncode, 0)
        cache = json.loads((self.state / 'cache.json').read_text())
        self.assertTrue(all(entry['state'] == 'FAILURE' for entry in cache.values()))
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 6, 'confirmed failure posts can be skipped')

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
        self.assertEqual(sum(c[:2] == ['api', 'graphql'] for c in calls), 3)
        self.assertEqual(len(calls), 3)
        git_calls = [json.loads(line) for line in (self.root / 'gitcalls').read_text().splitlines()]
        self.assertEqual(sum(c[2:3] == ['fetch'] for c in git_calls), 3)

    def test_checker_bytes_change_refreshes_every_waiting_failure_in_one_sweep(self):
        self.write_checker('waiting', state='failure')
        self.assertEqual(self.sweep().returncode, 0)
        first = json.loads((self.state / 'cache.json').read_text())
        self.assertTrue(all(entry['state'] == 'FAILURE' for entry in first.values()))
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        self.write_checker('click-removed')
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p[:2] for p in self.publications()[2:]], [['click-removed', '998'], ['click-removed', '999']])
        for key in ('998', '999'):
            self.assertIn(f'PR #{key}: premerge-evidence: success (test click removed (Valentin 2026-10-21))', result.stdout)
        self.assertIn('sweep: prs=2 skipped=0', result.stdout)
        updated = json.loads((self.state / 'cache.json').read_text())
        for key in first:
            self.assertEqual(updated[key]['state'], 'SUCCESS')
            self.assertNotEqual(first[key]['fingerprint'], updated[key]['fingerprint'])

    def gh_calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_unchanged_head_makes_one_batched_list_call_and_no_per_pr_calls(self):
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.gh_calls()
        self.assertEqual(len(calls), 2)  # one list call per sweep, nothing else
        self.assertEqual(calls[1][:2], ['api', 'graphql'])
        self.assertEqual(len(self.publications()), 2)
        self.assertIn('gh-api: list_calls=1 list=graphql rechecks=0 ratelimit_remaining=4000', result.stdout)
        hours = json.loads((self.state / 'api-calls.json').read_text())
        self.assertEqual(sum(h['calls'] for h in hours.values()), 2)
        self.assertEqual(sum(h['rechecks'] for h in hours.values()), 2)

    def test_changed_head_rechecks_only_changed_prs(self):
        self.assertEqual(self.sweep().returncode, 0)
        (self.root / 'head').write_text('b' * 40)
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p[1] for p in self.publications()[2:]], ['999'])
        self.assertIn('list=graphql rechecks=1', result.stdout)
        self.assertEqual(len(self.gh_calls()), 2)

    def test_dry_run_never_posts_or_populates_live_status_cache(self):
        result = self.sweep(dry_run=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('test click removed (Valentin 2026-10-21)', result.stdout)
        self.assertFalse((self.state / 'cache.json').exists())
        self.assertEqual(json.loads((self.state / 'dry-run/cache.json').read_text())['999']['state'], 'DRY_RUN')
        self.assertTrue(all(c[:2] == ['api', 'graphql'] for c in self.gh_calls()))
        count = len(self.publications())
        self.assertEqual(self.sweep(dry_run=True).returncode, 0)
        self.assertEqual(len(self.publications()), count)
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), count + 2)
        (self.root / 'fetch-error').touch()
        self.assertNotEqual(self.sweep(dry_run=True).returncode, 0)
        self.assertFalse((self.root / 'statuses').exists())

    def test_stale_gh_loop_matcher_picks_only_old_gh_polling(self):
        old, young = 3 * 3600, 600
        ps = '\n'.join([
            f'101 {old} gh pr checks 12 --watch',
            f'102 {old} gh run watch 55',
            f"103 {old} bash -c while true; do gh pr checks 12; sleep 30; done",
            f'104 {young} gh pr checks 12 --watch',
            f'105 {old} gh pr view 12',
            f'106 {old} vim notes-about-gh-pr-checks--watch.txt',
            f'107 {old} python3 /x/premerge-evidence.py',
            f'108 {old} python3 /x/premerge-evidence.py --kill-stale-gh-loops',
            f"109 {old} bash -c for i in 1 2; do echo hi; done",
            f'110 {old} gh pr checks 12 --watch',
            f"111 {old} bash -c while read f; do cp $f /bak; sleep 1; done; gh pr view 12",
            f"112 {old} bash -c until s=$(gh pr checks 1); do sleep 60; done",
            f'113 {old} bash -c while read f; do cp "$f" /bak; echo "gh pr view 12"; sleep 1; done',
            f"114 {old} /bin/bash -c source x && eval 'until gh run view 5 | grep -q done; do sleep 30; done'",
            f"115 {old} bash -c while read f; do cp $f /bak; echo gh pr view 12; sleep 1; done",
            f"116 {old} bash -c while true; do echo sleep; x=1 gh pr view 1; done",
        ])
        found = poster.stale_gh_loops(ps, {110})
        self.assertEqual([f[0] for f in found], [101, 102])

    def test_kill_mode_signals_only_matches(self):
        (self.bin / 'ps').write_text('#!/bin/sh\necho "4242 99999 gh run watch 1"\necho "4243 99999 sleep 9"\n')
        (self.bin / 'ps').chmod(0o755)
        with patch.dict(os.environ, self.env, clear=True), patch.object(os, 'kill') as kill:
            poster.kill_stale_gh_loops()
        kill.assert_called_once_with(4242, poster.signal.SIGTERM)

    def test_revocation_covers_a_head_missing_from_the_cache(self):
        self.assertEqual(self.sweep().returncode, 0)
        cache = json.loads((self.state / 'cache.json').read_text())
        del cache['999']
        (self.state / 'cache.json').write_text(json.dumps(cache))
        (self.root / 'fetch-error').touch()
        self.assertNotEqual(self.sweep().returncode, 0)
        self.assertEqual(len((self.root / 'statuses').read_text().splitlines()), 2)

    def test_two_page_list_is_followed_in_one_batched_command(self):
        (self.root / 'two-pages').touch()
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p[1] for p in self.publications()), ['998', '999'])
        self.assertIn('list_calls=2', result.stdout)
        self.assertEqual(self.sweep().returncode, 0)  # refetches both pages, nothing rechecked
        self.assertEqual(len(self.publications()), 2)
        self.assertEqual(sum(c[:2] == ['api', 'graphql'] for c in self.gh_calls()), 2)

    def test_failed_second_page_refuses_the_sweep(self):
        (self.root / 'two-pages').touch()
        (self.root / 'page2-error').touch()
        self.assertNotEqual(self.sweep().returncode, 0)
        self.assertEqual(self.publications(), [])

    def test_source_timer_checks_changes_every_two_minutes(self):
        self.assertIn('OnCalendar=*-*-* *:0/2:00', (HERE / 'premerge-evidence.timer').read_text())

    def test_paused_sweep_makes_no_calls(self):
        pause = self.root / 'pause-until'
        pause.write_text(str(int(time.time()) + 3600))
        self.env['GH_PAUSE_FILE'] = str(pause)
        result = self.sweep()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout + result.stderr, '')
        for name in ('calls', 'gitcalls', 'published', 'statuses'):
            self.assertFalse((self.root / name).exists(), name)
        pause.write_text(str(int(time.time()) - 5))
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)

    def test_unchanged_head_is_skipped_and_ten_minute_refresh_rechecks(self):
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        cache = json.loads((self.state / 'cache.json').read_text())
        for entry in cache.values():
            entry['checked'] = time.time() - 300  # inside the ten-minute window
        (self.state / 'cache.json').write_text(json.dumps(cache))
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        for entry in cache.values():
            entry['checked'] = time.time() - 700  # past the ten-minute window
        (self.state / 'cache.json').write_text(json.dumps(cache))
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 4)

    def test_fetch_failure_revokes_passing_statuses(self):
        self.assertEqual(self.sweep().returncode, 0)
        checker = (self.state / 'ship-check').read_bytes()
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
            for base in ('premerge-evidence', 'premerge-evidence-gh-loops'):
                name = f'{base}.{suffix}'
                self.assertEqual((self.root / '.config/systemd/user' / name).read_bytes(), (HERE / name).read_bytes())
        calls = [json.loads(line) for line in (self.root / 'systemctl-calls').read_text().splitlines()]
        self.assertEqual(calls, [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'premerge-evidence.timer'],
                                 ['--user', 'enable', '--now', 'premerge-evidence-gh-loops.timer']])
        (target / 'ship-check').unlink()
        self.assertEqual(self.sweep(target / 'premerge-evidence.py').returncode, 0)
        self.assertEqual(len(self.publications()), 2)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PosterTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    print('poster regressions passed')
