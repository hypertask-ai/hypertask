const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const script = path.join(process.cwd(), '.github/scripts/verify-qa-premerge.mjs')

async function load() {
  return import(script)
}

test('changed inbox files select the inbox cycle and other diffs fall back to it', async () => {
  const { selectJourney } = await load()
  const inbox = selectJourney([
    'src/app/inbox/page.tsx',
    'docs/ci.md',
  ])
  assert.equal(inbox.matchedPage, 'inbox.md')
  assert.equal(inbox.journey, 'inbox-cycle')
  assert.equal(inbox.fallback, false)
  assert.equal(inbox.featureMap, '.claude/skills/verify-qa/reference/feature-map/inbox.md')

  const fallback = selectJourney([
    '.github/workflows/ci-tests.yml',
    '.github/scripts/verify-qa-premerge.mjs',
    'docs/ci.md',
  ])
  assert.equal(fallback.matchedPage, null)
  assert.equal(fallback.journey, 'inbox-cycle')
  assert.equal(fallback.fallback, true)
  assert.equal(fallback.reason, 'no feature-map page matched the diff')
  assert.equal(fallback.featureMap, '.claude/skills/verify-qa/reference/feature-map/inbox.md')

  const login = selectJourney(['src/lib/auth/session.ts'])
  assert.equal(login.matchedPage, 'login.md')
  assert.equal(login.fallback, true)
  assert.equal(login.journey, 'inbox-cycle')
  assert.match(login.reason, /no premerge driver for login\.md/)

  const tie = selectJourney(['src/app/inbox/page.tsx', 'src/app/my-tasks/page.tsx'])
  assert.equal(tie.matchedPage, null)
  assert.equal(tie.fallback, true)
  assert.match(tie.reason, /tie: /)
  assert.match(tie.reason, /inbox\.md/)
  assert.match(tie.reason, /my-tasks\.md/)
})

test('longest prefix wins when a file sits under two catalog prefixes', async () => {
  const { selectJourney } = await load()
  const choice = selectJourney(['src/pages/api/queues/inboxReminder.ts'], [
    { page: 'queues.md', journey: null, prefixes: ['src/pages/api/queues/'] },
    { page: 'inbox.md', journey: 'inbox-cycle', prefixes: ['src/pages/api/queues/inboxReminder.ts'] },
  ])
  assert.equal(choice.matchedPage, 'inbox.md')
  assert.equal(choice.fallback, false)
})

test('the journey refuses any base that is not the loopback PR build', async () => {
  const { assertLoopback } = await load()
  assert.equal(assertLoopback('http://127.0.0.1:3100'), 'http://127.0.0.1:3100')
  assert.equal(assertLoopback('http://localhost:3100/inbox'), 'http://localhost:3100')
  assert.throws(() => assertLoopback('https://app.hypertask.ai'), /refuses non-loopback base app\.hypertask\.ai/)
  assert.throws(() => assertLoopback('https://127.0.0.1:3100'), /non-http/)
})

test('report-only mode records a refusal and still exits 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-qa-premerge-'))
  const changed = path.join(dir, 'changed.txt')
  fs.writeFileSync(changed, 'src/app/inbox/Inbox.tsx\n')
  const out = path.join(dir, 'out')
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VERIFY_QA_REPORT_ONLY: '1',
      VERIFY_QA_BASE: 'https://app.hypertask.ai',
      VERIFY_QA_CHANGED_FILES: changed,
      VERIFY_QA_OUT: out,
      VERIFY_QA_STATE_FILE: path.join(dir, 'missing-state.json'),
      VERIFY_QA_FIXTURE: path.join(dir, 'missing-fixture.json'),
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /verify-qa FAIL:/)
  const evidence = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
  assert.equal(evidence.verdict, 'FAIL')
  assert.equal(evidence.journey, 'inbox-cycle')
  assert.equal(evidence.fallback, false)
  assert.match(evidence.failure, /refuses non-loopback/)
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'summary.md'), 'utf8'), /eyJ/)
  const blocking = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VERIFY_QA_REPORT_ONLY: '0',
      VERIFY_QA_BASE: 'https://app.hypertask.ai',
      VERIFY_QA_OUT: path.join(dir, 'blocking'),
    },
  })
  assert.equal(blocking.status, 1)
})

test('browser-smoke runs the journey report-only on the existing build and uploads evidence', () => {
  const workflow = fs.readFileSync('.github/workflows/ci-tests.yml', 'utf8')
  const policy = fs.readFileSync('docs/ci-policy.yml', 'utf8')
  const job = workflow.slice(workflow.indexOf('\n  browser-smoke:'), workflow.indexOf('\n  mcp-cli-api-contract:'))
  assert.ok(job.length > 0)
  assert.doesNotMatch(job, /continue-on-error:\s*true/)
  assert.match(policy, /premerge_verify_qa:\n  ticket: https:\/\/app\.hypertask\.ai\/detail\/project-4060\/673\n  context: browser-smoke\n  required: false\n  report_only: true\n  blocks_merge: false\n/)
  assert.match(policy, /default_journey: inbox-cycle\n/)
  const required = policy.slice(policy.indexOf('required_checks:'), policy.indexOf('\n\n', policy.indexOf('required_checks:')))
  assert.doesNotMatch(required, /verify-qa-premerge/)
  const contractAt = job.indexOf('node scripts/mcp-cli-api-contract.mjs')
  const reportAt = job.indexOf('set +e')
  const journeyAt = job.indexOf('node .github/scripts/verify-qa-premerge.mjs')
  assert.ok(contractAt > 0 && contractAt < reportAt && reportAt < journeyAt)
  assert.match(job, /VERIFY_QA_REPORT_ONLY=1/)
  assert.match(job, /timeout --signal=TERM --kill-after=20s 160s node \.github\/scripts\/verify-qa-premerge\.mjs/)
  assert.match(job, /verify-qa premerge journey exited/)
  assert.match(job, /name: Upload premerge verify-qa evidence[\s\S]*if: always\(\)[\s\S]*name: verify-qa-premerge[\s\S]*if-no-files-found: ignore/)
  assert.match(job, /name: Link premerge verify-qa evidence[\s\S]*artifact-url/)
  const uploadIf = job.slice(job.indexOf('name: Upload premerge verify-qa evidence'), job.indexOf('name: Link premerge verify-qa evidence'))
  assert.doesNotMatch(uploadIf, /failure\(\)/)
})
