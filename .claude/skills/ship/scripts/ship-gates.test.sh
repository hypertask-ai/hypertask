#!/usr/bin/env bash
# Isolated fixtures with the real unlazy checker; no production calls.
set -euo pipefail
python3 - "$(dirname "$0")/ship-gates" "$HOME/.agents/skills/unlazy" <<'PY'
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

script = str(pathlib.Path(sys.argv[1]).resolve())
unlazy = pathlib.Path(sys.argv[2]).resolve()
with tempfile.TemporaryDirectory(prefix='ship-gates-') as tmp:
    p = pathlib.Path(tmp)
    home = p / "home with 'quotes"
    ship = home / '.agents/skills/ship/scripts'
    ship.mkdir(parents=True)
    (home / '.agents/skills/unlazy').symlink_to(unlazy, target_is_directory=True)
    check = ship / 'ship-check'
    check.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps([sys.argv[1:], os.getcwd(), os.environ.get('SHIP_REPO'), os.environ.get('SHIP_CHECKOUT')]) + '\\n')
markers = dict(ticket='ticket ok', deeper='deeper ok', pr='title ok', merged='merged ok',
               deployed='deployed ok (no app build needed)', proof='proof ok', docs='docs ok', done='done ok', cleaned='cleaned ok')
if sys.argv[1] in ('done', 'cleaned') and os.environ.get('DONE') != 'yes':
    print('FAIL: not Done'); sys.exit(1)
print(markers[sys.argv[1]])
''')
    check.chmod(0o755)
    approval = p / 'approvals'
    approval.mkdir(mode=0o700)
    env = dict(os.environ, HOME=str(home), UNLAZY_APPROVAL_DIR=str(approval), CALLS=str(p/'calls'))
    for key in ['CLAUDE_CODE_SESSION_ID', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'UNLAZY_SCOPE']:
        env.pop(key, None)
    repo = p / 'repo with spaces'
    repo.mkdir()
    def run(ticket='HTPR-6819', cwd=repo, **extra):
        return subprocess.run(['bash', script, ticket], cwd=cwd, env=dict(env, **extra), text=True, capture_output=True)
    def calls():
        return [json.loads(line) for line in (p/'calls').read_text().splitlines()]
    # One folder per ticket under the home folder, never in the project.
    def ledger(ticket='HTPR-6819'):
        return home / '.unlazy' / 'ledgers' / ticket / 'GATES.md'
    def ids(file):
        return re.findall(r'^- \[[ x]\] ([^:]+):', file.read_text(), re.M)

    r = run()
    assert r.returncode != 0 and 'needs CLAUDE_CODE_SESSION_ID' in r.stderr
    assert not (home/'.unlazy').exists()
    r = run('HTPR-6819; touch bad', CLAUDE_CODE_SESSION_ID='sessionA-full')
    assert r.returncode != 0 and not (home/'.unlazy').exists()
    print('ok missing session and invalid ticket fail without writing a ledger')

    session = 'sessionA-full-id'
    r = run(CLAUDE_CODE_SESSION_ID=session, CODEX_SESSION_ID='ignoredB-full', CODEX_THREAD_ID='ignoredC-full')
    file = ledger()
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == str(file), (r.stdout, r.stderr)
    assert (file.parent/'session').read_text() == session+'\n'
    assert ids(file) == ['HTPR-6819.'+g for g in ['ticket','deeper','pr','merged','deployed','proof','docs','done','cleaned']]
    assert 'UNMET: 2 (met: 7)' in r.stderr, r.stderr
    assert len(calls()) == 9
    assert all(c[1] == str(repo) for c in calls())
    assert file.read_text().count('automatic-evidence=v1') == 7
    assert file.read_text().count('  CWD: '+str(repo)) == 9
    original = file.read_text()
    r = run(CLAUDE_CODE_SESSION_ID=session)
    assert r.returncode == 0 and len(ids(file)) == 9 and len(calls()) == 11
    assert file.read_text() == original
    print('ok Claude precedence, full binding, absolute quoted commands/CWD, executed approvals, deployed suffix and idempotence')
    assert not (repo/'.unlazy').exists(), 'a ship run left session state in the project'

    r = run('YPER4-123', CLAUDE_CODE_SESSION_ID=session)
    other = ledger('YPER4-123')
    assert r.returncode == 0 and other.exists() and len(ids(other)) == 8, r.stderr
    assert 'YPER4-123.proof' not in ids(other)
    assert file.read_text() == original
    r = run('YPER4-123', CLAUDE_CODE_SESSION_ID=session)
    assert r.returncode == 0 and len(ids(other)) == 8
    assert not (repo/'.unlazy').exists()
    print('ok each ticket gets its own folder and repeat calls do not duplicate ids or reset evidence')

    for key, sid in [('CODEX_SESSION_ID','codexses-full'), ('CODEX_THREAD_ID','codexthr-full')]:
        r = run('HYFA-12', **{key:sid})
        assert r.returncode == 0 and len(ids(ledger('HYFA-12'))) == 8, r.stderr
        assert (ledger('HYFA-12').parent/'session').read_text() == sid+'\n'
    r = run('HYFA-13', CODEX_SESSION_ID='codexses-full', CODEX_THREAD_ID='ignoredC-full')
    assert r.returncode == 0 and len(ids(ledger('HYFA-13'))) == 8
    assert (ledger('HYFA-13').parent/'session').read_text() == 'codexses-full\n'
    print('ok Codex session/thread fallback and precedence')

    before = file.read_text()
    r = run(CLAUDE_CODE_SESSION_ID='sessionA-another-full-id')
    assert r.returncode == 0, r.stderr
    assert 'HTPR-6819 ledger moved from session sessionA-full-id to sessionA-another-full-id' in r.stderr, r.stderr
    assert file.read_text() == before
    assert (file.parent/'session').read_text() == 'sessionA-another-full-id\n'
    print('ok a later session continues the same ticket ledger and keeps its gates')

    result = subprocess.run(['node', str(unlazy/'scripts/gate-check.mjs'), '--reverify', '--root', str(file.parent),
                             str(file)], cwd=repo, env=dict(env, DONE='yes'), text=True, capture_output=True)
    assert result.returncode == 0 and 'ALL MET' in result.stdout, result.stdout+result.stderr
    assert all(c[1] == str(repo) for c in calls())
    assert 'NOT RUN' not in result.stdout
    elsewhere = p/'elsewhere'
    elsewhere.mkdir()
    result = subprocess.run(['node', str(unlazy/'scripts/gate-check.mjs'), '--reverify', str(file)],
                            cwd=elsewhere, env=dict(env, DONE='yes'), text=True, capture_output=True)
    assert result.returncode == 0 and 'ALL MET' in result.stdout and 'NOT RUN' not in result.stdout, result.stdout+result.stderr
    print('ok re-verification from the project and from elsewhere uses the same approved CWD')

    before = file.read_text()
    for tainted in [
        before + '\n- [ ] extra: unreviewed command\n  CHECK: touch '+str(p/'bad')+'\n  EXPECT: bad\n',
        before.replace("' ticket HTPR-6819", "' bind HTPR-6819 123", 1),
        before.replace('  EXPECT: ticket ok', '  EXPECT: anything', 1),
        before.replace('  CWD: '+str(repo), '  CWD: /tmp', 1),
        before + '\n- [ ] HTPR-6819.ticket: duplicate\n',
    ]:
        file.write_text(tainted)
        count = len(calls())
        approved = sorted(f.name for f in approval.iterdir())
        r = run(CLAUDE_CODE_SESSION_ID=session)
        assert r.returncode != 0, r.stderr
        assert len(calls()) == count and sorted(f.name for f in approval.iterdir()) == approved
        assert file.read_text() == tainted and not (p/'bad').exists()
    file.write_text(before)
    print('ok custom/mutating commands, altered expectations/CWD and duplicate ids never get auto-approved')

    cli = dict(SHIP_REPO='hypertask-ai/cli', SHIP_BASE='main')
    r = run('HTPR-6806', CLAUDE_CODE_SESSION_ID='cliSessA-full', **cli)
    assert r.returncode != 0 and 'SHIP_CHECKOUT' in r.stderr and not ledger('HTPR-6806').exists()
    r = run('HTPR-6806', CLAUDE_CODE_SESSION_ID='cliSessA-full', SHIP_CHECKOUT="/x';touch bad", **cli)
    assert r.returncode != 0 and not ledger('HTPR-6806').exists()
    cli['SHIP_CHECKOUT'] = '/home/u/hypertask cli'
    count = len(calls())
    r = run('HTPR-6806', CLAUDE_CODE_SESSION_ID='cliSessA-full', **cli)
    cfile = ledger('HTPR-6806')
    assert r.returncode == 0, r.stderr
    prefix = "SHIP_REPO=hypertask-ai/cli SHIP_BASE=main SHIP_CHECKOUT='/home/u/hypertask cli' "
    assert cfile.read_text().count('  CHECK: '+prefix) == 9
    new = calls()[count:]
    assert len(new) == 9 and all(c[2] == 'hypertask-ai/cli' and c[3] == '/home/u/hypertask cli' for c in new), new
    r = run('HTPR-6819', CLAUDE_CODE_SESSION_ID='cliSessA-full')
    assert r.returncode == 0 and len(ids(cfile)) == 9, r.stderr
    assert len(ids(ledger('HTPR-6819'))) == 9
    assert all(c[2] is None for c in calls()[-9:])
    print('ok CLI tickets carry SHIP_REPO, SHIP_BASE and SHIP_CHECKOUT into every check; app tickets append without them')

    before = cfile.read_text()
    for tainted in [before.replace('SHIP_BASE=main ', 'SHIP_BASE=main;touch${IFS}bad ', 1),
                    before.replace("SHIP_CHECKOUT='/home/u/hypertask cli'", "SHIP_CHECKOUT=$(touch bad)", 1),
                    before.replace('SHIP_REPO=hypertask-ai/cli ', 'FOO=1 SHIP_REPO=hypertask-ai/cli ', 1)]:
        assert tainted != before
        cfile.write_text(tainted)
        count = len(calls())
        r = run('HTPR-6806', CLAUDE_CODE_SESSION_ID='cliSessA-full', **cli)
        assert r.returncode != 0 and len(calls()) == count and not (p/'bad').exists(), r.stderr
    cfile.write_text(before)
    print('ok an altered env prefix is never auto-approved')
    print('ship-gates regression passed')
PY
