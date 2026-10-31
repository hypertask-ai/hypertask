#!/usr/bin/env python3
import json
import os
import re
from pathlib import Path
import sys

from runner_domains import LEASE_DOMAINS, SHARED, conflicts, label_domain

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

for leases in owners.values():
    for ticket, lease in leases.items():
        if isinstance(lease, str):
            lease = {'held': [lease], 'current': lease, 'pending': False}
            leases[ticket] = lease
        if (not isinstance(ticket, str) or not isinstance(lease, dict)
                or not isinstance(lease.get('held'), list) or not lease['held']
                or any(d not in LEASE_DOMAINS for d in lease['held'])
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
        lease = owners.setdefault(slot, {}).setdefault(ticket, {'held': [SHARED], 'current': SHARED, 'pending': True})
        if item.get('delivered') is True:
            lease['protected'] = True
            if lease['pending'] and 'acquired' not in lease:
                lease['acquired'] = lease['held'][:]

name = 'Runner ' + runner
tasks = {t['ticketNumber']: t for t in data['tasks'] if t.get('ticketNumber')}
terminal = {'Done', 'Archive', 'Archived', 'Flag: Everyone', 'Flag: Only Me + QA'}
def assigned(task):
    return any((a.get('agent') or {}).get('displayName', '').casefold() == name.casefold() for a in task.get('assignees', []))

def domain(task):
    return label_domain(task.get('labels') or [])

mine = owners.get(runner, {})
mine = {ticket: lease for ticket, lease in mine.items() if ticket not in tasks or (
    tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal
    and (assigned(tasks[ticket]) or (lease.get('admission') is True and not any(
        re.fullmatch(r'Runner [1-9][0-9]*', (a.get('agent') or {}).get('displayName', ''), re.I)
        for a in tasks[ticket].get('assignees', [])))))}
for ticket, lease in mine.items():
    if ticket in tasks and assigned(tasks[ticket]):
        lease.pop('admission', None)
other = {d for owner, leases in owners.items() if owner != runner for lease in leases.values() for d in lease['held']}

def contested(domains, scopes):
    return any(conflicts(d, scope) for d in domains for scope in scopes)

def import_task(ticket):
    d = domain(tasks[ticket])
    mine.setdefault(ticket, {'held': [d], 'current': d, 'pending': contested([d], other)})

for item in data['previous']:
    ticket = item.get('ticket')
    if ticket in tasks and assigned(tasks[ticket]) and tasks[ticket].get('section') not in terminal and tasks[ticket].get('status') not in terminal:
        mine.setdefault(ticket, {'held': [SHARED], 'current': SHARED, 'pending': contested([SHARED], other)})
for ticket, task in tasks.items():
    if task.get('projectId') in (15, 4060) and assigned(task) and task.get('status') not in terminal and task.get('section') in ('In Progress', 'QA', 'AI Review', 'Review', 'Valentin Review'):
        import_task(ticket)

for ticket, lease in mine.items():
    if ticket not in tasks:
        continue
    task = tasks[ticket]
    d = domain(task)
    previous = next((item for item in data['previous'] if item.get('ticket') == ticket), None)
    if task.get('section') in ('In Progress', 'QA', 'AI Review', 'Review', 'Valentin Review'):
        lease['protected'] = True
        if lease['pending'] and 'acquired' not in lease:
            lease['acquired'] = lease['held'][:]
    if previous is not None:
        lease['envelope'] = previous
        lease['undelivered'] = previous.get('delivered') is False and task.get('section') == 'Todo'
    if lease.get('protected'):
        lease['undelivered'] = False
    if d != lease['current']:
        if not lease['pending']:
            lease['acquired'] = lease['held'][:]
        lease['current'] = d
        if d not in lease['held']:
            lease['held'].append(d)
        lease['pending'] = contested(lease['held'], other)
    if lease['pending']:
        if lease.get('undelivered') and lease.get('acquired') and any(
                (owner < runner or not other_lease.get('undelivered'))
                and other_lease['pending'] and other_lease.get('acquired')
                and contested(lease['held'], other_lease['held'])
                for owner, leases in owners.items() if owner != runner for other_lease in leases.values()):
            lease['acquired'] = []
        priority = {d for owner, leases in owners.items() if owner != runner for other_lease in leases.values()
                    for d in (other_lease['held'] if not other_lease['pending'] else other_lease.get('acquired', []))}
        requested = {d for owner, leases in owners.items() if owner != runner for other_lease in leases.values()
                     if other_lease['pending'] and bool(other_lease.get('acquired')) == bool(lease.get('acquired')) and owner < runner
                     for d in other_lease['held'] if d not in other_lease.get('acquired', [])}
        if not any(contested([scope], priority) or (scope not in lease.get('acquired', []) and contested([scope], requested))
                   for scope in lease['held']):
            lease['pending'] = False
            lease['acquired'] = lease['held'][:]

held = {d for lease in mine.values() for d in lease['held']}
admitted_other = {d for owner, leases in owners.items() if owner != runner for lease in leases.values()
                  for d in (lease['held'] if not lease['pending'] else lease.get('acquired', []))}
accepted = []
for item in data['candidates']:
    ticket = item['ticket']
    if tasks[ticket].get('section') in terminal or tasks[ticket].get('status') in terminal:
        continue
    if any(ticket in leases for owner, leases in owners.items() if owner != runner):
        continue
    d = domain(tasks[ticket])
    if ticket in mine:
        if not mine[ticket]['pending'] and not contested(mine[ticket]['held'], admitted_other):
            accepted.append({**item, '_pickupPrevious': mine[ticket].get('envelope')})
    elif not any(lease['pending'] for lease in mine.values()) and (not held or held == {d}) and not contested([d], other):
        mine[ticket] = {'held': [d], 'current': d, 'pending': False}
        held.add(d)
        accepted.append(item)
for lease in mine.values():
    if not lease['pending']:
        lease.pop('envelope', None)
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
