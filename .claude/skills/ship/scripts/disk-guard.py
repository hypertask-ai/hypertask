#!/usr/bin/env python3
"""Conservative disk cleanup for the Agent Kit's shared development host."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import time
import urllib.parse
import urllib.request

DAY = 86400
SCAN_SKIP = {'.git', 'node_modules', '.next', '.cache', '.venv', 'target', 'dist', '__pycache__'}
DISPOSABLE = {'node_modules', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache',
              'target', 'zig-cache', '.zig-cache', 'zig-out', '__pycache__', '.pytest_cache'}


def command(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True, timeout=60).stdout.strip()


def inside(path, parent):
    return path.anchor == parent.anchor and path.parts[:len(parent.parts)] == parent.parts


def inventory(path, exclude=(), owned=False):
    """Do not follow links or cross mounts. Uncertainty must block deletion."""
    root = path.lstat()
    newest, size = root.st_mtime, 0
    pending = [path]
    while pending:
        item = pending.pop()
        info = item.lstat()
        if info.st_dev != root.st_dev or item.is_mount():
            raise ValueError('mount point')
        if owned and info.st_uid != os.getuid():
            raise ValueError('foreign owner')
        if stat.S_ISLNK(info.st_mode):
            if owned:
                raise ValueError('symlink')
            newest = max(newest, info.st_mtime)
            size += info.st_blocks * 512
            continue
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError('special file')
        newest = max(newest, info.st_mtime)
        size += info.st_blocks * 512
        if stat.S_ISDIR(info.st_mode):
            pending.extend(child for child in item.iterdir() if child.name not in exclude)
    return newest, size


def contains_git(path):
    if path.name == '.git':
        return True
    pending = [path]
    try:
        while pending:
            item = pending.pop()
            if item.name == '.git':
                return True
            if stat.S_ISDIR(item.lstat().st_mode):
                pending.extend(item.iterdir())
    except OSError:
        return True
    return False


# Fixed read-only code: no candidate paths or other caller data reach sudo.
PRIVILEGED_PROCESS_SCAN = r'''
import json
import os

paths = set()
with os.scandir('/proc') as entries:
    processes = [entry.name for entry in entries if entry.name.isdigit()]
for pid in processes:
    process = '/proc/' + pid
    links = [process + '/cwd', process + '/root']
    try:
        with os.scandir(process + '/fd') as entries:
            links.extend(entry.path for entry in entries)
    except (FileNotFoundError, ProcessLookupError):
        pass
    for link in links:
        try:
            target = os.readlink(link)
        except (FileNotFoundError, ProcessLookupError):
            continue
        if target.startswith('/'):
            paths.add(target.removesuffix(' (deleted)'))
print(json.dumps(sorted(paths)))
'''


def process_paths(proc=Path('/proc'), processes=None):
    try:
        output = subprocess.run(['sudo', '-n', '/usr/bin/python3', '-I', '-c', PRIVILEGED_PROCESS_SCAN],
                                capture_output=True, text=True, check=True, timeout=60).stdout
        targets = json.loads(output)
        if not isinstance(targets, list) or any(not isinstance(p, str) or not p.startswith('/') for p in targets):
            raise ValueError('invalid privileged process scan')
        return {Path(p) for p in targets}, set()
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    paths, uncertain = set(), set()
    for process in proc.iterdir() if processes is None else processes:
        if not process.name.isdigit():
            continue
        uid, unreadable = None, False
        try:
            uid = process.stat().st_uid
            links = [process / 'cwd', process / 'root']
            try:
                links.extend((process / 'fd').iterdir())
            except FileNotFoundError:
                pass
            except OSError:
                unreadable = True
            for link in links:
                try:
                    target = os.readlink(link)
                    if target.startswith('/'):
                        paths.add(Path(target.removesuffix(' (deleted)')).resolve())
                except FileNotFoundError:
                    continue  # Descriptors and processes can disappear during a scan.
                except OSError:
                    unreadable = True
        except FileNotFoundError:
            continue
        except OSError:
            unreadable = True
        if unreadable and (uid != os.getuid() or not unreadable_but_harmless(process)):
            uncertain.add(process)
    return paths, uncertain


# Login and key agents are not dumpable, so their fds are unreadable; they never hold build folders.
HARMLESS_UNREADABLE = {'sshd', '(sd-pam)', 'gpg-agent', 'ssh-agent'}


def unreadable_but_harmless(process):
    try:
        if (process / 'comm').read_text().strip() in HARMLESS_UNREADABLE:
            return True
        # A zombie has released every file it held.
        return any(line.split()[1:2] == ['Z'] for line in (process / 'status').read_text().splitlines()
                   if line.startswith('State:'))
    except (OSError, IndexError):
        return False


class Guard:
    def __init__(self, home=None, tmp=Path('/tmp'), dry=False, verbose=False, budget=12 * 60):
        self.home = Path(home or Path.home()).resolve()
        self.projects = self.home / 'projects'
        self.protected = self.projects / 'hypertask'
        self.tmp = tmp.resolve()
        self.state = self.home / '.local/state/disk-guard'
        self.dry = dry
        self.verbose = verbose
        self.now = time.time()
        # Stop starting removals before systemd's TimeoutStartSec kills the run mid-delete.
        self.deadline = time.monotonic() + budget
        self.freed = 0
        self.planned = 0
        self.removed = 0
        self.kept = 0
        self.keep_reasons = {}
        self.gh_cache = {}
        self.trees = set()
        self.failed_repos = {}
        self.process_snapshot = None

    def log(self, action, path, reason, freed=0):
        if action in {'kept', 'error'}:
            self.kept += 1
            self.keep_reasons[reason] = self.keep_reasons.get(reason, 0) + 1
        if not self.verbose and action not in {'removed', 'removed branch', 'would remove',
                                               'pruned', 'would prune', 'error', 'summary'}:
            return
        line = (f'{datetime.now(timezone.utc).isoformat()} {action}: '
                f'{str(path)!r} reason={reason!r} bytes_freed={freed}')
        print(line, flush=True)
        if not self.dry:
            try:
                self.state.mkdir(parents=True, exist_ok=True)
                log = self.state / 'log'
                if log.exists() and log.stat().st_size + len((line + '\n').encode()) >= 5 * 1024 * 1024:
                    log.replace(self.state / 'log.1')
                with log.open('a') as stream:
                    stream.write(line + '\n')
            except OSError:
                print(f'{line}\nDisk guard: log write failed; cleanup continues.', file=sys.stderr, flush=True)

    def discover(self):
        repos = []
        seen = set()
        if not self.projects.exists():
            return repos
        def failed(exc):
            path = Path(exc.filename or self.projects).resolve()
            self.trees.add(path)
            self.failed_repos[path] = 'repository discovery failed (permission or I/O error)'
        for root, dirs, files in os.walk(self.projects, followlinks=False, onerror=failed):
            path = Path(root)
            dirs[:] = [d for d in dirs if d not in SCAN_SKIP and not (path / d).is_symlink()]
            if path == self.protected:
                dirs[:] = []
                continue
            if not (path / '.git').exists() and not ((path / 'HEAD').is_file() and (path / 'objects').is_dir()):
                continue
            try:
                common = Path(command(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], path))
                if common in seen:
                    continue
                rows = []
                for block in command(['git', '-c', 'core.quotePath=false', 'worktree', 'list', '--porcelain', '-z'], path).split('\0\0'):
                    row = {}
                    for field in block.split('\0'):
                        key, _, value = field.partition(' ')
                        if key:
                            row[key] = value
                    if 'worktree' in row:
                        row['path'] = Path(row['worktree']).resolve()
                        rows.append(row)
                        self.trees.add(row['path'])
                seen.add(common)
                repos.append((path, rows))
            except (OSError, subprocess.SubprocessError, ValueError):
                self.trees.add(path)
                reason = 'cannot enumerate registered worktrees'
                try:
                    marker = path / '.git'
                    if marker.is_file():
                        key, _, target = marker.read_text().strip().partition(':')
                        if key == 'gitdir' and not (path / target.strip()).exists():
                            reason = 'orphan worktree folder, main repo missing'
                except (OSError, UnicodeError):
                    pass
                self.failed_repos[path] = reason
        for path, reason in self.failed_repos.items():
            self.log('kept', path, reason)
        return repos

    def busy(self, path, refresh=False):
        if refresh or self.process_snapshot is None:
            self.process_snapshot = process_paths()
        else:
            paths, uncertain = self.process_snapshot
            if uncertain:
                # Retry failed processes per candidate without repeating every readable fd.
                retry_paths, uncertain = process_paths(processes=uncertain)
                self.process_snapshot = (paths | retry_paths, uncertain)
        paths, uncertain = self.process_snapshot
        if any(inside(p, path) for p in paths):
            return 'process has cwd/fd/root inside'
        if uncertain:
            try:
                if any(process.stat().st_uid != os.getuid() for process in uncertain):
                    return 'privileged process scan unavailable'
            except OSError:
                return 'privileged process scan unavailable'
            return 'process scan incomplete (permission or I/O error)'
        return None

    def safety(self, path, age, exclude=(), refresh=False):
        if path.is_symlink() or inside(path, self.protected):
            raise ValueError('symlink or protected main checkout')
        newest, size = inventory(path, exclude, owned=True)
        if self.now - newest <= age:
            raise ValueError(f'newest mtime is not older than {age // DAY} days')
        reason = self.busy(path, refresh)
        if reason:
            raise ValueError(reason)
        return size

    def temporary(self):
        candidates = []
        for entry in self.tmp.iterdir():
            if entry.name.startswith('claude-'):
                self.log('kept', entry, 'Claude scratchpad top-level directory')
                if entry.is_dir() and not entry.is_symlink():
                    # Only named, rebuildable caches, never session build/scratch content.
                    for root, dirs, _ in os.walk(entry, followlinks=False):
                        parent = Path(root)
                        dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules'} and not (parent / d).is_symlink()]
                        for name in list(dirs):
                            child = parent / name
                            if name.startswith('node-compile-cache') or (name == 'cache' and parent.name == '.next'):
                                candidates.append(child)
                                dirs.remove(name)
            else:
                candidates.append(entry)
        for path in candidates:
            try:
                if time.monotonic() > self.deadline:
                    raise ValueError('time budget reached; next run continues')
                if any(inside(tree, path) or inside(path, tree) for tree in self.trees):
                    raise ValueError('registered git worktree')
                if path.lstat().st_uid != os.getuid():
                    raise ValueError('foreign owner')
                if contains_git(path):
                    raise ValueError('git checkout, not disposable cache')
                size = self.safety(path, 2 * DAY)
                if self.dry:
                    self.planned += size
                    self.log('would remove', path, 'old, owned, inactive temporary output', size)
                else:
                    # Recheck immediately before removal, including all descendant mtimes.
                    self.safety(path, 2 * DAY, refresh=True)
                    if path.is_dir():
                        shutil.rmtree(path)
                    else:
                        path.unlink()
                    self.freed += size
                    self.removed += 1
                    self.log('removed', path, 'old, owned, inactive temporary output', size)
            except ValueError as exc:
                self.log('kept', path, str(exc))
            except OSError:
                self.log('error', path, 'filesystem inspection or deletion failed')

    def prs(self, repo, branch):
        key = (repo, branch)
        if key not in self.gh_cache:
            # Bound API traffic per sweep. Failures are cached, never retried in a loop.
            try:
                if len(self.gh_cache) >= 60:
                    raise ValueError('per-run GitHub call limit')
                rows = json.loads(command(['gh', 'pr', 'list', '--head', branch, '--state', 'all',
                                           '--limit', '100', '--json', 'state,headRefName,headRefOid'], repo))
                if not isinstance(rows, list) or len(rows) >= 100:
                    raise ValueError('incomplete PR results')
                if any(r.get('state') not in {'OPEN', 'CLOSED', 'MERGED'} or r.get('headRefName') != branch for r in rows):
                    raise ValueError('unexpected PR results')
                self.gh_cache[key] = rows
            except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
                self.gh_cache[key] = None
        rows = self.gh_cache[key]
        if rows is None:
            raise ValueError('gh unavailable, failed, or rate-limited')
        return rows

    def merged(self, repo, row):
        branch = row.get('branch', '').removeprefix('refs/heads/')
        if not branch:
            raise ValueError('detached worktree; open PR cannot be ruled out')
        if branch:
            prs = self.prs(repo, branch)
            if any(r['state'] == 'OPEN' for r in prs):
                raise ValueError('OPEN PR for branch')
            if any(r['state'] == 'MERGED' and r.get('headRefOid') == row['HEAD'] for r in prs):
                return True
            default = command(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'], repo)
            result = subprocess.run(['git', 'merge-base', '--is-ancestor', row['HEAD'], default],
                                    cwd=repo, capture_output=True, timeout=60)
            if result.returncode == 0:
                return True
            if result.returncode != 1:
                raise ValueError('cannot check default branch ancestry')
            upstream = command(['git', 'for-each-ref', '--format=%(upstream)', row['branch']], repo)
            # A deleted remote branch can leave a configured but nonexistent upstream.
            if upstream:
                exists = subprocess.run(['git', 'show-ref', '--verify', '--quiet', upstream], cwd=repo, timeout=60)
                if exists.returncode != 1:
                    raise ValueError('branch is not merged and has a surviving upstream')
        refs = command(['git', 'for-each-ref', '--format=%(refname)', '--contains', row['HEAD'], 'refs/remotes/'], repo)
        if not refs:
            raise ValueError('HEAD is not contained in a remote-tracking ref')
        return False  # Safe abandoned tree, but do not delete an unmerged local branch.

    def check_ignored_files(self, path):
        rows = command(['git', 'status', '--porcelain', '--ignored', '--untracked-files=all', '-z'], path)
        for row in rows.split('\0'):
            if not row:
                continue
            if not row.startswith('!! '):
                raise ValueError('worktree became dirty')
            parts = Path(row[3:]).parts
            if not (any(part in DISPOSABLE for part in parts)
                    or (parts and (parts[-1].endswith('.tsbuildinfo') or parts[-1] == '.eslintcache'))
                    or ('.vercel', 'output') in zip(parts, parts[1:])):
                raise ValueError('ignored local files present')

    def worktrees(self, repos):
        for repo, rows in repos:
            for index, row in enumerate(rows):
                path = row['path']
                if path in self.failed_repos:
                    continue
                try:
                    if time.monotonic() > self.deadline:
                        raise ValueError('time budget reached; next run continues')
                    if index == 0:
                        raise ValueError('main checkout')
                    if path == self.protected or inside(path, self.protected):
                        raise ValueError('protected main checkout')
                    if not inside(path, self.projects):
                        raise ValueError('outside projects; registered tree protected from temporary cleanup')
                    if 'locked' in row or 'prunable' in row or not path.is_dir():
                        raise ValueError('locked, missing, or prunable worktree')
                    if command(['git', 'status', '--porcelain', '--untracked-files=all'], path):
                        raise ValueError('dirty worktree (including untracked files)')
                    self.check_ignored_files(path)
                    size = self.safety(path, 3 * DAY, {'.git', 'node_modules'})
                    is_merged = self.merged(repo, row)
                    if self.dry:
                        # Include node_modules in the size estimate, not in the inactivity test.
                        _, size = inventory(path, {'.git'})
                        self.planned += size
                        self.log('would remove', path, 'clean, inactive, old and remotely contained worktree', size)
                        continue
                    if command(['git', 'rev-parse', 'HEAD'], path) != row['HEAD']:
                        raise ValueError('HEAD changed during inspection')
                    if command(['git', 'rev-parse', '--symbolic-full-name', 'HEAD'], path) != row.get('branch', 'HEAD'):
                        raise ValueError('branch changed during inspection')
                    if command(['git', 'status', '--porcelain', '--untracked-files=all'], path):
                        raise ValueError('worktree became dirty')
                    self.check_ignored_files(path)
                    # Run removal from a surviving, unprotected checkout.
                    controller = next((r['path'] for r in rows if r['path'] != path
                                       and r['path'] != self.protected and r['path'].is_dir()), None)
                    if controller is None:
                        raise ValueError('no unprotected checkout to run git worktree remove')
                    before = shutil.disk_usage(path).used
                    self.safety(path, 3 * DAY, {'.git', 'node_modules'}, refresh=True)
                    command(['git', 'worktree', 'remove', str(path)], controller)
                    freed = max(0, before - shutil.disk_usage(controller).used)
                    self.freed += freed
                    self.removed += 1
                    self.log('removed', path, 'clean, inactive, old and remotely contained worktree', freed)
                    if is_merged and row.get('branch'):
                        branch = row['branch'].removeprefix('refs/heads/')
                        if command(['git', 'rev-parse', row['branch']], controller) != row['HEAD']:
                            self.log('kept', branch, 'branch tip changed after worktree removal')
                            continue
                        try:
                            command(['git', 'branch', '-d', branch], controller)
                            self.log('removed branch', branch, 'merged branch; git safe deletion')
                        except subprocess.SubprocessError:
                            self.log('kept', branch, 'git refused safe branch deletion (possibly a squash merge)')
                except ValueError as exc:
                    self.log('kept', path, str(exc))
                except (OSError, subprocess.SubprocessError):
                    self.log('error', path, 'git or filesystem inspection failed')

    def usage(self):
        info = os.statvfs('/')
        used = info.f_blocks - info.f_bfree
        return 100 * used / (used + info.f_bavail)

    def critical(self, used):
        flag = self.state / 'critical'
        if self.dry:
            self.log('would update', flag, 'critical' if used >= 90 else 'below critical threshold')
            return
        try:
            if used < 90:
                flag.unlink(missing_ok=True)
                return
            flag.write_text(f'{used:.2f}% at {self.now}\n')
            os.utime(flag, (self.now, self.now))
            mark = self.state / 'last-alert'
            if mark.exists() and self.now - mark.stat().st_mtime < 3600:
                self.log('kept', 'alert', 'hourly rate limit')
                return
            # Record the attempt before sending, so an error or interruption cannot spam.
            mark.touch()
            os.utime(mark, (self.now, self.now))
        except OSError:
            self.log('error', flag, 'critical state write failed; cleanup continues')
            return
        try:
            credentials = dict(os.environ)
            env_file = self.home / '.config/hypertask-env.sh'
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    fields = shlex.split(line)
                    if fields and fields[0] == 'export':
                        fields = fields[1:]
                    for field in fields:
                        name, _, value = field.partition('=')
                        if name in {'TELEGRAM_HYPERTASK_BOT_TOKEN', 'TELEGRAM_HYPERTASK_CHAT_ID'}:
                            credentials[name] = value
            token = credentials['TELEGRAM_HYPERTASK_BOT_TOKEN']
            chat = credentials['TELEGRAM_HYPERTASK_CHAT_ID']
            if not token or not chat:
                raise ValueError('missing notification configuration')
            body = urllib.parse.urlencode({'chat_id': chat, 'text':
                f'INFRA MANAGER: disk guard critical, / is {used:.2f}% used. New heavy jobs are held. '
                'Review ~/.local/state/disk-guard/status.json and the disk report. '
                'https://app.hypertask.ai/detail/project-4060/223'}).encode()
            request = urllib.request.Request(f'https://api.telegram.org/bot{token}/sendMessage', data=body)
            with urllib.request.urlopen(request, timeout=15) as response:
                if not json.load(response).get('ok'):
                    raise ValueError('notification rejected')
            self.log('alerted', 'INFRA MANAGER', 'critical disk via existing fleet-watchdog Telegram route')
        except Exception:
            # Exception strings and HTTP request URLs can contain the bot token.
            self.log('error', 'alert', 'notification failed; retry after hourly limit')

    def images(self):
        if self.dry:
            self.log('would prune', 'docker dangling images', 'disk >=80%; size unknown until Docker prunes')
            return
        try:
            before = shutil.disk_usage('/').used
            command(['docker', 'image', 'prune', '-f'])
            freed = max(0, before - shutil.disk_usage('/').used)
            self.freed += freed
            self.log('pruned', 'docker dangling images', 'disk >=80%; volumes never pruned', freed)
        except (OSError, subprocess.SubprocessError):
            self.log('error', 'docker dangling images', 'Docker unavailable or prune failed')

    def run(self):
        used = self.usage()
        self.critical(used)  # Set the safety hold before any potentially slow inspections.
        repos = self.discover()
        self.worktrees(repos)
        if used >= 80:
            self.temporary()
            self.images()
        after = self.usage()
        self.critical(after)
        status = {'used_percent': round(after, 2), 'level': 'critical' if after >= 90 else 'clean' if after >= 80 else 'ok',
                  'last_run': datetime.now(timezone.utc).isoformat(), 'freed': self.freed,
                  'would_free': self.planned, 'removed': self.removed, 'kept': self.kept,
                  'keep_reasons': self.keep_reasons,
                  'failed_repos': {str(path): reason for path, reason in self.failed_repos.items()}}
        if not self.dry:
            try:
                temp = self.state / 'status.tmp'
                temp.write_text(json.dumps(status, indent=2) + '\n')
                temp.replace(self.state / 'status.json')
            except OSError:
                self.log('error', self.state / 'status.json', 'status write failed; cleanup continues')
        self.log('summary', '/', json.dumps(status, sort_keys=True), self.freed)

    def report(self):
        self.discover()
        lines = ['# Disk guard retention report', '', f'Generated: {datetime.now(timezone.utc).isoformat()}',
                 '', 'Report only. No data or Docker volumes were deleted.', '',
                 '| Item | Allocated bytes | Age (newest mtime) | Decision | Reason |',
                 '| --- | ---: | --- | --- | --- |']
        roots = [self.home / '.local/state/vcc-evidence', self.home / '.local/state/br7-runs',
                 self.home / '.local/share/retired-agents']
        roots.extend(sorted((self.home / '.local/state').glob('retired-agents*')))
        roots.append(self.home / '.npm')
        rows = []
        for item, reason in self.failed_repos.items():
            try:
                newest, size = inventory(item)
                mtime = datetime.fromtimestamp(newest, timezone.utc).isoformat()
                rows.append((size, item, f'{(self.now - newest) / DAY:.1f} days; newest mtime {mtime}', 'keep', reason))
            except (OSError, ValueError):
                rows.append((0, item, 'unknown', 'keep', reason + '; cannot safely inspect size or mtime'))
        for root in roots:
            if not root.exists():
                lines.append(f'| {root} | 0 | absent | keep | no directory |')
                continue
            for item in sorted(root.iterdir()):
                try:
                    newest, size = inventory(item)
                    old = self.now - newest > 30 * DAY
                    reason = self.busy(item)
                    safe = old and reason is None and 'vcc-evidence' not in str(root)
                    why = reason or ('QA evidence: retain audit proof' if 'vcc-evidence' in str(root)
                                     else 'older than 30 days; inactive, rebuildable cache or retired archive' if old
                                     else 'newest mtime within 30 days')
                    rows.append((size, item, f'{(self.now - newest) / DAY:.1f} days', 'safe to delete' if safe else 'keep', why))
                except (OSError, ValueError):
                    rows.append((0, item, 'unknown', 'keep', 'cannot safely inspect'))
        for size, item, age, decision, why in sorted(rows, key=lambda r: r[0], reverse=True):
            lines.append(f'| {str(item).replace("|", "&#124;")} | {size} | {age} | {decision} | {why} |')
        cacache = self.home / '.npm/_cacache'
        old_bytes, old_items = 0, 0
        if cacache.exists():
            for root, dirs, files in os.walk(cacache, followlinks=False):
                dirs[:] = [d for d in dirs if not (Path(root) / d).is_symlink()]
                for name in files:
                    item = Path(root) / name
                    info = item.lstat()
                    if stat.S_ISREG(info.st_mode) and self.now - info.st_mtime > 30 * DAY:
                        old_items += 1
                        old_bytes += info.st_blocks * 512
        lines.extend(['', f'npm _cacache: {old_items} files older than 30 days, {old_bytes} allocated bytes. '
                      'keep: per-file age is not proof that no active npm process is using the cache.',
                      '', '## Docker unused volumes', '',
                      'keep: persistent data even when dangling. Docker CreatedAt is not last-used; '
                      'last-used is unavailable unless supplied by the volume driver. Never auto-pruned.'])
        try:
            df = command(['docker', 'system', 'df', '-v'])
            dangling = command(['docker', 'volume', 'ls', '--filter', 'dangling=true', '--format', '{{.Name}}'])
            lines.extend(['', '```text', df, '```', '', 'Dangling volumes (keep; last-used unknown):'])
            for name in dangling.splitlines():
                data = json.loads(command(['docker', 'volume', 'inspect', name]))[0]
                last_used = data.get('LastUsedAt') or (data.get('UsageData') or {}).get('LastUsedAt') or 'unavailable'
                lines.append(f'- {name}: keep; created {data.get("CreatedAt", "unknown")}; last-used {last_used}.')
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
            lines.append('keep: Docker inspection unavailable or failed.')
        self.state.mkdir(parents=True, exist_ok=True)
        path = self.state / f'report-{datetime.now(timezone.utc):%Y-%m-%d}.md'
        path.write_text('\n'.join(lines) + '\n')
        print(path)
        return path

    def install(self):
        self.state.mkdir(parents=True, exist_ok=True)
        target = self.state / 'disk-guard.py'
        if Path(__file__).resolve() != target:
            shutil.copy2(__file__, target)
        units = self.home / '.config/systemd/user'
        units.mkdir(parents=True, exist_ok=True)
        (units / 'disk-guard.service').write_text(
            '[Unit]\nDescription=Conservative Agent Kit disk guard\n[Service]\nType=oneshot\n'
            'ExecStart=/usr/bin/python3 %h/.local/state/disk-guard/disk-guard.py\n'
            'Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin\n'
            'WorkingDirectory=%h\nTimeoutStartSec=14min\nNice=10\nIOSchedulingClass=idle\n')
        (units / 'disk-guard.timer').write_text(
            '[Unit]\nDescription=Check server disk every 15 minutes\n[Timer]\n'
            'OnCalendar=*-*-* *:00/15:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n')
        command(['systemctl', '--user', 'daemon-reload'])
        command(['systemctl', '--user', 'disable', '--now', 'host-disk-sweep.timer'])
        command(['systemctl', '--user', 'stop', 'host-disk-sweep.service'])
        self.log('installed', target, 'old host-disk-sweep.timer stopped and disabled; old files retained')
        command(['systemctl', '--user', 'enable', '--now', 'disk-guard.timer'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    flags = parser.add_mutually_exclusive_group()
    flags.add_argument('--install', action='store_true')
    flags.add_argument('--dry-run', action='store_true')
    flags.add_argument('--report', action='store_true')
    parser.add_argument('--verbose', action='store_true', help='include per-item keep decisions')
    args = parser.parse_args()
    guard = Guard(dry=args.dry_run, verbose=args.verbose)
    if args.dry_run:
        guard.run()
        return
    guard.state.mkdir(parents=True, exist_ok=True)
    with (guard.state / 'lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('kept: another disk guard operation is running bytes_freed=0')
            return
        if args.install:
            guard.install()
        elif args.report:
            guard.report()
        else:
            guard.run()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FAIL: disk guard operation failed; no unchecked cleanup attempted', flush=True)
        raise SystemExit(1)
