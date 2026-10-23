#!/usr/bin/env python3
"""Tests for daily-stats.py (YPER4-341). Renders from fixture data; no network, no boards touched."""
import importlib.util
import json
import shutil
import subprocess
import os
import re
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('daily_stats', HERE / 'daily-stats.py')
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)

EM = chr(0x2014)
# 2026-10-13 10:00 Berlin (CEST, UTC+2) = 08:00 UTC. Berlin midnight today = 2026-10-12T22:00:00Z.
NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def task(i, title, section, updated, pid=15, labels=(), assignee=None):
    return {
        'id': 1000 + i, 'uniqueIndex': i, 'projectId': pid, 'title': title, 'section': section,
        'updatedAt': updated, 'createdAt': updated, 'labels': [{'name': n} for n in labels],
        'assignees': [{'displayName': 'x', 'agent': {'displayName': assignee}}] if assignee else [],
    }


def fixture():
    tasks15 = [
        task(1, '[BUGFIX] Fix the thing ' + EM + ' fully', 'Done', '2026-10-13T06:00:00Z', labels=['Bug']),
        task(2, '[FEATURE] New toy', 'Done', '2026-10-13T07:00:00Z'),
        task(3, '[SECURITY] Close a hole', 'Done', '2026-10-13T05:00:00Z', labels=['Security', 'Bug', 'P2']),
        task(4, 'Improve search', 'Done', '2026-10-13T04:00:00Z', labels=['IMPROVEMENT']),
        # Berlin midnight boundary: 21:59:59Z on the 12th is still yesterday (23:59:59 Berlin), 22:00:00Z is today.
        task(5, '[BUGFIX] Just before midnight', 'Done', '2026-10-12T21:59:59Z', labels=['Bug']),
        task(6, '[BUGFIX] Just after midnight', 'Done', '2026-10-12T22:00:00Z', labels=['Bug']),
        task(7, '[BUGFIX] Two days ago', 'Done', '2026-10-11T10:00:00Z', labels=['Bug']),
        task(8, 'Waiting for a yes', 'Valentin Review', '2026-10-10T08:00:00Z'),
        task(9, 'Older wait', 'UX Sign-off', '2026-10-08T08:00:00Z'),
        task(10, 'Running fix', 'In Progress', '2026-10-13T07:00:00Z', assignee='Runner 2'),
        task(11, 'Open bug one', 'Bugs', '2026-10-13T01:00:00Z', labels=['Bug', 'P1', 'Security']),
        task(12, 'Open bug two', 'Bugs', '2026-10-13T01:00:00Z', labels=['Bug', 'P3']),
        task(13, 'Held by three', 'Done', '2026-10-13T03:00:00Z', assignee='Runner 3'),
    ]
    tasks4060 = [
        task(1, '[INFRA] Plumbing', 'Done', '2026-10-13T02:00:00Z', pid=4060),
        task(2, 'No tag plumbing', 'Done', '2026-10-12T10:00:00Z', pid=4060),
        task(3, 'Infra in flight', 'In Progress', '2026-10-13T07:30:00Z', pid=4060, assignee='Runner 1'),
    ]
    claim = lambda at: {'ok': True, 'data': [{'text': '<p><strong>Claimed.</strong> Session working it now.</p>', 'createdAt': at}]}
    return {
        'now': NOW,
        'boards': {15: {'ok': True, 'data': tasks15}, 4060: {'ok': True, 'data': tasks4060}},
        'comments': {
            1001: claim('2026-10-13T05:00:00Z'),   # done 06:00 -> 60 min
            1002: claim('2026-10-13T04:00:00Z'),   # done 07:00 -> 180 min
            1003: claim('2026-10-13T03:00:00Z'),   # done 05:00 -> 120 min
            1010: claim('2026-10-13T06:30:00Z'),   # runner 2 holds 90 min
        },
        'prs': {
            'hypertask-ai/hypertask': {'ok': True, 'data': [
                {'number': 1, 'title': 'HTPR-1 [BUGFIX] Fix ' + EM + ' it', 'url': 'https://github.com/hypertask-ai/hypertask/pull/1', 'mergedAt': '2026-10-13T06:00:00Z'},
                {'number': 2, 'title': 'HTPR-2 [FEATURE] Yesterday PR', 'url': 'https://github.com/hypertask-ai/hypertask/pull/2', 'mergedAt': '2026-10-12T12:00:00Z'},
            ]},
            'hypertask-ai/cli': {'ok': True, 'data': []},
            'hypertask-ai/agent-fleet': {'ok': False, 'error': 'repo not found'},
        },
        'deploys': {'ok': True, 'data': {'today': 4, 'yesterday': 7, 'last_state': 'success', 'last_at': '2026-10-13T07:03:30Z', 'events': [{'at': '2026-10-13T07:03:30Z'}]}},
        'smoke': {'ok': True, 'data': {'http': 200, 'workflow': {'conclusion': 'success', 'at': '2026-10-13T06:58:13Z'}}},
        'ci': {'ok': True, 'data': [{'displayTitle': 'Broken build ' + EM + ' ouch', 'url': 'https://github.com/hypertask-ai/hypertask/actions/runs/9', 'createdAt': '2026-10-13T06:00:00Z'}]},
        'tokens': {'ok': True, 'data': {'claude': 20.0, 'codex': 1.0}},
        'load': {'ok': True, 'data': {'load': [1.5, 1.0, 1.0], 'mem_gb': 12.3, 'cpus': 8}},
        'posthog': {'ok': False, 'error': 'key not available'},
    }


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()
        self.page = ds.render(self.data)

    def test_no_em_dash_anywhere(self):
        self.assertNotIn(EM, self.page)
        self.assertNotIn(EM, (HERE / 'daily-stats.py').read_text())
        self.assertNotIn(EM, Path(__file__).read_text().replace('chr(0x2014)', ''))

    def test_every_ticket_and_pr_is_a_link_with_full_title(self):
        for t in self.data['boards'][15]['data'] + self.data['boards'][4060]['data']:
            if t['section'] in ('Done', 'Valentin Review', 'UX Sign-off', 'In Progress', 'Bugs'):
                if t['section'] == 'Done' and t['updatedAt'] < '2026-10-12T22:00:00Z':
                    continue
                url = f"https://app.hypertask.ai/detail/project-{t['projectId']}/{t['uniqueIndex']}"
                title = ds.scrub(t['title']).replace('&', '&amp;')
                self.assertIn(f'<a href="{url}">{title}</a>', self.page, t['title'])
        self.assertIn('<a href="https://github.com/hypertask-ai/hypertask/pull/1">HTPR-1 [BUGFIX] Fix - it</a>', self.page)
        self.assertIn('<a href="https://github.com/hypertask-ai/hypertask/actions/runs/9">Broken build - ouch</a>', self.page)

    def test_section_order(self):
        ids = re.findall(r'<section id="(\w+)"', self.page)
        self.assertEqual(ids, ['vital', 'waiting', 'today', 'done', 'bugs', 'errors', 'flight', 'runners', 'health', 'speed'])

    def test_waiting_first_and_oldest_first_with_wait_time(self):
        w = self.page.split('id="waiting"')[1].split('</section>')[0]
        self.assertLess(w.index('Older wait'), w.index('Waiting for a yes'))
        self.assertIn('5 d 0 h', w)  # 2026-10-08T08:00Z to 2026-10-13T08:00Z
        self.assertIn('3 d 0 h', w)

    def test_berlin_midnight_boundary(self):
        ts, ys = ds.day_bounds(NOW)
        self.assertEqual(ts.isoformat(), '2026-10-12T22:00:00+00:00')
        self.assertEqual(ys.isoformat(), '2026-10-11T22:00:00+00:00')
        tasks, _ = ds.all_tasks(self.data)
        today = {t['title'] for t in ds.done_between(tasks, ts, NOW)}
        yest = {t['title'] for t in ds.done_between(tasks, ys, ts)}
        self.assertIn('[BUGFIX] Just after midnight', today)
        self.assertNotIn('[BUGFIX] Just before midnight', today)
        self.assertIn('[BUGFIX] Just before midnight', yest)
        self.assertNotIn('[BUGFIX] Two days ago', yest)

    def test_berlin_midnight_boundary_in_winter_time(self):
        winter = datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc)
        ts, _ = ds.day_bounds(winter)
        self.assertEqual(ts.isoformat(), '2026-11-30T23:00:00+00:00')

    def test_counts_by_type(self):
        tasks, _ = ds.all_tasks(self.data)
        ts, ys = ds.day_bounds(NOW)
        c = ds.count_types(ds.done_between(tasks, ts, NOW))
        self.assertEqual(c, {'bug': 2, 'feature': 1, 'improvement': 1, 'security': 1, 'infra': 1, 'other': 1})
        y = ds.count_types(ds.done_between(tasks, ys, ts))
        self.assertEqual(y['bug'], 1)
        self.assertEqual(y['infra'], 1)
        # The rendered table shows the same numbers.
        today = self.page.split('id="today"')[1]
        self.assertIn('<td>Bugs</td><td class="num"><span data-count="done:bug">3</span></td><td class="num"><span data-previous="done:bug">1</span></td>', today)
        self.assertIn('<td>Infra</td><td class="num"><span data-count="done:infra">2</span></td><td class="num"><span data-previous="done:infra">0</span></td>', today)

    def test_pr_counts_and_missing_repo_isolated(self):
        config = ds.event_config(self.data)
        snap = ds.range_snapshot(config['events'], NOW, unavailable=config['unavailable'])
        self.assertEqual(snap['counts']['prs:hypertask-ai/hypertask'], 2)
        self.assertIsNone(snap['counts']['prs:hypertask-ai/agent-fleet'])
        self.assertIsNone(snap['counts']['prs'])
        self.assertEqual(snap['counts']['deploys'], 1)

    def test_in_flight_priorities_and_security_marked(self):
        f = self.page.split('id="flight"')[1].split('</section>')[0]
        self.assertIn('P1 <strong>1</strong>, P2 <strong>0</strong>, P3 <strong>1</strong>', f)
        self.assertIn('Security: <strong>1</strong>', f)
        self.assertIn('Infra in flight', f)

    def test_runners(self):
        r = self.page.split('id="runners"')[1].split('</section>')[0]
        self.assertIn('Runner 2', r)
        self.assertIn('1 h 30 min', r)
        self.assertRegex(r, r'Runner 3</td><td class="muted">idle')

    def test_speed_median(self):
        s = self.page.split('id="speed"')[1]
        self.assertIn('120 min', s)  # median of 60, 120, 180
        self.assertIn('data-speed="sample">3</span> of', s)

    def test_failed_source_shows_not_available_and_rest_renders(self):
        self.assertIn('Production error tickets', self.page)
        self.assertIn('not exception occurrences', self.page)
        self.assertIn('Claude weekly usage', self.page)
        self.data['boards'][4060] = {'ok': False, 'error': 'boom'}
        page = ds.render(self.data)
        self.assertIn('Board 4060: <span class="na">not available</span>', page)
        self.assertIn('Waiting for a yes', page)

    def test_responsive_and_theme_markers(self):
        self.assertIn('<meta name="viewport" content="width=device-width,initial-scale=1">', self.page)
        self.assertIn('prefers-color-scheme:dark', self.page)
        self.assertIn('<meta http-equiv="refresh" content="900">', self.page)
        self.assertIn('family=IBM+Plex+Sans', self.page)
        self.assertIn('type="application/json"', self.page)
        self.assertIn('history.replaceState', self.page)


class FailureTests(unittest.TestCase):
    def test_failed_run_keeps_last_good_page_and_marks_updated_red(self):
        good = ds.render(fixture())
        later = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)
        bad = ds.mark_failed(good, later, 'no board could be read')
        self.assertIn('class="updated bad"', bad)
        self.assertIn('Last update failed at 2026-10-13 11:00', bad)
        self.assertIn('no board could be read', bad)
        # Only the updated line changed.
        strip = lambda h: ds.UPDATED_RE.sub('', h)
        self.assertEqual(strip(bad), strip(good))
        self.assertNotIn(EM, bad)
        # The next good run turns it back to normal.
        again = ds.render(fixture(), later)
        self.assertNotIn('updated bad', again)

    def test_failed_run_without_a_previous_page_still_writes_something(self):
        page = ds.mark_failed('', NOW, 'x')
        self.assertIn('class="updated bad"', page)

    def test_main_keeps_old_file_when_all_boards_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'out.html'
            out.write_text(ds.render(fixture()))
            orig = ds.collect
            ds.collect = lambda now: {'now': now, 'boards': {15: {'ok': False, 'error': 'down'}, 4060: {'ok': False, 'error': 'down'}}}
            try:
                code = ds.main(['--out', str(out)])
            finally:
                ds.collect = orig
            self.assertEqual(code, 1)
            text = out.read_text()
            self.assertIn('Waiting for a yes', text)
            self.assertIn('class="updated bad"', text)


class InstallTests(unittest.TestCase):
    def test_install_contract_without_installing_or_touching_units(self):
        # Inspect calls only: this local verification must never install or alter deployed files.
        with patch.object(Path, 'mkdir'), patch.object(Path, 'resolve', lambda p: p), \
                patch.object(ds.shutil, 'copy2') as copy, patch.object(ds.os, 'chmod'), \
                patch.object(ds.subprocess, 'run') as run, patch.dict(os.environ, DAILY_STATS_NO_SYSTEMD='1'):
            ds.install()
            self.assertEqual(copy.call_count, 6)
            run.assert_not_called()
        timer = (HERE / 'daily-stats.timer').read_text()
        self.assertIn('OnCalendar=*:00/30', timer)
        self.assertIn('Persistent=true', timer)
        self.assertIn('--publish', (HERE / 'daily-stats.service').read_text())
        self.assertIn('%h/.local/share/daily-stats/daily-stats.py', (HERE / 'daily-stats.service').read_text())


class BoardPagingTests(unittest.TestCase):
    def fake(self, pages):
        calls = []

        def ht_get(path):
            calls.append(path)
            return pages[len(calls) - 1]
        return calls, ht_get

    def test_follows_pages_until_total(self):
        pages = [{'tasks': [{'id': i} for i in range(100)], 'total': 150, 'nextCursor': 'c1'},
                 {'tasks': [{'id': i} for i in range(100, 150)], 'total': 150, 'nextCursor': None}]
        calls, fake = self.fake(pages)
        real, ds.ht_get = ds.ht_get, fake
        try:
            self.assertEqual(len(ds.fetch_board(15)), 150)
        finally:
            ds.ht_get = real
        self.assertEqual(len(calls), 2)
        self.assertIn('cursor=c1', calls[1])

    def test_incomplete_list_is_an_error_not_a_short_count(self):
        pages = [{'tasks': [{'id': 1}], 'total': 5, 'nextCursor': None}, {'tasks': [], 'total': 5, 'nextCursor': None}]
        calls, fake = self.fake(pages)
        real, ds.ht_get = ds.ht_get, fake
        try:
            with self.assertRaises(RuntimeError):
                ds.fetch_board(15)
        finally:
            ds.ht_get = real


class RangeTests(unittest.TestCase):
    def config(self):
        data = fixture()
        data['boards'][15]['data'] = [
            task(1, 'Current recent', 'Done', '2026-10-13T07:30:00Z', labels=['Bug', 'prod-error']),
            task(2, 'At 1h start', 'Done', '2026-10-13T07:00:00Z'),
            task(3, 'Previous hour', 'Done', '2026-10-13T06:30:00Z'),
            task(4, 'At 24h start', 'Done', '2026-10-12T08:00:00Z'),
            task(5, 'Previous day', 'Done', '2026-10-11T09:00:00Z'),
            task(6, 'At 48h start', 'Done', '2026-10-11T08:00:00Z'),
            task(7, 'At now, excluded', 'Done', '2026-10-13T08:00:00Z'),
            task(8, 'Older than history', 'Done', '2026-09-28T07:00:00Z'),
        ]
        data['boards'][4060]['data'] = []
        data['prs'] = {r: {'ok': True, 'data': []} for r in ds.REPOS}
        data['prs'][ds.REPOS[0]]['data'] = [
            dict(number=i, title='PR ' + str(i), url='https://github.com/hypertask-ai/hypertask/pull/' + str(i), mergedAt=at)
            for i, at in enumerate(['2026-10-13T07:45:00Z', '2026-10-13T06:45:00Z', '2026-10-11T10:00:00Z'], 1)]
        return ds.event_config(data)

    def test_hand_counted_1h_and_24h_and_boundaries(self):
        c = self.config()
        self.assertEqual(len([e for e in c['events'] if e['metric'] == 'done']), 6)
        for key, counts, previous, deltas in [
                ('1h', [2, 1, 1, 1], [1, 0, 0, 1], [1, 1, 1, 0]),
                ('24h', [4, 1, 1, 2], [2, 0, 0, 1], [2, 1, 1, 1])]:
            snap = ds.range_snapshot(c['events'], NOW, key, c['history_start'])
            for field, values in [('counts', counts), ('previous', previous), ('deltas', deltas)]:
                self.assertEqual([snap[field][m] for m in ['done', 'bugs', 'errors', 'prs']], values)

    def test_all_ranges_and_invalid_fallback(self):
        c = self.config()
        for key in ds.RANGES:
            self.assertEqual(ds.range_snapshot(c['events'], NOW, key)['key'], key)
        for key in ['', None, '8h', 'toString', '__proto__']:
            self.assertEqual(ds.range_snapshot(c['events'], NOW, key)['key'], '24h')

    def test_short_history_only_disables_comparison(self):
        c = self.config()
        s = ds.range_snapshot(c['events'], NOW, '24h', (NOW - timedelta(hours=24)).isoformat())
        self.assertEqual(s['counts']['done'], 4)
        self.assertIsNone(s['previous']['done'])
        self.assertIsNone(s['deltas']['done'])

    def test_json_cannot_close_script_or_execute_title(self):
        data = fixture()
        title = '</script><script>alert("x")</script> & <img src=x onerror=alert(1)><!--<script>'
        data['boards'][15]['data'][0]['title'] = title
        page = ds.render(data)
        raw = re.search(r'<script id="stats-events" type="application/json">(.*?)</script>', page, re.S).group(1)
        self.assertNotIn('</', raw)
        self.assertIn(r'\u003c\/script>', raw)
        self.assertEqual(json.loads(raw)['events'][0]['title'], title)
        self.assertIn('&lt;script&gt;', page)
        self.assertEqual(page.count('</script>'), 2)

    @unittest.skipUnless(shutil.which('node'), 'node unavailable')
    def test_browser_counts_match_python_and_url_fallback(self):
        c = self.config()
        js = ds.BROWSER_JS.split('function applyRange')[0]
        cases = list(ds.RANGES) + ['', None, '8h', '__proto__', 'toString']
        prefix = 'const document = {getElementById: () => ({textContent: ' + json.dumps(json.dumps(c)) + '})};\n'
        suffix = '\nconsole.log(JSON.stringify(' + json.dumps(cases) + '.map(k => snapshot(new URL("file:///stats.html?range=" + (k ?? "")).searchParams.get("range")))));'
        result = subprocess.run(['node', '-e', prefix + js + suffix], capture_output=True, text=True, check=True)
        values = json.loads(result.stdout)
        for key, actual in zip(cases, values):
            expected = ds.range_snapshot(c['events'], NOW, key, c['history_start'], c['unavailable'])
            self.assertEqual(actual, expected)

    def test_missing_board_does_not_become_zero(self):
        data = fixture()
        data['boards'][15] = {'ok': False, 'error': 'down'}
        c = ds.event_config(data)
        snap = ds.range_snapshot(c['events'], NOW, unavailable=c['unavailable'])
        for metric in ['done', 'bugs', 'errors']:
            self.assertIsNone(snap['counts'][metric])
        self.assertIsNone(c['waiting'])
        self.assertIsNone(c['runners'])


class BudgetTests(unittest.TestCase):
    def test_spent_collection_budget_does_not_start_command(self):
        with patch.object(ds, 'COLLECT_DEADLINE', 0), patch.object(ds.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'budget used up'):
                ds.run(['unreachable'])
            run.assert_not_called()

    def test_run_timeout_is_limited_by_remaining_budget(self):
        with patch.object(ds.time, 'monotonic', return_value=100), patch.object(ds, 'COLLECT_DEADLINE', 103), \
                patch.object(ds.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = 'ok'
            ds.run(['safe'], timeout=20)
            self.assertEqual(run.call_args.kwargs['timeout'], 3)

    def test_pr_cap_is_failure_not_a_short_count(self):
        with patch.object(ds, 'gh_json', return_value=[{}] * 1000):
            with self.assertRaisesRegex(RuntimeError, 'limit'):
                ds.fetch_prs(ds.REPOS[0], '2026-10-01')

    def test_collect_requests_14_days_and_caps_comments(self):
        data = fixture()
        with patch.object(ds, 'fetch_board', side_effect=lambda pid: data['boards'][pid]['data']), \
                patch.object(ds, 'fetch_comments', return_value=[]) as comments, \
                patch.object(ds, 'fetch_prs', return_value=[]) as prs, \
                patch.object(ds, 'fetch_deploys', return_value={}) as deploys, \
                patch.object(ds, 'fetch_ci_failures', return_value=[]) as ci, \
                patch.object(ds, 'fetch_smoke'), patch.object(ds, 'fetch_tokens'), patch.object(ds, 'fetch_load'):
            result = ds.collect(NOW)
        self.assertEqual(result['history_start'], (NOW - timedelta(days=14)).isoformat())
        self.assertEqual(prs.call_args.args[1], '2026-09-29')
        self.assertEqual(ci.call_args.args[0], '2026-09-29')
        self.assertEqual(deploys.call_args.args[1], NOW - timedelta(days=14))
        self.assertLessEqual(comments.call_count, ds.COMMENT_CAP_DONE + ds.COMMENT_CAP_RUNNERS)


if __name__ == '__main__':
    unittest.main()
