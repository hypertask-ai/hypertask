#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

state = Path(sys.argv[1])
runner = sys.argv[2]
data = json.load(sys.stdin)
path = state / 'domain-ownership.json'
if path.exists():
    owners = json.loads(path.read_text())
    if not isinstance(owners, dict) or any(not isinstance(v, dict) for v in owners.values()):
        raise ValueError('invalid domain ownership')
else:
    owners = {}

valid_domains = {'Commands', 'Flags', 'Search', 'Prompts', 'Parity', 'Shipping', 'Shared'}
if any(not isinstance(ticket, str) or d not in valid_domains for leases in owners.values() for ticket, d in leases.items()):
    raise ValueError('invalid domain lease')
for inbox in state.glob('runner-*.json'):
    slot = inbox.name.removeprefix('runner-').removesuffix('.json')
    if not slot.isdigit() or slot == runner:
        continue
    queued = json.loads(inbox.read_text()).get('items', [])
    if not isinstance(queued, list):
        raise ValueError('invalid runner inbox')
    for item in queued:
        ticket = item.get('ticket')
        if not isinstance(ticket, str):
            raise ValueError('invalid queued ticket')
        owners.setdefault(slot, {}).setdefault(ticket, 'Shared')

name = 'Runner ' + runner
tasks = {t['ticketNumber']: t for t in data['tasks'] if t.get('ticketNumber')}
terminal = {'Done', 'Archive', 'Archived'}
def assigned(task):
    return any((a.get('agent') or {}).get('displayName') == name for a in task.get('assignees', []))

def domain(task):
    found = {label.get('name', label.get('value')) for label in (task.get('labels') or []) if isinstance(label, dict)}
    choices = [d for d in ('Commands', 'Flags', 'Search', 'Prompts', 'Parity', 'Shipping') if 'Domain: ' + d in found]
    return choices[0] if len(choices) == 1 else 'Shared'

mine = owners.get(runner, {})
mine = {ticket: d for ticket, d in mine.items() if ticket not in tasks or (assigned(tasks[ticket]) and tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal)}
for item in data['previous']:
    ticket = item.get('ticket')
    if ticket in tasks and assigned(tasks[ticket]) and tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal:
        mine.setdefault(ticket, domain(tasks[ticket]))
for ticket, task in tasks.items():
    if task.get('projectId') in (15, 4060) and assigned(task) and task.get('status') not in terminal and task.get('section') in ('In Progress', 'QA', 'AI Review', 'Review', 'Valentin Review'):
        mine.setdefault(ticket, domain(task))

other = {d for owner, leases in owners.items() if owner != runner for d in leases.values()}
held = set(mine.values())
accepted = []
for item in data['candidates']:
    ticket = item['ticket']
    d = mine.get(ticket, domain(tasks[ticket]))
    if ticket in mine:
        accepted.append(item)
    elif (not held or held == {d}) and not (other and (d == 'Shared' or 'Shared' in other or d in other)):
        mine[ticket] = d
        held.add(d)
        accepted.append(item)
if mine:
    owners[runner] = mine
else:
    owners.pop(runner, None)
tmp = path.with_name(path.name + '.' + str(os.getpid()))
try:
    tmp.write_text(json.dumps(owners, sort_keys=True) + '\n')
    os.replace(tmp, path)
finally:
    tmp.unlink(missing_ok=True)
json.dump(accepted, sys.stdout)
