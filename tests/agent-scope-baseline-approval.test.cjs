const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { readFileSync, readdirSync } = require('node:fs')

const load = () => import(pathToFileURL(path.join(__dirname, '../.github/scripts/agent-scope/baseline-approval.mjs')).href)
const URL_A = 'https://app.hypertask.ai/detail/project-15/7496'
const URL_B = 'https://app.hypertask.ai/detail/project-4060/123'
const entry = { path: 'src/app/api/example/route.ts', call: 'prisma.task.count({})', occurrence: 1, ticket: 'https://app.hypertask.ai/detail/project-15/7508', owner: 'HT Product Lead', expires: '2027-01-19', approvedIn: URL_A }
const json = entries => JSON.stringify(entries)

for (const [name, kind] of [['baseline', 'debt'], ['exceptions', 'exception']]) {
  const file = `.github/scripts/agent-scope/agent-scope-${name}.json`
  const files = (base, head) => [{ file, base: base === null ? null : json(base), head: head === null ? null : json(head) }]
  const line = `Agent scope ${kind} approved: ${URL_A}`

  test(`${kind}: initial creation, unchanged entries, reordering and removals are free`, async () => {
    const { checkApproval } = await load()
    for (const change of [files(null, [entry]), files([entry], [entry]), files([entry], []), files([entry], null)]) {
      assert.deepEqual(checkApproval(change, ''), { failures: [], approvals: [] })
    }
    const other = { ...entry, occurrence: 2 }
    assert.deepEqual(checkApproval(files([entry, other], [other, entry]), '').failures, [])
    assert.deepEqual(checkApproval(files([entry], [Object.fromEntries(Object.entries(entry).reverse())]), '').failures, [])
  })

  test(`${kind}: every added or changed entry requires the exact approval line`, async () => {
    const { checkApproval } = await load()
    for (const change of [files([], [entry]), files([entry], [{ ...entry, expires: '2027-02-01' }]), files([entry], [{ ...entry, sha256: 'a'.repeat(64) }])]) {
      assert.match(checkApproval(change, '').failures[0], new RegExp(`Agent scope ${kind} approved:`))
      assert.deepEqual(checkApproval(change, `Summary\n${line}\n`).failures, [])
      assert.equal(checkApproval(change, `prefix ${line}`).failures.length, 1)
      assert.equal(checkApproval(change, `${line} extra`).failures.length, 1)
      assert.equal(checkApproval(change, `Agent scope ${kind === 'debt' ? 'exception' : 'debt'} approved: ${URL_A}`).failures.length, 1)
    }
  })

  test(`${kind}: malformed URLs fail even when repeated in the body`, async () => {
    const { checkApproval } = await load()
    for (const approvedIn of [undefined, 'HTPR-7496', `${URL_A}/extra`, URL_A.replace('https:', 'http:')]) {
      assert.match(checkApproval(files([], [{ ...entry, approvedIn }]), `Agent scope ${kind} approved: ${approvedIn}`).failures[0], /valid approvedIn/)
    }
  })

  test(`${kind}: distinct changed entries need their own ticket approval`, async () => {
    const { checkApproval } = await load()
    const changes = files([], [entry, { ...entry, occurrence: 2, approvedIn: URL_B }])
    assert.equal(checkApproval(changes, line).failures.length, 1)
    assert.deepEqual(checkApproval(changes, `${line}\r\nAgent scope ${kind} approved: ${URL_B}`).failures, [])
    assert.throws(() => checkApproval([{ file, base: '{', head: '[]' }], ''))
  })
}

const source = file => readFileSync(path.join(__dirname, '..', file), 'utf8')

test('agent scope runs after dependency restore/install even on a cache hit and before Prisma', () => {
  const workflow = source('.github/workflows/ci-tests.yml')
  const job = workflow.slice(workflow.indexOf('  ci-tests:'), workflow.indexOf('  browser-smoke:'))
  const guard = job.match(/      - name: Guard agent board scope\n[\s\S]*?(?=\n      - )/)?.[0]
  assert.ok(guard)
  assert.ok(job.indexOf('name: Restore node_modules cache') < job.indexOf(guard))
  assert.ok(job.indexOf('name: Install dependencies') < job.indexOf(guard))
  assert.ok(job.indexOf(guard) < job.indexOf('name: Generate Prisma client'))
  assert.match(guard, /if: github.event_name == 'push' \|\| steps.scope.outputs.build_needed == 'true'\n/)
  assert.doesNotMatch(guard, /cache-hit|continue-on-error|setup-python/)
  assert.match(guard, /"\$PY312" -m venv "\$RUNNER_TEMP\/agent-scope-venv"/)
  assert.match(guard, /sys.version_info\[:2\] == \(3, 12\)/)
  assert.match(guard, /pip install --require-hashes -r .github\/scripts\/agent-scope\/requirements.txt/)
  assert.match(guard, /run.py --self-test\n\s+python .github\/scripts\/agent-scope\/run.py\n/)
  assert.match(guard, /SEMGREP_SEND_METRICS: "off"/)
  assert.match(guard, /SEMGREP_ENABLE_VERSION_CHECK: "0"/)
  const approval = job.match(/      - name: Agent scope debt needs a recorded approval\n[\s\S]*?(?=\n      - )/)?.[0]
  assert.ok(approval)
  assert.match(approval, /if: github.event_name == 'pull_request'/)
  assert.match(approval, /BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/)
  assert.match(approval, /run: node .github\/scripts\/agent-scope\/baseline-approval.mjs/)
  assert.ok(job.indexOf('git fetch --depth=1 origin "$BASE_SHA" "$HEAD_SHA"') < job.indexOf(approval))
  assert.match(job, /uses: actions\/cache\/restore@0057852bfaa89a56745cba8c7296529d2fc39830[\s\S]*?key: agent-scope-pip-.*hashFiles\('\.github\/scripts\/agent-scope\/requirements.txt'\)/)
})

test('fixtures cannot enter tsc, ESLint or the src inventory and the parser helpers stay explicit', () => {
  const directory = path.join(__dirname, '../.github/scripts/agent-scope/fixtures')
  assert.ok(readdirSync(directory).length >= 6)
  for (const file of readdirSync(directory)) assert.ok(file.endsWith('.ts.fixture'), file)
  const rule = source('.github/scripts/agent-scope/agent-scope.yml')
  for (const helper of ['getProjectWhere', 'getProjectListingWhere', 'projectContentAccessWhere', 'taskWriteAccessWhere', 'savedViewBoardAccessWhere']) {
    assert.ok(rule.includes(`<... ${helper}(...) ...>`), helper)
  }
  assert.doesNotMatch(rule, /getTaskWhere|nosemgrep|exclude:/)
  assert.match(source('.github/scripts/agent-scope/requirements.txt'), /^semgrep==1\.140\.0 \\/m)
  assert.match(source('.github/scripts/agent-scope/requirements.txt'), /^pydantic==2\.11\.9 \\/m)
})
