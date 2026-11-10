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
COUNT_WHERE_CALL = 'prisma.task.count({ where })'
FINDMANY_WHERE_CALL = 'prisma.task.findMany({ where, include })'
CONDITIONAL_WHERE_CALL = (
    'prisma.task.findMany({ where: filtered.paged || rankedResults && !sortField'
    ' ? { ...where, id: { in: primaryIds } } : where, select: { id: true }, })'
)


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

        static_source = (FIXTURES / 'unscoped.ts.fixture').read_bytes().replace(
            b'const id = 1;',
            b'',
        ).replace(
            b'where: { id }',
            b"where: { status: 'Normal' }",
        )
        static_call = "prisma.task.findFirst({ where: { status: 'Normal' } })"
        route.write_bytes(static_source)
        exception = dict(path=ROUTE, call=normalize(static_call), occurrence=1,
                         sha256=hashlib.sha256(static_source).hexdigest(),
                         reason='Self-test inline-where control, not a production exception.',
                         approvedIn='https://app.hypertask.ai/detail/project-15/7496')
        exceptions.write_text(json.dumps([exception]))
        invoke('exception-positive', 0, 'findings=1, excepted=1, debt=0, new=0')
        route.write_bytes(static_source.replace(b'findFirst', b'findMany'))
        exceptions.write_text(json.dumps([exception]))
        invoke('stale-exception', 1, 'Stale exception:')

        exceptions.write_text(json.dumps([exception]))
        route.write_bytes((FIXTURES / 'scoped.ts.fixture').read_bytes())
        invoke('removed-call', 1, 'Stale exception:')

        exceptions.write_text(json.dumps([exception]))
        route.write_bytes(static_source + b'\n// unrelated edit\n')
        invoke('unrelated-file-edit', 0, 'findings=1, excepted=1, debt=0, new=0')

        id_source = (FIXTURES / 'unscoped.ts.fixture').read_bytes()
        route.write_bytes(id_source)
        id_exception = dict(path=ROUTE, call=normalize(CALL), occurrence=1,
                            sha256=hashlib.sha256(id_source).hexdigest(),
                            reason='Self-test preauthorized ID control, not a production exception.',
                            approvedIn='https://app.hypertask.ai/detail/project-15/7496')
        exceptions.write_text(json.dumps([id_exception]))
        weakened_id = id_source.replace(b'const id = 1;', b'const id = 999999;')
        route.write_bytes(weakened_id)
        invoke('shorthand-where-id-stale', 1, 'Stale exception:')

        exceptions.write_text(json.dumps([exception]))
        route.write_bytes(static_source + (FIXTURES / 'planted.ts.fixture').read_bytes())
        invoke('new-call-in-excepted-file', 1, 'New unscoped query:')

        exceptions.write_text('[]\n')
        route.write_bytes((FIXTURES / 'real-route.ts.fixture').read_bytes() + (FIXTURES / 'parse-error.ts.fixture').read_bytes())
        invoke('agent-entry-parse-error', 1, 'Inventory parser errors:')

        route.write_bytes((FIXTURES / 'real-route.ts.fixture').read_bytes())
        new_path = 'src/app/api/brand-new-agent-query/route.ts'
        new_route = root / new_path
        new_route.parent.mkdir(parents=True)
        new_route.write_bytes(id_source)
        invoke('brand-new-agent-route', 1, f'New unscoped query: {new_path}')

        count_source = (FIXTURES / 'external-where-count.ts.fixture').read_bytes()
        route.write_bytes(count_source)
        count_exception = dict(
            path=ROUTE,
            call=normalize(COUNT_WHERE_CALL),
            occurrence=1,
            sha256=hashlib.sha256(count_source).hexdigest(),
            reason='Self-test preauthorized count-where control, not a production exception.',
            approvedIn='https://app.hypertask.ai/detail/project-15/7496',
        )
        exceptions.write_text(json.dumps([count_exception]))
        weakened = count_source.replace(b'const where = { id: 1 };', b'const where = {};')
        route.write_bytes(weakened)
        invoke('external-where-shorthand-stale', 1, 'Stale exception:')

        conditional_source = (FIXTURES / 'conditional-where.ts.fixture').read_bytes()
        route.write_bytes(conditional_source)
        conditional_exception = dict(
            path=ROUTE,
            call=normalize(CONDITIONAL_WHERE_CALL),
            occurrence=1,
            sha256=hashlib.sha256(conditional_source).hexdigest(),
            reason='Self-test preauthorized conditional-where control, not a production exception.',
            approvedIn='https://app.hypertask.ai/detail/project-15/7496',
        )
        exceptions.write_text(json.dumps([conditional_exception]))
        weakened = conditional_source.replace(
            b'projectId: { in: [1] }',
            b'projectId: { in: [] }',
        )
        route.write_bytes(weakened)
        invoke('conditional-where-stale', 1, 'Stale exception:')

        findmany_source = (FIXTURES / 'external-where-findmany.ts.fixture').read_bytes()
        route.write_bytes(findmany_source)
        findmany_exception = dict(
            path=ROUTE,
            call=normalize(FINDMANY_WHERE_CALL),
            occurrence=1,
            sha256=hashlib.sha256(findmany_source).hexdigest(),
            reason='Self-test preauthorized findMany-where control, not a production exception.',
            approvedIn='https://app.hypertask.ai/detail/project-15/7496',
        )
        exceptions.write_text(json.dumps([findmany_exception]))
        weakened = findmany_source.replace(
            b'projectId: { in: [1] }',
            b'projectId: { in: [] }',
        )
        route.write_bytes(weakened)
        invoke('external-where-findmany-stale', 1, 'Stale exception:')

    print('Self-tests passed: 12 (eleven negatives, scoped positive; exception prerequisite also passed)', flush=True)
    return 0
