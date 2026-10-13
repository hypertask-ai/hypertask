#!/usr/bin/env python3
"""Tests for daily-stats.py (YPER4-341). Renders from fixture data; no network, no boards touched."""
import importlib.util
import os
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

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
        'updatedAt': updated, 'labels': [{'name': n} for n in labels],
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
        'deploys': {'ok': True, 'data': {'today': 4, 'yesterday': 7, 'last_state': 'success', 'last_at': '2026-10-13T07:03:30Z'}},
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
        self.assertEqual(ids, ['waiting', 'today', 'done', 'flight', 'runners', 'health', 'speed'])

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
        self.assertIn('<td>Bugs</td><td class="num">2</td><td class="num">1</td>', today)
        self.assertIn('<td>Infra</td><td class="num">1</td><td class="num">1</td>', today)

    def test_pr_counts_and_missing_repo_isolated(self):
        today = self.page.split('id="today"')[1]
        self.assertIn('<td>hypertask</td><td class="num">1</td><td class="num">1</td>', today)
        self.assertIn('<td>agent-fleet</td><td colspan="2"><span class="na">not available</span>', today)
        self.assertIn('Deploys to production: <strong>4</strong> today, 7 yesterday', today)

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
        self.assertIn('2 h 0 min', s)  # median of 60, 120, 180
        self.assertIn('based on 3 of', s)

    def test_failed_source_shows_not_available_and_rest_renders(self):
        self.assertIn('New PostHog error issues today</div><span class="na">not available</span>', self.page)
        self.assertIn('Claude weekly usage', self.page)
        self.data['boards'][4060] = {'ok': False, 'error': 'boom'}
        page = ds.render(self.data)
        self.assertIn('Board 4060: <span class="na">not available</span>', page)
        self.assertIn('Waiting for a yes', page)

    def test_responsive_and_theme_markers(self):
        self.assertIn('<meta name="viewport" content="width=device-width,initial-scale=1">', self.page)
        self.assertIn('prefers-color-scheme:dark', self.page)
        self.assertIn('<meta http-equiv="refresh" content="900">', self.page)
        self.assertIn('IBM+Plex+Sans', self.page)
        self.assertNotIn('<script', self.page)


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
    def test_install_copies_script_and_units_outside_the_worktree(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, HOME=tmp, DAILY_STATS_NO_SYSTEMD='1')
            import subprocess
            subprocess.run(['python3', str(HERE / 'daily-stats.py'), '--install'], env=env, check=True, capture_output=True)
            for p in ('.local/share/daily-stats/daily-stats.py', '.config/systemd/user/daily-stats.service',
                      '.config/systemd/user/daily-stats.timer'):
                self.assertTrue((Path(tmp) / p).is_file(), p)
        timer = (HERE / 'daily-stats.timer').read_text()
        self.assertIn('OnCalendar=*:00/30', timer)
        self.assertIn('Persistent=true', timer)
        self.assertIn('--publish', (HERE / 'daily-stats.service').read_text())
        self.assertIn('%h/.local/share/daily-stats/daily-stats.py', (HERE / 'daily-stats.service').read_text())


if __name__ == '__main__':
    unittest.main()
