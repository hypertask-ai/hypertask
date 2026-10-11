#!/usr/bin/env python3
"""Reconcile current-head evidence statuses without polling each completed PR."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime

HERE = Path(__file__).resolve().parent
REPO = 'hypertask-ai/hypertask'
CHECKER_PATH = '.claude/skills/ship/scripts/ship-check'
REFRESH_SECONDS = 600  # ten-minute refresh for live flag changes; a new head or changed evidence re-checks at once


def install():
    target = Path.home() / '.local/lib/hypertask/premerge-evidence'
    units = Path.home() / '.config/systemd/user'
    target.mkdir(parents=True, exist_ok=True)
    units.mkdir(parents=True, exist_ok=True)
    for name in ('ship-check', 'premerge-evidence.py'):
        if HERE != target:
            shutil.copy2(HERE / name, target / name)
    for name in ('premerge-evidence', 'premerge-evidence-gh-loops'):
        for suffix in ('service', 'timer'):
            shutil.copy2(HERE / f'{name}.{suffix}', units)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    for name in ('premerge-evidence', 'premerge-evidence-gh-loops'):
        subprocess.run(['systemctl', '--user', 'enable', '--now', f'{name}.timer'], check=True)


def fingerprint(row, evidence, checker_sha):
    ticket = row['title'].split()[0]
    folder = evidence / ticket
    record = folder / 'premerge.md'
    digest = hashlib.sha256(json.dumps([row['headRefOid'], row['title'], checker_sha], sort_keys=True).encode())
    if record.is_file():
        text = record.read_bytes()
        digest.update(text)
        match = re.search(rb'^Recording:\s*([^\r\n]+)', text, re.M)
        if match:
            video = (folder / match[1].decode().strip()).resolve()
            if video.is_relative_to(folder.resolve()) and video.is_file():
                with video.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
    return digest.hexdigest()


def cache_dir(state):
    return Path(os.environ.get('SHIP_GIT_CACHE') or state / 'git')


def fetch_checker(state):
    # One git fetch of production, then read the rules from it. No contents API call.
    git = os.environ.get('SHIP_GIT', 'git')
    cache = cache_dir(state)
    remote = os.environ.get('SHIP_GIT_REMOTE', f'https://github.com/{REPO}.git')
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    cache.parent.mkdir(parents=True, exist_ok=True)
    with open(str(cache) + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not (cache / 'HEAD').exists():
            subprocess.run([git, 'init', '--bare', '-q', str(cache)], capture_output=True, timeout=60, check=True, env=env)
        subprocess.run([git, '-C', str(cache), 'fetch', '--no-tags', '-q', remote, '+production:refs/premerge/production'],
                       capture_output=True, timeout=600, check=True, env=env)
        checker = subprocess.run([git, '-C', str(cache), 'show', f'refs/premerge/production:{CHECKER_PATH}'],
                                 capture_output=True, timeout=60, check=True, env=env).stdout
    if not checker.startswith(b'#!'):
        raise ValueError('production ship-check is empty or not a script; refusing the sweep')
    return checker


def paused():
    # Another job saw a GitHub rate limit: do nothing and post nothing until the shared epoch passes.
    pause = Path(os.environ.get('GH_PAUSE_FILE', Path.home() / '.local/state/gh-shared-cache/pause-until'))
    try:
        return float(pause.read_text().strip()) > time.time()
    except (OSError, ValueError):
        return False


STATS = {'calls': 0, 'remaining': '?', 'list': '-'}
STALE_LOOP_SECONDS = 2 * 3600


def gh_page(page, etag=None):
    cmd = ['gh', 'api', '-i', f'repos/{REPO}/pulls?state=open&base=production&per_page=100&page={page}']
    if etag:
        cmd += ['-H', f'If-None-Match: {etag}']
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    STATS['calls'] += 1
    head, _, body = result.stdout.replace('\r\n', '\n').partition('\n\n')
    lines = head.split('\n')
    status = lines[0].split()[1] if len(lines[0].split()) > 1 else ''
    headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(':') for l in lines[1:])}
    STATS['remaining'] = headers.get('x-ratelimit-remaining', '?')
    return status, headers, body


def open_prs(state):
    # Page 1 is conditional: an unchanged list is a 304, which does not count against the rate limit.
    saved = state / 'list.json'
    try:
        cached = json.loads(saved.read_text())
    except (OSError, ValueError):
        cached = {}
    usable = cached.get('etag') and cached.get('rows') is not None
    status, headers, body = gh_page(1, cached['etag'] if usable else None)
    STATS['list'] = status
    if status == '304' and usable:
        return cached['rows']
    if status != '200':
        raise ValueError('open PR list failed')
    raw, page, more = json.loads(body), 1, 'rel="next"' in headers.get('link', '')
    while more:
        page += 1
        status, next_headers, body = gh_page(page)
        if status != '200':
            raise ValueError('open PR list page failed; refusing an incomplete sweep')
        raw += json.loads(body)
        more = 'rel="next"' in next_headers.get('link', '')
    rows = [{'number': r['number'], 'title': r['title'], 'headRefOid': r['head']['sha']} for r in raw]
    temporary = state / 'list.tmp'
    # With several pages no ETag is stored, so the next sweep refetches every page.
    temporary.write_text(json.dumps({'etag': None if page > 1 else headers.get('etag'), 'rows': rows}))
    temporary.replace(saved)
    return rows


def record_calls(state, rechecks):
    # One journal line per sweep plus an hourly total in the state folder.
    # list_calls counts only this script's own list/status calls, not the ship-check subprocesses: ratelimit_remaining is the real measure.
    print(f'gh-api: list_calls={STATS["calls"]} list={STATS["list"]} rechecks={rechecks} ratelimit_remaining={STATS["remaining"]}', flush=True)
    try:
        file = state / 'api-calls.json'
        try:
            hours = json.loads(file.read_text())
        except (OSError, ValueError):
            hours = {}
        hour = hours.setdefault(datetime.now().strftime('%Y-%m-%dT%H'), {'calls': 0, 'sweeps': 0, 'rechecks': 0})
        hour['calls'] += STATS['calls']
        hour['sweeps'] += 1
        hour['rechecks'] += rechecks
        file.write_text(json.dumps(dict(sorted(hours.items())[-48:])))
    except OSError:
        pass


def shell_words(text):
    # Shell words with operators split off; quoted text stays one word, so echo "gh pr view" is not a gh call.
    # An eval argument is code that runs, so it is expanded in place.
    lexer = shlex.shlex(text, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    words = []
    for word in lexer:
        words.extend(shell_words(word) if words and words[-1] == 'eval' else [word])
    return words


def starts_command(previous):
    # True when the word after `previous` is in command position, so echo gh pr view is an argument, not a gh call.
    return previous in ('while', 'until', 'do', 'then', 'else', '!', '{') or previous.endswith((';', '(', '|', '&'))


def is_gh_poll_loop(args):
    # A poll loop: one while/until ... done span that runs gh pr/run/api as a command and also sleeps.
    try:
        words = shell_words(args)
    except ValueError:
        return False
    for start, word in enumerate(words):
        # The closing done is the keyword after a ';', not a plain argument such as grep -q done.
        end = next((i for i in range(start + 1, len(words)) if words[i] == 'done' and words[i - 1].endswith(';')), None)
        if word not in ('while', 'until') or end is None:
            continue
        span = words[start:end + 1]
        commands = [i for i in range(1, len(span)) if starts_command(span[i - 1])]
        gh = any(span[i] == 'gh' and i + 1 < len(span) and span[i + 1] in ('pr', 'run', 'api') for i in commands)
        if gh and any(span[i] == 'sleep' for i in commands):
            return True
    return False


def stale_gh_loops(ps_output, own_pids, min_age=STALE_LOOP_SECONDS):
    # Only gh watch commands or shell loops that call gh, older than min_age. Never the sweep itself.
    found = []
    for line in ps_output.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        pid, age, args = int(parts[0]), int(parts[1]), parts[2]
        if pid in own_pids or age < min_age or 'premerge-evidence' in args:
            continue
        try:
            tokens = shlex.split(args)
        except ValueError:
            continue
        if not tokens:
            continue
        exe = os.path.basename(tokens[0])
        watch = exe == 'gh' and (('pr' in tokens and 'checks' in tokens and '--watch' in tokens)
                                 or tokens[1:3] == ['run', 'watch'])
        loop = exe in ('sh', 'bash', 'zsh', 'dash') and '-c' in tokens and is_gh_poll_loop(args)
        if watch or loop:
            found.append((pid, age, args))
    return found


def kill_stale_gh_loops():
    out = subprocess.run(['ps', '-u', str(os.getuid()), '-o', 'pid=,etimes=,args='],
                         capture_output=True, text=True, timeout=30, check=True).stdout
    for pid, age, args in stale_gh_loops(out, {os.getpid(), os.getppid()}):
        print(f'kill {pid} (age {age // 3600}h): {args[:200]}', flush=True)
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def revoke_passing(state):
    # Hold the publisher lock so an in-flight ship-check cannot re-post success after the revocation.
    with (state / 'publish.lock').open('w') as publisher:
        fcntl.flock(publisher, fcntl.LOCK_EX)
        (state / 'cache.json').unlink(missing_ok=True)
        failed = []
        for row in open_prs(state):
            # Every open head: a direct ship-check may have published success outside the sweep.
            try:
                STATS['calls'] += 1
                subprocess.run(['gh', 'api', f'repos/{REPO}/statuses/{row["headRefOid"]}', '--method', 'POST',
                                '-f', 'context=premerge-evidence', '-f', 'state=failure',
                                '-f', 'description=cannot load current premerge rules; retry'],
                               capture_output=True, timeout=60, check=True)
            except Exception:
                failed.append(str(row['number']))
        if failed:
            raise ValueError('could not revoke premerge-evidence on PR ' + ', '.join(failed))


def sweep():
    if paused():
        return
    state = Path(os.environ.get('PREMERGE_STATUS_STATE', Path.home() / '.local/state/premerge-evidence'))
    evidence = Path(os.environ.get('VCC_EVIDENCE_DIR', Path.home() / '.local/state/vcc-evidence'))
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        # Never execute a stale checker. Without current rules, passing statuses turn red so merges fail closed.
        try:
            checker_bytes = fetch_checker(state)
        except Exception:
            revoke_passing(state)
            raise
        checker_sha = hashlib.sha256(checker_bytes).hexdigest()
        checker = state / 'ship-check'
        temporary = state / 'ship-check.tmp'
        temporary.write_bytes(checker_bytes)
        temporary.chmod(0o755)
        temporary.replace(checker)
        rows = open_prs(state)
        cache_file = state / 'cache.json'
        try:
            cache = json.loads(cache_file.read_text())
        except (FileNotFoundError, ValueError):
            cache = {}
        updated, failed, rechecks = {}, False, 0
        for row in rows:
            key = str(row['number'])
            try:
                try:
                    signature = fingerprint(row, evidence, checker_sha)
                except (OSError, UnicodeError):
                    signature = None  # Let the publisher fail closed on unreadable evidence.
                previous = cache.get(key, {})
                # Refresh periodically too: live flags and transient read errors can change without a push.
                if (signature is not None and previous.get('state') and previous.get('fingerprint') == signature
                        and time.time() - previous.get('checked', 0) < REFRESH_SECONDS):
                    updated[key] = previous
                    continue
                rechecks += 1
                env = dict(os.environ, SHIP_REPO=REPO, SHIP_BASE='production', SHIP_GIT_CACHE=str(cache_dir(state)))
                result = subprocess.run([str(checker), 'premerge-status', key],
                                        capture_output=True, text=True, timeout=600, env=env)
                print(f'PR #{key}: {result.stdout.strip()}', flush=True)
                match = re.search(r'^premerge-evidence: (success|failure) ', result.stdout, re.M)
                if match and result.returncode == (0 if match[1] == 'success' else 1):
                    updated[key] = {'fingerprint': signature, 'state': match[1].upper(), 'checked': time.time()}
                else:
                    failed = True
            except Exception:
                print(f'PR #{key}: cannot reconcile evidence; retry next sweep', file=sys.stderr)
                failed = True
        temporary = state / 'cache.tmp'
        temporary.write_text(json.dumps(updated))
        temporary.replace(cache_file)
        record_calls(state, rechecks)
        if failed:
            raise ValueError('one or more statuses could not be published')


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--install']:
            install()
        elif sys.argv[1:] == ['--kill-stale-gh-loops']:
            kill_stale_gh_loops()
        elif not sys.argv[1:]:
            sweep()
        else:
            raise ValueError('usage: premerge-evidence.py [--install | --kill-stale-gh-loops]')
    except Exception:
        print('FAIL: premerge-evidence operation failed; inspect service logs and retry', file=sys.stderr)
        sys.exit(1)
