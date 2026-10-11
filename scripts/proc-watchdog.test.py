#!/usr/bin/env python3
"""Tests for proc-watchdog.py (YPER4-278). Real throwaway processes, scoped to a temp dir so nothing else is touched."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
fails = 0


def check(name, ok):
    global fails
    print(('ok   ' if ok else 'FAIL ') + name)
    fails += 0 if ok else 1


def alive(proc):
    return proc.poll() is None


def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return Path(f'/proc/{pid}/stat').read_text().split(') ')[1][0] != 'Z'
    except OSError:
        return False


with tempfile.TemporaryDirectory(prefix='pwd-test-') as tmp:
    t = Path(tmp)
    (t / 'tests').mkdir()
    # A test that hangs and owns a child process.
    (t / 'tests/hang.test.cjs').write_text(
        "const c=require('child_process').spawn('sleep',['300'],{stdio:'ignore'});"
        "require('fs').writeFileSync(process.argv[2], String(c.pid)); setInterval(()=>{},1000);\n")
    (t / 'server.js').write_text('setInterval(()=>{},1000);\n')
    (t / 'claude').symlink_to(sys.executable)
    notify = t / 'notify'
    notify.write_text(f'#!/bin/sh\necho "$1" > {t}/notify.target\ncat > {t}/notify.msg\n')
    notify.chmod(0o755)
    env = dict(os.environ, PROC_WATCHDOG_ONLY=tmp, PROC_WATCHDOG_STATE=str(t / 'state'),
               PROC_WATCHDOG_NOTIFY=str(notify), PROC_WATCHDOG_GRACE='2')

    def run(*args, **extra):
        return subprocess.run([sys.executable, str(HERE / 'proc-watchdog.py'), *args], env=dict(env, **extra),
                              capture_output=True, text=True, timeout=60)

    def start_all():
        test = subprocess.Popen(['node', str(t / 'tests/hang.test.cjs'), str(t / 'child.pid')])
        server = subprocess.Popen(['node', str(t / 'server.js')])
        shell = subprocess.Popen(['bash', '-c', f'sleep 300; echo {tmp} next build'])
        session = subprocess.Popen([str(t / 'claude'), '-c', 'import time; time.sleep(300)', f'{tmp}/tests/x.test.cjs'])
        premerge = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(300)', f'{tmp}/premerge-local-fds-x/search.mjs'])
        for _ in range(50):
            if (t / 'child.pid').exists() and (t / 'child.pid').read_text():
                break
            time.sleep(0.1)
        return test, server, shell, session, premerge, int((t / 'child.pid').read_text())

    # 1. Young processes under the memory limit are left alone.
    procs = start_all()
    test, server, shell, session, premerge, child = procs
    r = run('sweep')
    check('young, small processes are left alone', all(alive(p) for p in procs[:5]) and r.stdout == '')
    check('no warning when nothing was stopped', not (t / 'notify.msg').exists())

    # 2. Dry run lists without stopping.
    time.sleep(1.2)
    r = run('--dry-run', PROC_WATCHDOG_MAX_AGE='1')
    check('dry run lists the old test and premerge only', 'would stop test' in r.stdout
          and 'would stop premerge' in r.stdout and '2 over the limits' in r.stdout)
    check('dry run stops nothing', all(alive(p) for p in procs[:5]))

    # 3. Over the age limit: the test tree and the premerge process stop; the rest stays.
    r = run('sweep', PROC_WATCHDOG_MAX_AGE='1')
    time.sleep(0.3)
    check('old test stopped', not alive(test))
    check("old test's child process stopped too", not pid_alive(child))
    check('old premerge process stopped', not alive(premerge))
    check('server (no test/build/premerge) left running', alive(server))
    check('shell whose script mentions next build left running', alive(shell))
    check('a claude session is never stopped', alive(session))
    lines = [json.loads(x) for x in (t / 'state/kills.log').read_text().splitlines()]
    check('log has one line per stopped tree', sorted(x['kind'] for x in lines) == ['premerge', 'test'])
    check('log says why', all('running' in x['reason'] for x in lines) and lines[0]['processes'] >= 1)
    check('INFRA MANAGER warned once', (t / 'notify.target').read_text().strip() == 'infra-manager'
          and 'stopped 2 runaway' in (t / 'notify.msg').read_text())
    for p in (server, shell, session):
        p.kill()
    for f in ('notify.msg', 'notify.target', 'child.pid'):
        (t / f).unlink(missing_ok=True)

    # 4. Over the memory limit while young: stopped with the memory reason.
    procs = start_all()
    r = run('sweep', PROC_WATCHDOG_MAX_RSS_KB='1')
    time.sleep(0.3)
    check('test over the memory limit stopped', not alive(procs[0]))
    last = json.loads((t / 'state/kills.log').read_text().splitlines()[-1])
    check('memory reason logged', 'GB' in last['reason'])
    check('server still running under the memory rule', alive(procs[1]))
    for p in procs[:5]:
        if alive(p):
            p.kill()

    # 5. Secrets in command lines never reach the log or the warning.
    sec = subprocess.Popen(['node', str(t / 'tests/hang.test.cjs'), str(t / 'child.pid'), '--token=abc123secret'])
    time.sleep(1.2)
    run('sweep', PROC_WATCHDOG_MAX_AGE='1')
    text = (t / 'state/kills.log').read_text() + (t / 'notify.msg').read_text()
    check('token value redacted', 'abc123secret' not in text and '--token=***' in text)
    if alive(sec):
        sec.kill()

    # 6. Matching: real command lines from the VPS.
    sys.path.insert(0, str(HERE))
    import importlib.util
    spec = importlib.util.spec_from_file_location('pw', HERE / 'proc-watchdog.py')
    pw = importlib.util.module_from_spec(spec)
    os.environ.pop('PROC_WATCHDOG_ONLY', None)
    spec.loader.exec_module(pw)
    k = lambda cmd, name='node': pw.kind_of({'cmd': cmd, 'name': name})
    check('node test file', k('node tests/compose-task-palette.test.cjs') == 'test')
    check('node --test', k('node --test tests/') == 'test')
    check('next build', k('node /w/node_modules/.bin/next build --webpack') == 'build')
    check('next build worker', k('/usr/bin/node /w/node_modules/next/dist/compiled/jest-worker/processChild.js') == 'build')
    check('premerge search', k('node /tmp/premerge-local-fds-x/scripts/premerge-local-search.mjs f.json') == 'premerge')
    check('next dev is not a build', k('node /w/node_modules/.bin/next dev') is None)
    check('next start is not a build', k('npm exec next start -p 3000', 'npm exec next') is None)
    check('astro dev is not a build', k('/usr/bin/node /p/node_modules/astro/bin/astro.mjs dev --port 4399') is None)
    check('claude never matches', k('claude --resume x tests/a.test.cjs', 'claude') is None)

sys.exit(1 if fails else print('ALL PASS') or 0)
