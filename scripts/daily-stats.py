#!/usr/bin/env python3
"""Daily stats page for Hypertask (YPER4-341).

A plain script, no AI calls, read-only everywhere. It reads the boards, GitHub, the token-ladder status
file, /proc and PostHog, renders one static HTML page and (with --publish) uploads it with htmlshare to a
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
PH_PROJECT = '236160'
PH_HOST = 'https://eu.posthog.com'

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


def run(cmd, timeout=60):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
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


def fetch_board(pid):
    return ht_get(f'/mcp/tasks?projectId={pid}&limit=500')['tasks']


def fetch_comments(task):
    return ht_get(f"/mcp/comments?task_id={task['id']}&project_id={task['projectId']}")['comments']


def fetch_prs(repo, since_date):
    rows = gh_json(['pr', 'list', '-R', repo, '--state', 'merged', '--search', f'merged:>={since_date}',
                    '--limit', '100', '--json', 'number,title,url,mergedAt'])
    return rows


def fetch_deploys(now, today_start, yesterday_start):
    rows = gh_json(['api', 'repos/hypertask-ai/hypertask/deployments?environment=Production&per_page=40'])
    stamps = [(parse_ts(r['created_at']), r['id']) for r in rows]
    today = sum(1 for ts, _ in stamps if ts >= today_start)
    yesterday = sum(1 for ts, _ in stamps if yesterday_start <= ts < today_start)
    last_state, last_at = None, None
    if stamps:
        ts, did = max(stamps)
        sts = gh_json(['api', f'repos/hypertask-ai/hypertask/deployments/{did}/statuses?per_page=1'])
        last_state = sts[0]['state'] if sts else 'pending'
        last_at = ts.isoformat()
    return {'today': today, 'yesterday': yesterday, 'last_state': last_state, 'last_at': last_at}


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
    return gh_json(['run', 'list', '-R', 'hypertask-ai/hypertask', '--branch', 'production', '--status', 'failure',
                    '--created', f'>={since_date}', '--limit', '30', '--json', 'displayTitle,url,createdAt,name'])


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


def fetch_posthog(today_start):
    key = run(['stack-key', 'posthog', 'POSTHOG_READONLY_API_KEY'], timeout=20).strip()
    if not key:
        raise RuntimeError('key not available')
    API_CALLS['other'] += 1
    url = (f'{PH_HOST}/api/projects/{PH_PROJECT}/error_tracking/issues/'
           '?limit=100&order_by=first_seen&order_direction=DESC&date_from=-2d')
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=25) as r:
        d = json.load(r)
    fresh = [i for i in d['results'] if parse_ts(i['first_seen']) >= today_start]
    return {'new_today': len(fresh), 'sample': [i.get('description') or i.get('name') or '' for i in fresh[:3]]}


def collect(now):
    today_start, yesterday_start = day_bounds(now)
    since = berlin(yesterday_start, '%Y-%m-%d')
    today_date = berlin(today_start, '%Y-%m-%d')
    data = {'now': now, 'boards': {}, 'comments': {}, 'prs': {}}
    for pid in BOARDS:
        data['boards'][pid] = safe(fetch_board, pid)
    tasks, _ = all_tasks(data)
    done_today = done_between(tasks, today_start, now + timedelta(days=1))
    for t in done_today[:COMMENT_CAP_DONE]:
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
    data['deploys'] = safe(fetch_deploys, now, today_start, yesterday_start)
    data['smoke'] = safe(fetch_smoke)
    data['ci'] = safe(fetch_ci_failures, today_date)
    data['tokens'] = safe(fetch_tokens)
    data['load'] = safe(fetch_load)
    data['posthog'] = safe(fetch_posthog, today_start)
    return data


# ---------------------------------------------------------------- rendering

CSS = """
:root{--bg:#f4f4f4;--layer:#fff;--text:#161616;--muted:#525252;--line:#e0e0e0;--link:#0f62fe;--ok:#198038;--bad:#da1e28;--warn:#8e6a00;--tile:#f4f4f4}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--layer:#262626;--text:#f4f4f4;--muted:#c6c6c6;--line:#393939;--link:#78a9ff;--ok:#42be65;--bad:#ff8389;--warn:#f1c21b;--tile:#393939}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 'IBM Plex Sans',system-ui,-apple-system,Segoe UI,sans-serif;overflow-x:hidden}
main{max-width:1056px;margin:0 auto;padding:16px}
h1{font-size:28px;font-weight:400;margin:8px 0 4px}
h2{font-size:20px;font-weight:600;margin:0 0 12px}
section{background:var(--layer);border:1px solid var(--line);padding:16px;margin:16px 0}
a{color:var(--link);word-break:break-word}
.updated{margin:0 0 8px;color:var(--muted);font-size:14px}
.updated.bad{color:var(--bad);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0 16px}
.tile{background:var(--tile);padding:12px}
.tile .n{font-size:32px;line-height:1.1;font-weight:300}
.tile .l{font-size:13px;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted)}
td.num,th.num{text-align:right;white-space:nowrap}
ul{margin:0;padding-left:20px}
li{margin:4px 0}
.muted{color:var(--muted)}
.na{color:var(--warn)}
.ok{color:var(--ok)}
.bad{color:var(--bad)}
.tag{display:inline-block;font-size:12px;padding:0 8px;background:var(--tile);border-radius:12px;margin-left:6px;white-space:nowrap}
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
    out = ['<section id="waiting"><h2>Waiting on Valentin</h2>']
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


def pr_stats(data, today_start, yesterday_start):
    """{repo: (today_list, yesterday_list) or None}"""
    res = {}
    for repo in REPOS:
        src = data.get('prs', {}).get(repo)
        if not src or not src.get('ok'):
            res[repo] = (None, src['error'] if src else 'no data')
            continue
        today, yest = [], []
        for pr in src['data']:
            ts = parse_ts(pr['mergedAt'])
            if ts >= today_start:
                today.append(pr)
            elif ts >= yesterday_start:
                yest.append(pr)
        res[repo] = ((today, yest), None)
    return res


def sec_today(data, tasks, missing, now):
    ts, ys = day_bounds(now)
    d_today = done_between(tasks, ts, now + timedelta(days=1))
    d_yest = done_between(tasks, ys, ts)
    ct, cy = count_types(d_today), count_types(d_yest)
    out = ['<section id="today"><h2>Today so far</h2>',
           f'<p class="muted">Since 00:00 Europe/Berlin. Yesterday is the full previous day.</p>']
    if missing:
        out.append(f'<p>Done counts miss board {", ".join(str(m) for m in missing)}: {na()}</p>')
    out.append('<div class="scroll"><table><tr><th>Tickets moved to Done</th><th class="num">Today</th><th class="num">Yesterday</th></tr>')
    out.append(f'<tr><td><strong>All</strong></td><td class="num"><strong>{len(d_today)}</strong></td><td class="num"><strong>{len(d_yest)}</strong></td></tr>')
    for k in TYPES:
        out.append(f'<tr><td>{TYPE_NAMES[k]}</td><td class="num">{ct[k]}</td><td class="num">{cy[k]}</td></tr>')
    out.append('</table></div>')

    out.append('<h3>Pull requests merged</h3><div class="scroll"><table><tr><th>Repo</th><th class="num">Today</th><th class="num">Yesterday</th></tr>')
    prs = pr_stats(data, ts, ys)
    for repo in REPOS:
        val, err = prs[repo]
        if val is None:
            out.append(f'<tr><td>{esc(repo.split("/")[1])}</td><td colspan="2">{na(err)}</td></tr>')
        else:
            out.append(f'<tr><td>{esc(repo.split("/")[1])}</td><td class="num">{len(val[0])}</td><td class="num">{len(val[1])}</td></tr>')
    out.append('</table></div>')
    listed = [(repo, pr) for repo in REPOS if prs[repo][0] for pr in prs[repo][0][0]]
    if listed:
        out.append('<h3>Merged today</h3><ul>')
        for repo, pr in listed:
            out.append(f'<li>{link(pr["url"], pr["title"])} <span class="tag">{esc(repo.split("/")[1])}</span></li>')
        out.append('</ul>')

    out.append('<h3>Production</h3>')
    dep = data.get('deploys')
    if dep and dep.get('ok'):
        d = dep['data']
        state = d['last_state'] or 'none'
        cls = 'ok' if state == 'success' else 'bad'
        when = berlin(parse_ts(d['last_at'])) if d['last_at'] else ''
        out.append(f'<p>Deploys to production: <strong>{d["today"]}</strong> today, {d["yesterday"]} yesterday. '
                   f'Last one: <span class="{cls}">{esc(state)}</span> {esc(when)}.</p>')
    else:
        out.append(f'<p>Deploys: {na(dep["error"] if dep else None)}</p>')
    sm = data.get('smoke')
    if sm and sm.get('ok'):
        d = sm['data']
        cls = 'ok' if d['http'] == 200 else 'bad'
        line = f'Live check of {esc(APP)}: <span class="{cls}">HTTP {d["http"]}</span>.'
        if d.get('workflow'):
            w = d['workflow']
            wc = 'ok' if w['conclusion'] == 'success' else 'bad'
            line += f' Latest App Smoke run: <span class="{wc}">{esc(w["conclusion"])}</span> at {esc(berlin(parse_ts(w["at"])))}.'
        out.append(f'<p>{line}</p>')
    else:
        out.append(f'<p>Live check: {na(sm["error"] if sm else None)}</p>')
    out.append('</section>')
    return ''.join(out)


def sec_done(data, tasks, missing, now):
    ts, _ = day_bounds(now)
    done = done_between(tasks, ts, now + timedelta(days=1))
    out = [f'<section id="done"><h2>Done today ({len(done)})</h2>']
    if missing:
        out.append(f'<p>Board {", ".join(str(m) for m in missing)}: {na()}</p>')
    if not done:
        out.append('<p class="muted">Nothing is done yet today.</p>')
    else:
        out.append('<ul>')
        for t in done:
            tag = TYPE_NAMES[classify(t)]
            out.append(f'<li>{ticket_link(t)} <span class="tag">{esc(tag)}</span> <span class="muted">{esc(berlin(parse_ts(t["updatedAt"])))}</span></li>')
        out.append('</ul>')
    out.append('</section>')
    return ''.join(out)


def sec_flight(data, tasks, missing, now):
    out = ['<section id="flight"><h2>In flight</h2>']
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
    out = ['<section id="runners"><h2>Runners</h2>']
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


def sec_health(data, now):
    out = ['<section id="health"><h2>Health</h2>']
    cells = []
    tk = data.get('tokens')
    if tk and tk.get('ok'):
        cells.append(tile(f'{tk["data"]["claude"]:.0f}%', 'Claude weekly usage'))
        cells.append(tile(f'{tk["data"]["codex"]:.0f}%', 'Codex weekly usage'))
    else:
        cells.append(f'<div class="tile"><div class="l">Claude and Codex weekly usage</div>{na(tk["error"] if tk else None)}</div>')
    ld = data.get('load')
    if ld and ld.get('ok'):
        l1 = ld['data']['load'][0]
        cells.append(tile(f'{l1:.1f}', f'VPS load (1 min), {ld["data"]["cpus"]} CPUs'))
        cells.append(tile(f'{ld["data"]["mem_gb"]:.1f} GB', 'Free memory'))
    else:
        cells.append(f'<div class="tile"><div class="l">VPS load and memory</div>{na(ld["error"] if ld else None)}</div>')
    ph = data.get('posthog')
    if ph and ph.get('ok'):
        cells.append(tile(ph['data']['new_today'], 'New PostHog error issues today'))
    else:
        cells.append(f'<div class="tile"><div class="l">New PostHog error issues today</div>{na(ph["error"] if ph else None)}</div>')
    ci = data.get('ci')
    if ci and ci.get('ok'):
        cells.append(tile(len(ci['data']), 'Failed CI runs on production today'))
    else:
        cells.append(f'<div class="tile"><div class="l">Failed CI runs on production today</div>{na(ci["error"] if ci else None)}</div>')
    out.append('<div class="grid">' + ''.join(cells) + '</div>')
    if ci and ci.get('ok') and ci['data']:
        ts, _ = day_bounds(now)
        out.append('<h3>Failed runs</h3><ul>')
        for r in ci['data']:
            out.append(f'<li>{link(r["url"], r.get("displayTitle") or r.get("name") or "run")} <span class="muted">{esc(berlin(parse_ts(r["createdAt"])))}</span></li>')
        out.append('</ul>')
    out.append('</section>')
    return ''.join(out)


def sec_speed(data, tasks, missing, now):
    ts, _ = day_bounds(now)
    done = done_between(tasks, ts, now + timedelta(days=1))
    vals = speed_minutes(done, data.get('comments', {}))
    out = ['<section id="speed"><h2>Speed</h2>']
    if vals:
        med = statistics.median(vals)
        out.append(f'<p>Median time from "Claimed." to Done: <strong>{esc(human_span(timedelta(minutes=med)))}</strong> '
                   f'<span class="muted">(based on {len(vals)} of {len(done)} tickets done today)</span></p>')
    elif not done:
        out.append('<p class="muted">No ticket is done yet today.</p>')
    else:
        out.append(f'<p>Median claim to Done: {na("no claim comment found on the tickets checked")}</p>')
    out.append('</section>')
    return ''.join(out)


def render(data, now=None):
    now = now or data['now']
    tasks, missing = all_tasks(data)
    parts = [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta http-equiv="refresh" content="900">',
        '<title>Hypertask daily stats</title>',
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;600&display=swap" rel="stylesheet">',
        f'<style>{CSS}</style></head><body><main>',
        '<h1>Hypertask daily stats</h1>',
        updated_line(now),
        sec_waiting(data, tasks, missing, now),
        sec_today(data, tasks, missing, now),
        sec_done(data, tasks, missing, now),
        sec_flight(data, tasks, missing, now),
        sec_runners(data, tasks, missing, now),
        sec_health(data, now),
        sec_speed(data, tasks, missing, now),
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
    out = run(['htmlshare', str(path)], timeout=60).strip()
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
