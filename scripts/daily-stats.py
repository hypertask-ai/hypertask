#!/usr/bin/env python3
"""Daily stats page for Hypertask (YPER4-341).

A plain script, no AI calls, read-only everywhere. It reads the boards, GitHub, the token-ladder status
file and /proc, renders one static HTML page and (with --publish) uploads it with htmlshare to a
fixed hypertask.app URL. A systemd user timer runs it every 30 minutes.

Usage:
  daily-stats.py [--out FILE]   render to FILE (default ./daily-stats.html), no upload
  daily-stats.py --publish      render to ~/.local/share/daily-stats/out/daily-stats.html and upload it
  daily-stats.py --install      copy this script and its units to ~/.local/share/daily-stats and
                                ~/.config/systemd/user, enable the timer

Every source is fault-isolated: a failing source shows "not available" in its section and the rest still
renders. If the whole run fails, the last good page is kept and only its "last updated" line turns red.
"""
import html
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
BERLIN = ZoneInfo('Europe/Berlin')
HOME = Path(os.environ.get('HOME', str(Path.home())))
INSTALL_DIR = HOME / '.local/share/daily-stats'
PUBLISH_PATH = INSTALL_DIR / 'out/daily-stats.html'
UNIT_DIR = HOME / '.config/systemd/user'
TOKEN_STATUS = HOME / '.local/state/token-ladder/status.json'

BOARDS = {15: 'Hypertask Product', 4060: 'Agents & Infra'}
REPOS = ['hypertask-ai/hypertask', 'hypertask-ai/cli', 'hypertask-ai/agent-fleet']
APP = 'https://app.hypertask.ai'
WAITING_COLUMNS = ['Valentin Review', 'UX Sign-off']
FLIGHT_COLUMNS = ['In Progress', 'AI Review', 'QA', 'Bugs']
TYPES = ['bug', 'feature', 'improvement', 'security', 'infra', 'other']
TYPE_NAMES = {'bug': 'Bugs', 'feature': 'Features', 'improvement': 'Improvements',
              'security': 'Security', 'infra': 'Infra', 'other': 'Other'}
COMMENT_CAP_DONE = 10
COMMENT_CAP_RUNNERS = 6
RANGES = {'1h': 1, '3h': 3, '6h': 6, '12h': 12, '24h': 24, '2d': 48, '6d': 144, '7d': 168}

API_CALLS = {'ht': 0, 'gh': 0, 'other': 0}


# ---------------------------------------------------------------- time helpers

def parse_ts(s):
    if not s:
        return None
    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).astimezone(timezone.utc)


def day_bounds(now):
    """UTC instants of 00:00 Europe/Berlin today, yesterday."""
    local = now.astimezone(BERLIN)
    start = datetime(local.year, local.month, local.day, tzinfo=BERLIN)
    prev = datetime(*(local - timedelta(days=1)).timetuple()[:3], tzinfo=BERLIN)
    return start.astimezone(timezone.utc), prev.astimezone(timezone.utc)


def berlin(dt, fmt='%H:%M'):
    return dt.astimezone(BERLIN).strftime(fmt)


def human_span(delta):
    mins = max(int(delta.total_seconds() // 60), 0)
    if mins < 60:
        return f'{mins} min'
    hours, m = divmod(mins, 60)
    if hours < 24:
        return f'{hours} h {m} min'
    days, h = divmod(hours, 24)
    return f'{days} d {h} h'


# ---------------------------------------------------------------- task helpers

def ticket_url(t):
    return f"{APP}/detail/project-{t['projectId']}/{t['uniqueIndex']}"


def label_names(t):
    return {(l.get('name') or '') for l in t.get('labels') or []}


def classify(t):
    """bug / feature / improvement / security / infra / other, from the title prefix, then labels, then board."""
    title = (t.get('title') or '').lstrip()
    m = re.match(r'\[([A-Za-z]+)\]', title)
    tag = m.group(1).upper() if m else ''
    if tag == 'SECURITY':
        return 'security'
    if tag in ('BUG', 'BUGFIX'):
        return 'bug'
    if tag == 'FEATURE':
        return 'feature'
    if tag in ('IMPROVE', 'IMPROVEMENT'):
        return 'improvement'
    if tag == 'INFRA':
        return 'infra'
    names = {n.upper() for n in label_names(t)}
    if 'SECURITY' in names:
        return 'security'
    if any(n.startswith('FEATURE') for n in names):
        return 'feature'
    if any(n.startswith('IMPROVEMENT') for n in names):
        return 'improvement'
    if 'BUG' in names:
        return 'bug'
    if t.get('projectId') == 4060:
        return 'infra'
    return 'other'


def is_security(t):
    return 'SECURITY' in {n.upper() for n in label_names(t)} or classify(t) == 'security'


def priority(t):
    for p in ('P1', 'P2', 'P3'):
        if p in label_names(t):
            return p
    return None


def all_tasks(data):
    tasks, missing = [], []
    for pid in BOARDS:
        src = data.get('boards', {}).get(pid)
        if src and src.get('ok'):
            tasks.extend(src['data'])
        else:
            missing.append(pid)
    return tasks, missing


def done_between(tasks, start, end):
    out = []
    for t in tasks:
        if t.get('section') != 'Done':
            continue
        ts = parse_ts(t.get('updatedAt'))
        if ts and start <= ts < end:
            out.append(t)
    out.sort(key=lambda t: t['updatedAt'], reverse=True)
    return out


def count_types(tasks):
    c = {k: 0 for k in TYPES}
    for t in tasks:
        c[classify(t)] += 1
    return c


def claim_time(comments, before=None):
    """Time of the newest 'Claimed.' comment (before `before` when given)."""
    times = []
    for c in comments or []:
        if 'Claimed.' in (c.get('commentText') or c.get('text') or ''):
            ts = parse_ts(c.get('createdAt'))
            if ts and (before is None or ts <= before):
                times.append(ts)
    return max(times) if times else None


def speed_minutes(done_tasks, comments):
    """Minutes from 'Claimed.' to Done per ticket where comments were fetched."""
    vals = []
    for t in done_tasks:
        src = comments.get(t['id'])
        if not src or not src.get('ok'):
            continue
        done_at = parse_ts(t['updatedAt'])
        claimed = claim_time(src['data'], done_at)
        if claimed and done_at >= claimed:
            vals.append((done_at - claimed).total_seconds() / 60)
    return vals


def runner_name(t):
    for a in t.get('assignees') or []:
        n = (a.get('agent') or {}).get('displayName') or a.get('displayName') or ''
        if re.match(r'^Runner \d+$', n):
            return n
    return None


def runners_view(tasks, comments, now):
    """{runner: [(task, minutes, estimated)]} plus the sorted list of every runner seen on the boards."""
    seen = set()
    holding = {}
    for t in tasks:
        n = runner_name(t)
        if not n:
            continue
        seen.add(n)
        if t.get('section') in ('In Progress', 'AI Review', 'QA'):
            src = comments.get(t['id'])
            claimed = claim_time(src['data']) if src and src.get('ok') else None
            if claimed:
                mins, est = (now - claimed).total_seconds() / 60, False
            else:
                mins, est = (now - parse_ts(t['updatedAt'])).total_seconds() / 60, True
            holding.setdefault(n, []).append((t, mins, est))
    order = sorted(seen, key=lambda n: int(n.split()[1]))
    return holding, order


# ---------------------------------------------------------------- collection (every source isolated)

def safe(fn, *a):
    try:
        return {'ok': True, 'data': fn(*a)}
    except Exception as e:  # noqa: BLE001 - any failure becomes "not available"
        msg = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        return {'ok': False, 'error': msg[:160]}


COLLECT_DEADLINE = time.monotonic() + 480  # leaves most of the 15 min service limit for render and publish


def run(cmd, timeout=20, budget=True):
    left = COLLECT_DEADLINE - time.monotonic() if budget else timeout
    if left <= 1:
        raise RuntimeError('collection time budget used up')
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=min(timeout, left))
    if p.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {(p.stderr or p.stdout).strip()[:120]}")
    return p.stdout


def ht_get(path):
    API_CALLS['ht'] += 1
    out = run(['ht', 'GET', path])
    d = json.loads(out)
    if not d.get('success'):
        raise RuntimeError(f"ht GET {path.split('?')[0]}: {str(d.get('error') or 'no success')[:80]}")
    return d


def gh_json(args):
    API_CALLS['gh'] += 1
    return json.loads(run(['gh'] + args) or 'null')


def fetch_board(pid, max_pages=10):
    # The list endpoint caps a page at 100 tasks; follow its cursor so big boards stay complete.
    tasks, cursor = [], None
    for _ in range(max_pages):
        q = f'/mcp/tasks?projectId={pid}&limit=100&offset={len(tasks)}'
        if cursor:
            q += f'&cursor={cursor}'
        d = ht_get(q)
        tasks += d.get('tasks') or []
        cursor = d.get('nextCursor')
        if not cursor and len(tasks) >= int(d.get('total') or 0):
            return tasks
        if not d.get('tasks'):
            break
    raise RuntimeError(f'board {pid}: only {len(tasks)} tasks read, list is incomplete')


def fetch_comments(task):
    return ht_get(f"/mcp/comments?task_id={task['id']}&project_id={task['projectId']}")['comments']


def fetch_prs(repo, since_date):
    rows = gh_json(['pr', 'list', '-R', repo, '--state', 'merged', '--search', f'merged:>={since_date}',
                    '--limit', '1000', '--json', 'number,title,url,mergedAt'])
    if len(rows) >= 1000:
        raise RuntimeError('PR history reached the 1000 row limit')
    return rows


def fetch_deploys(now, since):
    # Stop at the requested history boundary, with a cap inside the shared collection budget.
    rows = []
    for page in range(1, 11):
        batch = gh_json(['api', f'repos/hypertask-ai/hypertask/deployments?environment=Production&per_page=100&page={page}'])
        rows.extend(batch)
        if len(batch) < 100 or parse_ts(batch[-1]['created_at']) < since:
            break
    else:
        raise RuntimeError('deployment history reached the 1000 row limit')
    last_state, last_at = None, None
    if rows:
        latest = max(rows, key=lambda r: r['created_at'])
        sts = gh_json(['api', f'repos/hypertask-ai/hypertask/deployments/{latest["id"]}/statuses?per_page=1'])
        last_state = sts[0]['state'] if sts else 'pending'
        last_at = latest['created_at']
    return {'events': [{'at': r['created_at']} for r in rows], 'last_state': last_state, 'last_at': last_at}


def fetch_smoke():
    API_CALLS['other'] += 1
    req = urllib.request.Request(APP + '/', headers={'User-Agent': 'daily-stats/1'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    workflow = None
    try:
        runs = gh_json(['run', 'list', '-R', 'hypertask-ai/hypertask', '--workflow', 'App Smoke', '--limit', '1',
                        '--json', 'conclusion,createdAt'])
        if runs:
            workflow = {'conclusion': runs[0].get('conclusion') or 'running', 'at': runs[0]['createdAt']}
    except Exception:  # noqa: BLE001 - the HTTP check alone is still useful
        workflow = None
    return {'http': status, 'workflow': workflow}


def fetch_ci_failures(since_date):
    rows = gh_json(['run', 'list', '-R', 'hypertask-ai/hypertask', '--branch', 'production', '--status', 'failure',
                    '--created', f'>={since_date}', '--limit', '1000', '--json', 'displayTitle,url,createdAt,name'])
    if len(rows) >= 1000:
        raise RuntimeError('CI history reached the 1000 row limit')
    return rows


def fetch_tokens():
    d = json.loads(TOKEN_STATUS.read_text())
    return {'claude': d['claude']['week']['used'], 'codex': d['codex']['week']['used']}


def fetch_load():
    load = Path('/proc/loadavg').read_text().split()[:3]
    mem = None
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            mem = int(line.split()[1]) / 1024 / 1024
    if mem is None:
        raise RuntimeError('MemAvailable missing')
    return {'load': [float(x) for x in load], 'mem_gb': mem, 'cpus': os.cpu_count() or 1}


def collect(now):
    since_at = now - timedelta(days=14)
    since = since_at.strftime('%Y-%m-%d')
    data = {'now': now, 'boards': {}, 'comments': {}, 'prs': {}}
    for pid in BOARDS:
        data['boards'][pid] = safe(fetch_board, pid)
    tasks, _ = all_tasks(data)
    done_recent = done_between(tasks, since_at, now)
    for t in done_recent[:COMMENT_CAP_DONE]:
        data['comments'][t['id']] = safe(fetch_comments, t)
    active = [t for t in tasks if runner_name(t) and t.get('section') in ('In Progress', 'AI Review', 'QA')]
    active.sort(key=lambda t: t['updatedAt'])
    fetched = 0
    for t in active:
        if fetched >= COMMENT_CAP_RUNNERS:
            break
        if t['id'] not in data['comments']:
            data['comments'][t['id']] = safe(fetch_comments, t)
            fetched += 1
    for repo in REPOS:
        data['prs'][repo] = safe(fetch_prs, repo, since)
    data['deploys'] = safe(fetch_deploys, now, since_at)
    data['smoke'] = safe(fetch_smoke)
    data['ci'] = safe(fetch_ci_failures, since)
    data['tokens'] = safe(fetch_tokens)
    data['load'] = safe(fetch_load)
    data['history_start'] = since_at.isoformat()
    return data


# ---------------------------------------------------------------- rendering

CSS = """
:root{--bg-pageBackground:#ffffff;--bg-cardBackground:#ffffff;--color-white-black:#18181b;--color-text-light-gray:#727279;--border-light-gray-thin:#e2e2e6;--color-rich-text-link:#1365a3;--color-pull-request-green:#1a7f37;--color-pull-request-checks-red:#cf222e;--warn:#8e6a00;--tile:#f4f4f5}
@media (prefers-color-scheme:dark){:root{--bg-pageBackground:#0e0e0e;--bg-cardBackground:#262a30;--color-white-black:#ffffff;--color-text-light-gray:#8e9093;--border-light-gray-thin:#33373e;--color-rich-text-link:#5896f1;--color-pull-request-green:#4ade80;--color-pull-request-checks-red:#f87171;--warn:#f1c21b;--tile:#0e0e0e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg-pageBackground);color:var(--color-white-black);font:16px/1.5 'IBM Plex Sans',system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:hidden}
main{max-width:1056px;margin:0 auto;padding:16px}
h1{font-size:24px;font-weight:400;margin:8px 0 4px}
h2{font-size:18px;font-weight:600;margin:0 0 12px}
section{background:var(--bg-cardBackground);border:1px solid var(--border-light-gray-thin);padding:16px;margin:16px 0}
a{color:var(--color-rich-text-link);word-break:break-word}
.updated{margin:0 0 8px;color:var(--color-text-light-gray);font-size:14px}
.updated.bad{color:var(--color-pull-request-checks-red);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0 16px}
.tile{background:var(--tile);padding:12px}
.tile .n{font-size:32px;line-height:1.1;font-weight:300}
.tile .l{font-size:13px;color:var(--color-text-light-gray)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--border-light-gray-thin);vertical-align:top}
th{font-weight:600;color:var(--color-text-light-gray)}
td.num,th.num{text-align:right;white-space:nowrap}
ul{margin:0;padding-left:20px}
li{margin:4px 0}
.muted{color:var(--color-text-light-gray)}
.na{color:var(--warn)}
.ok{color:var(--color-pull-request-green)}
.bad{color:var(--color-pull-request-checks-red)}
.tag{display:inline-block;font-size:12px;padding:0 8px;background:var(--tile);border-radius:4px;margin-left:6px;white-space:nowrap}
[hidden]{display:none!important}
.ranges{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.ranges button{font:inherit;font-size:14px;color:inherit;background:var(--tile);border:1px solid var(--border-light-gray-thin);border-radius:4px;padding:6px 10px;cursor:pointer}
.ranges button[aria-pressed="true"]{border-color:var(--color-rich-text-link);color:var(--color-rich-text-link)}
.ranges button:focus-visible{outline:2px solid var(--color-rich-text-link);outline-offset:2px}
.delta{font-size:13px;color:var(--color-text-light-gray);margin-top:6px}
h3{font-size:16px;margin:16px 0 4px}
.scroll{overflow-x:auto}
"""

UPDATED_RE = re.compile(r'<!--updated-->.*?<!--/updated-->', re.S)


def esc(s):
    return html.escape(str(s), quote=True)


def link(url, title):
    return f'<a href="{esc(url)}">{esc(title)}</a>'


def ticket_link(t):
    return link(ticket_url(t), t.get('title') or '(untitled)')


def na(why=None):
    extra = f' <span class="muted">({esc(why)})</span>' if why else ''
    return f'<span class="na">not available</span>{extra}'


def tile(n, label):
    return f'<div class="tile"><div class="n">{esc(n)}</div><div class="l">{esc(label)}</div></div>'


def updated_line(now, bad_msg=None):
    stamp = berlin(now, '%Y-%m-%d %H:%M')
    if bad_msg:
        return (f'<!--updated--><p class="updated bad">Last update failed at {esc(stamp)} (Berlin): {esc(bad_msg)}. '
                f'Showing the last good data below.</p><!--/updated-->')
    return f'<!--updated--><p class="updated">Last updated {esc(stamp)} Europe/Berlin. Refreshes every 30 minutes.</p><!--/updated-->'


def sec_waiting(data, tasks, missing, now):
    rows = [t for t in tasks if t.get('section') in WAITING_COLUMNS]
    rows.sort(key=lambda t: t['updatedAt'])
    out = ['<section id="waiting"><h2>Waiting on Valentin (now)</h2>']
    if missing:
        out.append(f'<p>Board {", ".join(str(m) for m in missing)}: {na()}</p>')
    if not rows:
        out.append('<p class="muted">Nothing is waiting on you.</p>' if not missing else '')
    else:
        out.append('<div class="scroll"><table><tr><th>Ticket</th><th>Column</th><th class="num">Waiting</th></tr>')
        for t in rows:
            wait = human_span(now - parse_ts(t['updatedAt']))
            out.append(f'<tr><td>{ticket_link(t)}</td><td>{esc(t["section"])}</td><td class="num">{esc(wait)}</td></tr>')
        out.append('</table></div><p class="muted">Wait time counts from the last change on the ticket.</p>')
    out.append('</section>')
    return ''.join(out)


def sec_flight(data, tasks, missing, now):
    out = ['<section id="flight"><h2>In flight (now)</h2>']
    if missing:
        out.append(f'<p>Board {", ".join(str(m) for m in missing)}: {na()}</p>')
    by = {c: [t for t in tasks if t.get('section') == c] for c in FLIGHT_COLUMNS}
    out.append('<div class="grid">' + ''.join(tile(len(by[c]), c) for c in FLIGHT_COLUMNS) + '</div>')
    bugs = by['Bugs']
    if bugs:
        pc = {p: sum(1 for t in bugs if priority(t) == p) for p in ('P1', 'P2', 'P3')}
        unr = sum(1 for t in bugs if priority(t) is None)
        sec = sum(1 for t in bugs if is_security(t))
        out.append(f'<p>Bugs by priority: P1 <strong>{pc["P1"]}</strong>, P2 <strong>{pc["P2"]}</strong>, P3 <strong>{pc["P3"]}</strong>'
                   f'{f", unrated {unr}" if unr else ""}. Security: <strong>{sec}</strong>.</p>')
    for c in FLIGHT_COLUMNS:
        if not by[c]:
            continue
        out.append(f'<h3>{esc(c)} ({len(by[c])})</h3><ul>')
        for t in sorted(by[c], key=lambda t: t['updatedAt']):
            tags = ''
            if c == 'Bugs':
                if priority(t):
                    tags += f'<span class="tag">{priority(t)}</span>'
                if is_security(t):
                    tags += '<span class="tag bad">Security</span>'
            out.append(f'<li>{ticket_link(t)}{tags}</li>')
        out.append('</ul>')
    out.append('</section>')
    return ''.join(out)


def sec_runners(data, tasks, missing, now):
    holding, order = runners_view(tasks, data.get('comments', {}), now)
    out = ['<section id="runners"><h2>Runners (now)</h2>']
    if missing:
        out.append(f'<p>Board {", ".join(str(m) for m in missing)}: {na()}</p>')
    if not order:
        out.append('<p class="muted">No runner seen on the boards.</p>')
    else:
        out.append('<div class="scroll"><table><tr><th>Runner</th><th>Holds</th><th class="num">Time on it</th></tr>')
        for n in order:
            if n not in holding:
                out.append(f'<tr><td>{esc(n)}</td><td class="muted">idle</td><td class="num"></td></tr>')
                continue
            for t, mins, est in holding[n]:
                span = human_span(timedelta(minutes=mins))
                note = ' (since last change)' if est else ''
                out.append(f'<tr><td>{esc(n)}</td><td>{ticket_link(t)} <span class="tag">{esc(t["section"])}</span></td>'
                           f'<td class="num">{esc(span)}{esc(note)}</td></tr>')
        out.append('</table></div>')
    out.append('</section>')
    return ''.join(out)


def build_events(data):
    """Only timestamped facts, bounded to 14 days. Done uses the board's last-change timestamp."""
    now = data['now']
    since = now - timedelta(days=14)
    events = []

    def add(metric, at, **fields):
        ts = parse_ts(at)
        if ts and since <= ts < now:
            events.append(dict(metric=metric, at=ts.isoformat(), **fields))

    tasks, _ = all_tasks(data)
    for t in tasks:
        fields = dict(title=t.get('title') or '(untitled)', url=ticket_url(t), type=classify(t))
        if t.get('section') == 'Done':
            mins = speed_minutes([t], data.get('comments', {}))
            add('done', t.get('updatedAt'), minutes=mins[0] if mins else None, **fields)
        names = {n.lower() for n in label_names(t)}
        if classify(t) == 'bug' or 'bug' in names or t.get('section') == 'Bugs':
            add('bugs', t.get('createdAt'), **fields)
        if t.get('projectId') == 15 and 'prod-error' in names:
            add('errors', t.get('createdAt'), **fields)
    for repo, src in data.get('prs', {}).items():
        if src.get('ok'):
            for pr in src['data']:
                add('prs', pr['mergedAt'], repo=repo, title=pr['title'], url=pr['url'])
    for metric, source in [('deploys', 'deploys'), ('ci', 'ci')]:
        src = data.get(source, {})
        if src.get('ok'):
            rows = src['data'].get('events', []) if metric == 'deploys' else src['data']
            for row in rows:
                add(metric, row.get('at') or row.get('createdAt'),
                    title=row.get('displayTitle') or row.get('name') or 'run', url=row.get('url') or '')
    return events


def range_snapshot(events, now, range_key='24h', history_start=None, unavailable=()):
    """Pure reference for the browser: half-open current and equal-length previous periods."""
    key = range_key if range_key in RANGES else '24h'
    start = now - timedelta(hours=RANGES[key])
    previous_start = start - timedelta(hours=RANGES[key])
    current = [e for e in events if start <= parse_ts(e['at']) < now]
    previous = [e for e in events if previous_start <= parse_ts(e['at']) < start]
    counts, previous_counts, deltas = {}, {}, {}
    keys = ['done', 'bugs', 'errors', 'prs', 'deploys', 'ci']
    keys += ['done:' + t for t in TYPES] + ['prs:' + r for r in REPOS]
    for name in keys:
        metric, _, group = name.partition(':')
        field = 'type' if metric == 'done' else 'repo'
        count = lambda rows: sum(e['metric'] == metric and (not group or e.get(field) == group) for e in rows)
        available = name not in unavailable and (metric not in unavailable or (metric == 'prs' and group))
        complete = not history_start or parse_ts(history_start) <= previous_start
        counts[name] = count(current) if available else None
        previous_counts[name] = count(previous) if available and complete else None
        deltas[name] = counts[name] - previous_counts[name] if available and complete else None
    return dict(key=key, current=current, counts=counts, previous=previous_counts, deltas=deltas)


def event_config(data):
    tasks, missing = all_tasks(data)
    unavailable = []
    if missing:
        unavailable += ['done', 'bugs']
    if 15 in missing:
        unavailable.append('errors')
    for repo in REPOS:
        if not data.get('prs', {}).get(repo, {}).get('ok'):
            unavailable += ['prs:' + repo, 'prs']
    for source in ('deploys', 'ci'):
        if not data.get(source, {}).get('ok'):
            unavailable.append(source)
    holding, _ = runners_view(tasks, data.get('comments', {}), data['now'])
    return dict(now=data['now'].isoformat(), ranges=RANGES, events=build_events(data),
                history_start=data.get('history_start', (data['now'] - timedelta(days=14)).isoformat()),
                unavailable=sorted(set(unavailable)),
                waiting=None if missing else sum(t.get('section') in WAITING_COLUMNS for t in tasks),
                runners=None if missing else len(holding))


def embedded_json(value):
    return scrub(json.dumps(value, ensure_ascii=False).replace('</', r'<\/').replace('<', r'\u003c'))


def stat(snapshot, name, attr='count'):
    value = snapshot['previous' if attr == 'previous' else 'counts'][name]
    return f'<span data-{attr}="{esc(name)}">{value if value is not None else "n/a"}</span>'


def event_list(config, metric, snapshot):
    out = ['<ul>']
    for i, e in sorted(enumerate(config['events']), key=lambda pair: pair[1]['at'], reverse=True):
        if e['metric'] != metric:
            continue
        hidden = '' if e in snapshot['current'] else ' hidden'
        out.append(f'<li data-event="{i}"{hidden}>{link(e["url"], e["title"])} '
                   f'<span class="muted">{esc(berlin(parse_ts(e["at"]), "%d %b %H:%M"))}</span></li>')
    out.append('</ul>')
    if metric in config['unavailable']:
        out.append('<p class="na">Source unavailable; any listed events are partial.</p>')
    empty = not any(e['metric'] == metric for e in snapshot['current'])
    out.append(f'<p class="muted" data-empty="{metric}"{"" if empty else " hidden"}>No events in this range.</p>')
    return ''.join(out)


def sec_vital(config, snapshot):
    out = ['<section id="vital" aria-label="Vital numbers"><div class="grid">']
    labels = {'done': 'Tickets Done', 'bugs': 'New bugs filed', 'errors': 'Production error tickets', 'prs': 'PRs merged'}
    for metric, label in labels.items():
        delta = snapshot['deltas'][metric]
        text = f'{delta:+d} vs previous 24h' if delta is not None else 'n/a vs previous 24h'
        out.append(f'<div class="tile"><div class="l">{label}</div><div class="n">{stat(snapshot, metric)}</div>'
                   f'<div class="delta" data-delta="{metric}">{text}</div></div>')
    out.extend(tile(config[key] if config[key] is not None else 'n/a', label + ' (now)')
               for key, label in [('waiting', 'Waiting on Valentin'), ('runners', 'Active runners')])
    out.append('</div><p class="muted">Done: current Done tickets by last change (not a transition log). '
               'New bugs: ticket creation on boards 15 and 4060. Production errors: board 15 tickets labeled prod-error, '
               'by creation time, not exception occurrences. PRs: GitHub mergedAt across the three repos below. '
               'n/a means a source or complete previous period is unavailable.</p></section>')
    return ''.join(out)


def sec_period(data, config, snapshot):
    out = ['<section id="today"><h2>Selected period</h2><p class="muted">Rolling range ending at the data update, '
           'compared with the preceding period of exactly the same length.</p>',
           '<div class="scroll"><table><tr><th>Tickets Done</th><th class="num">Selected</th><th class="num">Previous</th></tr>']
    for key, label in [('done', 'All')] + [('done:' + k, TYPE_NAMES[k]) for k in TYPES]:
        out.append(f'<tr><td>{label}</td><td class="num">{stat(snapshot, key)}</td><td class="num">{stat(snapshot, key, "previous")}</td></tr>')
    out.append('</table></div><h3>Pull requests merged</h3><div class="scroll"><table><tr><th>Repo</th><th class="num">Selected</th><th class="num">Previous</th></tr>')
    for repo in REPOS:
        key = 'prs:' + repo
        out.append(f'<tr><td>{esc(repo.split("/")[1])}</td><td class="num">{stat(snapshot, key)}</td><td class="num">{stat(snapshot, key, "previous")}</td></tr>')
    out.append('</table></div>' + event_list(config, 'prs', snapshot))
    out.append(f'<h3>Production</h3><p>Deploys in selected range: <strong>{stat(snapshot, "deploys")}</strong>; '
               f'previous: {stat(snapshot, "deploys", "previous")}.</p>')
    dep = data.get('deploys', {})
    if dep.get('ok'):
        d = dep['data']
        state = d.get('last_state') or 'none'
        cls = 'ok' if state == 'success' else 'bad'
        when = berlin(parse_ts(d['last_at']), '%Y-%m-%d %H:%M') if d.get('last_at') else ''
        out.append(f'<p>Latest deploy (now): <span class="{cls}">{esc(state)}</span> {esc(when)} Berlin.</p>')
    else:
        out.append(f'<p>Latest deploy (now): {na()}</p>')
    sm = data.get('smoke', {})
    if sm.get('ok'):
        d = sm['data']
        cls = 'ok' if d['http'] == 200 else 'bad'
        line = f'Live check of {esc(APP)} (now): <span class="{cls}">HTTP {d["http"]}</span>.'
        if d.get('workflow'):
            w = d['workflow']
            wc = 'ok' if w['conclusion'] == 'success' else 'bad'
            line += f' Latest App Smoke (now): <span class="{wc}">{esc(w["conclusion"])}</span> at {esc(berlin(parse_ts(w["at"])))} Berlin.'
        out.append(f'<p>{line}</p>')
    else:
        out.append(f'<p>Live check (now): {na()}</p>')
    out.append('</section>')
    for metric, title in [('done', 'Done'), ('bugs', 'New bugs filed'), ('errors', 'Production error tickets')]:
        out.append(f'<section id="{metric}"><h2>{title} in selected range ({stat(snapshot, metric)})</h2>'
                   + event_list(config, metric, snapshot) + '</section>')
    return ''.join(out)


def sec_health(data, config, snapshot):
    out = ['<section id="health"><h2>Health</h2><div class="grid">']
    tk = data.get('tokens', {})
    if tk.get('ok'):
        out += [tile(f'{tk["data"][key]:.0f}%', label + ' weekly usage (now)') for key, label in [('claude', 'Claude'), ('codex', 'Codex')]]
    else:
        out.append(tile('n/a', 'Claude and Codex weekly usage (now)'))
    ld = data.get('load', {})
    if ld.get('ok'):
        out += [tile(f'{ld["data"]["load"][0]:.1f}', f'VPS load (now, 1 min), {ld["data"]["cpus"]} CPUs'),
                tile(f'{ld["data"]["mem_gb"]:.1f} GB', 'Free memory (now)')]
    else:
        out.append(tile('n/a', 'VPS load and memory (now)'))
    out.append(f'</div><p>Failed CI runs on production in selected range: {stat(snapshot, "ci")}</p>'
               + event_list(config, 'ci', snapshot) + '</section>')
    return ''.join(out)


def sec_speed(config, snapshot):
    vals = [e['minutes'] for e in snapshot['current'] if e['metric'] == 'done' and e.get('minutes') is not None]
    med = f'{statistics.median(vals):.0f} min' if vals else 'n/a'
    return (f'<section id="speed"><h2>Speed in selected range</h2><p>Median time from "Claimed." to Done: '
            f'<strong data-speed="median">{med}</strong> <span class="muted">(based on '
            f'<span data-speed="sample">{len(vals)}</span> of {stat(snapshot, "done")} tickets)</span></p>'
            '<p class="muted">Sample limited to the 10 most recently done tickets with fetched claim comments.</p></section>')


BROWSER_JS = r"""
const config = JSON.parse(document.getElementById('stats-events').textContent);
function validRange(value) { return Object.hasOwn(config.ranges, value) ? value : '24h'; }
function snapshot(value) {
  const key = validRange(value), end = Date.parse(config.now), hours = config.ranges[key];
  const start = end - hours * 3600000, previousStart = start - hours * 3600000;
  const current = config.events.filter(e => Date.parse(e.at) >= start && Date.parse(e.at) < end);
  const previous = config.events.filter(e => Date.parse(e.at) >= previousStart && Date.parse(e.at) < start);
  const counts = {}, before = {}, deltas = {};
  const keys = ['done', 'bugs', 'errors', 'prs', 'deploys', 'ci',
    ...['bug', 'feature', 'improvement', 'security', 'infra', 'other'].map(t => 'done:' + t),
    ...['hypertask-ai/hypertask', 'hypertask-ai/cli', 'hypertask-ai/agent-fleet'].map(r => 'prs:' + r)];
  for (const name of keys) {
    const [metric, group] = name.split(':');
    const count = rows => rows.filter(e => e.metric === metric && (!group || e[metric === 'done' ? 'type' : 'repo'] === group)).length;
    const available = !config.unavailable.includes(name) && (!config.unavailable.includes(metric) || (metric === 'prs' && group));
    const complete = Date.parse(config.history_start) <= previousStart;
    counts[name] = available ? count(current) : null;
    before[name] = available && complete ? count(previous) : null;
    deltas[name] = available && complete ? counts[name] - before[name] : null;
  }
  return {key, current, counts, previous: before, deltas};
}
function applyRange(value) {
  const s = snapshot(value), show = n => n === null ? 'n/a' : String(n);
  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = show(s.counts[el.dataset.count]); });
  document.querySelectorAll('[data-previous]').forEach(el => { el.textContent = show(s.previous[el.dataset.previous]); });
  const label = s.key.endsWith('d') ? s.key.slice(0, -1) + ' days' : s.key;
  document.getElementById('selected-range').textContent = 'Last ' + label + ' (ending at last update)';
  document.querySelectorAll('[data-delta]').forEach(el => {
    const n = s.deltas[el.dataset.delta];
    el.textContent = (n === null ? 'n/a' : (n >= 0 ? '+' : '') + n) + ' vs previous ' + label;
  });
  const active = new Set(s.current);
  document.querySelectorAll('[data-event]').forEach(el => { el.hidden = !active.has(config.events[Number(el.dataset.event)]); });
  document.querySelectorAll('[data-empty]').forEach(el => {
    const metric = el.dataset.empty;
    el.hidden = s.current.some(e => e.metric === metric);
    el.textContent = 'No events in this range.';
  });
  const minutes = s.current.filter(e => e.metric === 'done' && e.minutes !== null).map(e => e.minutes).sort((a,b) => a-b);
  const mid = Math.floor(minutes.length / 2);
  const median = minutes.length ? (minutes.length % 2 ? minutes[mid] : (minutes[mid - 1] + minutes[mid]) / 2) : null;
  document.querySelector('[data-speed="median"]').textContent = median === null ? 'n/a' : Math.round(median) + ' min';
  document.querySelector('[data-speed="sample"]').textContent = String(minutes.length);
  document.querySelectorAll('[data-range]').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.range === s.key)); });
  const url = new URL(location.href);
  url.searchParams.set('range', s.key);
  history.replaceState(null, '', url);
}
document.querySelectorAll('[data-range]').forEach(el => { el.addEventListener('click', () => applyRange(el.dataset.range)); });
applyRange(new URL(location.href).searchParams.get('range'));
"""


def render(data, now=None):
    now = now or data['now']
    tasks, missing = all_tasks(data)
    config = event_config(data)
    snapshot = range_snapshot(config['events'], data['now'], history_start=config['history_start'], unavailable=config['unavailable'])
    buttons = ''.join(f'<button type="button" data-range="{key}" aria-pressed="{str(key == "24h").lower()}">{key[:-1] + " days" if key.endswith("d") else key}</button>' for key in RANGES)
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta http-equiv="refresh" content="900">',
        '<title>Hypertask daily stats</title>',
        f'<style>{CSS}</style></head><body><main><h1>Hypertask daily stats</h1>',
        updated_line(now),
        '<p id="selected-range" class="muted" aria-live="polite">Last 24h (ending at last update)</p>',
        f'<nav class="ranges" aria-label="Time range">{buttons}</nav>',
        sec_vital(config, snapshot),
        sec_waiting(data, tasks, missing, now),
        sec_period(data, config, snapshot),
        sec_flight(data, tasks, missing, now),
        sec_runners(data, tasks, missing, now),
        sec_health(data, config, snapshot),
        sec_speed(config, snapshot),
        f'<script id="stats-events" type="application/json">{embedded_json(config)}</script>',
        f'<script>{BROWSER_JS}</script>',
        '</main></body></html>',
    ]
    return scrub(''.join(parts))


def scrub(text):
    """No em dashes anywhere, even if a ticket title has one."""
    return text.replace(chr(0x2014), '-')


def mark_failed(old_html, now, reason):
    """Keep the last good page; rewrite only the 'last updated' line, in red."""
    line = scrub(updated_line(now, reason))
    if old_html and UPDATED_RE.search(old_html):
        return UPDATED_RE.sub(lambda m: line, old_html, count=1)
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>Hypertask daily stats</title><style>{CSS}</style></head><body><main><h1>Hypertask daily stats</h1>'
            + line + '<p>No good page yet.</p></main></body></html>')


# ---------------------------------------------------------------- publish / install / main

def publish(path):
    out = run(['htmlshare', str(path)], timeout=60, budget=False).strip()
    url = out.splitlines()[-1]
    if not url.startswith('https://'):
        raise RuntimeError('htmlshare gave no URL')
    return url


def install():
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    UNIT_DIR.mkdir(parents=True, exist_ok=True)
    for name in ('daily-stats.py', 'daily-stats.service', 'daily-stats.timer'):
        src, dst = HERE / name, INSTALL_DIR / name
        if src.resolve() != dst.resolve():
            shutil.copy2(src, dst)
    os.chmod(INSTALL_DIR / 'daily-stats.py', 0o755)
    for suffix in ('service', 'timer'):
        shutil.copy2(INSTALL_DIR / f'daily-stats.{suffix}', UNIT_DIR / f'daily-stats.{suffix}')
    if os.environ.get('DAILY_STATS_NO_SYSTEMD') == '1':
        return
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'daily-stats.timer'], check=True)


def main(argv):
    if argv == ['--install']:
        install()
        print(f'installed to {INSTALL_DIR}; timer enabled')
        return 0
    do_publish = '--publish' in argv
    out_path = Path('daily-stats.html')
    if '--out' in argv:
        out_path = Path(argv[argv.index('--out') + 1])
    unknown = [a for a in argv if a not in ('--publish', '--out') and a != str(out_path)]
    if unknown:
        print('usage: daily-stats.py [--out FILE | --publish | --install]', file=sys.stderr)
        return 2
    target = PUBLISH_PATH if do_publish else out_path
    target.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    started = datetime.now()
    failed = None
    try:
        data = collect(now)
        if all(not data['boards'][p]['ok'] for p in BOARDS):
            raise RuntimeError('no board could be read')
        page = render(data, now)
    except Exception as e:  # noqa: BLE001 - whole run failed: keep the last good page
        failed = str(e).strip().splitlines()[0][:160] if str(e).strip() else type(e).__name__
        old = target.read_text() if target.exists() else ''
        page = mark_failed(old, now, failed)
    target.write_text(page)
    secs = (datetime.now() - started).total_seconds()
    print(f'wrote {target} in {secs:.1f}s; api calls: ht {API_CALLS["ht"]}, gh {API_CALLS["gh"]}, other {API_CALLS["other"]}')
    if do_publish:
        try:
            print(publish(target))
        except Exception as e:  # noqa: BLE001
            print(f'publish failed: {e}', file=sys.stderr)
            return 1
        print('cache bust: skipped (hypertask.app sits on the Hypertask Cloudflare account, which needs a recorded yes)')
    if failed:
        print(f'run failed: {failed}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
