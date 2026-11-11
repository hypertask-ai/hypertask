#!/usr/bin/env bash
# Temp HOME and a fake CLI only. Never provisions a real agent.
# usage: setup-agents.test.sh [--case missing-deps|clean-home|safety|check-mode]
set -euo pipefail
case_name=${2:-}
[ "$#" -eq 0 ] || [ "${1:-}" = "--case" ] || { echo "usage: setup-agents.test.sh [--case <name>]" >&2; exit 1; }
python3 - "$(dirname "$0")/setup-agents" "$case_name" <<'PY'
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

script = str(pathlib.Path(sys.argv[1]).resolve())
wanted = sys.argv[2]
secret = 'fixture-only-bearer-value'

with tempfile.TemporaryDirectory(prefix='setup-agents-') as tmp:
    root = pathlib.Path(tmp)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    cli = bin_dir / 'hypertask'
    cli.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
secret = 'fixture-only-bearer-value'
mode = os.environ.get('FAKE_MODE', '')
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps(args) + '\\n')
if args[:2] == ['agents', 'create']:
    if mode == 'create-fail':
        print(secret)
        print(secret, file=sys.stderr)
        sys.exit(1)
    if mode == 'race':
        slug = 'setup-smoke'
        p = pathlib.Path.home() / ('.config/hypertask-agents/credentials/' + slug + '-agent-token')
        p.write_text(secret)
    if mode == 'invalid-json':
        print(secret)
    else:
        print(json.dumps({'token': secret}))
    sys.exit(0)
if mode == 'read-fail':
    print(secret)
    sys.exit(4)
print(json.dumps({'authenticated': mode != 'wrong-ticket', 'verified': True}))
''')
    cli.chmod(0o755)
    base = {k: v for k, v in os.environ.items() if k not in {
        'SHIP_SESSION_NAME', 'VCC_CREDENTIALS_DIR', 'VCC_SESSION_CREDENTIALS_DIR', 'SHELLOPTS', 'BASH_ENV', 'ENV'}}
    base['PATH'] = str(bin_dir) + os.pathsep + base['PATH']

    def fixture(label, path=None):
        home = root / label
        home.mkdir()
        calls = home / 'calls'
        return home, calls, dict(base, HOME=str(home), PATH=path or base['PATH'], CALLS=str(calls))

    def run(env, *args, timeout=60):
        return subprocess.run(['/bin/bash', script, *args], env=env, text=True, capture_output=True, timeout=timeout)

    def none_leaked(result):
        assert secret not in result.stdout + result.stderr, 'a token leaked in script output'

    def calls(home, name='calls'):
        p = home / name
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def case_missing_deps():
        home, calls_file, env = fixture('no-cli', '/usr/bin:/bin')
        r = run(env, '--name', 'Setup Smoke')
        assert r.returncode == 2, (r.returncode, r.stderr)
        assert 'missing hypertask' in r.stderr, r.stderr
        assert 'install it from https://github.com/hypertask-ai/cli' in r.stderr
        assert 'nothing was created' in r.stderr
        assert not (home / '.config').exists(), 'a missing dependency still created files'
        assert not calls_file.exists(), 'the CLI ran despite a missing dependency'

        # Same message for a library dependency, with the CLI present.
        sparse = root / 'sparse-bin'
        sparse.mkdir()
        for tool in ['flock', 'mktemp', 'ln', 'cat', 'readlink']:
            found = shutil.which(tool)
            assert found, tool + ' is required by this test'
            os.symlink(found, sparse / tool)
        os.symlink(cli, sparse / 'hypertask')
        home, calls_file, env = fixture('no-jq', str(sparse))
        r = run(env, '--name', 'Setup Smoke')
        assert r.returncode == 2, (r.returncode, r.stderr)
        assert 'missing jq' in r.stderr and 'apt-get install jq' in r.stderr, r.stderr
        assert not calls_file.exists(), 'the CLI ran despite a missing dependency'
        print('missing-deps: ok')

    def case_clean_home():
        home, calls_file, env = fixture('clean')
        started = time.monotonic()
        r = run(env, '--name', 'Setup Smoke')
        elapsed = time.monotonic() - started
        none_leaked(r)
        assert r.returncode == 0, (r.returncode, r.stderr)
        assert 'Setup Smoke: login ok; type /rename Setup Smoke then rerun' in r.stdout, r.stdout
        assert elapsed < 120, f'one command took {elapsed:.1f}s'
        creds = home / '.config/hypertask-agents/credentials'
        token = creds / 'setup-smoke-agent-token'
        assert token.read_text() == secret + '\n'
        assert token.stat().st_mode & 0o777 == 0o600, 'credential is not 0600'
        link = creds / 'sessions/setup-smoke-agent-token'
        assert link.is_symlink() and os.readlink(link) == '../setup-smoke-agent-token'
        assert calls(home) == [
            ['agents', 'create', '--name', 'Setup Smoke', '--project', '15', '--project', '11514', '--json'],
            ['--json', '--token', secret, 'status'],
        ], calls(home)
        before = token.stat().st_mtime_ns
        r = run(env, 'Setup Smoke')
        assert r.returncode == 0, (r.returncode, r.stderr)
        assert token.stat().st_mtime_ns == before, 'an existing credential was rewritten'
        assert [c for c in calls(home) if c[:2] == ['agents', 'create']] == [
            ['agents', 'create', '--name', 'Setup Smoke', '--project', '15', '--project', '11514', '--json']]
        assert elapsed < 120, f'one command took {elapsed:.1f}s'
        print('clean-home: ok')

    def case_safety():
        for bad in ['', 'ht_live_token', 'html|name', 'x' * 65, 'bad${name}']:
            home, calls_file, env = fixture('bad-' + str(abs(hash(bad)) % 10000))
            if bad == '':
                r = run(env, '--name', bad)
            else:
                r = run(env, '--name', bad)
            assert r.returncode != 0, (bad, r.returncode)
            assert not calls_file.exists(), 'an invalid name still called the CLI: ' + bad
            assert not (home / '.config').exists(), 'an invalid name still created files: ' + bad
        home, calls_file, env = fixture('unknown-option')
        r = run(env, '--name', 'Setup Smoke', '--nope')
        assert r.returncode != 0 and 'unknown option: --nope' in r.stderr, r.stderr
        r = run(env, '--name', 'Setup Smoke', '--identity', 'Other Name')
        assert r.returncode != 0 and 'same slug' in r.stderr, r.stderr
        assert not calls_file.exists(), 'a refused identity still called the CLI'

        # An existing credential is reused, never replaced, and never invented.
        home, calls_file, env = fixture('existing')
        creds = home / '.config/hypertask-agents/credentials'
        creds.mkdir(parents=True)
        token = creds / 'setup-smoke-agent-token'
        token.write_text('')
        r = run(env, '--name', 'Setup Smoke')
        assert r.returncode != 0 and 'refusing to replace it' in r.stderr, r.stderr
        assert token.read_text() == ''
        token.unlink()
        token.symlink_to(creds / 'missing')
        r = run(env, '--name', 'Setup Smoke')
        assert r.returncode != 0 and token.is_symlink(), r.stderr
        token.unlink()
        token.write_text(secret)
        link = creds / 'sessions/setup-smoke-agent-token'
        creds.joinpath('sessions').mkdir()
        link.write_text('do not overwrite')
        r = run(env, '--name', 'Setup Smoke')
        assert r.returncode != 0 and 'not a symlink' in r.stderr, r.stderr
        assert link.read_text() == 'do not overwrite'
        assert not calls_file.exists(), 'a refused credential still called the CLI'

        for mode, message in [
            ('create-fail', 'could not create agent'),
            ('invalid-json', 'returned no usable token'),
            ('read-fail', 'the server rejected this login'),
            ('wrong-ticket', 'not authenticated'),
        ]:
            home, calls_file, env = fixture(mode)
            r = run(dict(env, FAKE_MODE=mode), '--name', 'Setup Smoke')
            none_leaked(r)
            assert r.returncode != 0, (mode, r.returncode)
            assert message in r.stderr, (mode, r.stderr)
            creds = home / '.config/hypertask-agents/credentials'
            assert not list(creds.glob('.setup-smoke-token.*')), 'a temporary token was left behind: ' + mode
            if mode in ['create-fail', 'invalid-json']:
                assert not (creds / 'setup-smoke-agent-token').exists(), 'a failed creation saved a credential'

        home, calls_file, env = fixture('race')
        r = run(dict(env, FAKE_MODE='race'), '--name', 'Setup Smoke')
        assert r.returncode != 0 and 'appeared while setup was running' in r.stderr, r.stderr
        assert (home / '.config/hypertask-agents/credentials/setup-smoke-agent-token').read_text() == secret, \
            'a racing writer token was overwritten'
        print('safety: ok')

    def case_check_mode():
        home, calls_file, env = fixture('check')
        started = time.monotonic()
        r = run(env, '--check')
        elapsed = time.monotonic() - started
        none_leaked(r)
        assert r.returncode == 0, (r.returncode, r.stderr)
        assert 'check ok (tools present, login ok)' in r.stdout, r.stdout
        assert elapsed < 5, f'the smoke check took {elapsed:.1f}s'
        assert not (home / '.config').exists(), 'the smoke check wrote files'
        assert calls(home) == [['--json', 'status']], calls(home)
        r = run(dict(env, FAKE_MODE='read-fail'), '--check')
        none_leaked(r)
        assert r.returncode != 0 and 'the server rejected this login' in r.stderr, r.stderr

        # A runner machine has credentials but no ambient login: --check uses the credential.
        home, calls_file, env = fixture('check-with-credential')
        creds = home / '.config/hypertask-agents/credentials'
        creds.mkdir(parents=True)
        (creds / 'setup-smoke-agent-token').write_text(secret)
        r = run(env, '--check', '--name', 'Setup Smoke')
        none_leaked(r)
        assert r.returncode == 0, (r.returncode, r.stderr)
        assert 'check ok' in r.stdout, r.stdout
        assert calls(home) == [['--json', '--token', secret, 'status']], calls(home)
        assert len(list(creds.glob('.setup-smoke-token.*'))) == 0
        print('check-mode: ok')

    cases = {
        'missing-deps': case_missing_deps,
        'clean-home': case_clean_home,
        'safety': case_safety,
        'check-mode': case_check_mode,
    }
    if wanted:
        assert wanted in cases, 'unknown case: ' + wanted + ' (choose ' + ', '.join(cases) + ')'
        cases[wanted]()
    else:
        for name, case in cases.items():
            case()
        print('setup-agents tests passed')
PY
