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
for leases in owners.values():
    for ticket, lease in leases.items():
        if isinstance(lease, str):
            lease = {'held': [lease], 'current': lease, 'pending': False}
            leases[ticket] = lease
        if (not isinstance(ticket, str) or not isinstance(lease, dict)
                or not isinstance(lease.get('held'), list) or not lease['held']
                or any(d not in valid_domains for d in lease['held'])
                or lease.get('current') not in lease['held']
                or not isinstance(lease.get('pending'), bool)
                or ('acquired' in lease and (not isinstance(lease['acquired'], list)
                    or any(d not in lease['held'] for d in lease['acquired'])))):
            raise ValueError('invalid domain lease')
for inbox in state.glob('runner-*.json'):
    slot = inbox.name.removeprefix('runner-').removesuffix('.json')
    if not slot.isdigit():
        continue
    queued = json.loads(inbox.read_text()).get('items', [])
    if not isinstance(queued, list):
        raise ValueError('invalid runner inbox')
    for item in queued:
        ticket = item.get('ticket')
        if not isinstance(ticket, str):
            raise ValueError('invalid queued ticket')
        owners.setdefault(slot, {}).setdefault(ticket, {'held': ['Shared'], 'current': 'Shared', 'pending': True})

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
mine = {ticket: lease for ticket, lease in mine.items() if ticket not in tasks or (assigned(tasks[ticket]) and tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal)}
other = {d for owner, leases in owners.items() if owner != runner for lease in leases.values() for d in lease['held']}
priority = {d for owner, leases in owners.items() if owner != runner for lease in leases.values()
            for d in (lease['held'] if not lease['pending'] or owner < runner else lease.get('acquired', []))}

def conflicts(d, scopes):
    return bool(scopes) and (d == 'Shared' or 'Shared' in scopes or d in scopes)

def import_task(ticket):
    d = domain(tasks[ticket])
    mine.setdefault(ticket, {'held': [d], 'current': d, 'pending': conflicts(d, other)})

for item in data['previous']:
    ticket = item.get('ticket')
    if ticket in tasks and assigned(tasks[ticket]) and tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal:
        mine.setdefault(ticket, {'held': ['Shared'], 'current': 'Shared', 'pending': conflicts('Shared', other)})
for ticket, task in tasks.items():
    if task.get('projectId') in (15, 4060) and assigned(task) and task.get('status') not in terminal and task.get('section') in ('In Progress', 'QA', 'AI Review', 'Review', 'Valentin Review'):
        import_task(ticket)

for ticket, lease in mine.items():
    if ticket not in tasks:
        continue
    d = domain(tasks[ticket])
    if d != lease['current']:
        if not lease['pending']:
            lease['acquired'] = lease['held'][:]
        lease['current'] = d
        if d not in lease['held']:
            lease['held'].append(d)
        lease['pending'] = any(conflicts(scope, other) for scope in lease['held'])
    if lease['pending'] and not any(conflicts(scope, priority) for scope in lease['held']):
        lease['pending'] = False

held = {d for lease in mine.values() for d in lease['held']}
accepted = []
for item in data['candidates']:
    ticket = item['ticket']
    d = domain(tasks[ticket])
    if ticket in mine:
        if not mine[ticket]['pending']:
            accepted.append(item)
    elif not any(lease['pending'] for lease in mine.values()) and (not held or held == {d}) and not conflicts(d, other):
        mine[ticket] = {'held': [d], 'current': d, 'pending': False}
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
