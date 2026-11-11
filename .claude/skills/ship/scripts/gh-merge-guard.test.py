import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class MergeGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.bin = self.home / '.local/bin'
        self.bin.mkdir(parents=True)
        self.wrapper = self.bin / 'gh'
        self.log = self.home / 'calls'
        self.original = (HERE / 'gh-wrapper.fixture').read_text().replace('REAL=/usr/bin/gh', 'REAL="$HOME/real-gh"')
        self.wrapper.write_text(self.original)
        self.wrapper.chmod(0o755)
        real = self.home / 'real-gh'
        real.write_text('#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ["CALL_LOG"], "a") as f: f.write(json.dumps(sys.argv[1:]) + "\\n")\n')
        real.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), CALL_LOG=str(self.log), GH_NO_APP_TOKEN='1')
        self.env.pop('GH_REPO', None)
        self.env.pop('GH_HOST', None)
        self.env.pop('SHIP_REPO', None)
        self.installed = self.home / '.local/lib/hypertask/merge-guard'

    def install(self):
        return subprocess.run(['python3', str(HERE / 'gh-merge-guard'), '--install'], env=self.env, capture_output=True)

    def call(self, *args):
        return subprocess.run([str(self.wrapper), *args], env=self.env, cwd=self.home, capture_output=True)

    def fake_checker(self, code):
        checker = self.installed / 'ship-check'
        checker.write_text('#!/usr/bin/env python3\nimport json, os, sys\np = json.load(sys.stdin)\nopen(os.path.join(os.environ["HOME"], "input"), "w").write(json.dumps(p))\nopen(os.path.join(os.environ["HOME"], "env"), "w").write(json.dumps({k: os.environ[k] for k in ("SHIP_REPO", "SHIP_BASE") if k in os.environ}))\nsys.exit(' + str(code) + ')\n')

    def test_install_idempotent_and_original_preserved(self):
        self.assertEqual(self.install().returncode, 0)
        installed = self.wrapper.read_text()
        self.assertEqual((self.installed / 'proof-coverage.py').read_bytes(), (HERE / 'proof-coverage.py').read_bytes())
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.wrapper.read_text(), installed)
        line = '"$HOME/.local/lib/hypertask/merge-guard/gh-merge-guard" -- "$@" || exit $?\n'
        self.assertEqual(installed.replace(line, ''), self.original)
        for marker in ('GH_NO_APP_TOKEN', 'export GH_REAL=', 'export HT_GH_CACHE_DIR=',
                       'FLEET_INFRA_FIRST_FILE', 'fleet-gh/infra-first-guard'):
            self.assertIn(marker, installed)

    def test_refused_semicolon_and_exact_allowed_arguments(self):
        self.assertEqual(self.install().returncode, 0)
        self.fake_checker(2)
        result = subprocess.run(['bash', '-c', 'false; "$HOME/.local/bin/gh" pr merge 42 --squash --subject "$1" -R hypertask-ai/hypertask', '_', 'hello; world'], env=self.env, cwd=self.home)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.log.exists())
        self.fake_checker(0)
        args = ['pr', 'merge', '42', '--squash', '--subject', 'hello; world', '-R', 'hypertask-ai/hypertask']
        self.assertEqual(self.call(*args).returncode, 0)
        self.assertEqual(json.loads(self.log.read_text()), args)
        payload = json.loads((self.home / 'input').read_text())
        self.assertEqual(payload['tool_input']['command'], 'gh pr merge 42 -R hypertask-ai/hypertask')
        self.assertEqual(payload['cwd'], str(self.home))

    def test_fail_closed_and_reads(self):
        self.assertEqual(self.install().returncode, 0)
        self.fake_checker(7)
        self.assertNotEqual(self.call('pr', 'merge', '42').returncode, 0)
        (self.installed / 'ship-check').unlink()
        self.assertNotEqual(self.call('pr', 'merge', '42').returncode, 0)
        self.assertEqual(self.call('pr', 'view', '42').returncode, 0)
        self.assertEqual(json.loads(self.log.read_text()), ['pr', 'view', '42'])
        self.assertNotEqual(self.call('--repo', 'hypertask-ai/hypertask', 'pr', 'merge', '42').returncode, 0)
        self.assertNotEqual(self.call('pr', 'merge', '42', '--unknown').returncode, 0)

    def test_alias_refused_and_builtin_reads_pass(self):
        self.assertEqual(self.install().returncode, 0)
        self.assertNotEqual(self.call('land', '42').returncode, 0)
        self.assertNotEqual(self.call('unknown-command').returncode, 0)
        self.assertFalse(self.log.exists())
        for args in (('pr', 'view', '42'), ('repo', 'view'), ('--version',), ('version',), ('-h',), ('help',)):
            self.assertEqual(self.call(*args).returncode, 0)

    def test_repository_flags_and_opt_in_bound_to_destination(self):
        self.assertEqual(self.install().returncode, 0)
        self.fake_checker(7)
        self.env.update(SHIP_REPO='spoofed/repo', SHIP_BASE='main')
        for args in (('pr', '--repo', 'hypertask-ai/hypertask', 'merge', '42'),
                     ('--repo', 'hypertask-ai/hypertask', 'pr', 'merge', '42'),
                     ('-Rhypertask-ai/hypertask', 'pr', 'merge', '42')):
            self.assertEqual(self.call(*args).returncode, 7)
            payload = json.loads((self.home / 'input').read_text())
            env = json.loads((self.home / 'env').read_text())
            self.assertEqual(payload['tool_input']['command'], 'gh pr merge 42 -R hypertask-ai/hypertask')
            self.assertEqual(env['SHIP_REPO'], 'hypertask-ai/hypertask')
            self.assertEqual(env['SHIP_BASE'], 'production')
        self.assertEqual(self.call('pr', 'merge', '42', '-R', 'Example/Project').returncode, 7)
        env = json.loads((self.home / 'env').read_text())
        self.assertEqual(env['SHIP_REPO'], 'example/project')
        self.assertEqual(env['SHIP_BASE'], 'main')
        self.env.pop('SHIP_REPO')
        self.assertEqual(self.call('pr', 'merge', '42', '-R', 'example/project').returncode, 7)
        self.assertNotIn('SHIP_REPO', json.loads((self.home / 'env').read_text()))
        self.assertFalse(self.log.exists())

    def test_explicit_repo_required(self):
        self.assertEqual(self.install().returncode, 0)
        self.fake_checker(7)
        git = self.bin / 'git'
        git.write_text('#!/bin/sh\nprintf "%s\\n" "git@github.com:Example/Project.git"\n')
        git.chmod(0o755)
        self.env['PATH'] = str(self.bin) + os.pathsep + os.environ['PATH']
        for config in ('', '[remote "app"]\n\tgh-resolved = base\n\turl = git@github.com:hypertask-ai/hypertask.git\n'):
            dotgit = self.home / '.git'
            dotgit.mkdir(exist_ok=True)
            (dotgit / 'config').write_text(config)
            result = self.call('pr', 'merge', '42')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'name an explicit repository', result.stderr)
            self.assertFalse((self.home / 'input').exists())
            self.assertFalse(self.log.exists())
        self.env['GH_REPO'] = 'Example/Project'
        self.assertEqual(self.call('pr', 'merge', '42').returncode, 7)
        self.assertEqual(json.loads((self.home / 'input').read_text())['tool_input']['command'],
                         'gh pr merge 42 -R example/project')
        self.assertFalse(self.log.exists())

    def test_url_and_real_guard(self):
        self.assertEqual(self.install().returncode, 0)
        self.fake_checker(0)
        self.assertEqual(self.call('pr', 'merge', 'https://github.com/example/project/pull/42').returncode, 0)
        payload = json.loads((self.home / 'input').read_text())
        self.assertEqual(payload['tool_input']['command'], 'gh pr merge 42 -R example/project')
        self.assertEqual(self.install().returncode, 0)
        self.assertEqual(self.call('pr', 'merge', '42', '-R', 'example/project').returncode, 0)

    def test_missing_guard_file_blocks_merge(self):
        self.assertEqual(self.install().returncode, 0)
        (self.installed / 'gh-merge-guard').unlink()
        self.assertNotEqual(self.call('pr', 'merge', '42', '-R', 'hypertask-ai/hypertask').returncode, 0)
        self.assertFalse(self.log.exists())

    def test_real_checker_semicolon_and_ci_gate(self):
        real = self.home / 'real-gh'
        real.write_text('''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as f:
    f.write(json.dumps(args) + '\\n')
head = 'a' * 40
if args[:2] == ['pr', 'merge']:
    with open(os.path.join(os.environ['HOME'], 'merges'), 'a') as f:
        f.write(json.dumps(args) + '\\n')
elif args[:2] == ['pr', 'view']:
    print('HYCI-135 [INFRA] Fixture' if 'title' in args else head)
elif args[0] == 'api':
    endpoint = args[1]
    if os.environ.get('READ_ERROR') and os.environ['READ_ERROR'] in endpoint:
        sys.exit(1)
    if endpoint.endswith('/pulls/42'):
        print(head)
    elif '/check-runs?' in endpoint:
        production = '/commits/production/' in endpoint
        missing = not production and os.environ.get('MISSING_HEAD')
        run = {'id': 2 if production else 1, 'name': 'ci-tests', 'status': 'completed',
               'conclusion': os.environ.get('PRODUCTION', 'failure') if production else 'success',
               'started_at': '2026-01-02T00:00:00Z' if production else os.environ.get('HEAD_TIME', '2026-01-01T00:00:00Z'),
               'html_url': 'https://example.invalid/run'}
        print(json.dumps({'check_runs': [] if missing else [run]}))
    elif '/statuses/' in endpoint:
        print('{}')
    elif '/actions/jobs/' in endpoint:
        print('fixture failure')
    else:
        sys.exit(1)
else:
    sys.exit(1)
''')
        hypertask = self.bin / 'hypertask'
        hypertask.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"success":true,"tasks":[{"id":135}]}\'\n')
        hypertask.chmod(0o755)
        self.env.update(PATH=str(self.bin) + os.pathsep + os.environ['PATH'], SHIP_BASE='production')
        for key in list(self.env):
            if key.startswith('BASH_FUNC_') or key in ('FLEET_INFRA_FIRST_FILE', 'BASH_ENV', 'ENV',
                                                        'READ_ERROR', 'MISSING_HEAD', 'PRODUCTION', 'HEAD_TIME',
                                                        'PREMERGE_STATUS_STATE'):
                self.env.pop(key, None)
        args = ['pr', 'merge', '42', '--squash', '--subject', 'hello; world', '-R', 'hypertask-ai/hypertask']
        payload = json.dumps({'tool_input': {'command': 'gh pr merge 42 -R hypertask-ai/hypertask'}, 'cwd': str(self.home)})
        self.env['PAYLOAD'] = payload
        self.env['CHECKER'] = str(HERE / 'ship-check')
        shell = 'printf %s "$PAYLOAD" | "$CHECKER" guard; echo $? > "$HOME/direct-result"; "$HOME/.local/bin/gh" "$@"'
        def scenario():
            return subprocess.run(['bash', '-c', shell, '_', *args], env=self.env, cwd=self.home, capture_output=True, text=True)
        merges = self.home / 'merges'
        before = scenario()
        self.assertEqual((self.home / 'direct-result').read_text().strip(), '2', before.stderr)
        self.assertIn('passed before that on an older production', before.stderr)
        self.assertEqual(before.returncode, 0, before.stderr)
        self.assertEqual([json.loads(line) for line in merges.read_text().splitlines()], [args])
        merges.unlink()
        self.assertEqual(self.install().returncode, 0)
        self.env['CHECKER'] = str(self.installed / 'ship-check')
        blocked = scenario()
        self.assertEqual((self.home / 'direct-result').read_text().strip(), '2', blocked.stderr)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn('passed before that on an older production', blocked.stderr)
        self.assertFalse(merges.exists())
        self.env['SHIP_BASE'] = 'wrong-base'
        for interleaved in (('pr', '--repo', 'hypertask-ai/hypertask', 'merge', '42', '--squash'),
                            ('--repo', 'hypertask-ai/hypertask', 'pr', 'merge', '42', '--squash')):
            result = self.call(*interleaved)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('passed before that on an older production', result.stderr.decode())
        self.env['SHIP_BASE'] = 'production'
        for config, message in (({'MISSING_HEAD': '1'}, 'ci-tests is missing on head'),
                                ({'READ_ERROR': '/commits/production/'}, 'cannot read ci-tests')):
            self.env.update(config)
            result = self.call(*args)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(message, result.stderr.decode())
            self.assertFalse(merges.exists())
            for key in config:
                self.env.pop(key)
        for config in ({'PRODUCTION': 'success'}, {'HEAD_TIME': '2026-01-03T00:00:00Z'}):
            self.env.update(config)
            result = self.call(*args)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual([json.loads(line) for line in merges.read_text().splitlines()], [args])
            calls = [json.loads(line) for line in self.log.read_text().splitlines()]
            self.assertTrue(any(call[:2] == ['api', 'repos/hypertask-ai/hypertask/statuses/' + 'a' * 40]
                                and 'state=success' in call for call in calls))
            merges.unlink()
            self.log.unlink()
            for key in config:
                self.env.pop(key)

    def test_invalid_install_shape_unchanged(self):
        self.wrapper.write_text(self.original.replace('exec $REAL "$@"', 'exec "$REAL" "$@"'))
        before = self.wrapper.read_text()
        self.assertNotEqual(self.install().returncode, 0)
        self.assertEqual(self.wrapper.read_text(), before)
        self.assertFalse(self.installed.exists())


if __name__ == '__main__':
    unittest.main()
