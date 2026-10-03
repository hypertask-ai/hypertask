#!/usr/bin/env bash
# Temp HOME and a fake CLI only. Never provision a real agent.
set -euo pipefail
python3 - "$(dirname "$0")/setup-runner" <<'PY'
import json
import os
import pathlib
import subprocess
import sys
import tempfile

script = str(pathlib.Path(sys.argv[1]).resolve())
secret = 'fixture-only-bearer-value'
with tempfile.TemporaryDirectory(prefix='setup-runner-') as tmp, subprocess.Popen(['cat'], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL) as live:
    root = pathlib.Path(tmp)
    bin_dir = root / 'bin'
    bin_dir.mkdir()
    cli = bin_dir / 'hypertask'
    cli.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
secret = 'fixture-only-bearer-value'
mode = os.environ.get('FAKE_MODE', '')
if args[:2] == ['agents', 'create']:
    assert args == ['agents', 'create', '--name', args[3], '--project', '15', '--project', '4060', '--json']
    call = ['create', args[3]]
else:
    assert args == ['--json', '--token', secret, 'tasks', 'get', 'YPER4-159']
    call = ['read', 'verified token']
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps(call) + '\\n')
if mode in ('create-fail', 'read-fail') and call[0] == mode.split('-')[0]:
    print(secret); print(secret, file=sys.stderr); sys.exit(1)
if call[0] == 'create':
    if mode == 'race':
        n = args[3].split()[-1]
        p = pathlib.Path.home() / ('.config/hypertask-agents/credentials/runner-' + n + '-agent-token')
        p.write_text(secret)
    if mode == 'invalid-json':
        print(secret)
    else:
        print(json.dumps({'token': '' if mode == 'empty-token' else secret}))
else:
    print(json.dumps({'success': True, 'tasks': [{'ticketNumber': 'HTPR-1' if mode == 'wrong-ticket' else 'YPER4-159'}]}))
''')
    cli.chmod(0o755)
    base_env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'])
    for k in ['SHIP_SESSION_NAME', 'VCC_CREDENTIALS_DIR', 'VCC_SESSION_CREDENTIALS_DIR', 'SHELLOPTS', 'BASH_ENV', 'ENV']:
        base_env.pop(k, None)

    def fixture(label):
        home = root / label
        home.mkdir()
        creds = home / '.config/hypertask-agents/credentials'
        creds.mkdir(parents=True)
        sessions = home / '.claude/sessions'
        sessions.mkdir(parents=True)
        env = dict(base_env, HOME=str(home), CALLS=str(home / 'calls'))
        return home, creds, sessions, env

    def assert_no_secret(output):
        assert secret not in output, 'a token leaked in script output'

    def run(env, *args, trace=False):
        result = subprocess.run(['bash'] + (['-x'] if trace else []) + [script, *args], env=env, text=True, capture_output=True)
        assert_no_secret(result.stdout + result.stderr)
        return result

    def calls(home):
        p = home / 'calls'
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def token(creds, n, contents=secret):
        p = creds / f'runner-{n}-agent-token'
        p.write_text(contents)
        return p

    def session(sessions, pid, name, source='user'):
        p = sessions / f'{pid}.json'
        p.write_text(json.dumps({'pid': pid, 'name': name, 'nameSource': source}))
        return p

    # Positive control: the leak detector must reject a known token in output.
    try:
        assert_no_secret('error: ' + secret)
    except AssertionError:
        pass
    else:
        raise AssertionError('leak detector accepted its positive control')
    home, creds, sessions, env = fixture('new home with spaces')
    r = run(env, trace=True)
    assert r.returncode == 0
    assert '/rename RUNNER 1' in r.stdout and 'type /rename RUNNER 1 then rerun' in r.stdout
    p = creds / 'runner-1-agent-token'
    assert p.read_text() == secret + '\n'
    assert p.stat().st_mode & 0o777 == 0o600
    link = creds / 'sessions/runner-1-agent-token'
    assert link.is_symlink() and os.readlink(link) == '../runner-1-agent-token'
    assert calls(home) == [['create', 'Runner 1'], ['read', 'verified token']]
    # /rename changes the actual ancestor registry. Re-running keeps the login.
    session(sessions, os.getpid(), 'RUNNER 1')
    before = p.stat().st_mtime_ns
    r = run(env, '9')
    assert r.returncode == 0 and 'RUNNER 1: login ok, identity ok' in r.stdout
    assert p.stat().st_mtime_ns == before
    assert calls(home).count(['create', 'Runner 1']) == 1
    print('ok new login, permissions, secret-safe tracing, rename and named-number precedence')

    home, creds, sessions, env = fixture('picking')
    token(creds, 1)
    # A live child is not this test's owning ancestor session.
    session(sessions, live.pid, 'RUNNER 2')
    # A fully reaped child PID is dead, even though its registry file remains.
    child = subprocess.Popen(['true'])
    child.wait()
    session(sessions, child.pid, 'RUNNER 3')
    r = run(env)
    assert r.returncode == 0 and 'RUNNER 3:' in r.stdout
    assert calls(home)[0] == ['create', 'Runner 3']
    print('ok smallest free number ignores dead sessions and avoids tokens and live names')

    home, creds, sessions, env = fixture('reuse')
    p = token(creds, 7)
    before = p.stat().st_mtime_ns
    r = run(env, '7')
    assert r.returncode == 0 and 'RUNNER 7:' in r.stdout
    assert p.read_text() == secret and p.stat().st_mtime_ns == before
    assert calls(home) == [['read', 'verified token']]
    session(sessions, os.getpid(), 'RUNNER 7 | current ticket')
    r = run(env)
    assert r.returncode == 0 and 'identity ok' in r.stdout
    print('ok explicit existing token is never overwritten, named identity suffix matches ship')

    home, creds, sessions, env = fixture('collision')
    session(sessions, live.pid, 'RUNNER 5')
    r = run(env, '5')
    assert r.returncode != 0 and 'another live session' in r.stderr and not calls(home)
    session(sessions, os.getpid(), 'RUNNER 5')
    r = run(env)
    assert r.returncode != 0 and not calls(home)
    print('ok explicit and named collisions fail before creating an agent')

    home, creds, sessions, env = fixture('derived')
    session(sessions, os.getpid(), 'RUNNER 8', source='derived')
    r = run(env)
    assert r.returncode == 0 and 'RUNNER 1:' in r.stdout and 'identity ok' not in r.stdout
    print('ok derived titles cannot select a board identity')

    for bad in ['0', '-1', '01', 'abc', '1; echo bad', '999/../../bad']:
        home, creds, sessions, env = fixture('bad-' + str(len(list(root.iterdir()))))
        r = run(env, bad)
        assert r.returncode != 0 and not calls(home)
    r = run(env, '1', '2')
    assert r.returncode != 0 and not calls(home)
    print('ok invalid arguments fail without provisioning')

    for mode in ['create-fail', 'invalid-json', 'empty-token', 'read-fail', 'wrong-ticket', 'race']:
        home, creds, sessions, env = fixture(mode)
        r = run(dict(env, FAKE_MODE=mode))
        assert r.returncode != 0
        assert not list(creds.glob('.runner-*-token.*')), 'temporary token left behind'
        p = creds / 'runner-1-agent-token'
        if mode in ['create-fail', 'invalid-json', 'empty-token']:
            assert not p.exists()
        if mode == 'race':
            assert p.read_text() == secret, 'racing writer token was overwritten'
    print('ok creation and verification errors fail loudly without leaking or overwriting tokens')

    home, creds, sessions, env = fixture('empty-existing')
    p = token(creds, 1, '')
    r = run(env, '1')
    assert r.returncode != 0 and p.read_text() == '' and not calls(home)
    p.unlink()
    p.symlink_to(creds / 'missing')
    r = run(env, '1')
    assert r.returncode != 0 and p.is_symlink() and not calls(home)
    print('ok empty or dangling existing credentials are never replaced')

    home, creds, sessions, env = fixture('session-credential')
    token(creds, 1)
    (creds / 'sessions').mkdir()
    link = creds / 'sessions/runner-1-agent-token'
    link.write_text('do not overwrite')
    r = run(env, '1')
    assert r.returncode != 0 and link.read_text() == 'do not overwrite' and not calls(home)
    link.unlink()
    session(sessions, os.getpid(), 'RUNNER 1')
    wrong = home / 'wrong-identity-creds'
    wrong.mkdir()
    r = run(dict(env, VCC_SESSION_CREDENTIALS_DIR=str(wrong)))
    assert r.returncode != 0 and 'ship-identity does not match' in r.stderr
    print('ok session credentials and mismatched ship identities fail closed')

    home, creds, sessions, env = fixture('parallel')
    jobs = [subprocess.Popen(['bash', script], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(3)]
    numbers = []
    for job in jobs:
        out, err = job.communicate(timeout=30)
        assert job.returncode == 0 and secret not in out + err
        numbers.append(out.split(':')[0])
    assert set(numbers) == {'RUNNER 1', 'RUNNER 2', 'RUNNER 3'}
    assert len([c for c in calls(home) if c[0] == 'create']) == 3
    print('ok concurrent setups reserve distinct numbers')
    print('setup-runner tests passed')
PY
