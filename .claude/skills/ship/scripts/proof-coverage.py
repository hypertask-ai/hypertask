#!/usr/bin/env python3
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


ACCEPTANCE_HEADINGS = {
    'done when', 'acceptance', 'acceptance criteria', 'akzeptanzkriterien',
    "critères d'acceptation", 'critères d’acceptation', 'criterios de aceptación',
    'acceptatiecriteria',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def call(*args):
    return subprocess.check_output(args, text=True, timeout=60)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(text):
    return ' '.join(re.sub(r'[`*_]', '', text).split()).strip()


class TicketItems(HTMLParser):
    def __init__(self, structured=False):
        super().__init__()
        self.structured = structured
        self.lines, self.text, self.bullets, self.heading = [], '', [], False

    def flush(self, heading=False):
        if self.text.strip():
            text = normalize(self.text)
            label = None if self.structured else re.match(r'^([A-Za-z][A-Za-z ]{0,40}):', text)
            heading = heading or text.lower().rstrip(':') in ACCEPTANCE_HEADINGS
            if heading or label:
                self.lines.append('## ' + (label[1] if label else text))
            else:
                self.lines.append(text)
        self.text = ''

    def handle_starttag(self, tag, attrs):
        if re.fullmatch(r'h[1-6]', tag):
            self.flush()
            self.heading = True
        elif tag == 'li':
            if not self.bullets:
                self.flush()
            self.bullets.append([len(self.lines), ''])
            self.lines.append('')
        elif tag in ('p', 'div', 'br'):
            if self.bullets:
                self.bullets[-1][1] += ' '
            else:
                self.flush()

    def handle_endtag(self, tag):
        if re.fullmatch(r'h[1-6]', tag):
            self.flush(True)
            self.heading = False
        elif tag == 'li' and self.bullets:
            index, text = self.bullets.pop()
            self.lines[index] = '- ' + normalize(text) if text.strip() else ''
        elif tag in ('p', 'div'):
            if self.bullets:
                self.bullets[-1][1] += ' '
            elif not self.heading:
                self.flush()

    def handle_data(self, data):
        if self.bullets:
            self.bullets[-1][1] += data
        else:
            self.text += data


def items(text, headings):
    active, found = False, []
    for line in text.splitlines():
        heading = re.match(r'^#{1,6}\s+(.+?)\s*$', line)
        if heading:
            active = normalize(heading[1]).lower().rstrip(':') in headings
        elif active and re.match(r'^\s*[-*+]\s+', line):
            found.append(normalize(re.sub(r'^\s*[-*+]\s+(?:\[[ xX]\]\s*)?', '', line)))
        elif active and line.strip() and found and line.startswith('  '):
            found[-1] += ' ' + normalize(line)
    return found


def ticket_text(source, structured=False):
    if '<' not in source:
        return source
    parser = TicketItems(structured)
    parser.feed(source)
    parser.flush()
    return '\n'.join(parser.lines)


def activities(ticket):
    page = json.loads(call('hypertask', 'task', 'agent-log', ticket, '--limit', '100', '--json'))
    require(page.get('success') is True and isinstance(page.get('activities'), list), 'cannot read agent activity')
    return sorted(page['activities'], key=lambda r: r['createdAt'])


def evidence(folder, relative):
    path = (folder / relative).resolve()
    require(path.is_relative_to(folder.resolve()) and path.is_file() and path.stat().st_size > 0,
            f'missing, empty or outside-run evidence: {relative}')
    return path


def main():
    ticket, sha, pr, mode, *args = sys.argv[1:]
    root = Path(os.environ.get('SHIP_CHECKOUT', os.getcwd())).resolve()
    folder = Path(os.environ.get('VCC_EVIDENCE_DIR', str(Path.home() / '.local/state/vcc-evidence'))) / ticket
    proof = folder / 'proof.md'
    text = proof.read_text()
    run = re.search(r'^Run: (\d{4}-\d{2}-\d{2}-qa-run-\d+)\s*$', text, re.M)[1]
    task = json.loads(call('hypertask', 'tasks', 'get', ticket, '--json'))
    require(task.get('success') is True and len(task['tasks']) == 1, 'cannot read ticket acceptance items')
    task = task['tasks'][0]
    acceptance = items(ticket_text(task.get('description') or ''), ACCEPTANCE_HEADINGS)
    structured = ticket_text(task.get('acceptanceCriteria') or '', structured=True)
    structured_items = [normalize(re.sub(r'^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?', '', line))
                        for line in structured.splitlines() if line.strip() and not line.startswith('#')]
    acceptance = list(dict.fromkeys(acceptance + structured_items))
    require(acceptance, 'ticket has no acceptance items in its description or acceptanceCriteria')
    page = re.search(r'^Feature map: (\.claude/skills/verify-qa/reference/(?:feature|ops)-map/[a-z0-9-]+\.md)\s*$', text, re.M)
    require(page, 'proof needs a feature-map or ops-map page')
    recipe = call('git', '-C', str(root), 'show', f'{sha}:{page[1]}')
    breakage = items(recipe, {'what usually breaks', 'gotchas'})
    require(breakage, f'{page[1]} has no What usually breaks or Gotchas bullets')
    for section, expected in [('Acceptance', acceptance), ('What usually breaks', breakage)]:
        block = re.search(rf'^## {section}\s*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
        rows = {} if not block else {normalize(m[2]): (m[1], m[3]) for m in re.finditer(
            r'^- (PASS|FAIL|TRIED|NOT-APPLICABLE): (.+?) -> (.+)$', block[1], re.M)}
        for item in expected:
            require(item in rows, f'missing {section} item: {item}')
            status, target = rows[item]
            if section == 'What usually breaks' and status == 'NOT-APPLICABLE':
                require(len(target.strip()) >= 10, f'not-applicable needs a reason: {item}')
            else:
                require(status == ('PASS' if section == 'Acceptance' else 'TRIED'), f'unpassed {section} item: {item}')
                evidence(folder / run, target)
    drive = re.search(r'^Drive script: ([A-Za-z0-9._/-]+\.(?:mjs|py|sh))\s*$', text, re.M)
    require(drive and '..' not in drive[1].split('/') and not drive[1].startswith('/'), 'proof needs a repository-relative Drive script')
    script = drive[1]
    source = subprocess.check_output(['git', '-C', str(root), 'show', f'{sha}:{script}'], timeout=60)
    drive_hash = hashlib.sha256(source).hexdigest()
    log = activities(ticket)
    builders = [r for r in log if r.get('text') == f'Proof builder: PR {pr}']
    require(builders and builders[-1].get('agentId'), f'builder must bind PR {pr} through ship-check bind before independent QA')
    builder = builders[-1]
    binding = dict(pr=int(pr), sha=sha, proof_sha256=digest(proof), drive_sha256=drive_hash)
    if mode == 'rerun':
        require(len(args) == 2 and args[0] == script, f'inspect the drive script, then explicitly pass {script} and a fresh QA run name')
        identity = call(str(Path.home() / '.agents/skills/ship/scripts/ship-identity')).split('\t')[0].strip()
        require(identity.lower() != builder['agentName'].lower(), 'builder cannot record their own independent rerun')
        name = args[1]
        require(re.fullmatch(r'\d{4}-\d{2}-\d{2}-qa-run-\d+', name) and name != run, 'rerun needs a fresh QA run name')
        require(not call('git', '-C', str(root), 'status', '--porcelain').strip(), 'drive checkout has local changes')
        output = folder / name
        output.mkdir(exist_ok=False)
        with tempfile.TemporaryDirectory(prefix='proof-rerun-') as temporary:
            checkout = Path(temporary) / 'checkout'
            call('git', '-C', str(root), 'worktree', 'add', '--detach', str(checkout), sha)
            try:
                dependencies = root / 'node_modules'
                if dependencies.is_dir():
                    (checkout / 'node_modules').symlink_to(dependencies.resolve(), target_is_directory=True)
                installed = checkout / script
                require(installed.resolve().is_relative_to(checkout) and digest(installed) == drive_hash, 'drive script differs from merged source')
                command = [{'.mjs': 'node', '.py': 'python3', '.sh': 'bash'}[installed.suffix], str(installed), str(output)]
                try:
                    result = subprocess.run(command, cwd=checkout, env=dict(os.environ, SHIP_CHECKOUT=str(checkout)), capture_output=True, timeout=300)
                    code, transcript = result.returncode, result.stdout + result.stderr
                except subprocess.TimeoutExpired as error:
                    code, transcript = 124, (error.stdout or b'') + (error.stderr or b'')
                require(digest(proof) == binding['proof_sha256'] and digest(installed) == drive_hash, 'proof or drive script changed during rerun')
            finally:
                call('git', '-C', str(root), 'worktree', 'remove', '--force', str(checkout))
        record = output / 'drive-result.log'
        record.write_bytes(f'exit: {code}\n'.encode() + transcript)
        binding.update(run=name, result='PASS' if code == 0 else 'FAIL', evidence='drive-result.log', evidence_sha256=digest(record))
        call('vcc', 'activity', 'add', ticket, '--text', 'Proof rerun: ' + json.dumps(binding, sort_keys=True))
        require(code == 0, f'drive rerun failed: exit {code}; recorded in agent activity')
        print('rerun recorded; authenticated identity is verified by ship-check proof')
        return
    reruns = []
    for row in log:
        if row['createdAt'] > builder['createdAt'] and row.get('text', '').startswith('Proof rerun: '):
            entry = json.loads(row['text'][len('Proof rerun: '):])
            require(isinstance(entry, dict), 'malformed independent rerun record')
            if all(entry.get(k) == v for k, v in binding.items()):
                reruns.append((row, entry))
    require(reruns, 'no independent drive rerun for this proof; wait in QA, never self-pass')
    actor, entry = reruns[-1]
    require(actor.get('agentId') and actor['agentId'] != builder['agentId'] and actor.get('runId'), 'drive rerun must be recorded by a different authenticated agent with a run id')
    require(entry.get('result') == 'PASS' and re.fullmatch(r'\d{4}-\d{2}-\d{2}-qa-run-\d+', entry.get('run', '')) and entry['run'] != run, 'independent rerun failed or reused the builder run')
    artifact = evidence(folder / entry['run'], entry.get('evidence', ''))
    require(digest(artifact) == entry.get('evidence_sha256'), 'independent rerun evidence changed')
    print(f'coverage and independent rerun ok: {actor["agentId"]} run {actor["runId"]}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, IndexError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f'FAIL: {error}')
