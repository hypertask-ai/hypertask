#!/usr/bin/env python3
"""Stop runaway test, build and premerge processes before they freeze the runners (YPER4-278).

A matched process tree is stopped when its root is older than 2 hours or any process in it uses more than 6 GB.
Only this user's processes are read. Claude, tmux, services and dev servers never match. Every stop is logged to
~/.local/state/proc-watchdog/kills.log and INFRA MANAGER gets one warning per sweep through runner-deliver.

  proc-watchdog.py sweep        stop what is over the limits
  proc-watchdog.py --dry-run    list what would be stopped, stop nothing
  proc-watchdog.py --install    copy this script and its timer to ~/.local/lib/hypertask/proc-watchdog and enable it
"""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
PROC = Path(os.environ.get('PROC_WATCHDOG_PROC', '/proc'))
MAX_AGE = int(os.environ.get('PROC_WATCHDOG_MAX_AGE', 2 * 60 * 60))
MAX_RSS_KB = int(os.environ.get('PROC_WATCHDOG_MAX_RSS_KB', 6 * 1024 * 1024))
STATE = Path(os.environ.get('PROC_WATCHDOG_STATE', Path.home() / '.local/state/proc-watchdog'))
NOTIFY = os.environ.get('PROC_WATCHDOG_NOTIFY', str(Path.home() / '.local/lib/hypertask/runner-pickup/runner-deliver'))
GRACE = float(os.environ.get('PROC_WATCHDOG_GRACE', 10))
ONLY = os.environ.get('PROC_WATCHDOG_ONLY', '')  # tests: only consider command lines containing this text

# First match wins. Patterns read the full command line.
KINDS = [
    ('premerge', re.compile(r'premerge-local')),
    ('test', re.compile(r'(^|/)(node|bun)\s.*\b(tests?|__tests__)/\S+\.(test|spec)\.[cm]?[jt]sx?\b')),
    ('test', re.compile(r'(^|/)node\s(.*\s)?--test\b')),
    ('test', re.compile(r'(^|/|\s)(vitest|jest)(\.m?js)?(\s|$)')),
    ('test', re.compile(r'\bplaywright(\.js)?\s+test\b')),
    ('build', re.compile(r'(^|/|\s)next(/dist/bin/next)?\s+build\b')),
    ('build', re.compile(r'next/dist/compiled/jest-worker/processChild\.js')),
    ('build', re.compile(r'\b(npm|pnpm|yarn)\s+run\s+build\b')),
    ('build', re.compile(r'(^|/|\s)(astro|vite)(\.m?js)?\s+build\b')),
]
# Never stopped, even when a pattern matches their command line (a session's own prompt can mention a test).
NEVER = {'claude', 'codex', 'hax', 'tmux', 'tmux: server', 'systemd', 'sshd', 'zsb', 'proc-watchdog.py'}
SHELLS = {'bash', 'sh', 'dash', 'zsh', 'fish'}
SECRET = re.compile(r'(?i)((?:token|secret|password|key|auth)[^=\s]*[=\s]+)\S+')


def clock_ticks():
    return os.sysconf('SC_CLK_TCK')


def read_procs():
    """pid -> {ppid, start, age, rss_kb, cmd, name, cwd} for this user's processes."""
    uid = os.getuid()
    uptime = float((PROC / 'uptime').read_text().split()[0])
    procs = {}
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
            stat = (entry / 'stat').read_text()
            name = stat[stat.index('(') + 1:stat.rindex(')')]
            fields = stat[stat.rindex(')') + 2:].split()
            raw = (entry / 'cmdline').read_bytes()
            rss = 0
            for line in (entry / 'status').read_text().splitlines():
                if line.startswith('VmRSS:'):
                    rss = int(line.split()[1])
            try:
                cwd = os.readlink(entry / 'cwd')
            except OSError:
                cwd = ''
        except (OSError, ValueError):
            continue
        if not raw:
            continue  # kernel thread or zombie
        start = int(fields[19])
        procs[int(entry.name)] = {
            'ppid': int(fields[1]), 'start': start, 'age': uptime - start / clock_ticks(), 'rss_kb': rss,
            'cmd': raw.rstrip(b'\0').replace(b'\0', b' ').decode(errors='replace'), 'name': name, 'cwd': cwd,
        }
    return procs


def kind_of(proc):
    first = proc['cmd'].split(' ', 1)[0]
    if proc['name'] in NEVER or os.path.basename(first) in NEVER or 'proc-watchdog.py' in proc['cmd']:
        return None
    # A shell's command line is a whole script ("npm run build && next start"); its real work matches on its own.
    if os.path.basename(first) in SHELLS:
        return None
    if ONLY and ONLY not in proc['cmd']:
        return None
    for kind, pattern in KINDS:
        if pattern.search(proc['cmd']):
            return kind
    return None


def over_limit(procs):
    """Matched root trees over a limit, as [{pid, kind, reason, age, rss_kb, cmd, cwd, tree}]."""
    kinds = {pid: kind_of(p) for pid, p in procs.items()}
    children = {}
    for pid, p in procs.items():
        children.setdefault(p['ppid'], []).append(pid)

    def tree(pid):
        out, todo = [], [pid]
        while todo:
            cur = todo.pop()
            out.append(cur)
            todo.extend(children.get(cur, []))
        return out

    def matched_ancestor(pid):
        seen, cur = set(), procs[pid]['ppid']
        while cur in procs and cur not in seen:
            if kinds[cur] and procs[cur]['name'] not in NEVER:
                return True
            seen.add(cur)
            cur = procs[cur]['ppid']
        return False

    hits = []
    for pid, kind in kinds.items():
        if not kind or matched_ancestor(pid):
            continue
        members = tree(pid)
        # A session process can sit inside a tree (a test that launches claude): never stop such a tree.
        if any(procs[m]['name'] in NEVER for m in members if m != pid):
            continue
        age = procs[pid]['age']
        rss = max(procs[m]['rss_kb'] for m in members)
        reasons = []
        if age > MAX_AGE:
            reasons.append(f'running {age / 3600:.1f} h')
        if rss > MAX_RSS_KB:
            reasons.append(f'using {rss / 1048576:.1f} GB')
        if reasons:
            hits.append({'pid': pid, 'kind': kind, 'reason': ' and '.join(reasons), 'age': age, 'rss_kb': rss,
                         'cmd': procs[pid]['cmd'], 'cwd': procs[pid]['cwd'],
                         'tree': [(m, procs[m]['start']) for m in members]})
    return hits


def same(pid, start):
    """True while pid still is the process we read (guards against pid reuse)."""
    try:
        stat = (PROC / str(pid) / 'stat').read_text()
        return int(stat[stat.rindex(')') + 2:].split()[19]) == start
    except (OSError, ValueError, IndexError):
        return False


def stop(hit):
    members = [m for m in reversed(hit['tree']) if same(*m)]  # children first
    for pid, _ in members:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    deadline = time.time() + GRACE
    while time.time() < deadline and any(same(*m) for m in members):
        time.sleep(0.2)
    killed = 0
    for pid, start in members:
        if same(pid, start):
            try:
                os.kill(pid, signal.SIGKILL)
                killed += 1
            except OSError:
                pass
    return len(members), killed


def short(text, n):
    text = SECRET.sub(r'\1***', text)
    return text if len(text) <= n else text[:n - 3] + '...'


def sweep(dry_run=False):
    hits = over_limit(read_procs())
    if dry_run:
        for h in hits:
            print(f"would stop {h['kind']} pid {h['pid']} ({h['reason']}, {len(h['tree'])} processes): {short(h['cmd'], 160)}")
        print(f'{len(hits)} over the limits')
        return 0
    if not hits:
        return 0
    STATE.mkdir(parents=True, exist_ok=True)
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    lines = []
    with open(STATE / 'kills.log', 'a') as log:
        for h in hits:
            stopped, forced = stop(h)
            log.write(json.dumps({'ts': now, 'pid': h['pid'], 'kind': h['kind'], 'reason': h['reason'],
                                  'processes': stopped, 'forced': forced, 'cwd': h['cwd'],
                                  'cmd': short(h['cmd'], 400)}) + '\n')
            lines.append(f"{h['kind']} pid {h['pid']} ({h['reason']}) in {h['cwd'] or '?'}: {short(h['cmd'], 120)}")
            print(f"stopped {lines[-1]}")
    message = (f'Process watchdog stopped {len(hits)} runaway process tree(s) (limits: 2 h or 6 GB): '
               + '; '.join(lines[:8]) + ('; and more' if len(lines) > 8 else '')
               + f". Log: {STATE / 'kills.log'}. https://app.hypertask.ai/detail/project-4060/278")
    try:
        subprocess.run([NOTIFY, 'infra-manager'], input=message.encode(), timeout=60,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as err:
        print(f'warning not sent: {err}', file=sys.stderr)
    return 0


def install():
    target = Path.home() / '.local/lib/hypertask/proc-watchdog'
    units = Path.home() / '.config/systemd/user'
    target.mkdir(parents=True, exist_ok=True)
    units.mkdir(parents=True, exist_ok=True)
    for name in ('proc-watchdog.py', 'proc-watchdog.service', 'proc-watchdog.timer'):
        if HERE != target:
            shutil.copy2(HERE / name, target / name)
    for suffix in ('service', 'timer'):
        shutil.copy2(target / f'proc-watchdog.{suffix}', units)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'proc-watchdog.timer'], check=True)


def main():
    args = sys.argv[1:]
    if args == ['--install']:
        install()
    elif args == ['sweep']:
        sys.exit(sweep())
    elif args == ['--dry-run']:
        sys.exit(sweep(dry_run=True))
    else:
        print('usage: proc-watchdog.py [sweep|--dry-run|--install]', file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
