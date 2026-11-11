#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name('ship-check')


class FinishChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.repo = self.root / 'repo'
        self.run_git('init', '-q', str(self.repo), cwd=self.root)
        self.run_git('config', 'user.email', 'fixture@example.com')
        self.run_git('config', 'user.name', 'Fixture')
        self.run_git('commit', '-q', '--allow-empty', '-m', 'fixture')
        origin = self.root / 'origin.git'
        self.run_git('init', '-q', '--bare', str(origin))
        self.run_git('remote', 'add', 'origin', str(origin))
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        VCC_EVIDENCE_DIR=str(self.root / 'evidence'),
                        SHIP_CHECKOUT=str(self.repo), CODEX_SESSION_ID='session-a',
                        FIXTURE_ROOT=str(self.root))
        self.env.pop('CLAUDE_CODE_SESSION_ID', None)
        self.env.pop('CODEX_THREAD_ID', None)
        self.write('hypertask', '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ['FIXTURE_ROOT'])
if sys.argv[1:3] in [['tasks', 'get'], ['task', 'get']]:
    print(json.dumps({'success': True, 'tasks': [{'ticketNumber': sys.argv[3], 'boardId': 15, 'section': os.environ.get('SECTION', 'In Progress'), 'description': os.environ.get('DESCRIPTION', ''), 'acceptanceCriteria': os.environ.get('ACCEPTANCE', '')}]}))
elif sys.argv[1:3] in [['section', 'list'], ['sections', 'list']]:
    print(json.dumps({'success': True, 'sections': [
        {'id': 1, 'section_title': 'Flag: Everyone', 'isDone': True},
        {'id': 2, 'section_title': 'Flag: Only Me + QA', 'isDone': True},
        {'id': 3, 'section_title': 'No Flag', 'isDone': True},
        {'id': 4, 'section_title': 'Flag: Off', 'isDone': None},
        {'id': 5, 'section_title': 'Agent Blocked (Infra)', 'isDone': False},
        {'id': 6, 'section_title': 'In Progress', 'isDone': False}]}))
elif sys.argv[1:3] == ['task', 'agent-log']:
    assert sys.argv[4:] == ['--limit', '100', '--json'], sys.argv
    rows = json.loads((root / 'activity.json').read_text())
    print(json.dumps({'success': True, 'activities': sorted(rows, key=lambda row: row['createdAt'], reverse=True)[:100]}))
elif sys.argv[1:3] == ['comment', 'list']:
    print((root / 'comments.json').read_text())
else:
    sys.exit(10)
''')
        self.comments('Local tests got SIGKILL on the VPS. Exit 137.')

    def run_git(self, *args, cwd=None):
        return subprocess.run(['git', *args], cwd=cwd or self.repo,
                              check=True, capture_output=True, text=True)

    def write(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def comments(self, text):
        (self.root / 'comments.json').write_text(json.dumps({
            'success': True, 'comments': [{'text': text, 'createdAt': '2026-10-28T10:00:00Z'}]}))

    def check(self, *args, success=True, **env):
        result = subprocess.run([str(SCRIPT), *args], env=dict(self.env, **env),
                                cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def guard(self, command):
        result = subprocess.run([str(SCRIPT), 'guard'], env=self.env, cwd=self.repo,
                                input=json.dumps({'tool_input': {'command': command}, 'cwd': str(self.repo)}),
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stderr

    def test_agent_deployment_requires_matching_live_proof_and_only_proven_path(self):
        ticket = 'HYCI-161'
        evidence = self.root / 'evidence' / ticket
        evidence.mkdir(parents=True)
        for name, value in [('pr', '42'), ('repo', 'hypertask-ai/hypertask'), ('base', 'production')]:
            (evidence / name).write_text(value + '\n')
        home = self.root / 'home'
        self.env['HOME'] = str(home)
        installed = home / '.local/lib/hypertask/runner-pickup/runner-selfupdate'
        installed.parent.mkdir(parents=True)
        unit = self.repo / '.claude/systemd/runner-selfupdate.service'
        payload = self.repo / '.claude/skills/ship/scripts/runner-selfupdate'
        unit.parent.mkdir(parents=True)
        payload.parent.mkdir(parents=True)
        unit.write_text('[Service]\nExecStart=%h/.local/lib/hypertask/runner-pickup/runner-selfupdate run\n')
        payload.write_text('old\n')
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'unit')
        payload.write_text('new\n')
        unit.write_text(unit.read_text() + 'Description=updated\n')
        test = payload.with_name('runner-selfupdate.test.sh')
        test.write_text('test\n')
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'agent change')
        sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        fragment = self.root / 'installed.service'
        start = int(time.time()) - 10
        def install(path, content):
            path.write_text(content)
            os.utime(path, (start - 10, start - 10))
        install(fragment, unit.read_text())
        install(installed, payload.read_text())
        self.write('systemctl', f'''#!/bin/sh
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/systemctl.log"
case "$*" in
  *FragmentPath*) echo "{fragment}" ;;
  *--timestamp=us*NeedDaemonReload*)
    if [ "${{RACE:-}}" = yes ]; then RESULT=exit-code STATUS=1; fi
    printf 'Result=%s\\nExecMainStatus=%s\\nNeedDaemonReload=%s\\nExecMainStartTimestamp=%s\\nExecMainExitTimestamp=%s\\nDropInPaths=%s\\n' "${{RESULT:-success}}" "${{STATUS:-0}}" "${{RELOAD:-no}}" "${{START-@{start}}}" "${{EXIT-@{start}}}" "${{DROP_INS-}}" ;;
  *Result*) printf 'Result=%s\\nExecMainStatus=%s\\n' "${{RESULT:-success}}" "${{STATUS:-0}}" ;;
  *) exit 1 ;;
esac
''')
        self.write('gh', f'''#!/bin/sh
case "$1:$2" in
  pr:view) echo '{{"number":42,"title":"HYCI-161 [INFRA] Fixture","state":"MERGED","mergeCommit":{{"oid":"'"${{MERGE_SHA:-{sha}}}"'"}},"baseRefName":"production"}}' ;;
  api:*/deployments/*/statuses) echo "${{DEPLOY_STATE:-}}" ;;
  api:*/deployments\?*) echo "${{DEPLOY_ID:-}}" ;;
  api:*/status|api:*/deployments*) echo '' ;;
  *) exit 1 ;;
esac
''')
        proof = evidence / 'live-proof'
        def record(value):
            proof.write_text(f'sha: {value}\nsource: {self.repo}\ncheck: systemd-user-unit runner-selfupdate.service\n')
        self.check('deployed', ticket, success=False)
        record(sha)
        self.assertIn('agent live proof', self.check('deployed', ticket))
        log = self.root / 'systemctl.log'
        log.write_text('')
        self.check('deployed', ticket, success=False, RACE='yes')
        queries = [line for line in log.read_text().splitlines() if 'FragmentPath' not in line]
        self.assertEqual(len(queries), 1)
        for prop in ['Result', 'ExecMainStatus', 'NeedDaemonReload',
                     'ExecMainStartTimestamp', 'ExecMainExitTimestamp', 'DropInPaths']:
            self.assertIn(f'-p {prop}', queries[0])
        self.assertIn('agent live proof', self.check('deployed', ticket,
                                                    START=f'@{start}.100000000', EXIT=f'@{start}.200000000'))
        self.check('deployed', ticket, success=False, STATUS='1')
        self.check('deployed', ticket, success=False, RESULT='failed')
        self.check('deployed', ticket, success=False, EXIT='')
        self.check('deployed', ticket, success=False, EXIT=f'@{start - 1}')
        self.check('deployed', ticket, success=False, EXIT=f'@{start}.100000000', START=f'@{start}.200000000')
        self.check('deployed', ticket, success=False, EXIT=f'@{int(time.time()) + 3600}')
        self.check('deployed', ticket, success=False, START='')
        self.check('deployed', ticket, success=False, START=f'@{start - 20}')
        self.check('deployed', ticket, success=False, START=f'@{int(time.time()) + 3600}')
        self.check('deployed', ticket, success=False, RELOAD='yes')
        self.check('deployed', ticket, success=False, DROP_INS='/tmp/override.conf')
        original_unit = unit.read_text()
        for extra_start in ['ExecStart=/bin/false\n', 'ExecStart=\n']:
            unit.write_text(original_unit + extra_start)
            install(fragment, unit.read_text())
            self.run_git('add', '.')
            self.run_git('commit', '-qm', 'multiple starts')
            multi_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
            record(multi_sha)
            self.check('deployed', ticket, success=False, MERGE_SHA=multi_sha)
        unit.write_text(original_unit)
        install(fragment, original_unit)
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'restore single start')
        record(sha)
        self.assertIn('agent live proof', self.check('deployed', ticket))
        os.utime(installed, ns=((start * 10**9) + 900_000_000,) * 2)
        self.check('deployed', ticket, success=False, START=f'@{start}.100000000')
        install(installed, payload.read_text())
        installed.unlink()
        symlink_target = self.root / 'installed-payload'
        install(symlink_target, payload.read_text())
        installed.symlink_to(symlink_target)
        self.assertIn('agent live proof', self.check('deployed', ticket))
        symlink_target.write_text(payload.read_text())
        os.utime(symlink_target, (start + 1, start + 1))
        self.check('deployed', ticket, success=False)
        installed.unlink()
        install(installed, payload.read_text())
        record('0' * 40)
        self.check('deployed', ticket, success=False)
        record(sha)
        installed.write_text('stale\n')
        self.check('deployed', ticket, success=False)
        install(installed, payload.read_text())
        fragment.write_text('wrong unit\n')
        self.check('deployed', ticket, success=False)
        install(fragment, unit.read_text())
        installed.unlink()
        self.check('deployed', ticket, success=False)
        install(installed, payload.read_text())
        wrong = home / '.local/lib/hypertask/other/runner-selfupdate'
        wrong.parent.mkdir(parents=True)
        wrong.write_text(payload.read_text())
        unit.write_text(f'[Service]\nExecStart={wrong} run\n')
        install(fragment, unit.read_text())
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'wrong installation')
        wrong_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        record(wrong_sha)
        self.check('deployed', ticket, success=False, MERGE_SHA=wrong_sha)
        unit.write_text('[Service]\nExecStart=%h/.local/lib/hypertask/runner-pickup/runner-selfupdate run\nDescription=updated\n')
        install(fragment, unit.read_text())
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'restore unit')
        payload.unlink()
        self.run_git('add', '-A')
        self.run_git('commit', '-qm', 'missing source')
        missing_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        record(missing_sha)
        self.check('deployed', ticket, success=False, MERGE_SHA=missing_sha)
        payload.write_text(installed.read_text())
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'restore payload')
        renamed = payload.with_name('renamed')
        self.run_git('mv', str(payload), str(renamed))
        self.run_git('commit', '-qm', 'rename payload')
        renamed_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        record(renamed_sha)
        self.check('deployed', ticket, success=False, MERGE_SHA=renamed_sha)
        self.run_git('mv', str(renamed), str(payload))
        self.run_git('commit', '-qm', 'restore payload name')
        for name in ['src/app.ts', '.claude/skills/ship/scripts/runner-pickup',
                     '.claude/skills/ship/scripts/ship-check.test.sh']:
            extra = self.repo / name
            extra.parent.mkdir(parents=True, exist_ok=True)
            extra.write_text('change\n')
            self.run_git('add', '.')
            self.run_git('commit', '-qm', 'mixed change')
            mixed_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
            record(mixed_sha)
            self.check('deployed', ticket, success=False, MERGE_SHA=mixed_sha)
            self.assertIn('deployed ok', self.check('deployed', ticket, MERGE_SHA=mixed_sha, DEPLOY_ID='123', DEPLOY_STATE='success'))
            extra.unlink()
            self.run_git('add', '-A')
            self.run_git('commit', '-qm', 'remove extra')

        app = self.repo / 'src/app.ts'
        app.parent.mkdir(parents=True, exist_ok=True)
        app.write_text('old app\n')
        unit.write_text(f'[Service]\nExecStart={app}\n')
        install(fragment, unit.read_text())
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'app unit')
        app.write_text('new app\n')
        os.utime(app, (start - 10, start - 10))
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'app payload')
        app_sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        record(app_sha)
        self.check('deployed', ticket, success=False, MERGE_SHA=app_sha)
        self.assertIn('deployed ok', self.check('deployed', ticket, MERGE_SHA=app_sha, DEPLOY_ID='123', DEPLOY_STATE='success'))

    def test_three_released_ticket_replays(self):
        for ticket, section in [('HTPR-7950', 'Flag: Everyone'),
                                ('HTPR-7753', 'Flag: Only Me + QA'),
                                ('YPER4-697', 'No Flag')]:
            with self.subTest(ticket=ticket):
                self.assertEqual(self.check('done', ticket, SECTION=section), 'done ok\n')
                self.check('branch', ticket, 'none')
                self.assertIn('cleaned ok', self.check('cleaned', ticket))
        self.check('done', 'HTPR-7950', success=False, SECTION='Flag: Off')

    def test_unfinished_full_day_observation_stays_open(self):
        gate = '<p>Full-day observation gate: still unfinished.</p>'
        closed = '<p>Full-day observation gate: passed.</p>'
        checklist = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Full-day observation: watch production for 24 hours</p></li></ul>'
        checked = checklist.replace('data-checked="false"', 'data-checked="true"')
        self.assertIn('unfinished full-day observation gate', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Flag: Everyone', DESCRIPTION=gate))
        self.assertIn('still unfinished', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Flag: Everyone', DESCRIPTION=gate))
        self.assertIn('unfinished full-day observation gate', self.check(
            'move', 'HTPR-8872', 'Flag: Everyone', success=False, DESCRIPTION=gate))
        self.assertIn('Full-day observation: watch production for 24 hours', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Flag: Everyone', DESCRIPTION=checklist))
        self.assertIn('move ok', self.check('move', 'HTPR-8872', 'In Progress', DESCRIPTION=gate))
        self.assertEqual(self.check('done', 'HTPR-8872', SECTION='Flag: Everyone', DESCRIPTION=closed), 'done ok\n')
        self.assertEqual(self.check('done', 'HTPR-8872', SECTION='Flag: Everyone', DESCRIPTION=checked), 'done ok\n')
        self.assertIn('unfinished full-day observation gate', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Done',
            ACCEPTANCE='<p>Full-day observation gate: incomplete.</p>'))
        self.assertEqual(self.check(
            'done', 'HTPR-8872', SECTION='Flag: Everyone',
            DESCRIPTION=closed, ACCEPTANCE='Report: unfinished'), 'done ok\n')
        self.assertEqual(self.check(
            'done', 'HTPR-8872', SECTION='Flag: Everyone',
            DESCRIPTION='Full-day observation gate: no longer unfinished.'), 'done ok\n')
        self.assertIn('unfinished full-day observation gate', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Done',
            DESCRIPTION='Full-day observation gate: not done.'))
        self.assertEqual(self.check(
            'done', 'HTPR-8872', SECTION='Flag: Everyone',
            DESCRIPTION='<p>A ticket can state a full-day observation gate that is not finished.</p>'), 'done ok\n')
        self.assertIn('still unfinished', self.check(
            'done', 'HTPR-8872', success=False, SECTION='Flag: Everyone',
            DESCRIPTION='<p>Full-day observation gate: still <strong>unfinished</strong>.</p>'))
        self.assertEqual(self.check(
            'done', 'HTPR-8872', SECTION='Flag: Everyone',
            DESCRIPTION='<p>Full-day observation gate: <em>passed</em>.</p>'), 'done ok\n')
        self.assertEqual(self.check(
            'done', 'HTPR-8872', SECTION='Flag: Everyone',
            DESCRIPTION=checked + '<ul><li><p>Observation results are attached</p></li></ul>'), 'done ok\n')

    def test_killed_local_check_refuses_blocked_handoff_by_title_and_id(self):
        for section in ['Agent Blocked (Infra)', '5']:
            self.assertIn('push and let CI decide', self.check(
                'move', 'HTPR-7950', section, success=False))

    def test_real_blocker_still_allowed(self):
        self.comments('<p>Local tests got SIGKILL.</p><p>Blocker: provider returned HTTP 403.</p>')
        self.assertIn('move ok', self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)'))
        self.comments('<p>Blocker: local test exit code 137.</p>')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)
        self.comments('Provider returned HTTP 403.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')

    def test_local_success_does_not_turn_ci_failure_into_local_failure(self):
        for text in ['Local tests passed. CI tests got SIGKILL, exit 137.',
                     'Local tests passed, but CI tests got SIGKILL, exit 137.',
                     'CI tests got SIGKILL, exit 137, but local tests passed.']:
            self.comments(text)
            self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')
        self.comments('CI tests passed, but local tests got SIGKILL, exit 137.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)
        self.comments('<p>Local tests got SIGKILL.</p><p>Blocker: CI tests got SIGKILL, exit 137.</p>')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')

    def test_ci_failure_and_working_moves_still_allowed(self):
        self.comments('CI test job got SIGKILL, exit 137.')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)')
        self.comments('Local tests got SIGKILL.')
        self.check('move', 'HTPR-7950', 'In Progress')

    def test_ci_and_factory_tickets_finish_through_the_normal_step(self):
        for ticket in ['HYCI-31', 'IGSH-1335']:
            with self.subTest(ticket=ticket):
                self.assertIn('move ok', self.check('move', ticket, 'In Progress'))

    def test_guard_enforces_done_moves_on_the_ci_board(self):
        for ticket in ['HYCI-31', 'IGSH-1335']:
            with self.subTest(ticket=ticket):
                out = self.guard(f'vcc task move {ticket} --section Done')
                self.assertIn('blocked moving ' + ticket, out)

    def test_unreadable_handoff_fails_closed(self):
        (self.root / 'comments.json').write_text('{bad')
        self.check('move', 'HTPR-7950', 'Agent Blocked (Infra)', success=False)

    def test_foreign_worktree_and_remote_branch_do_not_block(self):
        self.check('branch', 'YPER4-697', 'old/yper4-697')
        self.run_git('worktree', 'add', '-q', '-b', 'old/yper4-697', str(self.root / 'old'))
        self.run_git('push', '-q', 'origin', 'old/yper4-697')
        self.check('branch', 'YPER4-697', 'none', CODEX_SESSION_ID='session-b')
        self.assertIn('cleaned ok', self.check('cleaned', 'YPER4-697', CODEX_SESSION_ID='session-b'))
        self.check('cleaned', 'YPER4-697', success=False)
        self.assertTrue((self.root / 'old').exists())
        self.assertIn('old/yper4-697', self.run_git('branch', '--list').stdout)

    def test_own_resources_require_cleanup(self):
        ticket, branch = 'YPER4-697', 'new/yper4-697'
        self.check('branch', ticket, branch)
        self.run_git('worktree', 'add', '-q', '-b', branch, str(self.root / 'own'))
        self.run_git('push', '-q', 'origin', branch)
        self.assertIn('worktree', self.check('cleaned', ticket, success=False))
        self.run_git('worktree', 'remove', str(self.root / 'own'))
        self.assertIn('local branch', self.check('cleaned', ticket, success=False))
        self.run_git('branch', '-D', branch)
        self.assertIn('GitHub branch', self.check('cleaned', ticket, success=False))
        self.run_git('push', '-q', 'origin', '--delete', branch)
        self.assertIn('cleaned ok', self.check('cleaned', ticket))

    def test_missing_ownership_is_not_a_pass(self):
        self.check('cleaned', 'YPER4-697', success=False)
        self.check('branch', 'YPER4-697', 'none', success=False, CODEX_SESSION_ID='')
        self.check('branch', 'YPER4-697', 'none', success=False, CODEX_SESSION_ID='../other')

    def test_cannot_replace_ownership_with_none(self):
        self.check('branch', 'YPER4-697', 'own/one')
        self.check('branch', 'YPER4-697', 'none', success=False)
        self.check('branch', 'YPER4-697', 'own/two')
        self.run_git('branch', 'own/two')
        self.check('cleaned', 'YPER4-697', success=False)

    def test_proof_acceptance_and_authenticated_drive_rerun(self):
        ticket, run = 'HTPR-7766', '2026-11-09-qa-run-14'
        folder = self.root / 'evidence' / ticket
        output = folder / run
        output.mkdir(parents=True)
        (folder / 'pr').write_text('42')
        (output / 'result.json').write_text('{"ok":true}')
        (output / 'doctor.png').write_bytes(b'screenshot fixture')
        page = '.claude/skills/verify-qa/reference/feature-map/' + 'fixture.md'
        (self.repo / page).parent.mkdir(parents=True)
        (self.repo / page).write_text('## Gotchas\n\n- Cursor lost after reload.\n  Check the box.\n\n### Proof\n- Not a gotcha.\n')
        ops = ('pr-drain-picker', 'runner-pickup')
        recipes = SCRIPT.parents[2] / 'verify-qa/reference/ops-map'
        for name in ops:
            target = self.repo / '.claude/skills/verify-qa/reference/ops-map' / f'{name}.md'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text((recipes / f'{name}.md').read_text())
        script = 'drive.mjs'
        (self.repo / '.gitignore').write_text('node_modules/\n')
        dependency = self.repo / 'node_modules/proof-fixture'
        dependency.mkdir(parents=True)
        (dependency / 'package.json').write_text('{"type":"module","exports":"./index.mjs"}')
        (dependency / 'index.mjs').write_text('export const version = "prepared dependency";\n')
        (self.repo / 'drive-version.txt').write_text('merged')
        (self.repo / script).write_text('import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { version } from "proof-fixture";\nassert.equal(version, "prepared dependency");\nassert.equal(readFileSync("drive-version.txt", "utf8"), "merged");\nassert.equal(process.env.SHIP_CHECKOUT, process.cwd());\nconsole.log("drive reached", process.argv[2]);\nprocess.exit(Number(process.env.DRIVE_EXIT || 0));\n')
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'proof fixture')
        sha = self.run_git('rev-parse', 'HEAD').stdout.strip()
        self.write('gh', f'''#!/bin/sh
case "$1:$2" in
  pr:view) if [ "$7" = title ]; then echo 'HTPR-7766 [BUGFIX] Fixture'; else echo '{{"number":42,"title":"HTPR-7766 [BUGFIX] Fixture","state":"MERGED","mergeCommit":{{"oid":"{sha}"}},"baseRefName":"production"}}'; fi ;;
  api:*/status) echo 'Ignored Build Step' ;;
  *) exit 1 ;;
esac
''')
        self.env['DESCRIPTION'] = '<p><strong>Done when:</strong></p><ul><li><p>Every action works from the keyboard in all three places.</p></li><li><p>Board keys still work.</p></li></ul><p><strong>Risk:</strong> none</p><ul><li>Not acceptance.</li></ul>'
        activity = self.root / 'activity.json'
        builder = dict(id='builder-note', agentId='builder-id', agentName='Runner 1', runId='builder-run', createdAt='2026-11-09T00:00:00Z', text='Proof builder: PR 42')
        activity.write_text(json.dumps([builder]))
        self.write('ht', '#!/bin/sh\nexit 10\n')
        self.write('vcc', '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ['FIXTURE_ROOT'])/'activity.json'
rows = json.loads(p.read_text())
rows.append(dict(id=str(len(rows)),agentId=os.environ.get('ACTOR','reviewer-id'),agentName=os.environ.get('ACTOR_NAME','Runner 2'),runId='reviewer-run',createdAt=f'2026-11-09T01:00:{len(rows):02d}Z',text=sys.argv[-1]))
p.write_text(json.dumps(rows))
print('recorded')
''')
        home = self.root / 'home'
        identity = home / '.agents/skills/ship/scripts/ship-identity'
        identity.parent.mkdir(parents=True)
        identity.write_text('#!/bin/sh\nprintf "%s\\tfixture\\n" "${ACTOR_NAME:-Runner 2}"\n')
        identity.chmod(0o755)
        self.env['HOME'] = str(home)
        historical = (SCRIPT.parent / 'fixtures/htpr-7766-proof.md').read_text()
        historical = historical.replace('c164a28dfcf6f06f5ef05b6fb9f414f880b3b49d', sha)
        for line in historical.splitlines():
            if line.startswith('- PASS:'):
                file = output / line.split(' -> ')[1]
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('historical fixture evidence')
        proof = folder / 'proof.md'
        proof.write_text(historical.replace('feature-map/ai-chat.md', 'feature-map/fixture.md'))
        self.assertIn('missing Acceptance item: Every action works', self.check('proof', ticket, success=False))
        self.assertIn('missing Acceptance item: Every action works', self.check('move', ticket, 'Done', success=False))
        self.assertIn('proof ok', self.check('proof', ticket, SHIP_PROOF_STRICT='0'))
        complete = (recipes / 'proof-coverage.md').read_text().split('```text\n')[1].split('```')[0]
        for before, after in [
            ('.claude/skills/verify-qa/reference/feature-map/<page>.md', page),
            ('<merge-sha>', sha), ('<id>', '985'), ('<YYYY-MM-DD>-qa-run-<n>', run),
            ('<repository-relative .mjs, .py or .sh committed in the merge>', script),
            ('- PASS: <case> -> <nonempty-file>', '- PASS: doctor -> doctor.png'),
            ('<exact acceptance bullet>', 'Every action works from the keyboard in all three places.'),
            ('<exact breakage bullet>', 'Cursor lost after reload. Check the box.'),
            ('- NOT-APPLICABLE: <another exact breakage bullet> -> <reason of 10 characters or more>\n', ''),
            ('<nonempty-file>', 'result.json'),
            ('## What usually breaks', '- PASS: Board keys still work. -> result.json\n\n## What usually breaks')]:
            complete = complete.replace(before, after)
        proof.write_text(complete)
        activity.write_text('[]')
        self.assertIn('builder must bind', self.check('proof', ticket, success=False))
        activity.write_text(json.dumps([builder]))
        self.check('bind', ticket, '42', ACTOR='builder-id', ACTOR_NAME='Runner 1')
        (output / 'result.json').write_text('')
        self.check('proof', ticket, success=False)
        (output / 'result.json').write_text('{"ok":true}')
        self.assertIn('no independent drive rerun', self.check('proof', ticket, success=False))
        for before, after, message in [
            ('- PASS: Board keys still work. -> result.json', '', 'missing Acceptance item: Board keys still work.'),
            ('Board keys still work. -> result.json', 'Board keys still work. -> absent.json', 'evidence'),
            ('- TRIED: Cursor lost after reload. Check the box. -> result.json', '', 'missing What usually breaks item: Cursor lost'),
            ('TRIED: Cursor lost after reload. Check the box. -> result.json', 'NOT-APPLICABLE: Cursor lost after reload. Check the box. -> no', 'needs a reason')]:
            proof.write_text(complete.replace(before, after))
            self.assertIn(message, self.check('proof', ticket, success=False))
        proof.write_text(complete)
        def rerun(n, **env):
            return self.check('rerun', ticket, script, f'2026-11-09-qa-run-{n}', **env)
        def validate(text, n, **env):
            proof.write_text(text)
            rerun(n, **env)
            self.assertIn('proof ok', self.check('proof', ticket, **env))
        self.assertIn('builder cannot', rerun(15, success=False, ACTOR_NAME='Runner 1'))
        rerun(15, ACTOR='builder-id')
        self.assertIn('different authenticated agent', self.check('proof', ticket, success=False))
        rerun(16, success=False, DRIVE_EXIT='1')
        self.assertIn('rerun failed', self.check('proof', ticket, success=False))
        validate(complete, 17)
        proof.write_text(complete + '\nChanged proof.\n')
        self.assertIn('no independent drive rerun', self.check('proof', ticket, success=False))
        proof.write_text(complete)
        (folder / '2026-11-09-qa-run-17/drive-result.log').write_text('altered')
        self.assertIn('evidence changed', self.check('proof', ticket, success=False))
        validate(complete.replace('TRIED: Cursor lost after reload. Check the box. -> result.json', 'NOT-APPLICABLE: Cursor lost after reload. Check the box. -> Read-only change; no cursor behavior affected.'), 18)
        nested = '<h2>Done when</h2><ul><li><p>Every action works from the keyboard in all three places.</p><ul><li><p>Board keys still work.</p><ul><li>Nested keys work.</li></ul></li></ul></li></ul>'
        self.assertIn('missing Acceptance item: Nested keys work.', self.check('proof', ticket, success=False, DESCRIPTION=nested))
        validate(complete.replace('## What usually breaks', '- PASS: Nested keys work. -> result.json\n\n## What usually breaks'), 19, DESCRIPTION=nested)
        for number, name in enumerate(ops, 20):
            with self.subTest(recipe=name):
                breakage = [line[2:] for line in (recipes / f'{name}.md').read_text().split('## What usually breaks\n')[1].splitlines() if line.startswith('- ')]
                self.assertTrue(breakage)
                ops_page = '.claude/skills/verify-qa/reference/ops-map/' + name + '.md'
                validate(complete.replace(page, ops_page).split('## What usually breaks')[0]
                         + '## What usually breaks\n'
                         + ''.join(f'- TRIED: {item} -> result.json\n' for item in breakage), number)
        self.check('bind', ticket, '42')
        self.assertIn('no independent drive rerun', self.check('proof', ticket, success=False))
        self.assertIn('builder cannot', rerun(22, success=False))
        rerun(22, ACTOR_NAME='Runner 3')
        self.assertIn('different authenticated agent', self.check('proof', ticket, success=False))
        reviewer = dict(ACTOR='third-agent-id', ACTOR_NAME='Runner 3')
        validate(proof.read_text(), 23, **reviewer)
        criteria = ['Structured keys work.', '- Structured keys work.', '1. Structured keys work.',
                    '<ul><li>Structured keys work.</li></ul>', '<p>Structured keys work.</p>',
                    '<p>Keys: Structured keys work.</p>',
                    '<p>Structured keys work.</p><ul><li>Board keys still work.</li></ul>']
        variants = [(dict(ACCEPTANCE=value), 'Keys: Structured keys work.' if 'Keys:' in value else 'Structured keys work.')
                    for value in criteria]
        for heading in ['Akzeptanzkriterien', "Critères d’acceptation", "Critères d'acceptation",
                        'Criterios de aceptación', 'Acceptatiecriteria']:
            variants.extend((dict(DESCRIPTION=value), 'Board keys still work.') for value in [
                f'<p><strong>{heading}:</strong></p><ul><li>Board keys still work.</li></ul>',
                f'## {heading}\n- Board keys still work.\n'])
        for number, (env, expected) in enumerate(variants, 24):
            with self.subTest(**env):
                proof.write_text(complete.replace(f'- PASS: {expected} -> result.json', ''))
                self.assertIn('missing Acceptance item: ' + expected, self.check('proof', ticket, success=False, **env))
                covered = complete if expected == 'Board keys still work.' else complete.replace(
                    '## What usually breaks', f'- PASS: {expected} -> result.json\n\n## What usually breaks')
                validate(covered, number, **reviewer, **env)
                if 'ACCEPTANCE' in env:
                    self.assertIn('proof ok', self.check('proof', ticket, DESCRIPTION='', **env))
        (self.repo / 'drive-version.txt').write_text('later production')
        (self.repo / script).write_text('throw new Error("must not execute the later drive");\n')
        self.run_git('add', '.')
        self.run_git('commit', '-qm', 'unrelated newer production')
        validate(complete, 70, **reviewer)
        self.assertIn('drive reached', (folder / '2026-11-09-qa-run-70/drive-result.log').read_text())
        self.assertEqual(len(self.run_git('worktree', 'list', '--porcelain').stdout.split('worktree ')) - 1, 1)
        (self.repo / 'drive-version.txt').write_text('dirty')
        self.assertIn('local changes', rerun(71, success=False, **reviewer))
        self.assertFalse((folder / '2026-11-09-qa-run-71').exists())
        (self.repo / 'drive-version.txt').write_text('later production')
        (self.repo / 'untracked.py').write_text('untracked')
        self.assertIn('local changes', rerun(72, success=False, **reviewer))


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(FinishChecks)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if result.wasSuccessful():
        print('finish checks passed')
    raise SystemExit(not result.wasSuccessful())
