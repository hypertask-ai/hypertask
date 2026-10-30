#!/usr/bin/env bash
# Isolated read-only fixtures; no production calls.
set -euo pipefail
python3 - "$(dirname "$0")/board-check" <<'PY'
import collections
import datetime
import json
import os
import pathlib
import subprocess
import sys
import tempfile

script = str(pathlib.Path(sys.argv[1]).resolve())
now = datetime.datetime(2026, 10, 1, 12, tzinfo=datetime.timezone.utc)
def iso(hours):
    return (now - datetime.timedelta(hours=hours)).isoformat().replace('+00:00', 'Z')
def task(n, section='AI Review', labels=()):
    return dict(id=100+n, ticketNumber=f'HTPR-{n}', uniqueIndex=n, projectId=15,
                title=f'Full title {n} with spaces', section=section,
                labels=[dict(name=s) for s in labels])
def comment(hours=8, text='Claimed. claude --resume session-123', agent='Agent One'):
    row = dict(createdAt=iso(hours), text=f'<p>{text}</p>')
    if agent:
        row['agent'] = dict(id=agent, displayName=agent)
    return row
def pr(n, ticket, hours):
    return dict(number=n, title=f'{ticket} [BUGFIX] Complete PR title {n}', body='',
                url=f'https://github.com/hypertask-ai/hypertask/pull/{n}',
                commits=dict(nodes=[dict(commit=dict(committedDate=iso(hours)))]))

mock = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
f = json.loads(pathlib.Path(os.environ['FIXTURE']).read_text())
with open(os.environ['CALLS'], 'a') as out: out.write(json.dumps([name]+args+([os.environ.get('VCC_ACTIVITY_AGENT_ID','')] if name=='vcc' else []))+'\n')
if name == 'ship-identity':
    if f.get('identity_error'): sys.exit(1)
    print('RUNNER 12\t'+os.environ['RUNNER_TOKEN_FILE'])
elif name == 'ht':
    assert os.environ.get('HT_TOKEN') == 'runner-fixture-token'
    if '/agent-activity?' in args[1]:
        ticket = args[1].split('/')[3]
        offset = int(args[1].split('&offset=')[1]) if '&offset=' in args[1] else 0
        if f.get('repeat_log_page'): offset = 0
        print(json.dumps(dict(success=True, activities=f.get('logs', {}).get(ticket, [])[offset:offset+100])))
        sys.exit(0)
    assert args[:1] == ['GET'] and args[1].startswith('/mcp/tasks?ticket_number=')
    tickets = args[1].split('ticket_number=')[1].split('&')[0].split(',')
    rows = [t for t in f['tasks'] if t['ticketNumber'] in tickets]
    if f.get('batch_missing'): rows = rows[:-1]
    print(json.dumps(dict(success=True,tasks=rows)))
elif name == 'date':
    if args == ['-u', '+%s']: print('1790856000')
    else: sys.exit(subprocess.call(['/usr/bin/date']+args))
elif name == 'gh':
    assert args[:2] == ['api','graphql'], args
    pages = [f['prs'][i:i+100] for i in range(0,len(f['prs']),100)] or [[]]
    for i, page in enumerate(pages if '--paginate' in args else pages[:1]):
        print(json.dumps(dict(data=dict(repository=dict(pullRequests=dict(nodes=page,pageInfo=dict(hasNextPage=f.get('pr_more', i<len(pages)-1))))))))
elif name == 'hypertask':
    assert os.environ.get('HYPERTASKS_JWT_TOKEN') == 'runner-fixture-token'
    if args[:2] == ['sections','list']:
        print(json.dumps(dict(success=True,sections=[dict(section_title=s) for s in f.get('sections',['AI Review','QA','In Progress'])])))
    elif args[:2] == ['tasks','list']:
        col = args[args.index('--section')+1]
        tasks = [t for t in f['tasks'] if t['section']==col]
        offset = int(args[args.index('--offset')+1]) if '--offset' in args else 0
        if f.get('repeat_page'): offset = 0
        page = tasks[offset:offset+100] if not f.get('empty_page') else []
        print(json.dumps(dict(success=True,tasks=page,total=len(tasks)+f.get('extra',0))))
    elif args[:2] == ['tasks','get']:
        print(json.dumps(dict(success=True,tasks=[t for t in f['tasks'] if t['ticketNumber']==args[2]])))
    elif args[:2] == ['comment','list']:
        rows = f['comments'][args[2]]
        size = int(args[args.index('--limit')+1]) if '--limit' in args else len(rows)
        start = int(args[args.index('--cursor')+1]) if '--cursor' in args else 0
        if f.get('repeat_cursor'): start = 0
        page = rows[start:start+size]
        more = start + size < len(rows)
        print(json.dumps(dict(success=True,comments=page,total=len(rows),
                              has_more=more,nextCursor=str(start+size) if more else None)))
    else: raise AssertionError('not a read: '+repr(args))
elif name == 'vcc':
    assert args[:2] == ['activity','last']
    if f.get('activity_error'):
        print('route unavailable',file=sys.stderr); sys.exit(f['activity_error'])
    if os.environ.get('VCC_ACTIVITY_AGENT_ID'):
        assert os.environ['VCC_ACTIVITY_AGENT_ID'] == 'Agent One'
        activity = f.get('claimed_activities',{}).get(args[2], f['activities'].get(args[2],''))
    else: activity = f['activities'].get(args[2],'')
    print(activity,end='')
'''

def run(f):
    with tempfile.TemporaryDirectory() as tmp:
        p = pathlib.Path(tmp)
        (p/'mock').write_text(mock); (p/'mock').chmod(0o755)
        for name in ['gh','hypertask','vcc','date','ship-identity','ht']: (p/name).symlink_to('mock')
        (p/'fixture').write_text(json.dumps(f))
        (p/'runner-token').write_text('' if f.get('empty_token') else 'runner-fixture-token')
        (p/'board-check').write_text(pathlib.Path(script).read_text())
        env = dict(os.environ, PATH=tmp+':'+os.environ['PATH'], FIXTURE=str(p/'fixture'), CALLS=str(p/'calls'), RUNNER_TOKEN_FILE=str(p/'runner-token'), HYPERTASKS_JWT_TOKEN='shared-human-fixture', HT_TOKEN='shared-human-fixture')
        result = subprocess.run(['bash',str(p/'board-check')],env=env,text=True,capture_output=True)
        calls = [json.loads(s) for s in (p/'calls').read_text().splitlines()]
        return result, calls

tasks = [task(1),task(2,labels=['BUG 🐛']),task(3,'QA',['FEATURE 💎']),task(4,'In Progress'),
         task(5),task(6),task(7),task(8),task(9),task(10),task(11),task(12)]
comments = {t['ticketNumber']:[comment()] for t in tasks}
comments['HTPR-3'] = [comment(text='Claimed. working without resume')]
comments['HTPR-4'] = [comment(agent=None)]
comments['HTPR-6'] = [comment(),comment(1,text='Claimed. newer claim without resume')]
comments['HTPR-9'] = [comment(text='Claimed. codex resume session-9')]
comments['HTPR-10'] = [comment(1)]
activities = {t['ticketNumber']:iso(1)+'\tAgent One\n' for t in tasks}
activities['HTPR-2'] = iso(8)+'\tAgent One\n'
activities['HTPR-5'] = iso(1)+'\tAgent Two\n'
activities['HTPR-7'] = iso(6)+'\tAgent One\n'
activities['HTPR-8'] = ''
activities['HTPR-10'] = ''
activities['HTPR-11'] = iso(1)+'\tAgent Two\n'
f = dict(tasks=tasks,comments=comments,activities=activities,
         claimed_activities={'HTPR-5':iso(8)+'\tAgent One\n',
                             'HTPR-11':iso(2)+'\tAgent One\n',
                             'HTPR-12':iso(8)+'\tAgent One\n'},
         prs=[pr(11,'HTPR-1',8),pr(12,'HTPR-2',8),pr(13,'HTPR-3',1),pr(14,'Unlinked',8)])
r, calls = run(f)
assert r.returncode == 0, r.stderr
lines = [s.split('\t') for s in r.stdout.splitlines()]
assert [s[0] for s in lines[:2]] == ['PR','PR'], r.stdout
# Recency decides (Valentin, 2026-10-01): any sign of life in the last 6 hours keeps a ticket off the list.
assert [s[1] for s in lines] == ['HTPR-2','-','HTPR-2','HTPR-7','HTPR-8'], r.stdout
assert lines[0][-1] == 'move back to Backlog'
assert lines[-1][-1] == 'ask Valentin'
assert lines[2][2] == 'Full title 2 with spaces'
assert lines[2][3] == 'https://app.hypertask.ai/detail/project-15/2'
assert lines[0][4] == '8h 0m' and lines[3][4] == '6h 0m', r.stdout
counts = collections.Counter(tuple(c[:2]) for c in calls)
assert counts[('gh','api')] == 1
assert sum(c[:3] == ['hypertask','tasks','list'] for c in calls) == 3
reads = [c[3] for c in calls if c[:3] == ['hypertask','comment','list']]
assert len(reads) == len(set(reads)) == len(tasks), calls
activity_reads = collections.Counter(c[3] for c in calls if c[:3] == ['vcc','activity','last'])
assert max(activity_reads.values()) <= 2
assert any(c[:4] == ['vcc','activity','last','HTPR-11'] and c[4] == 'Agent One' for c in calls)
assert '\tHTPR-11\t' not in r.stdout  # Another agent's newer activity does not hide a live claim.
assert all(c[:3] in (['hypertask','tasks','list'],['hypertask','tasks','get'],
                    ['hypertask','sections','list'],['hypertask','comment','list'])
           for c in calls if c[0]=='hypertask')
print('ok claimed-agent identity, newest claim, resume, boundary, no activity, output, ordering and call bounds')
log_fixture = dict(f, comments={**f['comments'], 'HTPR-11': []}, logs={'HTPR-11': [dict(
    id='claim-log', text='Claimed. Resume: tmux attach -t ht-hax-runner-8',
    createdAt=iso(1), agentId='Agent One', agentName='Agent One')]})
logged, _ = run(log_fixture)
assert logged.returncode == 0, logged.stderr
assert '\tHTPR-11\t' not in logged.stdout
print('ok direct agent-log tmux claim stays taken')
split_history = dict(tasks=[task(1)], prs=[], activities={},
    comments={'HTPR-1': [comment(agent=None, text='Human update')]*50},
    logs={'HTPR-1': [dict(id=f'log-{i}', text='Agent heartbeat', createdAt=iso(8),
                         agentId='Agent One', agentName='Agent One') for i in range(50)]})
checked, _ = run(split_history)
assert checked.returncode == 0, checked.stderr
assert '\tHTPR-1\t' in checked.stdout
split_history['logs']['HTPR-1'] = [dict(id=f'log-{i}', text='Agent heartbeat', createdAt=iso(8),
    agentId='Agent One', agentName='Agent One') for i in range(100)]
checked, _ = run(split_history)
assert checked.returncode == 0, checked.stderr
assert '\tHTPR-1\t' in checked.stdout
split_history['logs']['HTPR-1'].append(dict(id='old-claim', text='Claimed. Resume: tmux attach -t ht-hax-runner-8',
    createdAt=iso(8), agentId='Agent One', agentName='Agent One'))
split_history['activities']['HTPR-1'] = iso(1)+'\tAgent One\n'
checked, _ = run(split_history)
assert checked.returncode == 0, checked.stderr
assert '\tHTPR-1\t' not in checked.stdout
repeated, _ = run(dict(split_history, repeat_log_page=True))
assert repeated.returncode != 0 and 'repeated agent activity' in repeated.stderr
split_history['comments']['HTPR-1'] *= 2
split_history['logs']['HTPR-1'] = []
checked, calls = run(split_history)
assert checked.returncode == 0, checked.stderr
assert len([c for c in calls if c[:3] == ['hypertask','comment','list']]) == 1, calls
print('ok a full page of claim-free comments no longer fails the scan')



# Only the unavailable route activates fallback; comments alone cannot keep deployed claims alive.
f['activity_error'] = 4
comments['HTPR-1'] = [comment(1)]
r, _ = run(f)
assert r.returncode == 0, r.stderr
assert 'HTPR-1\t' not in r.stdout
assert '\tHTPR-3\t' not in r.stdout  # Recent PR commit counts as a sign of life.
assert '\tHTPR-2\t' in r.stdout  # Both signs are stale.
assert '\tHTPR-10\t' not in r.stdout  # Recent comment + valid resume.
assert r.stderr.count('temporary fallback') == 1
print('ok unavailable route fallback uses newest comment or PR commit, without waiving claim/resume')

f['activity_error'] = 1
r, _ = run(f)
assert r.returncode != 0 and 'cannot read activity' in r.stderr
f['activity_error'] = 4; f['extra'] = 1
r, _ = run(f)
assert r.returncode != 0 and 'no progress' in r.stderr
f['extra'] = 0; f['sections'] = ['QA','In Progress']
r, _ = run(f)
assert r.returncode != 0 and 'no column named AI Review' in r.stderr
print('ok auth failures, missing columns and truncated lists fail closed')
f = dict(tasks=[], comments={}, activities={}, prs=[], pr_more=True)
r, _ = run(f)
assert r.returncode != 0 and 'PR list incomplete' in r.stderr, r.stderr
print('ok incomplete PR pagination fails closed')
f = dict(tasks=[task(n, 'AI Review') for n in range(1,103)],
         comments={f'HTPR-{n}':[comment()] for n in range(1,103)},
         activities={'HTPR-102':iso(1)+'\tAgent One\n'},
         prs=[pr(n,f'HTPR-{n}',8) for n in range(1,103)])
r, calls = run(f)
assert r.returncode == 0, r.stderr
assert '\tHTPR-101\t' in r.stdout and '\tHTPR-102\t' not in r.stdout, r.stdout
reads = [c[3] for c in calls if c[:3] == ['hypertask','comment','list']]
assert len(reads) == len(set(reads)) == 102, reads
assert sum(c[:3] == ['hypertask','tasks','list'] for c in calls) == 4, calls
assert any(c[:3] == ['hypertask','tasks','list'] and '--offset' in c and c[c.index('--offset')+1]=='100' for c in calls)
print('ok paginated PRs and columns, late-page stale work, fresh claims and deduplicated reads')
f['repeat_page'] = True
r, calls = run(f)
assert r.returncode != 0 and 'changed while paging' in r.stderr, r.stderr
assert not any(c[:3] == ['hypertask','comment','list'] for c in calls)
print('ok overlapping column pages refuse misleading coverage')
f = dict(tasks=[task(n) for n in range(1,503)],
         comments={f'HTPR-{n}':[comment()] for n in range(1,503)},activities={},prs=[])
r, calls = run(f)
assert r.returncode != 0 and 'partial coverage: inspected 500 of 502 distinct tickets' in r.stderr, r.stderr
reads = [c[3] for c in calls if c[:3] == ['hypertask','comment','list']]
assert len(reads) == len(set(reads)) == 500, len(reads)
assert '\tHTPR-500\t' in r.stdout and '\tHTPR-501\t' not in r.stdout
print('ok bounded inspections retain the partial report and identify omitted coverage')
f = dict(tasks=[task(1)],comments={'HTPR-1':[comment(agent=None)]*100+[comment(9)]},activities={},prs=[])
r, calls = run(f)
assert r.returncode == 0, r.stderr
assert len([c for c in calls if c[:3] == ['hypertask','comment','list']]) == 2, calls
assert any('--cursor' in c for c in calls if c[:3] == ['hypertask','comment','list']), calls
print('ok older claims are found on later comment pages')
f = dict(tasks=[task(1)],comments={'HTPR-1':[comment(agent=None)]*175},activities={},prs=[])
r, calls = run(f)
assert r.returncode == 0, r.stderr
assert len([c for c in calls if c[:3] == ['hypertask','comment','list']]) == 2, calls
assert '\tHTPR-1\t' in r.stdout, r.stdout
print('ok a busy ticket without a claim is reported instead of failing the scan')
f = dict(tasks=[task(1)],comments={'HTPR-1':[comment(agent=None)]*300},activities={},prs=[],
         repeat_cursor=True)
r, _ = run(f)
assert r.returncode != 0 and 'comment paging made no progress' in r.stderr, r.stderr
print('ok a cursor that stops moving fails the scan')
f = dict(tasks=[task(1, 'Backlog'), task(2, 'Backlog')],
         comments={f'HTPR-{n}':[comment()] for n in [1,2]}, activities={},
         prs=[pr(n,f'HTPR-{n}',8) for n in [1,2]])
r, calls = run(f)
assert r.returncode == 0, r.stderr
assert sum(c[0] == 'ht' and c[2].startswith('/mcp/tasks?') for c in calls) == 1, calls
assert not any(c[:3] == ['hypertask','tasks','get'] for c in calls), calls
assert len(r.stdout.splitlines()) == 2, r.stdout
f = dict(tasks=[task(n, 'Backlog') for n in range(1,102)],
         comments={f'HTPR-{n}':[comment()] for n in range(1,102)}, activities={},
         prs=[pr(n,f'HTPR-{n}',8) for n in range(1,102)])
r, calls = run(f)
assert r.returncode == 0, r.stderr
assert sum(c[0] == 'ht' and c[2].startswith('/mcp/tasks?') for c in calls) == 2, calls
assert len(r.stdout.splitlines()) == 101, r.stdout
f['batch_missing'] = True
r, _ = run(f)
assert r.returncode != 0 and 'batch' in r.stderr and not r.stdout, r.stderr
f['batch_missing'] = False; f['identity_error'] = True
r, calls = run(f)
assert r.returncode != 0 and 'identity' in r.stderr, r.stderr
assert not any(c[0] in ['gh','hypertask','ht','vcc'] for c in calls), calls
f['identity_error'] = False; f['empty_token'] = True
r, calls = run(f)
assert r.returncode != 0 and 'credential is empty' in r.stderr, r.stderr
assert not any(c[0] in ['gh','hypertask','ht','vcc'] for c in calls), calls
print('ok runner-token isolation, one batched task read, incomplete batch and identity failures refuse shared-login fallback')
print('BOARD CHECK VERIFIED')
PY
