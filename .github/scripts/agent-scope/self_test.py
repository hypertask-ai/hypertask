"""Adversarial fixtures invoke the production entrypoint, inventory and checker."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from scope_scan import normalize

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / 'fixtures'
ROUTE = 'src/app/api/mcp/chat/rooms/pending/route.ts'
CALL = 'prisma.task.findFirst({ where: { id } })'


def run(output):
    with tempfile.TemporaryDirectory(prefix='agent-scope-self-test-', dir=os.environ.get('RUNNER_TEMP')) as scratch:
        root = Path(scratch)
        route = root / ROUTE
        route.parent.mkdir(parents=True)
        auth = root / 'src/lib/mcp/routeWrapper.ts'
        auth.parent.mkdir(parents=True)
        auth.write_bytes((FIXTURES / 'auth.ts.fixture').read_bytes())
        baseline = root / 'baseline.json'
        exceptions = root / 'exceptions.json'
        baseline.write_text('[]\n')
        exceptions.write_text('[]\n')

        def invoke(name, expected, needle):
            result = subprocess.run([sys.executable, str(HERE / 'run.py'), '--root', str(root),
                                     '--baseline', str(baseline), '--exceptions', str(exceptions)],
                                    text=True, capture_output=True)
            text = result.stdout + result.stderr
            (output / f'{name}.log').write_text(text)
            print(f'Fixture {name}: exit={result.returncode}\n{text}', flush=True)
            if (result.returncode == 0) != (expected == 0) or needle not in text:
                raise ValueError(f'Fixture {name} did not reach the expected production check: {needle}')

        route.write_bytes((FIXTURES / 'scoped.ts.fixture').read_bytes())
        invoke('scoped-positive', 0, 'findings=0, excepted=0, debt=0, new=0')

        route.write_bytes((FIXTURES / 'real-route.ts.fixture').read_bytes() + (FIXTURES / 'planted.ts.fixture').read_bytes())
        invoke('planted-real-route', 1, f'New unscoped query: {ROUTE}')

        source = (FIXTURES / 'unscoped.ts.fixture').read_bytes()
        route.write_bytes(source)
        exception = dict(path=ROUTE, call=normalize(CALL), occurrence=1,
                         sha256=hashlib.sha256(source).hexdigest(),
                         reason='Self-test preauthorized ID control, not a production exception.',
                         approvedIn='https://app.hypertask.ai/detail/project-15/7496')
        exceptions.write_text(json.dumps([exception]))
        invoke('exception-positive', 0, 'findings=1, excepted=1, debt=0, new=0')
        exceptions.write_text(json.dumps([{**exception, 'sha256': '0' * 64}]))
        invoke('stale-exception', 1, 'Stale exception:')

        exceptions.write_text(json.dumps([exception]))
        route.write_bytes(source + (FIXTURES / 'planted.ts.fixture').read_bytes())
        exceptions.write_text(json.dumps([{**exception, 'sha256': hashlib.sha256(route.read_bytes()).hexdigest()}]))
        invoke('new-call-in-excepted-file', 1, 'New unscoped query:')

        exceptions.write_text('[]\n')
        route.write_bytes((FIXTURES / 'real-route.ts.fixture').read_bytes() + (FIXTURES / 'parse-error.ts.fixture').read_bytes())
        invoke('agent-entry-parse-error', 1, 'Inventory parser errors:')

        route.write_bytes((FIXTURES / 'real-route.ts.fixture').read_bytes())
        new_path = 'src/app/api/brand-new-agent-query/route.ts'
        new_route = root / new_path
        new_route.parent.mkdir(parents=True)
        new_route.write_bytes(source)
        invoke('brand-new-agent-route', 1, f'New unscoped query: {new_path}')

    print('Self-tests passed: 6 (five negatives, scoped positive; exception prerequisite also passed)', flush=True)
    return 0
