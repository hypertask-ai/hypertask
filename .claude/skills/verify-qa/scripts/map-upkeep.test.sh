#!/usr/bin/env bash
set -euo pipefail
python3 - "$(dirname "$0")/map-upkeep" <<'PY'
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

script = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='map-upkeep-') as tmp:
    root = Path(tmp)
    home = root / 'home with spaces'
    home.mkdir()
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    calls_file = root / 'calls'
    mock = bin_dir / 'mock'
    mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as out:
    out.write(json.dumps([name, args, os.getcwd()]) + '\\n')
mode = os.environ.get('MODE', '')
if name == 'systemctl':
    assert args in [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'verify-map-upkeep.timer']]
    sys.exit(1 if mode == 'install-fail' else 0)
elif name == 'git':
    if args == ['worktree', 'list', '--porcelain']:
        print('worktree ' + os.environ['REPO'])
        print('HEAD ' + 'a' * 40)
        print('')
        print('worktree /fixture/disposable-ticket-worktree')
    elif args == ['rev-parse', '--show-toplevel']:
        print(os.environ['REPO'])
    elif args[:3] == ['-C', os.environ['REPO'], 'fetch']:
        assert args[3:] == ['origin', 'production']
        sys.exit(1 if mode == 'fetch-fail' else 0)
    elif args[:4] == ['-C', os.environ['REPO'], 'worktree', 'add']:
        assert args[4] == '--detach' and args[6] == 'origin/production'
        assert pathlib.Path(args[5]).is_dir()
        sys.exit(1 if mode == 'worktree-fail' else 0)
    else:
        assert args == ['rev-parse', 'HEAD'], args
        print('a' * 40)
elif name == 'hax':
    assert args[:5] == ['--provider=codex', '--model=gpt-6.1-sol', '--effort=high', '--no-session', '-p']
    assert len(args) == 6
    assert pathlib.Path.cwd().parent == pathlib.Path.home() / '.local/state/verify-map-upkeep/worktrees'
    if mode == 'hax-fail':
        print('fixture failure', file=sys.stderr)
        sys.exit(1)
    print('Outcome: stale. Fixture map needs a route update.')
else:
    raise AssertionError(name)
''')
    mock.chmod(0o755)
    for name in ['git', 'systemctl', 'hax']:
        (bin_dir / name).symlink_to(mock)
    env = dict(os.environ, HOME=str(home), PATH=str(bin_dir) + ':' + os.environ['PATH'],
               CALLS=str(calls_file), REPO=str(root / 'repo with spaces'))
    for key in ['BASH_ENV', 'ENV', 'SHELLOPTS']:
        env.pop(key, None)

    def run(*args, mode='', installed=False):
        subject = home / '.local/lib/hypertask/verify-map-upkeep/map-upkeep' if installed else script
        return subprocess.run(['bash', str(subject), *args], env=dict(env, MODE=mode), text=True, capture_output=True)

    def calls():
        return [json.loads(line) for line in calls_file.read_text().splitlines()] if calls_file.exists() else []

    result = run('--dry-run')
    assert result.returncode == 0, result.stderr
    assert 'hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p' in result.stdout
    assert 'https://app.hypertask.ai' in result.stdout and 'Report:' in result.stdout
    assert not calls() and not (home / '.local').exists()
    assert run('--unknown').returncode == 2
    assert run('--dry-run', '--install').returncode == 2
    print('ok dry-run prints hax without running it or writing state; invalid arguments fail')

    result = run('--install')
    assert result.returncode == 0, result.stderr
    units = home / '.config/systemd/user'
    service = (units / 'verify-map-upkeep.service').read_text()
    timer = (units / 'verify-map-upkeep.timer').read_text()
    assert '[Service]\nType=oneshot\n' in service
    assert 'WorkingDirectory=' + env['REPO'] + '\n' in service
    assert 'ExecStart="%h/.local/lib/hypertask/verify-map-upkeep/map-upkeep"' in service
    assert 'OnCalendar=weekly\nPersistent=true\n' in timer
    assert '[Install]\nWantedBy=timers.target\n' in timer
    target = home / '.local/lib/hypertask/verify-map-upkeep/map-upkeep'
    assert os.access(target, os.X_OK) and target.read_bytes() == script.read_bytes()
    system_calls = [c[1] for c in calls() if c[0] == 'systemctl']
    assert system_calls == [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'verify-map-upkeep.timer']]
    if shutil.which('systemd-analyze'):
        verify_args = ['systemd-analyze', '--user', 'verify', str(units / 'verify-map-upkeep.service'), str(units / 'verify-map-upkeep.timer')]
        verified = subprocess.run(verify_args, env=env, text=True, capture_output=True)
        assert verified.returncode == 0, verified.stderr
        bad_service = service.replace('WorkingDirectory=' + env['REPO'], 'WorkingDirectory="' + env['REPO'] + '"')
        (units / 'verify-map-upkeep.service').write_text(bad_service)
        rejected = subprocess.run(verify_args, env=env, text=True, capture_output=True)
        assert rejected.returncode != 0, 'systemd accepted the quoted-path negative control'
        (units / 'verify-map-upkeep.service').write_text(service)
    assert run('--install', installed=True).returncode == 0
    assert run('--install', mode='install-fail').returncode != 0
    print('ok fake-HOME install copies an executable, writes weekly persistent units, enables timer and propagates errors')

    before = len(calls())
    result = run(installed=True)
    assert result.returncode == 0, result.stderr
    report = next((home / '.local/state/verify-map-upkeep').glob('*.md'))
    text = report.read_text()
    assert 'Outcome: stale. Fixture map needs a route update.' in text
    assert 'Commit: ' + 'a' * 40 in text
    worktree = Path(next(line.removeprefix('Worktree: ') for line in result.stdout.splitlines() if line.startswith('Worktree: ')))
    assert worktree.is_dir() and not list(worktree.iterdir())
    run_calls = calls()[before:]
    assert any(c[1] == ['-C', env['REPO'], 'fetch', 'origin', 'production'] for c in run_calls)
    assert any(c[1] == ['-C', env['REPO'], 'worktree', 'add', '--detach', str(worktree), 'origin/production'] for c in run_calls)
    assert [c[0] for c in run_calls].count('hax') == 1
    print('ok run uses a fresh production worktree, saves findings and retains the worktree without edits')

    for mode in ['fetch-fail', 'worktree-fail', 'hax-fail']:
        before = len(calls())
        result = run(mode=mode)
        assert result.returncode != 0, mode
        assert 'Outcome: blocked.' in report.read_text()
        if mode != 'hax-fail':
            assert not any(c[0] == 'hax' for c in calls()[before:])
    assert 'Fixture map needs a route update.' in report.read_text()
    print('ok failures are reported and earlier reports remain intact')

print('map-upkeep tests passed')
PY
