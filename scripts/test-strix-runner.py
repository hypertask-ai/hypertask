#!/usr/bin/env python3
"""Exercise cron execution, failed scans, report gating and agent-only filing."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
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
        class ModelFixture(BaseHTTPRequestHandler):
            def do_POST(handler):
                length = int(handler.headers['Content-Length'])
                prompt = json.loads(handler.rfile.read(length))['messages'][0]['content']
                self.model_requests.append(prompt)
                content = {'findings': []} if prompt.startswith('Extract vulnerability claims') else {'verdict': 'rejected', 'reason': 'test fixture'}
                payload = json.dumps({'choices': [{'message': {'content': json.dumps(content)}}]}).encode()
                handler.send_response(200)
                handler.send_header('Content-Type', 'application/json')
                handler.send_header('Content-Length', str(len(payload)))
                handler.end_headers()
                handler.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.model_requests = []
        server = ThreadingHTTPServer(('127.0.0.1', 0), ModelFixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        bin = self.root / '.local/bin'
        bin.mkdir(parents=True)
        for name, body in {
            'systemctl': '#!/bin/sh\ntest -n "$XDG_RUNTIME_DIR"\n',
            'curl': '#!/bin/sh\nexit 0\n',
            'htbot': '#!/bin/sh\necho \'{"success":true}\'\n',
            'docker': '#!/bin/sh\nif [ "$1 $2" = "network rm" ] && [ "$MODE" = cleanup_fail ]; then exit 1; fi\n',
            'strix': '''#!/usr/bin/python3
import json,os,pathlib,sys
mode=os.environ.get('MODE','ok')
if mode=='crash':sys.exit(7)
p=pathlib.Path('strix_runs/owned');p.mkdir(parents=True)
complete=mode!='budget'
data={'status':'completed' if complete else 'budget_exceeded','scan_results':{'scan_completed':complete,'methodology':'COVERAGE_COMPLETE','technical_analysis':'Coverage incomplete' if mode=='incomplete' else 'Reviewed changes'}}
(p/'run.json').write_text(json.dumps(data));(p/'penetration_test_report.md').write_text('Report\\n\\nCOVERAGE_COMPLETE\\n')
(p/'vulnerabilities.json').write_text('[]')
if mode in ('findings','confirm'):
 finding={'title':'Informational fixture','severity':'low'} if mode=='findings' else {'title':'Auth weakness','severity':'high','code_locations':[{'file':'auth.py','start_line':1}]}
 (p/'vulnerabilities.json').write_text(json.dumps([finding]))
 sys.exit(2)
''',
        }.items():
            p=bin / name;p.write_text(body);p.chmod(0o755)
        self.env = {'HOME': str(self.root), 'PATH': os.environ['PATH'], 'STRIX_REPO': str(self.repo), 'STRIX_DIFF_BASE': self.base,
                    'STRIX_CONFIRM_API_BASE': f'http://127.0.0.1:{server.server_port}/v1', 'STRIX_CONFIRM_API_KEY': 'fixture-key'}

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
        self.assertEqual(len(self.model_requests), 1)

    def test_confirmation_uses_local_model_fixture(self):
        result,status,state=self.run_scan('confirm')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(status['status'],'completed')
        self.assertEqual(len(self.model_requests), 3)
        self.assertEqual(sum('Auth weakness' in prompt for prompt in self.model_requests), 2)

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

    def test_budgeted_batches_resume_without_repeating_completed_scope(self):
        for name in ['second.py', 'third.py']:
            (self.repo/name).write_text('new code\n')
        self.git('add', 'second.py', 'third.py');self.git('commit', '-m', 'more scope')
        self.env.update(STRIX_BATCH_FILES='1', STRIX_BUDGET='3', STRIX_BATCH_BUDGET='3')
        first,status,state=self.run_scan()
        self.assertEqual(first.returncode,3,first.stdout+first.stderr)
        self.assertEqual(status['status'],'pending')
        pinned=self.git('rev-parse','HEAD')
        self.assertFalse((state/'last-success').exists())
        coverage=json.loads((Path(status['job'])/'coverage.json').read_text())
        self.assertEqual(coverage['completed_batches'],1)
        first_report=coverage['batches'][0]['run']
        (self.repo/'later.py').write_text('next revision\n')
        self.git('add','later.py');self.git('commit','-m','later production change')
        self.env['STRIX_BUDGET']='6'
        second,status,state=self.run_scan()
        self.assertEqual(second.returncode,0,second.stdout+second.stderr)
        coverage=json.loads((Path(status['job'])/'coverage.json').read_text())
        self.assertEqual(coverage['completed_batches'],3)
        self.assertEqual(coverage['batches'][0]['run'],first_report)
        self.assertEqual(coverage['reserved_budget'],6)
        self.assertEqual((state/'last-success').read_text().strip(),pinned)
        self.assertFalse((state/'pending-scope').exists())

    def test_batch_failure_retains_completed_receipts(self):
        result,status,state=self.run_scan('budget')
        self.assertNotEqual(result.returncode,0)
        self.assertTrue((state/'pending-scope').exists())
        result,status,state=self.run_scan('ok')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual(status['status'],'completed')


class ReportTests(unittest.TestCase):
    def test_security_entry_points_precede_documentation_backlog(self):
        planner=load('strix-review-batches')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            paths=['docs/auth.md','.claude/skills/a.md','src/components/Button.tsx','src/lib/auth/session.ts']
            for name in paths:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('source')
            batches=planner.plan(root,paths,max_files=1)
            self.assertEqual(batches[0],['src/lib/auth/session.ts'])
            self.assertEqual(batches[1],['src/components/Button.tsx'])

    def test_narrative_findings_are_not_silently_discarded(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'penetration_test_report.md').write_text('A token can be replayed at src/auth.ts:12')
            finding={'title':'Token replay','severity':'medium','code_locations':[{'file':'src/auth.ts','start_line':12,'end_line':12}]}
            with patch.object(reporter,'model_text',return_value=json.dumps({'findings':[finding]})):
                self.assertEqual(reporter.read_findings(temp),[finding])
                self.assertTrue((root/'narrative-candidates.json').exists())
            with patch.object(reporter,'model_text',return_value='{"findings":[{"title":"No evidence"}]}'):
                with self.assertRaises(ValueError):reporter.read_findings(temp)

    def test_narrative_and_structured_findings_are_merged(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'penetration_test_report.md').write_text('Two findings')
            first={'title':'First flaw','severity':'medium','code_locations':[{'file':'src/a.ts','start_line':1}]}
            second={'title':'Second flaw','severity':'high','code_locations':[{'file':'src/b.ts','start_line':2}]}
            (root/'vulnerabilities.json').write_text(json.dumps([first]))
            with patch.object(reporter,'model_text',return_value=json.dumps({'findings':[first,second]})):
                self.assertEqual(reporter.read_findings(temp),[first,second])

    def test_completed_report_can_describe_an_incomplete_auth_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'run';root.mkdir()
            (root/'run.json').write_text(json.dumps({'status':'completed','scan_results':{
                'scan_completed':True,'methodology':'COVERAGE_COMPLETE',
                'technical_analysis':'The incomplete authorization check exposes account data.'}}))
            (root/'penetration_test_report.md').write_text(
                'The incomplete authorization check exposes account data.\n\nCOVERAGE_COMPLETE\n')
            self.assertEqual(load('strix-check-run').validate(temp),root)

    def test_incomplete_report_prose_cannot_advance_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'run';root.mkdir()
            (root/'run.json').write_text(json.dumps({'status':'completed','scan_results':{
                'scan_completed':True,'methodology':'COVERAGE_COMPLETE'}}))
            (root/'penetration_test_report.md').write_text(
                'Coverage is incomplete because the budget was exhausted.\n\nCOVERAGE_COMPLETE\n')
            with self.assertRaisesRegex(ValueError,'incomplete coverage'):
                load('strix-check-run').validate(temp)

    def test_report_itself_must_attest_to_complete_coverage(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'run';root.mkdir()
            (root/'run.json').write_text(json.dumps({'status':'completed','scan_results':{
                'scan_completed':True,'methodology':'COVERAGE_COMPLETE'}}))
            (root/'penetration_test_report.md').write_text('Reviewed the requested scope.\n')
            with self.assertRaisesRegex(ValueError,'attest'):
                load('strix-check-run').validate(temp)

    def test_batch_plan_respects_size_and_rejects_outside_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); source=root/'source';source.mkdir()
            for name in ['one.py','two.py','three.py']:
                (source/name).write_text('x'*40)
            planner=load('strix-review-batches')
            result=planner.plan(source,['one.py','two.py','three.py'],max_bytes=60)
            self.assertEqual(len(result),3)
            (root/'outside.py').write_text('secret')
            with self.assertRaises(ValueError):planner.plan(source,['../outside.py'])
            (source/'link.py').symlink_to(root/'outside.py')
            with self.assertRaises(ValueError):planner.plan(source,['link.py'])

    def test_completed_banner_without_scope_attestation_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            run=Path(temp)/'run';run.mkdir()
            (run/'run.json').write_text(json.dumps({'status':'completed','scan_results':{'scan_completed':True}}))
            (run/'penetration_test_report.md').write_text('COVERAGE_COMPLETE\n')
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
            (root/'src/caller.ts').write_text('const count = await redis.incr(key)\nconst decision = decide(count, limit)\n')
            with patch.object(reporter,'APP',root):
                source=reporter.source_evidence({'code_locations':[{'file':'src/helper.ts','start_line':1,'end_line':1}]})
                self.assertIn('Caller/test context: src/caller.ts',source)
                self.assertIn('redis.incr(key)',source)

    def test_confirmation_includes_intervening_redemption_logic(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'src').mkdir()
            lines=['// filler']*2500
            lines[1250]='await consumeToken(jti);'
            (root/'src/auth.ts').write_text('\n'.join(lines))
            with patch.object(reporter,'APP',root):
                source=reporter.source_evidence({'code_locations':[{'file':'src/auth.ts','start_line':1,'end_line':1}]})
                self.assertIn('await consumeToken(jti);',source)

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

    def test_assessment_removes_snapshots_but_keeps_reports(self):
        assessment=load('strix-assess')
        with tempfile.TemporaryDirectory() as temp:
            def fake_snapshot(state, output, name, remote, ref):
                source=output/name;source.mkdir()
                for profile in json.loads((SCRIPTS/'strix-assessment.json').read_text()).values():
                    if profile['repository']==name:
                        for filename in profile['files']:
                            path=source/filename;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('source')
                return source,'test-revision'
            with patch.dict(os.environ,STRIX_ASSESSMENT_STATE=temp), \
                 patch.object(sys,'argv',['strix-assess.py','--source-only','--profile','native-cli']), \
                 patch.object(assessment,'snapshot',side_effect=fake_snapshot) as snapshot_call, \
                 patch.object(assessment.batches,'run',return_value=0):
                self.assertEqual(assessment.main(),0)
            snapshot_call.assert_called_once()
            self.assertEqual(snapshot_call.call_args.args[2],'cli')
            output=Path(json.loads((Path(temp)/'latest.json').read_text())['output'])
            self.assertTrue((output/'assessment.json').exists())
            self.assertFalse((output/'app').exists())
            self.assertFalse((output/'cli').exists())

    def test_installer_replaces_dependency_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            verify=root/'verify'
            for name, content in {
                'app-auth.mjs':'export {}\n',
                'config.mjs':'export {}\n',
                'node_modules/playwright/index.mjs':'export {}\n',
                'node_modules/playwright/current.txt':'current\n',
                'node_modules/playwright-core/package.json':'{}\n',
                'node_modules/playwright-core/current.txt':'current\n',
            }.items():
                path=verify/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
            destination=root/'installed'
            stale=destination/'node_modules/playwright/stale.txt'
            stale.parent.mkdir(parents=True);stale.write_text('stale\n')
            result=subprocess.run(
                ['/bin/bash',str(SCRIPTS/'install-strix-runner.sh')],
                env={**os.environ,'HOME':str(root/'home'),'STRIX_INSTALL_DIR':str(destination),
                     'STRIX_VERIFY_SOURCE':str(verify)},
                capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertFalse(stale.exists())
            self.assertEqual((destination/'node_modules/playwright/current.txt').read_text(),'current\n')

    def test_concurrent_modes_file_a_finding_only_once(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            roots=[Path(temp)/name for name in ('weekly','assessment')]
            for root in roots:root.mkdir()
            finding={'title':'Duplicate auth flaw','severity':'high'}
            with patch.object(reporter,'STATE',str(Path(temp)/'filed.json')), \
                 patch.object(reporter,'read_findings',return_value=[finding]), \
                 patch.object(reporter,'confirmed_twice',return_value=([{'verdict':'confirmed'}]*2,True)), \
                 patch.object(reporter,'post_ticket',return_value=True) as post:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    list(pool.map(reporter.main,map(str,roots)))
                self.assertEqual(post.call_count,1)
                self.assertEqual(json.loads((Path(temp)/'filed.json').read_text()),['duplicateauthflaw'])

    def test_confirmation_error_fails_the_job(self):
        reporter=load('strix-file-tickets')
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp)/'vulnerabilities.json').write_text(json.dumps([{'title':'Test','severity':'high'}]))
            with patch.object(reporter,'STATE',str(Path(temp)/'state.json')),patch.object(reporter,'read_findings',return_value=[{'title':'Test','severity':'high'}]),patch.object(reporter,'confirmed_twice',side_effect=ValueError('no evidence')):
                with self.assertRaises(SystemExit):reporter.main(temp)


class BatchRunResumeTests(unittest.TestCase):
    """HTPR-6628: a non-resume run must never adopt a receipt left by any
    other run at the same scope key, and a resume must only continue the
    exact run it is a continuation of."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/'source'
        self.source.mkdir()
        for name in ('a.py', 'b.py', 'c.py'):
            (self.source/name).write_text('x'*10)
        self.state = self.root/'state'
        self.output_base = self.root/'output'
        self.planner = load('strix-review-batches')

    def _patches(self):
        return (
            patch.object(self.planner.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')),
            patch.object(self.planner.checker, 'validate', side_effect=lambda p: p/'run'),
        )

    def test_fresh_run_never_adopts_receipts_left_by_an_earlier_run(self):
        planner = self.planner
        files = ['a.py', 'b.py', 'c.py']
        batches = planner.plan(self.source, files, max_files=1)
        scope_key = planner.hashlib.sha256(
            planner.json.dumps(['rev', 'base', batches]).encode()).hexdigest()[:24]
        # A prior, unrelated run left completed-looking receipts for the two
        # later batches (the exact shape a non-resume run that was
        # interrupted before it reached them used to leave behind).
        stale = self.state/scope_key/'stale-run'
        stale.mkdir(parents=True)
        for index in (1, 2):
            planner.write_json(stale/f'{index}.json', {
                'index': index, 'files': batches[index], 'status': 'completed',
                'run': 'STALE-OLD-REPORT', 'run_id': 'stale-run', 'scope_key': scope_key,
            })
        planner.write_json(planner._run_pointer(self.state, scope_key),
                            {'run_id': 'stale-run', 'scope_key': scope_key})

        output = self.output_base/'fresh'; output.mkdir(parents=True)
        p1, p2 = self._patches()
        with p1, p2:
            code = planner.run(self.source, files, self.state, output, 'rev', 'base',
                                budget=99, batch_budget=1, max_files=1, resume=False)
        self.assertEqual(code, 0)
        coverage = json.loads((output/'coverage.json').read_text())
        for batch in coverage['batches']:
            self.assertNotEqual(batch['run'], 'STALE-OLD-REPORT')
            self.assertIn(str(output), batch['run'])

    def test_resume_continues_an_interrupted_run_without_rescanning_completed_batches(self):
        planner = self.planner
        files = ['a.py', 'b.py', 'c.py']
        p1, p2 = self._patches()
        with p1, p2:
            output1 = self.output_base/'partial'; output1.mkdir(parents=True)
            code1 = planner.run(self.source, files, self.state, output1, 'rev', 'base',
                                 budget=1, batch_budget=1, max_files=1, resume=True)
            self.assertEqual(code1, 3)
            coverage1 = json.loads((output1/'coverage.json').read_text())
            self.assertEqual(coverage1['completed_batches'], 1)
            first_report = coverage1['batches'][0]['run']

            output2 = self.output_base/'resumed'; output2.mkdir(parents=True)
            code2 = planner.run(self.source, files, self.state, output2, 'rev', 'base',
                                 budget=99, batch_budget=1, max_files=1, resume=True)
        self.assertEqual(code2, 0)
        coverage2 = json.loads((output2/'coverage.json').read_text())
        self.assertEqual(coverage2['completed_batches'], 3)
        self.assertEqual(coverage2['batches'][0]['run'], first_report)
        for batch in coverage2['batches'][1:]:
            self.assertIn(str(output2), batch['run'])

    def test_resume_with_changed_input_does_not_reuse_previous_scope_receipts(self):
        planner = self.planner
        files = ['a.py', 'b.py', 'c.py']
        p1, p2 = self._patches()
        with p1, p2:
            output1 = self.output_base/'orig'; output1.mkdir(parents=True)
            code1 = planner.run(self.source, files, self.state, output1, 'rev', 'base',
                                 budget=99, batch_budget=1, max_files=1, resume=True)
            self.assertEqual(code1, 0)

            (self.source/'d.py').write_text('extra')
            output2 = self.output_base/'changed'; output2.mkdir(parents=True)
            code2 = planner.run(self.source, files+['d.py'], self.state, output2, 'rev', 'base',
                                 budget=99, batch_budget=1, max_files=1, resume=True)
        self.assertEqual(code2, 0)
        coverage2 = json.loads((output2/'coverage.json').read_text())
        self.assertEqual(coverage2['total_batches'], 4)
        for batch in coverage2['batches']:
            self.assertIn(str(output2), batch['run'])


if __name__=='__main__':unittest.main()
