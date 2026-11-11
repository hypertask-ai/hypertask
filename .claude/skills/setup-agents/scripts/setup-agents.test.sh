#!/usr/bin/env bash
# Temp HOME and a fake CLI only. Never provisions a real agent.
# usage: setup-agents.test.sh [--case missing-deps|clean-home|safety|check-mode]
set -euo pipefail
wanted=
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = "--case" ] || { echo "usage: setup-agents.test.sh [--case <name>]" >&2; exit 1; }
  wanted=$2
fi
python3 - "$(dirname "$0")/setup-agents" "$wanted" <<'PY'
import json, os, pathlib, shutil, subprocess, sys, tempfile, time

script = str(pathlib.Path(sys.argv[1]).resolve())
secret = 'fixture-only-bearer-value'
with tempfile.TemporaryDirectory(prefix='setup-agents-') as tmp:
    root = pathlib.Path(tmp)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    cli = bin_dir / 'hypertask'
    cli.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args, secret, mode = sys.argv[1:], 'fixture-only-bearer-value', os.environ.get('FAKE_MODE', '')
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps(args) + '\\n')
if args[:2] == ['agents', 'create']:
    if mode == 'create-fail': sys.exit(1)
    if mode == 'race': pathlib.Path.home().joinpath('.config/hypertask-agents/credentials/setup-smoke-agent-token').write_text(secret)
    print(secret if mode == 'invalid-json' else json.dumps({'token': secret}))
else:
    if mode == 'read-fail': sys.exit(4)
    print(json.dumps({'authenticated': mode != 'wrong-ticket', 'verified': True}))
''')
    cli.chmod(0o755)
    base = {k: v for k, v in os.environ.items()
            if k not in {'SHIP_SESSION_NAME', 'VCC_CREDENTIALS_DIR', 'VCC_SESSION_CREDENTIALS_DIR', 'SHELLOPTS', 'BASH_ENV', 'ENV'}}
    base['PATH'] = str(bin_dir) + os.pathsep + base['PATH']

    def fixture(label, path=None):
        home = root / label
        home.mkdir()
        return home, dict(base, HOME=str(home), PATH=path or base['PATH'], CALLS=str(home / 'calls'))
    def run(env, *args):
        result = subprocess.run(['/bin/bash', script, *args], env=env, text=True, capture_output=True, timeout=120)
        assert secret not in result.stdout + result.stderr, 'a token leaked in script output'
        return result
    def calls(home):
        path = home / 'calls'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
    def creds(home):
        return home / '.config/hypertask-agents/credentials'
    def must_fail(env, needle, *args, mode=''):
        result = run(dict(env, FAKE_MODE=mode), *args)
        assert result.returncode != 0 and needle in result.stderr, (args, result.returncode, result.stderr)
        assert not list(creds(pathlib.Path(env['HOME'])).glob('.setup-smoke-token.*')), 'a temporary token was left behind'
        return pathlib.Path(env['HOME'])
    def missing_deps():
        home, env = fixture('no-cli', '/usr/bin:/bin')
        result = run(env, '--name', 'Setup Smoke')
        assert result.returncode == 2, (result.returncode, result.stderr)
        assert 'missing hypertask; install it from https://github.com/hypertask-ai/cli' in result.stderr and 'nothing was created' in result.stderr, result.stderr
        assert not (home / '.config').exists(), 'a missing dependency still created files'
        sparse = root / 'sparse-bin'
        sparse.mkdir()
        for tool in ['flock', 'mktemp', 'ln', 'cat', 'readlink', 'sed', 'tr']:
            os.symlink(shutil.which(tool), sparse / tool)
        os.symlink(cli, sparse / 'hypertask')
        home, env = fixture('no-jq', str(sparse))
        result = run(env, '--name', 'Setup Smoke')
        assert result.returncode == 2 and 'missing jq; install it with: sudo apt-get install jq' in result.stderr, result.stderr
        assert not (home / 'calls').exists(), 'the CLI ran despite a missing dependency'
        print('missing-deps: ok')
    def clean_home():
        home, env = fixture('clean')
        started = time.monotonic()
        result = run(env, '--name', 'Setup Smoke')
        elapsed = time.monotonic() - started
        assert result.returncode == 0, (result.returncode, result.stderr)
        assert 'Setup Smoke: login ok; type /rename Setup Smoke then rerun' in result.stdout, result.stdout
        assert elapsed < 120, f'one command took {elapsed:.1f}s'
        token = creds(home) / 'setup-smoke-agent-token'
        assert token.read_text() == secret + '\n' and token.stat().st_mode & 0o777 == 0o600, 'credential is not 0600'
        link = creds(home) / 'sessions/setup-smoke-agent-token'
        assert link.is_symlink() and os.readlink(link) == '../setup-smoke-agent-token'
        create = ['agents', 'create', '--name', 'Setup Smoke', '--project', '15', '--project', '11514', '--json']
        assert calls(home) == [create, ['--json', '--token', secret, 'status']], calls(home)
        before = token.stat().st_mtime_ns
        assert run(env, 'Setup Smoke').returncode == 0
        assert token.stat().st_mtime_ns == before, 'an existing credential was rewritten'
        assert [c for c in calls(home) if c[:2] == ['agents', 'create']] == [create], 'an existing credential was recreated'
        print('clean-home: ok')
    def safety():
        for bad in ['', 'ht_live_token', 'html|name', 'x' * 65, 'bad${name}']:
            home, env = fixture('bad-' + str(abs(hash(bad)) % 10000))
            assert run(env, '--name', bad).returncode != 0 and not (home / 'calls').exists(), bad
            assert not (home / '.config').exists(), 'an invalid name still created files: ' + bad
        home, env = fixture('options')
        assert 'unknown option: --nope' in run(env, '--name', 'Setup Smoke', '--nope').stderr
        must_fail(env, 'must share a slug', '--name', 'Setup Smoke', '--identity', 'Other Name')
        assert not (home / 'calls').exists(), 'a refused identity still called the CLI'
        home, env = fixture('existing')
        creds(home).mkdir(parents=True)
        token = creds(home) / 'setup-smoke-agent-token'
        token.write_text('')
        must_fail(env, 'refusing to replace it', '--name', 'Setup Smoke')
        assert token.read_text() == ''
        token.unlink()
        token.symlink_to(creds(home) / 'missing')
        must_fail(env, 'refusing to replace it', '--name', 'Setup Smoke')
        assert token.is_symlink()
        token.unlink()
        token.write_text(secret)
        link = creds(home) / 'sessions/setup-smoke-agent-token'
        link.parent.mkdir()
        link.write_text('do not overwrite')
        must_fail(env, 'not a symlink', '--name', 'Setup Smoke')
        assert link.read_text() == 'do not overwrite' and not (home / 'calls').exists()
        for mode, needle in [('create-fail', 'could not create agent'), ('invalid-json', 'returned no usable token'),
                             ('read-fail', 'the server rejected this login'), ('wrong-ticket', 'not authenticated')]:
            home, env = fixture(mode)
            must_fail(env, needle, '--name', 'Setup Smoke', mode=mode)
            if mode in ['create-fail', 'invalid-json']:
                assert not (creds(home) / 'setup-smoke-agent-token').exists(), 'a failed creation saved a credential'
        home, env = fixture('same-slug')
        assert run(env, '--name', 'Setup Smoke').returncode == 0
        must_fail(env, 'already belongs to "Setup Smoke"', '--name', 'Setup-Smoke')
        assert len([c for c in calls(home) if c[:2] == ['agents', 'create']]) == 1, 'a second agent was created for one slug'
        home, env = fixture('race')
        must_fail(env, 'appeared while setup was running', '--name', 'Setup Smoke', mode='race')
        assert (creds(home) / 'setup-smoke-agent-token').read_text() == secret, 'a racing writer token was overwritten'
        print('safety: ok')
    def check_mode():
        home, env = fixture('check')
        started = time.monotonic()
        result = run(env, '--check')
        elapsed = time.monotonic() - started
        assert result.returncode == 0 and 'check ok (tools present, login ok)' in result.stdout, result.stderr
        assert elapsed < 5, f'the smoke check took {elapsed:.1f}s'
        assert not (home / '.config').exists(), 'the smoke check wrote files'
        assert calls(home) == [['--json', 'status']], calls(home)
        assert 'the server rejected this login' in run(dict(env, FAKE_MODE='read-fail'), '--check').stderr
        home, env = fixture('check-credential')
        assert 'no readable credential for "Setup Smoke"' in run(env, '--check', '--name', 'Setup Smoke').stderr
        creds(home).mkdir(parents=True)
        (creds(home) / 'setup-smoke-agent-token').write_text(secret)
        result = run(env, '--check', '--name', 'Setup Smoke')
        assert result.returncode == 0 and 'check ok' in result.stdout, result.stderr
        assert calls(home) == [['--json', '--token', secret, 'status']], calls(home)
        print('check-mode: ok')
    cases = {'missing-deps': missing_deps, 'clean-home': clean_home, 'safety': safety, 'check-mode': check_mode}
    if sys.argv[2]:
        assert sys.argv[2] in cases, 'unknown case: ' + sys.argv[2]
        cases[sys.argv[2]]()
    else:
        for case in cases.values():
            case()
        print('setup-agents tests passed')
PY
