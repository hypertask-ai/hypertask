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
    f.write(json.dumps([sys.argv[1:], os.getcwd()]) + '\\n')
markers = dict(ticket='ticket ok', pr='title ok', merged='merged ok',
               deployed='deployed ok (no app build needed)', proof='proof ok', done='done ok', cleaned='cleaned ok')
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
    def ledger(session, cwd=repo):
        return cwd / '.unlazy' / ('s-'+session[:8]) / 'GATES.md'
    def ids(file):
        return re.findall(r'^- \[[ x]\] ([^:]+):', file.read_text(), re.M)

    r = run()
    assert r.returncode != 0 and 'needs CLAUDE_CODE_SESSION_ID' in r.stderr
    assert not (repo/'.unlazy').exists()
    r = run('HTPR-6819; touch bad', CLAUDE_CODE_SESSION_ID='sessionA-full')
    assert r.returncode != 0 and not (repo/'.unlazy').exists()
    print('ok missing session and invalid ticket fail without writing a scope')

    session = 'sessionA-full-id'
    r = run(CLAUDE_CODE_SESSION_ID=session, CODEX_SESSION_ID='ignoredB-full', CODEX_THREAD_ID='ignoredC-full')
    file = ledger(session)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == str(file), (r.stdout, r.stderr)
    assert (file.parent/'session').read_text() == session+'\n'
    assert ids(file) == ['HTPR-6819.'+g for g in ['ticket','pr','merged','deployed','proof','done','cleaned']]
    assert 'UNMET: 2 (met: 5)' in r.stderr, r.stderr
    assert len(calls()) == 7
    assert all(c[1] == str(repo) for c in calls())
    assert file.read_text().count('automatic-evidence=v1') == 5
    assert file.read_text().count('  CWD: '+str(repo)) == 7
    original = file.read_text()
    r = run(CLAUDE_CODE_SESSION_ID=session)
    assert r.returncode == 0 and len(ids(file)) == 7 and len(calls()) == 9
    assert file.read_text() == original
    print('ok Claude precedence, full binding, absolute quoted commands/CWD, executed approvals, deployed suffix and idempotence')

    r = run('YPER4-123', CLAUDE_CODE_SESSION_ID=session)
    assert r.returncode == 0 and len(ids(file)) == 13 and len(set(ids(file))) == 13, r.stderr
    assert 'YPER4-123.proof' not in ids(file)
    assert file.read_text().startswith(original)
    assert len([d for d in (repo/'.unlazy').iterdir() if d.name != 'locks']) == 1
    r = run('YPER4-123', CLAUDE_CODE_SESSION_ID=session)
    assert r.returncode == 0 and len(ids(file)) == 13
    print('ok another ticket appends in one scope and repeat calls do not duplicate ids or reset evidence')

    for key, sid in [('CODEX_SESSION_ID','codexses-full'), ('CODEX_THREAD_ID','codexthr-full')]:
        r = run('HYFA-12', **{key:sid})
        assert r.returncode == 0 and len(ids(ledger(sid))) == 6, r.stderr
        assert (ledger(sid).parent/'session').read_text() == sid+'\n'
    r = run('HYFA-13', CODEX_SESSION_ID='codexses-full', CODEX_THREAD_ID='ignoredC-full')
    assert r.returncode == 0 and len(ids(ledger('codexses-full'))) == 12
    print('ok Codex session/thread fallback and precedence')

    before = file.read_text()
    count = len(calls())
    r = run(CLAUDE_CODE_SESSION_ID='sessionA-another-full-id')
    assert r.returncode != 0 and 'session prefix collision' in r.stderr
    assert file.read_text() == before and len(calls()) == count
    print('ok colliding session prefixes cannot overwrite another session')

    result = subprocess.run(['node', str(unlazy/'scripts/gate-check.mjs'), '--reverify', '--root', str(repo),
                             '--scope', 's-'+session[:8]], cwd=p, env=dict(env, DONE='yes'), text=True, capture_output=True)
    assert result.returncode == 0 and 'ALL MET' in result.stdout, result.stdout+result.stderr
    assert all(c[1] == str(repo) for c in calls())
    assert 'NOT RUN' not in result.stdout
    elsewhere = p/'elsewhere'
    elsewhere.mkdir()
    result = subprocess.run(['node', str(unlazy/'scripts/gate-check.mjs'), '--reverify', str(file)],
                            cwd=elsewhere, env=dict(env, DONE='yes'), text=True, capture_output=True)
    assert result.returncode == 0 and 'ALL MET' in result.stdout and 'NOT RUN' not in result.stdout, result.stdout+result.stderr
    print('ok named and discovered re-verification use the same approved CWD from a different launch directory')

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
    print('ship-gates regression passed')
PY
