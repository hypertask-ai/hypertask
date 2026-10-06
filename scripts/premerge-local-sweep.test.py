#!/usr/bin/env python3
"""Sweep tests mock every signal, Docker command and systemd operation."""
import datetime
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('sweep', Path(__file__).with_name('premerge-local-sweep.py'))
sweep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sweep)


class SweepTests(unittest.TestCase):
    def test_only_old_owned_premerge_processes_are_signalled(self):
        with tempfile.TemporaryDirectory() as temp:
            proc = Path(temp)
            (proc / 'uptime').write_text('100000 0\n')
            rows = [
                (101, 100, b'PREMERGE_LOCAL=1', b'next-server (v16)\0'),
                (102, 100, b'PREMERGE_LOCAL=1', b'node\0/x/node_modules/next/dist/bin/next\0start\0'),
                (103, 100, b'PREMERGE_LOCAL=1', b'node\0/x/scripts/premerge-local-search.mjs\0'),
                (104, 9999900, b'PREMERGE_LOCAL=1', b'next-server (v16)\0'),
                (105, 100, b'OTHER=1', b'next-server (v16)\0'),
                (106, 100, b'PREMERGE_LOCAL=1', b'node\0unrelated.mjs\0'),
                (107, 5680000, b'PREMERGE_LOCAL=1', b'next-server (v16)\0'),
            ]
            for pid, ticks, env, command in rows:
                folder = proc / str(pid)
                folder.mkdir()
                (folder / 'stat').write_text(f'{pid} (next-server (v16)) ' + ' '.join(['0'] * 19 + [str(ticks)]))
                (folder / 'environ').write_bytes(env + b'\0')
                (folder / 'cmdline').write_bytes(command)
            real_path = Path

            def mapped(value):
                value = str(value)
                return proc / value.removeprefix('/proc/').removeprefix('/proc') if value.startswith('/proc') else real_path(value)

            with patch.object(sweep, 'Path', side_effect=mapped), \
                    patch.object(sweep.os, 'sysconf', return_value=100), \
                    patch.object(sweep.os, 'getpgid', side_effect=lambda pid: pid if pid == 101 else 999), \
                    patch.object(sweep.os, 'killpg') as groups, patch.object(sweep.os, 'kill') as singles:
                sweep.sweep_processes()
                groups.assert_called_once_with(101, sweep.signal.SIGTERM)
                self.assertCountEqual(singles.call_args_list, [unittest.mock.call(102, sweep.signal.SIGTERM), unittest.mock.call(103, sweep.signal.SIGTERM)])

    def test_wrong_owner_and_reused_pid_are_not_signalled(self):
        with tempfile.TemporaryDirectory() as temp:
            proc = Path(temp)
            (proc / 'uptime').write_text('100000 0\n')
            folder = proc / '101'
            folder.mkdir()
            (folder / 'environ').write_bytes(b'PREMERGE_LOCAL=1\0')
            (folder / 'cmdline').write_bytes(b'next-server (v16)\0')
            with patch.object(sweep, 'Path', side_effect=lambda value: proc if value == '/proc' else proc / 'uptime'), \
                    patch.object(sweep, 'start_ticks', side_effect=[100, 200]), \
                    patch.object(sweep.os, 'killpg') as groups, patch.object(sweep.os, 'kill') as singles:
                sweep.sweep_processes()
                groups.assert_not_called()
                singles.assert_not_called()
            with patch.object(sweep, 'Path', side_effect=lambda value: proc if value == '/proc' else proc / 'uptime'), \
                    patch.object(sweep.os, 'getuid', return_value=999999), \
                    patch.object(sweep, 'start_ticks') as started:
                sweep.sweep_processes()
                started.assert_not_called()

    def test_container_age_and_name_are_both_required(self):
        old = 'ht-premerge-0123456789abcdef-postgres'
        young = 'ht-premerge-0123456789abcdef-redis'
        unrelated = 'ht-premerge-not-ours-postgres'
        now = datetime.datetime.now(datetime.timezone.utc)
        removed = []

        def docker(args, **kwargs):
            if args[1] == 'ps':
                return subprocess.CompletedProcess(args, 0, '\n'.join([old, young, unrelated]))
            if args[1] == 'inspect':
                age = 13 if args[-1] == old else 1
                return subprocess.CompletedProcess(args, 0, (now - datetime.timedelta(hours=age)).isoformat())
            self.assertEqual(args[:4], ['docker', 'rm', '-f', '-v'])
            removed.append(args[-1])
            return subprocess.CompletedProcess(args, 0)

        with patch.object(sweep.shutil, 'which', return_value='/mock/docker'), patch.object(sweep.subprocess, 'run', side_effect=docker):
            sweep.sweep_containers()
        self.assertEqual(removed, [old])

    def test_install_is_explicit_and_only_writes_fixture_home(self):
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            with patch.object(sweep.Path, 'home', return_value=home), patch.object(sweep.subprocess, 'run') as commands:
                sweep.install()
                self.assertEqual([call.args[0] for call in commands.call_args_list], [
                    ['systemctl', '--user', 'daemon-reload'],
                    ['systemctl', '--user', 'enable', '--now', 'premerge-local-sweep.timer'],
                ])
            target = home / '.local/lib/hypertask/premerge-local'
            self.assertEqual((target / 'premerge-local-sweep.py').read_bytes(), (sweep.HERE / 'premerge-local-sweep.py').read_bytes())
            units = home / '.config/systemd/user'
            self.assertIn('OnCalendar=hourly', (units / 'premerge-local-sweep.timer').read_text())
            self.assertIn('premerge-local-sweep.py sweep', (units / 'premerge-local-sweep.service').read_text())
            self.assertIn('Persistent=true', (units / 'premerge-local-sweep.timer').read_text())


if __name__ == '__main__':
    unittest.main()
