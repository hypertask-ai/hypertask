#!/usr/bin/env python3
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

DOMAINS = {'Commands', 'Flags', 'Search', 'Prompts', 'Parity', 'Shipping'}
ACTIVE = {'In Progress', 'QA', 'AI Review', 'Review', 'Valentin Review', 'UX Sign-off', 'Flag: Off'}
TERMINAL = {'Done', 'Archive', 'Archived', 'Flag: Everyone', 'Flag: Only Me + QA'}


def read(*args):
    result = subprocess.run([os.environ.get('SHIP_CLAIM_HYPERTASK', 'hypertask'), *args],
                            capture_output=True, text=True, check=True, timeout=60)
    return json.loads(result.stdout)


def validate(task, project=None):
    if (not isinstance(task, dict) or not isinstance(task.get('ticketNumber'), str)
            or not re.fullmatch(r'(HTPR|HYFA|YPER4)-[0-9]+', task['ticketNumber'])
            or type(task.get('projectId')) is not int or task['projectId'] not in (15, 4060)
            or (project is not None and task['projectId'] != project)
            or not isinstance(task.get('section'), str) or not task['section']
            or not isinstance(task.get('labels'), list) or not isinstance(task.get('assignees'), list)
            or any(not isinstance(x, dict) or not isinstance(x.get('name', x.get('value')), str) for x in task['labels'])
            or any(not isinstance(x, dict) or ('agent' in x and x['agent'] is not None and
                   (not isinstance(x['agent'], dict) or not isinstance(x['agent'].get('displayName'), str)))
                   for x in task['assignees'])):
        raise ValueError('invalid task fields')
    return task


def domain(task):
    found = {x.get('name', x.get('value'))[8:] for x in task['labels']
             if x.get('name', x.get('value')).startswith('Domain: ')} & DOMAINS
    return next(iter(found)) if len(found) == 1 else 'Shared'


def conflict(a, b):
    return a == b or 'Shared' in (a, b)


def main():
    if len(sys.argv) != 3 or not re.fullmatch(r'[1-9][0-9]*', sys.argv[1]) or not re.fullmatch(r'(HTPR|HYFA|YPER4)-[0-9]+', sys.argv[2]):
        raise ValueError('usage: runner-domain-admit.py RUNNER TICKET')
    runner, ticket = sys.argv[1:]
    state = Path(os.environ.get('RUNNER_INBOX_DIR', str(Path.home() / '.local/state/runner-inbox')))
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'domain-ownership.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        tasks = {}
        for project in (15, 4060):
            offset, expected = 0, None
            while True:
                page = read('tasks', 'list', '--project', str(project), '--limit', '100', '--offset', str(offset), '--json')
                if (not isinstance(page, dict) or page.get('success') is not True or type(page.get('total')) is not int
                        or page['total'] < 0 or not isinstance(page.get('tasks'), list) or len(page['tasks']) > 100
                        or (page.get('nextCursor') is not None and not isinstance(page['nextCursor'], str))):
                    raise ValueError('invalid board page')
                if expected is None:
                    expected = page['total']
                if page['total'] != expected or offset + len(page['tasks']) > expected:
                    raise ValueError('board total changed')
                for task in page['tasks']:
                    validate(task, project)
                    if task['ticketNumber'] in tasks:
                        raise ValueError('duplicate ticket')
                    tasks[task['ticketNumber']] = task
                offset += len(page['tasks'])
                if offset == expected:
                    break
                if not page['tasks']:
                    raise ValueError('incomplete board page')
        if ticket not in tasks:
            detail = read('tasks', 'get', ticket, '--json')
            if not isinstance(detail, dict) or detail.get('success') is not True or not isinstance(detail.get('tasks'), list) or len(detail['tasks']) != 1:
                raise ValueError('invalid task detail')
            task = validate(detail['tasks'][0])
            if task['ticketNumber'] != ticket:
                raise ValueError('wrong task detail')
            tasks[ticket] = task
        path = state / 'domain-ownership.json'
        owners = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(owners, dict):
            raise ValueError('invalid ownership')
        for slot, leases in owners.items():
            if not isinstance(slot, str) or not slot.isdigit() or not isinstance(leases, dict):
                raise ValueError('invalid ownership')
            for key, lease in leases.items():
                if isinstance(lease, str):
                    lease = leases[key] = {'held': [lease], 'current': lease, 'pending': False}
                if (not isinstance(key, str) or not isinstance(lease, dict) or not isinstance(lease.get('held'), list)
                        or not lease['held'] or any(d not in DOMAINS | {'Shared'} for d in lease['held'])
                        or lease.get('current') not in lease['held'] or type(lease.get('pending')) is not bool):
                    raise ValueError('invalid lease')
        for inbox in state.glob('runner-*.json'):
            match = re.fullmatch(r'runner-([0-9]+)\.json', inbox.name)
            if not match:
                continue
            data = json.loads(inbox.read_text())
            if not isinstance(data, dict) or not isinstance(data.get('items'), list):
                raise ValueError('invalid inbox')
            for item in data['items']:
                if not isinstance(item, dict) or not isinstance(item.get('ticket'), str):
                    raise ValueError('invalid inbox item')
                owners.setdefault(match[1], {}).setdefault(item['ticket'], {'held': ['Shared'], 'current': 'Shared', 'pending': True, 'protected': True})
        for slot, leases in list(owners.items()):
            for key, lease in list(leases.items()):
                task = tasks.get(key)
                if task is None:
                    try:
                        detail = read('tasks', 'get', key, '--json')
                        if (not isinstance(detail, dict) or detail.get('success') is not True
                                or not isinstance(detail.get('tasks'), list) or len(detail['tasks']) != 1):
                            continue
                        task = validate(detail['tasks'][0])
                        if task['ticketNumber'] != key:
                            continue
                        tasks[key] = task
                    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
                        continue
                names = [(a.get('agent') or {}).get('displayName', '') for a in task['assignees']]
                own = any(name.casefold() == ('runner ' + slot).casefold() for name in names)
                terminal = task['section'] in TERMINAL or task.get('status') in TERMINAL
                if terminal or (not own and (not lease.get('admission') or any(
                        re.fullmatch(r'Runner [1-9][0-9]*', name, re.I) for name in names))):
                    del leases[key]
                elif own:
                    lease.pop('admission', None)
            if not leases:
                del owners[slot]
        for task in tasks.values():
            if task['section'] not in ACTIVE or task.get('status') in TERMINAL:
                continue
            for assignee in task['assignees']:
                name = (assignee.get('agent') or {}).get('displayName', '')
                match = re.fullmatch(r'Runner ([1-9][0-9]*)', name, re.I)
                if not match:
                    continue
                leases = owners.setdefault(match[1], {})
                d = domain(task)
                lease = leases.setdefault(task['ticketNumber'], {'held': [d], 'current': d, 'pending': False})
                if d != lease['current']:
                    lease.setdefault('acquired', lease['held'][:])
                    if d not in lease['held']:
                        lease['held'].append(d)
                    lease['current'] = d
                    lease['pending'] = True
                lease['protected'] = True
                lease.pop('admission', None)
        mine = owners.setdefault(runner, {})
        d = domain(tasks[ticket])
        existing = mine.get(ticket)
        scopes = set(existing['held']) if existing else set()
        scopes.add(d)
        others = [(slot, key, lease) for slot, leases in owners.items() if slot != runner for key, lease in leases.items()]
        cross = [(slot, key) for slot, key, lease in others if any(
            conflict(a, b) for a in scopes
            for b in (lease.get('acquired', []) if existing and not existing.get('admission') and lease['pending'] else lease['held']))]
        all_leases = [(slot, key, lease) for slot, leases in owners.items() for key, lease in leases.items()]
        conflicts = [(a, b) for i, a in enumerate(all_leases) for b in all_leases[i + 1:]
                     if a[0] != b[0] and any(conflict(x, y) for x in a[2]['held'] for y in b[2]['held'])]
        if conflicts:
            print('runner-domain-admit: existing conflicts: ' + ', '.join(
                f'Runner {a[0]} {a[1]} / Runner {b[0]} {b[1]}' for a, b in conflicts), file=sys.stderr)
        if existing and d != existing['current']:
            existing.setdefault('acquired', existing['held'][:])
            if d not in existing['held']:
                existing['held'].append(d)
            existing['current'] = d
            existing['pending'] = True
        blocked = cross or any(lease['pending'] for lease in mine.values()) or (not existing and len({s for lease in mine.values() for s in lease['held']} | scopes) > 1)
        if tasks[ticket]['section'] in TERMINAL or tasks[ticket].get('status') in TERMINAL:
            blocked = True
        assigned = [(a.get('agent') or {}).get('displayName', '') for a in tasks[ticket]['assignees']]
        if any(re.fullmatch(r'Runner [1-9][0-9]*', name, re.I) and name.casefold() != ('runner ' + runner).casefold() for name in assigned):
            blocked = True
        if not blocked:
            lease = mine.setdefault(ticket, {'held': [d], 'current': d, 'pending': False})
            if d not in lease['held']:
                lease['held'].append(d)
            lease.update(current=d, protected=True)
            if any(name.casefold() == ('runner ' + runner).casefold() for name in assigned):
                lease.pop('admission', None)
            else:
                lease['admission'] = True
        if not mine:
            owners.pop(runner, None)
        tmp = path.with_name(path.name + '.' + str(os.getpid()))
        try:
            tmp.write_text(json.dumps(owners, sort_keys=True) + '\n')
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
        if blocked:
            raise ValueError('domain admission held' + (': ' + ', '.join(f'Runner {s} {t}' for s, t in cross) if cross else ''))
        print(json.dumps({'held': [key for key, task in tasks.items() if task['section'] in ACTIVE
                                   and any((a.get('agent') or {}).get('displayName', '').casefold() == ('runner ' + runner).casefold()
                                           for a in task['assignees'])]}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'runner-domain-admit: {error}', file=sys.stderr)
        sys.exit(1)
