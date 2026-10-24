#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
export APPROVED_SWEEP_TEST_HERE="$here"
python3 - <<'PY'
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

here = Path(os.environ['APPROVED_SWEEP_TEST_HERE'])
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    home = root / 'home'
    bin = root / 'bin'
    bin.mkdir()
    scripts = home / '.agents/skills/ship/scripts'
    scripts.mkdir(parents=True)
    token = home / 'runner-token'
    token.write_text('fixture agent credential')
    stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['SWEEP_TEST_DIR'])
data = json.loads((root / 'fixture.json').read_text())
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / 'calls').open('a') as f:
    f.write(json.dumps([name, os.environ.get('SHIP_SESSION_NAME'), args]) + '\\n')
if name == 'ship-identity':
    print(data.get('identity', 'RUNNER 8') + '\\t' + str(Path.home() / 'runner-token'))
elif name == 'runner-deliver':
    assert args == ['ht-product-lead']
    with (root / 'deliveries').open('a') as f:
        f.write(json.dumps({'id':os.environ['RUNNER_DELIVER_ID'], 'message':sys.stdin.read()}) + '\\n')
    sys.exit(data.get('delivery_exit', 0))
elif name == 'vcc':
    if args[:2] == ['task', 'list']:
        assert '--limit' in args and args[args.index('--limit')+1] == '100'
        board = args[args.index('--project')+1]
        tasks = data['boards'].get(board, [])
        offset = int(args[args.index('--cursor')+1]) if '--cursor' in args else 0
        page = tasks[offset:offset+100]
        cursor = str(offset+100) if offset+100 < len(tasks) else None
        print(json.dumps({'success':True, 'tasks':page, 'total':len(tasks), 'nextCursor':None if data.get('incomplete') else cursor}))
    elif args[:2] == ['comments', 'list']:
        assert '--include-activity' in args
        rows = data['comments'].get(args[2], [])
        offset = int(args[args.index('--cursor')+1]) if '--cursor' in args else 0
        print(json.dumps({'success':True, 'comments':rows[offset:offset+100], 'total':len(rows), 'nextCursor':str(offset+100) if offset+100<len(rows) else None}))
    elif args[:2] == ['activity', 'last']:
        if data.get('activity_error'): sys.exit(1)
        print(data.get('activity', ''))
    else:
        raise AssertionError('board write or unexpected read: ' + str(args))
else:
    raise AssertionError(name)
'''
    for path in (bin/'vcc', scripts/'ship-identity', scripts/'runner-deliver'):
        path.write_text(stub)
        path.chmod(0o755)
    env = dict(os.environ, HOME=str(home), PATH=str(bin)+':'+os.environ['PATH'],
               SWEEP_TEST_DIR=str(root), SHIP_SESSION_NAME='RUNNER 8', PYTHONDONTWRITEBYTECODE='1')
    now = time.time()
    def date(offset):
        return datetime.fromtimestamp(now + offset, timezone.utc).isoformat()
    def comment(id=1, text='<p>yes</p>', offset=-7200, agent=None, **extra):
        return dict(id=id, text=text, createdAt=date(offset), creatorId=6, agent=agent,
                    editedAt=None, reactions=[], **extra)
    def task(number=1, section='Valentin Review', **extra):
        return dict(ticketNumber=f'HTPR-{number}', uniqueIndex=number, section=section, **extra)
    base = dict(boards={'15':[task()], '4060':[]}, comments={'HTPR-1':[comment()]})
    state = home / '.local/state/ht-approved-sweep'
    def run(data=None, go=False, ok=True):
        (root/'fixture.json').write_text(json.dumps(data or base))
        (root/'calls').write_text('')
        result = subprocess.run([str(here/'ht-approved-sweep'), *(['--go'] if go else [])], env=env, text=True, capture_output=True)
        assert (result.returncode == 0) == ok, result.stdout + result.stderr
        calls = [json.loads(s) for s in (root/'calls').read_text().splitlines()]
        assert all(identity == 'RUNNER 8' for _, identity, _ in calls)
        return result.stdout + result.stderr, calls
    def listed(data):
        output, calls = run(data)
        assert 'HTPR-1 — https://' in output, output
        return calls
    def quiet(data):
        output, _ = run(data)
        assert 'HTPR-1 — https://' not in output and 'Approved sweep: 0' in output, output
    calls = listed(base)
    assert sum(args[:2] == ['task','list'] for name, _, args in calls) == 2
    assert not state.exists() and not (root/'deliveries').exists()
    print('ok plain yes listed; one list per board; dry run writes/sends nothing')
    thumbs = copy.deepcopy(base)
    thumbs['comments']['HTPR-1'] = [comment(text='<p>Question: <strong>Proceed?</strong></p>', offset=-10000,
        agent={'id':'runner','displayName':'Runner 8'})]
    thumbs['comments']['HTPR-1'][0]['reactions'] = [dict(userId=6, emoji='👍', createdAt=date(-7200))]
    listed(thumbs)
    print('ok thumbs up on Question listed')
    no_question = copy.deepcopy(thumbs)
    no_question['comments']['HTPR-1'][0]['text'] = 'status update'
    quiet(no_question)
    for metadata in ({'agent':{'id':'runner'}}, {'agent_display_name':'Runner 8'}, {'isAgent':True}):
        data = copy.deepcopy(thumbs)
        data['comments']['HTPR-1'][0]['reactions'][0].update(metadata)
        quiet(data)
    print('ok non-Question and agent thumbs up ignored')
    recent = copy.deepcopy(thumbs)
    recent['comments']['HTPR-1'][0]['reactions'][0]['createdAt'] = date(-100)
    quiet(recent)
    recent['comments']['HTPR-1'][0]['reactions'][0]['createdAt'] = date(-7200)
    recent['comments']['HTPR-1'].append(comment(2, 'no', -3600))
    quiet(recent)
    other = copy.deepcopy(base)
    other['comments']['HTPR-1'][0]['creatorId'] = 7
    quiet(other)
    print('ok reaction clock, withdrawal after thumbs up, other human yes ignored')
    for offset, expected in ((-3600, quiet), (-10000, listed)):
        data = copy.deepcopy(base)
        data['comments']['HTPR-1'].append(comment(2, '<p><strong>Claimed.</strong> Next: work', offset, agent={'id':'runner'}))
        expected(data)
    print('ok claim after yes quiet; claim before yes listed')
    data = copy.deepcopy(base)
    data['comments']['HTPR-1'].append(comment(2, 'no, stop', -3600))
    quiet(data)
    data['comments']['HTPR-1'].append(comment(3, 'yes please', -1800))
    quiet(data)
    data['comments']['HTPR-1'][-1]['createdAt'] = date(-3700)
    data['comments']['HTPR-1'][1]['createdAt'] = date(-5000)
    listed(data)
    print('ok later no withdraws; later yes starts a fresh one-hour clock')
    for data in (dict(boards=base['boards'], comments={'HTPR-1':[comment(offset=-100)]}),
                 dict(boards=base['boards'], comments={'HTPR-1':[comment(agent={'id':'runner'})]}),
                 dict(boards=base['boards'], comments={'HTPR-1':[comment(editedBy={'userId':6})]})):
        quiet(data)
    print('ok under one hour, agent yes, edited yes quiet')
    for section in ('Done','In Progress'):
        data = copy.deepcopy(base)
        data['boards']['15'][0]['section'] = section
        output, calls = run(data)
        assert 'Approved sweep: 0' in output
        assert not any(args[:2] == ['comments','list'] for _,_,args in calls)
    data = copy.deepcopy(base)
    data['comments']['HTPR-1'].append(comment(2, '', -3600, agent={'id':'runner'}, type='activity'))
    quiet(data)
    quiet(dict(base, activity=date(-3600)+'\tRunner 8'))
    listed(dict(base, activity=date(-10000)+'\tRunner 8'))
    print('ok Done/In Progress skipped before comments; post-approval agent activity quiet')
    data = copy.deepcopy(base)
    data['boards']['15'] += [task(n, 'Done') for n in range(2,102)]
    calls = listed(data)
    assert sum(args[:2] == ['task','list'] for _,_,args in calls) == 3
    run(dict(data, incomplete=True), ok=False)
    data = copy.deepcopy(base)
    data['comments']['HTPR-1'] += [comment(n, 'status', -10000) for n in range(2,103)]
    listed(data)
    print('ok minimum board/comment pagination; incomplete list fails closed')
    data = copy.deepcopy(base)
    data['boards'] = {'15':[], '4060':[dict(task(), ticketNumber='YPER4-1')]}
    data['comments'] = {'YPER4-1':[comment()]}
    output,_ = run(data)
    assert 'https://app.hypertask.ai/detail/project-4060/1#comment-1' in output
    print('ok board 4060 scanned and approval link included')
    run(dict(base, identity='Valentins Claude Code'), ok=False)
    run(dict(base, activity_error=True), go=True, ok=False)
    assert not (root/'deliveries').exists()
    run(dict(base, delivery_exit=1), go=True, ok=False)
    assert not (state/'reported.json').exists()
    output,_ = run(dict(base, delivery_exit=3), go=True)
    deliveries = [json.loads(s) for s in (root/'deliveries').read_text().splitlines()]
    assert len(deliveries) == 2 and deliveries[0]['id'] == deliveries[1]['id']
    assert '#comment-1' in deliveries[-1]['message']
    quiet(base)
    run(base, go=True)
    assert len((root/'deliveries').read_text().splitlines()) == 2
    print('ok no fallback login; failed reads/delivery do not mark reported; durable queue deduplicated')
    data = copy.deepcopy(base)
    data['comments']['HTPR-1'].append(comment(2, 'yes please', -4000))
    listed(data)
    run(data, go=True)
    quiet(data)
    assert len((root/'deliveries').read_text().splitlines()) == 3
    print('ok a new approval reports once independently; successful direct delivery deduplicated')
    shared = subprocess.run(['node','-e', '''const assert = require('node:assert/strict');
const { classifyAnswer } = require(process.argv[1]);
for (const word of ['yes','yep','okay','approved','go ahead','ship it']) assert.equal(classifyAnswer(word),'yes');
for (const word of ['no','do not','hold','👎']) assert.equal(classifyAnswer(word),'no');
for (const word of ['yes but wait','yes?','Good to go','yes, broken']) assert.equal(classifyAnswer(word),'unclear');
''', str(here/'approval-answer.cjs')], text=True, capture_output=True)
    assert shared.returncode == 0, shared.stderr
    approval_words = (here/'../../../../src/lib/flags/approvalWords.ts').resolve().read_text()
    assert 'export { classifyAnswer } from "../../../../.claude/skills/ship/scripts/approval-answer.cjs"' in approval_words
    assert 'function classifyAnswer' not in approval_words
    print('ok HTPR-7727 classifier shared, not duplicated; ambiguous answers remain unclear')
    service = (here/'ht-approved-sweep.service').read_text()
    timer = (here/'ht-approved-sweep.timer').read_text()
    assert 'ht-approved-sweep --go' in service and 'SHIP_SESSION_NAME=RUNNER 8' in service
    assert 'OnCalendar=hourly' in timer and 'Persistent=true' in timer
    check = subprocess.run(['systemd-analyze','--user','--recursive-errors=no','verify',str(here/'ht-approved-sweep.service'),str(here/'ht-approved-sweep.timer')], text=True, capture_output=True)
    assert check.returncode == 0, check.stdout+check.stderr
    print('ok hourly persistent units verified without install/start')
print('approved sweep tests passed')
PY
