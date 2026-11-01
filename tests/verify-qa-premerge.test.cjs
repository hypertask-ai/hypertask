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

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-qa-premerge-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('changed pages select their own drivers, never an inbox fallback', async () => {
  const { selectJourney } = await load()
  for (const [file, page, journey] of [
    ['src/app/inbox/page.tsx', 'inbox.md', ['inbox-cycle']],
    ['src/lib/auth/session.ts', 'login.md', ['login']],
    ['src/components/PageComponents/Kanban/index.tsx', 'boards-and-views.md', ['open-board', 'switch-boards', 'drag-card']],
    ['src/components/PageComponents/TaskDetail/index.tsx', 'task-detail-and-description.md', ['open-task', 'edit-description']],
    ['src/pages/api/comments/create.ts', 'comments-and-mentions.md', ['add-comment']],
    ['src/components/RTE/TiptapCreateTaskModal.tsx', 'create-task-attachments.md', ['create-task']],
    ['src/components/Common/newTask.tsx', 'quick-entry-cards.md', ['create-task']],
    ['src/app/api/ai/chat/route.ts', 'ai-chat.md', ['ai-chat']],
    ['src/components/Modals/Settings/BillingSection.tsx', 'billing-and-plans.md', ['plan-check']],
  ]) {
    const choice = selectJourney([file, 'docs/ci.md'])
    assert.equal(choice.matchedPage, page)
    assert.deepEqual(choice.journey, journey)
    assert.equal(choice.featureMap, `.claude/skills/verify-qa/reference/feature-map/${page}`)
    assert.equal(choice.reason, 'matched')
  }
  for (const files of [[], ['docs/ci.md'], ['.github/scripts/verify-qa-premerge.mjs']]) {
    assert.deepEqual(selectJourney(files), {
      matchedPage: null, journey: null, reason: 'no feature-map page matched the diff', featureMap: null, counts: {},
    })
  }
  const unsupported = selectJourney(['src/app/my-tasks/page.tsx'])
  assert.equal(unsupported.matchedPage, 'my-tasks.md')
  assert.equal(unsupported.journey, null)
  assert.equal(unsupported.reason, 'no premerge driver for my-tasks.md')
  const tie = selectJourney(['src/app/inbox/page.tsx', 'src/app/my-tasks/page.tsx'])
  assert.equal(tie.matchedPage, null)
  assert.equal(tie.journey, null)
  assert.match(tie.reason, /tie: inbox\.md, my-tasks\.md/)
})

test('catalog drivers cover the journey tags and refer to real feature-map pages', async () => {
  const { FEATURE_MAP_CATALOG } = await load()
  const source = fs.readFileSync('e2e/smoke/journeys.spec.ts', 'utf8')
  const ids = [...source.matchAll(/idTag\('([^']+)'\)/g)].map((match) => match[1]).sort()
  const mapped = [...new Set(FEATURE_MAP_CATALOG.flatMap((entry) => entry.journey || []))].filter((id) => id !== 'inbox-cycle').sort()
  assert.deepEqual(mapped, ids)
  for (const entry of FEATURE_MAP_CATALOG) {
    assert.equal(fs.existsSync(`.claude/skills/verify-qa/reference/feature-map/${entry.page}`), true, entry.page)
  }
})

test('longest prefix wins and the most changed page wins', async () => {
  const { selectJourney } = await load()
  const choice = selectJourney(['src/pages/api/queues/inboxReminder.ts'], [
    { page: 'queues.md', journey: null, prefixes: ['src/pages/api/queues/'] },
    { page: 'inbox.md', journey: ['inbox-cycle'], prefixes: ['src/pages/api/queues/inboxReminder.ts'] },
  ])
  assert.equal(choice.matchedPage, 'inbox.md')
  assert.deepEqual(choice.journey, ['inbox-cycle'])
  assert.deepEqual(selectJourney(['src/lib/auth/a.ts', 'src/lib/auth/b.ts', 'src/app/inbox/page.tsx']).journey, ['login'])
})

test('the journey refuses any base that is not the loopback PR build', async () => {
  const { assertLoopback } = await load()
  assert.equal(assertLoopback('http://127.0.0.1:3100'), 'http://127.0.0.1:3100')
  assert.equal(assertLoopback('http://localhost:3100/inbox'), 'http://localhost:3100')
  assert.throws(() => assertLoopback('https://app.hypertask.ai'), /refuses non-loopback base app\.hypertask\.ai/)
  assert.throws(() => assertLoopback('https://127.0.0.1:3100'), /non-http/)
})

test('tagged runner passes selected IDs, PR base and opt-in to Playwright and evaluates its report', async (t) => {
  const { runTaggedJourneys, selectJourney } = await load()
  const outDir = tempDir(t)
  for (const [statuses, exit, verdict] of [
    [['passed', 'passed'], 0, 'PASS'],
    [['passed', 'failed'], 1, 'FAIL'],
    [['skipped', 'skipped'], 0, 'UNREACHABLE'],
    [[], 0, 'UNREACHABLE'],
    [['passed', 'passed'], 1, 'FAIL'],
  ]) {
    const result = await runTaggedJourneys({
      base: 'http://127.0.0.1:3100', outDir,
      journey: selectJourney(['src/components/PageComponents/TaskDetail/index.tsx']).journey,
    }, (command, args, options) => {
      assert.equal(command, process.execPath)
      assert.equal(args[0], path.join(process.cwd(), 'node_modules/@playwright/test/cli.js'))
      assert.deepEqual(args.slice(1), [
        'test', '-c', 'playwright.config.smoke.ts', '--project=journeys',
        '--grep', '@id:(open-task|edit-description)(\\s|$)',
        '--workers=1', '--retries=0', '--global-timeout=140000', '--reporter=json',
        `--output=${path.join(outDir, 'test-results')}`,
      ])
      assert.equal(options.env.BASE_URL, 'http://127.0.0.1:3100')
      assert.equal(options.env.SMOKE_BASE_URL, 'http://127.0.0.1:3100')
      assert.equal(options.env.HT_QA_JOURNEYS, '1')
      assert.equal(options.env.HT_QA_TIER, '')
      assert.equal(options.env.HT_QA_EXPECTED_PLAN, 'Free')
      assert.equal(options.cwd, process.cwd())
      fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_NAME, JSON.stringify({ suites: [{ specs: statuses.map((status, i) => ({
        tags: [`id:${['open-task', 'edit-description'][i]}`],
        tests: [{ results: [{ status }] }],
      })) }] }))
      return { status: exit }
    })
    assert.equal(result.verdict, verdict)
    assert.deepEqual(result.steps.map((step) => step.name), ['open-task', 'edit-description'])
    assert.deepEqual(result.steps.map((step) => step.pass), ['open-task', 'edit-description'].map((_, i) => statuses[i] === 'passed'))
  }
  await assert.rejects(runTaggedJourneys({ base: 'http://127.0.0.1:3100', journey: ['login'], outDir }, () => ({ error: new Error('timed out') })), /journey runner: timed out/)
})

test('unmatched, unsupported and tied diffs write UNREACHABLE without loading a browser or fixture', (t) => {
  const dir = tempDir(t)
  const changed = path.join(dir, 'changed.txt')
  for (const [index, files] of [
    ['unmatched', ['docs/ci.md']],
    ['unsupported', ['src/app/my-tasks/page.tsx']],
    ['tie', ['src/app/inbox/page.tsx', 'src/app/my-tasks/page.tsx']],
  ]) {
    fs.writeFileSync(changed, files.join('\n'))
    const out = path.join(dir, index)
    const summary = path.join(dir, `${index}.md`)
    const child = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {
      ...process.env, VERIFY_QA_REPORT_ONLY: '1', VERIFY_QA_BASE: '',
      VERIFY_QA_CHANGED_FILES: changed, VERIFY_QA_OUT: out, GITHUB_STEP_SUMMARY: summary,
      VERIFY_QA_STATE_FILE: path.join(dir, 'missing-state'), VERIFY_QA_FIXTURE: path.join(dir, 'missing-fixture'),
    } })
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /::warning::verify-qa UNREACHABLE: no driver:/)
    const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
    assert.equal(result.verdict, 'UNREACHABLE')
    assert.equal(result.journey, null)
    assert.deepEqual(result.steps, [])
    assert.match(fs.readFileSync(summary, 'utf8'), /Verdict: \*\*UNREACHABLE\*\*/)
    assert.doesNotMatch(child.stdout, /verify-qa ok/)
  }
})

test('report-only mode records a production refusal as a warning and still exits 0', (t) => {
  const dir = tempDir(t)
  const changed = path.join(dir, 'changed.txt')
  fs.writeFileSync(changed, 'src/app/inbox/Inbox.tsx\n')
  for (const reportOnly of ['1', '0']) {
    const out = path.join(dir, reportOnly)
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: {
      ...process.env, VERIFY_QA_REPORT_ONLY: reportOnly, VERIFY_QA_BASE: 'https://app.hypertask.ai',
      VERIFY_QA_CHANGED_FILES: changed, VERIFY_QA_OUT: out,
    } })
    assert.equal(result.status, reportOnly === '1' ? 0 : 1, result.stderr)
    assert.match(result.stdout, /::warning::verify-qa FAIL:/)
    const evidence = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
    assert.equal(evidence.verdict, 'FAIL')
    assert.deepEqual(evidence.journey, ['inbox-cycle'])
    assert.match(evidence.failure, /refuses non-loopback/)
  }
})

test('browser-smoke runs report-only on the existing build and uploads evidence', () => {
  const workflow = fs.readFileSync('.github/workflows/ci-tests.yml', 'utf8')
  const policy = fs.readFileSync('docs/ci-policy.yml', 'utf8')
  const job = workflow.slice(workflow.indexOf('\n  browser-smoke-flags:'), workflow.indexOf('\n  browser-smoke:\n'))
  assert.ok(job.length > 0)
  assert.doesNotMatch(job, /continue-on-error:\s*true/)
  assert.match(policy, /premerge_verify_qa:[\s\S]*?required: false\n  report_only: true\n  blocks_merge: false\n/)
  assert.match(policy, /unmatched_verdict: "UNREACHABLE: no driver"/)
  const required = policy.slice(policy.indexOf('required_checks:'), policy.indexOf('\n\n', policy.indexOf('required_checks:')))
  assert.doesNotMatch(required, /verify-qa-premerge/)
  const desktop = workflow.slice(workflow.indexOf('\n  browser-smoke-desktop:'), workflow.indexOf('\n  browser-smoke-mobile:'))
  assert.match(desktop, /node scripts\/mcp-cli-api-contract\.mjs/)
  const reportAt = job.indexOf('set +e')
  const journeyAt = job.indexOf('node .github/scripts/verify-qa-premerge.mjs')
  assert.ok(reportAt > 0 && reportAt < journeyAt)
  assert.match(job, /VERIFY_QA_REPORT_ONLY=1/)
  assert.match(job, /timeout --signal=TERM --kill-after=20s 160s node \.github\/scripts\/verify-qa-premerge\.mjs/)
  assert.match(job, /verify-qa premerge journey exited/)
  assert.match(job, /VERIFY_QA_OUT=verify-qa-premerge\/matched-control/)
  assert.match(job, /name: Upload premerge verify-qa evidence[\s\S]*if: always\(\) && \(github.event_name == 'push' \|\| steps.scope.outputs.heavy_needed == 'true'\)[\s\S]*name: verify-qa-premerge[\s\S]*if-no-files-found: ignore/)
  assert.match(job, /name: Link premerge verify-qa evidence[\s\S]*artifact-url/)
})
