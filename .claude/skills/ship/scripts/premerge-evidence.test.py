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
    assert args[2:] == ['--method', 'POST', '-f', 'context=premerge-evidence-local', '-f', 'state=failure',
                        '-f', 'description=cannot load current premerge rules; retry']
    if (root / 'post-error-once').exists():
        (root / 'post-error-once').unlink()
        sys.exit(1)
    with (root / 'statuses').open('a') as log:
        log.write('failure\\n')
elif args[:2] == ['api', '-i'] and args[2].startswith('repos/hypertask-ai/hypertask/pulls?'):
    sha = (root / 'head').read_text() if (root / 'head').exists() else 'a' * 40
    etag = '"' + sha[:8] + '"'
    if (root / 'two-pages').exists():
        page = int(args[2].rsplit('page=', 1)[1])
        link = 'Link: <https://api.github.com/next>; rel="next"\\r\\n' if page == 1 else ''
        if page == 2 and (root / 'page2-error').exists():
            sys.exit(1)
        print('HTTP/2.0 200 OK\\r\\nEtag: ' + etag + '\\r\\n' + link + '\\r\\n'
              + json.dumps([{'number': 997 + page, 'title': f'YPER4-{997 + page} [INFRA] Fixture', 'head': {'sha': sha}}]))
        sys.exit(0)
    if args[3:] == ['-H', 'If-None-Match: ' + etag]:
        print('HTTP/2.0 304 Not Modified\\r\\nEtag: ' + etag + '\\r\\nX-Ratelimit-Remaining: 4000\\r\\n\\r\\n')
        sys.exit(1)  # gh exits non-zero on a 304
    print('HTTP/2.0 200 OK\\r\\nEtag: ' + etag + '\\r\\nX-Ratelimit-Remaining: 4001\\r\\n\\r\\n'
          + json.dumps([{'number': n, 'title': f'YPER4-{n} [INFRA] Fixture', 'head': {'sha': sha}}
                        for n in (998, 999)]))
elif args[:1] == ['api'] and '/commits/' in args[1] and '/status?' in args[1]:
    if (root / 'status-error').exists():
        sys.exit(1)
    fixture = root / 'github-status'
    status = json.loads(fixture.read_text()) if fixture.exists() else {'statuses': []}
    status.setdefault('sha', args[1].split('/commits/')[1].split('/')[0])
    print(json.dumps(status))
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
        self.assertEqual(sum(c[0] == 'api' and c[1] != '-i' for c in calls), 0)
        self.assertEqual(sum(c[:2] == ['api', '-i'] for c in calls), 3)
        git_calls = [json.loads(line) for line in (self.root / 'gitcalls').read_text().splitlines()]
        self.assertEqual(sum(c[2:3] == ['fetch'] for c in git_calls), 3)

    def gh_calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_unchanged_head_makes_one_conditional_list_call_and_no_per_pr_calls(self):
        self.assertEqual(self.sweep().returncode, 0)
        self.assertEqual(len(self.publications()), 2)
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.gh_calls()
        self.assertEqual(len(calls), 2)  # one list call per sweep, nothing else
        self.assertEqual(calls[1][3:], ['-H', 'If-None-Match: "aaaaaaaa"'])  # 304 path
        self.assertEqual(len(self.publications()), 2)
        self.assertIn('gh-api: list_calls=1 list=304 rechecks=0 ratelimit_remaining=4000', result.stdout)
        hours = json.loads((self.state / 'api-calls.json').read_text())
        self.assertEqual(sum(h['calls'] for h in hours.values()), 2)
        self.assertEqual(sum(h['rechecks'] for h in hours.values()), 2)

    def test_changed_head_rechecks_only_changed_prs(self):
        self.assertEqual(self.sweep().returncode, 0)
        (self.root / 'head').write_text('b' * 40)
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([p[1] for p in self.publications()[2:]], ['998', '999'])
        self.assertIn('list=200 rechecks=2', result.stdout)
        cached = json.loads((self.state / 'list.json').read_text())
        self.assertEqual({r['headRefOid'] for r in cached['rows']}, {'b' * 40})

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

    def github_status(self):
        return {'statuses': [{'context': 'premerge-evidence', 'state': 'success',
                              'creator': {'login': 'github-actions[bot]', 'type': 'Bot'},
                              'description': 'GitHub premerge click',
                              'target_url': f'https://github.com/{poster.REPO}/actions/runs/123'}]}

    def test_rules_fetch_failure_preserves_trusted_github_success(self):
        (self.root / 'github-status').write_text(json.dumps(self.github_status()))
        (self.root / 'fetch-error').touch()
        self.assertEqual(self.sweep().returncode, 1)
        self.assertEqual(self.publications(), [])
        self.assertEqual((self.root / 'statuses').read_text().splitlines(), ['failure', 'failure'])
        self.assertFalse(any('/status?' in call[1] for call in self.gh_calls() if call[0] == 'api'))
        self.assertTrue(all('context=premerge-evidence-local' in call for call in self.gh_calls() if '--method' in call))

    def test_rules_fetch_failure_does_not_trust_stale_or_other_creator_status(self):
        (self.root / 'fetch-error').touch()
        for change in ('sha', 'creator', 'type', 'state', 'context', 'description', 'target_url', 'url-suffix'):
            with self.subTest(change=change):
                status = self.github_status()
                item = status['statuses'][0]
                if change == 'sha':
                    status['sha'] = 'b' * 40
                elif change == 'creator':
                    item['creator']['login'] = 'someone-else'
                elif change == 'type':
                    item['creator']['type'] = 'User'
                elif change == 'state':
                    item['state'] = 'failure'
                elif change == 'context':
                    item['context'] = 'ci-tests'
                elif change == 'description':
                    item['description'] = 'click record ok'
                elif change == 'target_url':
                    item['target_url'] = 'https://github.com/other/repo/actions/runs/123'
                else:
                    item['target_url'] += '/jobs/456'
                (self.root / 'github-status').write_text(json.dumps(status))
                self.assertEqual(self.sweep().returncode, 1)
                self.assertEqual((self.root / 'statuses').read_text().splitlines(), ['failure', 'failure'])
                (self.root / 'statuses').unlink()

    def test_unreadable_github_status_never_overwrites_potential_github_success(self):
        (self.root / 'status-error').touch()
        (self.root / 'fetch-error').touch()
        self.assertEqual(self.sweep().returncode, 1)
        self.assertEqual((self.root / 'statuses').read_text().splitlines(), ['failure', 'failure'])
        self.assertTrue(all('context=premerge-evidence-local' in call for call in self.gh_calls() if '--method' in call))

    def test_workflow_success_between_get_and_post_cannot_be_overwritten(self):
        events = []
        required = {'state': 'failure'}
        def rows(state):
            events.append('GET snapshot: no workflow success')
            required['state'] = 'success'
            events.append('workflow success')
            return [{'number': 999, 'headRefOid': 'a' * 40}]
        def post(args, **kwargs):
            self.assertIn('context=premerge-evidence-local', args)
            events.append('VPS advisory failure')
            return subprocess.CompletedProcess(args, 0)
        self.state.mkdir()
        with patch.object(poster, 'open_prs', side_effect=rows), patch.object(poster.subprocess, 'run', side_effect=post):
            poster.revoke_passing(self.state)
        self.assertEqual(events, ['GET snapshot: no workflow success', 'workflow success', 'VPS advisory failure'])
        self.assertEqual(required['state'], 'success')

    def status_verdict(self, verdict, valid=True, required='absent', interleave=False, pending=False, future=False):
        source = (HERE / 'ship-check').read_text()
        publisher = source.split('check_premerge_status() (', 1)[1].split('\n)\n', 1)[0]
        if pending:
            publisher = publisher.replace('state=failure', 'state=pending')
        if future:
            publisher = publisher.replace("'no released flag touched')", "'no screen files changed'|'flag removal on Everyone')")
        (self.root / 'required-status').write_text(required)
        (self.bin / 'gh').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['POSTER_TEST_ROOT'])
args = sys.argv[1:]
if args[:2] == ['pr', 'view']:
    print('a' * 40)
elif args[:1] == ['api'] and '/commits/' in args[1]:
    snapshot = (root / 'required-status').read_text()
    with (root / 'events').open('a') as log:
        log.write('VPS GET: ' + snapshot + '\\n')
    if os.environ['STATUS_INTERLEAVE'] == '1':
        (root / 'required-status').write_text('success')
        with (root / 'events').open('a') as log:
            log.write('workflow POST: success\\n')
    print(json.dumps({'state': snapshot}))
elif args[:1] == ['api'] and '/statuses/' in args[1]:
    assert args[1] == 'repos/hypertask-ai/hypertask/statuses/' + 'a' * 40, args
    assert args[2:4] == ['--method', 'POST'], args
    fields = dict(args[i + 1].split('=', 1) for i, arg in enumerate(args) if arg == '-f')
    with (root / 'status-posts').open('a') as log:
        log.write(json.dumps(fields) + '\\n')
    with (root / 'events').open('a') as log:
        log.write('VPS POST: ' + fields['context'] + ' ' + fields['state'] + '\\n')
    if fields['context'] == 'premerge-evidence':
        (root / 'required-status').write_text(fields['state'])
else:
    raise AssertionError(args)
''')
        script = '''REPO=hypertask-ai/hypertask
fail() { printf 'FAIL: %s\\n' "$*"; exit 1; }
check_premerge() {
  gh api "repos/$REPO/commits/$2/status?premerge=fixture" >/dev/null || return 1
  printf '%s\\n' "$STATUS_VERDICT"
  return "$STATUS_VALIDATION_RC"
}
check_premerge_status() (''' + publisher + '\n)\ncheck_premerge_status 999\n'
        env = dict(self.env, STATUS_VERDICT=verdict, STATUS_VALIDATION_RC='0' if valid else '1',
                   STATUS_INTERLEAVE='1' if interleave else '0')
        result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True, timeout=10)
        posts_file = self.root / 'status-posts'
        posts = [json.loads(line) for line in posts_file.read_text().splitlines()] if posts_file.exists() else []
        for post in posts:
            self.assertIn(post['context'], ('premerge-evidence', 'premerge-evidence-local'))
            if post['context'] == 'premerge-evidence':
                self.assertEqual(post['state'], 'success', post)
        return result, posts, (self.root / 'required-status').read_text()

    def test_no_flag_pr_publishes_required_success(self):
        result, posts, required = self.status_verdict('no released flag touched')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence', 'success')])
        self.assertEqual(required, 'success')

    def test_valid_local_verdict_publishes_required_success(self):
        result, posts, required = self.status_verdict('premerge ok', required='failure')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence', 'success')])
        self.assertEqual(required, 'success')

    def test_workflow_success_stays_success(self):
        result, posts, required = self.status_verdict('github premerge ok', required='success')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(posts), 1)
        self.assertEqual(required, 'success')

    def test_missing_evidence_leaves_required_context_absent(self):
        result, posts, required = self.status_verdict('FAIL: record a browser click-through', valid=False)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence-local', 'failure')])
        self.assertEqual(required, 'absent')

    def test_workflow_success_between_vps_get_and_post_cannot_end_in_failure(self):
        result, posts, required = self.status_verdict('FAIL: record a browser click-through', valid=False,
                                                     required='pending', interleave=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence-local', 'failure')])
        self.assertEqual((self.root / 'events').read_text().splitlines(), [
            'VPS GET: pending', 'workflow POST: success', 'VPS POST: premerge-evidence-local failure'])
        self.assertEqual(required, 'success')

    def test_pending_verdict_never_posts_required_context(self):
        # Exercise the routing default even if a future validator introduces pending.
        result, posts, required = self.status_verdict('unknown verdict', pending=True, required='success')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence-local', 'pending')])
        self.assertEqual(required, 'success')

    def test_additional_success_verdicts_still_publish_required_success(self):
        # Model YPER4-549 adding success cases without coupling routing to their wording.
        for verdict in ('no screen files changed', 'flag removal on Everyone'):
            with self.subTest(verdict=verdict):
                (self.root / 'status-posts').unlink(missing_ok=True)
                result, posts, required = self.status_verdict(verdict, future=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual([(p['context'], p['state']) for p in posts], [('premerge-evidence', 'success')])
                self.assertEqual(required, 'success')

    def test_revocation_covers_a_head_missing_from_the_cache(self):
        self.assertEqual(self.sweep().returncode, 0)
        cache = json.loads((self.state / 'cache.json').read_text())
        del cache['999']
        (self.state / 'cache.json').write_text(json.dumps(cache))
        (self.root / 'fetch-error').touch()
        self.assertNotEqual(self.sweep().returncode, 0)
        self.assertEqual(len((self.root / 'statuses').read_text().splitlines()), 2)

    def test_two_page_list_is_followed_and_stores_no_etag(self):
        (self.root / 'two-pages').touch()
        result = self.sweep()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p[1] for p in self.publications()), ['998', '999'])
        self.assertIsNone(json.loads((self.state / 'list.json').read_text())['etag'])
        self.assertEqual(self.sweep().returncode, 0)  # refetches both pages, nothing rechecked
        self.assertEqual(len(self.publications()), 2)
        self.assertEqual(sum(c[:2] == ['api', '-i'] for c in self.gh_calls()), 4)

    def test_failed_second_page_refuses_the_sweep(self):
        (self.root / 'two-pages').touch()
        (self.root / 'page2-error').touch()
        self.assertNotEqual(self.sweep().returncode, 0)
        self.assertEqual(self.publications(), [])

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
