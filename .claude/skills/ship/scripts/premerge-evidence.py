#!/usr/bin/env python3
"""Reconcile current-head evidence statuses without polling each completed PR."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
REPO = 'hypertask-ai/hypertask'
CHECKER_PATH = '.claude/skills/ship/scripts/ship-check'
REFRESH_SECONDS = 3600  # slow refresh for live flag changes; a new head or changed evidence re-checks at once


def install():
    target = Path.home() / '.local/lib/hypertask/premerge-evidence'
    units = Path.home() / '.config/systemd/user'
    target.mkdir(parents=True, exist_ok=True)
    units.mkdir(parents=True, exist_ok=True)
    for name in ('ship-check', 'premerge-evidence.py'):
        if HERE != target:
            shutil.copy2(HERE / name, target / name)
    for suffix in ('service', 'timer'):
        shutil.copy2(HERE / f'premerge-evidence.{suffix}', units)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'premerge-evidence.timer'], check=True)


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


def open_prs():
    result = subprocess.run(['gh', 'pr', 'list', '-R', REPO, '--state', 'open', '--base', 'production',
                             '--limit', '1000', '--json', 'number,title,headRefOid,statusCheckRollup'],
                            capture_output=True, text=True, timeout=60, check=True)
    rows = json.loads(result.stdout)
    if len(rows) >= 1000:
        raise ValueError('open PR list may be truncated; refusing an incomplete sweep')
    return rows


def revoke_passing(state):
    # Hold the publisher lock so an in-flight ship-check cannot re-post success after the revocation.
    with (state / 'publish.lock').open('w') as publisher:
        fcntl.flock(publisher, fcntl.LOCK_EX)
        (state / 'cache.json').unlink(missing_ok=True)
        failed = []
        for row in open_prs():
            if not any(s.get('context') == 'premerge-evidence' and s.get('state') == 'SUCCESS'
                       for s in row['statusCheckRollup'] or []):
                continue
            try:
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
        rows = open_prs()
        cache_file = state / 'cache.json'
        try:
            cache = json.loads(cache_file.read_text())
        except (FileNotFoundError, ValueError):
            cache = {}
        updated, failed = {}, False
        for row in rows:
            key = str(row['number'])
            try:
                try:
                    signature = fingerprint(row, evidence, checker_sha)
                except (OSError, UnicodeError):
                    signature = None  # Let the publisher fail closed on unreadable evidence.
                statuses = [s for s in (row['statusCheckRollup'] or []) if s.get('context') == 'premerge-evidence']
                previous = cache.get(key, {})
                # Refresh periodically too: live flags and transient read errors can change without a push.
                if (signature is not None and statuses and previous.get('fingerprint') == signature
                        and previous.get('state') == statuses[0].get('state')
                        and time.time() - previous.get('checked', 0) < REFRESH_SECONDS):
                    updated[key] = previous
                    continue
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
        if failed:
            raise ValueError('one or more statuses could not be published')


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--install']:
            install()
        elif not sys.argv[1:]:
            sweep()
        else:
            raise ValueError('usage: premerge-evidence.py [--install]')
    except Exception:
        print('FAIL: premerge-evidence operation failed; inspect service logs and retry', file=sys.stderr)
        sys.exit(1)
