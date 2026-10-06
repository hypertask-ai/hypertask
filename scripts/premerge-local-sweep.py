#!/usr/bin/env python3
"""Remove only disposable premerge resources that are more than 12 hours old."""
import datetime
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys

HERE = Path(__file__).resolve().parent
MAX_AGE = 12 * 60 * 60


def install():
    target = Path.home() / '.local/lib/hypertask/premerge-local'
    units = Path.home() / '.config/systemd/user'
    target.mkdir(parents=True, exist_ok=True)
    units.mkdir(parents=True, exist_ok=True)
    for name in ('premerge-local-sweep.py', 'premerge-local-sweep.service', 'premerge-local-sweep.timer'):
        if HERE != target:
            shutil.copy2(HERE / name, target / name)
    for suffix in ('service', 'timer'):
        shutil.copy2(target / f'premerge-local-sweep.{suffix}', units)
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', '--user', 'enable', '--now', 'premerge-local-sweep.timer'], check=True)


def start_ticks(process):
    # Next's process title contains spaces and can contain parentheses.
    return int((process / 'stat').read_text().rsplit(') ', 1)[1].split()[19])


def sweep_processes():
    uptime = float(Path('/proc/uptime').read_text().split()[0])
    ticks = os.sysconf('SC_CLK_TCK')
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != os.getuid():
                continue
            started = start_ticks(process)
            if uptime - started / ticks <= MAX_AGE:
                continue
            env = (process / 'environ').read_bytes().split(b'\0')
            if b'PREMERGE_LOCAL=1' not in env:
                continue
            args = (process / 'cmdline').read_bytes().split(b'\0')
            title = args[0].decode(errors='replace')
            is_next = title.startswith('next-server (') or (
                any(arg.endswith(b'/next/dist/bin/next') for arg in args) and b'start' in args
            )
            is_search = any(arg.endswith(b'/scripts/premerge-local-search.mjs') for arg in args)
            if not (is_next or is_search) or start_ticks(process) != started:
                continue
            pid = int(process.name)
            # Old scripts used setsid. Never signal another process's group.
            if os.getpgid(pid) == pid:
                os.killpg(pid, signal.SIGTERM)
            else:
                os.kill(pid, signal.SIGTERM)
            print(f'Stopped stale premerge process {pid}.')
        except (FileNotFoundError, ProcessLookupError, PermissionError, ValueError, IndexError):
            continue


def sweep_containers():
    if not shutil.which('docker'):
        return
    names = subprocess.run(['docker', 'ps', '-a', '--filter', 'name=ht-premerge-', '--format', '{{.Names}}'],
                           capture_output=True, text=True, check=True).stdout.splitlines()
    now = datetime.datetime.now(datetime.timezone.utc)
    for name in names:
        if not re.fullmatch(r'ht-premerge-[0-9a-f]{16}-(postgres|redis|soketi)', name):
            continue
        result = subprocess.run(['docker', 'inspect', '--format', '{{.Created}}', name],
                                capture_output=True, text=True)
        if result.returncode:
            continue
        created = datetime.datetime.fromisoformat(result.stdout.strip().replace('Z', '+00:00'))
        if (now - created).total_seconds() > MAX_AGE:
            subprocess.run(['docker', 'rm', '-f', '-v', name], check=True, stdout=subprocess.DEVNULL)
            print(f'Removed stale premerge container {name}.')


def main():
    if sys.argv[1:] == ['--install']:
        install()
    elif sys.argv[1:] == ['sweep']:
        sweep_processes()
        sweep_containers()
    else:
        raise ValueError('usage: premerge-local-sweep.py [sweep|--install]')


if __name__ == '__main__':
    main()
