#!/usr/bin/env python3
"""Scan inventoried agent entries and enforce source-bound exceptions and call-bound debt."""
import csv
import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
TICKET_URL = re.compile(r'https://app\.hypertask\.ai/detail/project-\d+/\d+')
BOARD_DELEGATE = re.compile(rb'\bprisma\s*\.\s*(?:project|task|comment)\b')


def normalize(call):
    return re.sub(r'\s+', ' ', call).strip()


def finding(root, raw):
    source = (root / raw['path']).read_bytes()
    call = source[raw['start']['offset']:raw['end']['offset']].decode('utf-8')
    return dict(path=raw['path'], call=normalize(call), sha256=hashlib.sha256(source).hexdigest(), line=raw['start']['line'])


def key(entry):
    return (entry['path'], entry['call'], entry['occurrence'])


def read_entries(path, kind):
    entries = json.loads(path.read_text())
    if not isinstance(entries, list):
        raise ValueError(f'{kind} must be a JSON array')
    keys = set()
    for entry in entries:
        path = entry['path']
        if not path.startswith('src/') or '..' in Path(path).parts or '\\' in path:
            raise ValueError(f'Invalid {kind} path: {path}')
        if not entry['call'] or normalize(entry['call']) != entry['call']:
            raise ValueError(f'Invalid normalized call in {kind}: {path}')
        if type(entry['occurrence']) is not int or entry['occurrence'] < 1:
            raise ValueError(f'Invalid occurrence in {kind}: {path}')
        if key(entry) in keys:
            raise ValueError(f'Duplicate {kind}: {key(entry)}')
        keys.add(key(entry))
        if not TICKET_URL.fullmatch(entry.get('approvedIn', '')):
            raise ValueError(f'Invalid approvedIn in {kind}: {path}')
        if kind == 'exception':
            if not re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')) or not entry.get('reason', '').strip():
                raise ValueError(f'Exception needs complete file sha256 and reason: {path}')
        else:
            ticket = entry.get('ticket', '')
            if not TICKET_URL.fullmatch(ticket):
                raise ValueError(f'Debt needs a follow-up ticket: {path}')
            if not entry.get('owner', '').strip():
                raise ValueError(f'Debt needs an owner: {path}')
            if date.fromisoformat(entry['expires']) < date.today():
                raise ValueError(f'Expired debt: {path} ({entry["expires"]})')
    return entries


def check_findings(findings, exceptions, baseline):
    errors = []
    actual = {key(f): f for f in findings}
    excepted = set()
    debt = set()
    for entry in exceptions:
        identity = key(entry)
        if identity not in actual or actual[identity]['sha256'] != entry['sha256']:
            errors.append(f'Stale exception: {entry["path"]} occurrence={entry["occurrence"]}')
        else:
            excepted.add(identity)
    for entry in baseline:
        identity = key(entry)
        if identity in excepted:
            errors.append(f'Debt overlaps exception: {entry["path"]}')
        elif identity not in actual:
            errors.append(f'Stale debt: {entry["path"]} occurrence={entry["occurrence"]}')
        else:
            debt.add(identity)
    new = set(actual) - excepted - debt
    for identity in sorted(new):
        entry = actual[identity]
        errors.append(f'New unscoped query: {entry["path"]}:{entry["line"]}: {entry["call"]}')
    counts = dict(findings=len(findings), excepted=len(excepted), debt=len(debt), new=len(new))
    print('Agent scope: ' + ', '.join(f'{k}={v}' for k, v in counts.items()), flush=True)
    return counts, errors


def run_semgrep(root, targets, output):
    semgrep = os.environ.get('SEMGREP', 'semgrep')
    env = dict(os.environ, SEMGREP_SEND_METRICS='off', SEMGREP_ENABLE_VERSION_CHECK='0')
    version = subprocess.check_output([semgrep, '--version'], env=env, text=True).strip()
    if version != '1.140.0':
        raise ValueError(f'Expected Semgrep 1.140.0, got {version}')
    command = [semgrep, '--config', str(HERE / 'agent-scope.yml'), '--metrics', 'off',
               '--disable-version-check', '--no-git-ignore', '--disable-nosem', '--json',
               '--error', '--strict', '--jobs', str(min(os.cpu_count() or 1, 4)), '--max-memory', '512', *targets]
    result = subprocess.run(command, cwd=root, env=env, text=True, capture_output=True)
    (output / 'scan.raw.json').write_text(result.stdout)
    (output / 'scan.stderr.log').write_text(result.stderr)
    payload = json.loads(result.stdout)
    if payload.get('errors'):
        raise ValueError(f'Semgrep parser/engine errors: {payload["errors"]}')
    if result.returncode not in (0, 1):
        raise ValueError(f'Semgrep exited {result.returncode}: {result.stderr}')
    missing = set(targets) - set(payload['paths']['scanned'])
    if missing:
        raise ValueError(f'Unscanned agent-capable targets: {sorted(missing)}')
    occurrences = Counter()
    findings = []
    for raw in sorted(payload['results'], key=lambda r: (r['path'], r['start']['offset'])):
        entry = finding(root, raw)
        identity = (entry['path'], entry['call'])
        occurrences[identity] += 1
        entry['occurrence'] = occurrences[identity]
        findings.append(entry)
    return findings


def scan(root, inventory, output, exceptions_path, baseline_path):
    rows = list(csv.DictReader(inventory.open()))
    entries = sorted(r['path'] for r in rows if r['agent_capable'] == 'true')
    if not entries:
        raise ValueError('Refusing vacuous scan: no agent-capable targets')
    targets = [path for path in entries if BOARD_DELEGATE.search((root / path).read_bytes())]
    print(f'Agent scope targets: entries={len(entries)}, with_board_delegate={len(targets)}', flush=True)
    findings = run_semgrep(root, targets, output) if targets else []
    exceptions = read_entries(exceptions_path, 'exception')
    baseline = read_entries(baseline_path, 'debt')
    counts, errors = check_findings(findings, exceptions, baseline)
    (output / 'scan.json').write_text(json.dumps(dict(entries=len(entries), targets=len(targets), counts=counts, findings=findings, errors=errors), indent=2) + '\n')
    for error in errors:
        print(error, flush=True)
    return int(bool(errors))
