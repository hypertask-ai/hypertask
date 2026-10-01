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
if name == 'date':
    if args == ['-u', '+%s']: print('1790856000')
    else: sys.exit(subprocess.call(['/usr/bin/date']+args))
elif name == 'gh':
    assert args[:2] == ['api','graphql'], args
    print(json.dumps(dict(data=dict(repository=dict(pullRequests=dict(nodes=f['prs'],pageInfo=dict(hasNextPage=False)))))))
elif name == 'hypertask':
    if args[:2] == ['sections','list']:
        print(json.dumps(dict(success=True,sections=[dict(section_title=s) for s in f.get('sections',['AI Review','QA','In Progress'])])))
    elif args[:2] == ['tasks','list']:
        col = args[args.index('--section')+1]
        tasks = [t for t in f['tasks'] if t['section']==col]
        print(json.dumps(dict(success=True,tasks=tasks,total=len(tasks)+f.get('extra',0))))
    elif args[:2] == ['tasks','get']:
        print(json.dumps(dict(success=True,tasks=[t for t in f['tasks'] if t['ticketNumber']==args[2]])))
    elif args[:2] == ['comment','list']:
        print(json.dumps(dict(success=True,comments=f['comments'][args[2]])))
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
        for name in ['gh','hypertask','vcc','date']: (p/name).symlink_to('mock')
        (p/'fixture').write_text(json.dumps(f))
        env = dict(os.environ, PATH=tmp+':'+os.environ['PATH'], FIXTURE=str(p/'fixture'), CALLS=str(p/'calls'))
        result = subprocess.run(['bash',script],env=env,text=True,capture_output=True)
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
assert lines[0][-1] == 'move back to Bugs'
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
assert r.returncode != 0 and 'list incomplete' in r.stderr
f['extra'] = 0; f['sections'] = ['QA','In Progress']
r, _ = run(f)
assert r.returncode != 0 and 'no column named AI Review' in r.stderr
print('ok auth failures, missing columns and truncated lists fail closed')
f = dict(tasks=[task(n, 'AI Review' if n <= 51 else 'QA') for n in range(1,102)],
         comments={},activities={},prs=[])
r, calls = run(f)
assert r.returncode != 0 and 'over 100 distinct tickets' in r.stderr
assert not any(c[:3] == ['hypertask','comment','list'] for c in calls)
f = dict(tasks=[task(1)],comments={'HTPR-1':[comment(agent=None)]*100},activities={},prs=[])
r, _ = run(f)
assert r.returncode != 0 and 'outside the bounded comment read' in r.stderr
print('ok scan budget and potentially hidden older claims fail closed')
print('BOARD CHECK VERIFIED')
PY
