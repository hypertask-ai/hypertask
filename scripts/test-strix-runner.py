#!/usr/bin/env python3
"""Exercise cron execution, failed scans, report gating and agent-only filing."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent

def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL, text=True).strip()
        self.git = git
        git('init', '-b', 'production')
        git('config', 'user.email', 'test@example.invalid')
        git('config', 'user.name', 'Test')
        (self.repo / 'auth.py').write_text('first\n')
        git('add', '.');git('commit', '-m', 'base')
        self.base = git('rev-parse', 'HEAD')
        (self.repo / 'auth.py').write_text('second\n')
        git('add', '.');git('commit', '-m', 'change')
        (self.repo / '.env').write_text('UNTRACKED_SECRET=never-copy\n')
        bin = self.root / '.local/bin'
        bin.mkdir(parents=True)
        for name, body in {
            'systemctl': '#!/bin/sh\ntest -n "$XDG_RUNTIME_DIR"\n',
            'curl': '#!/bin/sh\nexit 0\n',
            'htbot': '#!/bin/sh\necho \'{"success":true}\'\n',
            'rg': '#!/bin/sh\nexit 1\n',
            'docker': '#!/bin/sh\nif [ "$1 $2" = "network rm" ] && [ "$MODE" = cleanup_fail ]; then exit 1; fi\n',
            'strix': '''#!/usr/bin/python3
import json,os,pathlib,sys
mode=os.environ.get('MODE','ok')
if mode=='crash':sys.exit(7)
p=pathlib.Path('strix_runs/owned');p.mkdir(parents=True)
complete=mode!='budget'
data={'status':'completed' if complete else 'budget_exceeded','scan_results':{'scan_completed':complete,'methodology':'COVERAGE_COMPLETE','technical_analysis':'Incomplete' if mode=='incomplete' else 'Reviewed changes'}}
(p/'run.json').write_text(json.dumps(data));(p/'penetration_test_report.md').write_text('Report')
if mode=='findings':
 (p/'vulnerabilities.json').write_text(json.dumps([{'title':'Informational fixture','severity':'low'}]))
 sys.exit(2)
''',
        }.items():
            p=bin / name;p.write_text(body);p.chmod(0o755)
        self.env = {'HOME': str(self.root), 'PATH': '/usr/bin:/bin', 'STRIX_REPO': str(self.repo), 'STRIX_DIFF_BASE': self.base}

    def run_scan(self, mode='ok'):
        result=subprocess.run(['/bin/bash', str(SCRIPTS/'strix-weekly.sh')],env={**self.env,'MODE':mode},capture_output=True,text=True)
        state=self.root/'.local/state/strix/weekly'
        status=json.loads((state/'latest.json').read_text())
        return result,status,state

    def test_cron_success_uses_clean_revision(self):
        result,status,state=self.run_scan()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(status['status'],'completed')
        self.assertEqual((state/'last-success').read_text().strip(),self.git('rev-parse','HEAD'))
        self.assertFalse((Path(status['job'])/'source/.env').exists())
        self.assertFalse((Path(status['job'])/'source/.git/objects/info/alternates').exists())

    def test_findings_exit_code_still_checks_and_files_report(self):
        result,status,state=self.run_scan('findings')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(status['status'],'completed')
        self.assertTrue((state/'last-success').exists())

    def test_no_changes_skips_scan(self):
        self.env['STRIX_DIFF_BASE']=self.git('rev-parse','HEAD')
        result,status,_=self.run_scan()
        self.assertEqual(result.returncode,0)
        self.assertEqual(status['status'],'no_changes')

    def test_failed_or_incomplete_runs_do_not_advance(self):
        for mode in ['crash','budget','incomplete']:
            with self.subTest(mode=mode):
                result,status,state=self.run_scan(mode)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(status['status'],'failed')
                self.assertFalse((state/'last-success').exists())

    def test_cleanup_failure_is_failure(self):
        result,status,state=self.run_scan('cleanup_fail')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(status['status'],'failed')
        self.assertFalse((state/'last-success').exists())


class ReportTests(unittest.TestCase):
    def test_completed_banner_without_scope_attestation_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            run=Path(temp)/'run';run.mkdir()
            (run/'run.json').write_text(json.dumps({'status':'completed','scan_results':{'scan_completed':True}}))
            with self.assertRaisesRegex(ValueError,'attest'):
                load('strix-check-run').validate(temp)

    def test_no_run_and_multiple_runs_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            validator=load('strix-check-run')
            with self.assertRaises(ValueError):validator.validate(temp)
            for n in ['one','two']:
                p=Path(temp)/n;p.mkdir();(p/'run.json').write_text('{}')
            with self.assertRaises(ValueError):validator.validate(temp)

    def test_confirmation_includes_actual_callers(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'src').mkdir()
            (root/'src/helper.ts').write_text('export function decide(count, limit) { return count > limit }\n')
            caller=root/'src/caller.ts'
            caller.write_text('const count = await redis.incr(key)\nconst decision = decide(count, limit)\n')
            search=subprocess.CompletedProcess([],0,f'{caller}\n','')
            with patch.object(reporter,'APP',root),patch.object(reporter.subprocess,'run',return_value=search):
                source=reporter.source_evidence({'code_locations':[{'file':'src/helper.ts','start_line':1,'end_line':1}]})
                self.assertIn('Caller/test context: src/caller.ts',source)
                self.assertIn('redis.incr(key)',source)

    def test_filing_uses_agent_wrapper_without_assignment(self):
        reporter=load('strix-file-tickets')
        with patch.object(reporter.subprocess,'run') as call:
            call.return_value=subprocess.CompletedProcess([],0,'{"success":true}','')
            self.assertTrue(reporter.post_ticket({'title':'Test','description':'<p>Test</p>','priority':'urgent'}))
            args=call.call_args.args[0]
            self.assertEqual(args[0],'htbot')
            self.assertNotIn('--token',args)
            self.assertNotIn('--assignee',args)
            call.return_value=subprocess.CompletedProcess([],0,'{"success":false}','')
            self.assertFalse(reporter.post_ticket({'title':'Test','description':'Test','priority':'urgent'}))

    def test_confirmation_error_fails_the_job(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp)/'vulnerabilities.json').write_text(json.dumps([{'title':'Test','severity':'high'}]))
            with patch.object(reporter,'STATE',str(Path(temp)/'state.json')),patch.object(reporter,'confirmed_twice',side_effect=ValueError('no evidence')):
                with self.assertRaises(SystemExit):reporter.main(temp)


if __name__=='__main__':unittest.main()
