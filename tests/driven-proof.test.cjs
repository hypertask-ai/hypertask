const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { decide, classify, controlNeeded } = require('../scripts/driven-proof.cjs')

const root = path.join(__dirname, '..')
const head = 'a'.repeat(40)
const files = ['src/pages/api/notifications/getAll.ts']
const featureMap = '.claude/skills/verify-qa/reference/feature-map/inbox.md'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const replay = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/driven-proof/replay.json'), 'utf8'))

function seededRun(t, overrides = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'driven-proof-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, '01-inbox.png'), png)
  writeFileSync(path.join(dir, 'result.json'), JSON.stringify({
    verdict: 'PASS', head, featureMap, base: 'http://127.0.0.1:3100',
    steps: [{ name: 'inbox-cycle', pass: true }], screenshots: ['01-inbox.png'], ...overrides,
  }))
  return dir
}

async function check(recordDir, options = {}) {
  return decide({ files, recordDir, head, root, ...options })
}

test('docs, tests, and CI pass without a drive; runtime and unknown diffs do not', async () => {
  assert.equal((await check(null, { files: ['docs/ci.md', 'tests/driven-proof.test.cjs', '.github/workflows/ci-tests.yml', 'scripts/driven-proof.cjs'] })).detail, 'exempt: ci, docs, test')
  assert.equal(classify(['src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx']).exempt, false)
  assert.equal(classify(['README.md']).kinds.join(','), 'docs')
  assert.equal(classify(['src/app/wiki/agents/agents.md']).exempt, false)
  assert.equal((await check(null, { files: [] })).verdict, 'FAIL')
  assert.equal((await check(null)).verdict, 'FAIL')
})

test('a screen change needs current-head seeded proof for its own feature', async (t) => {
  const recordDir = seededRun(t)
  assert.equal((await check(recordDir)).detail, `seeded ${featureMap}`)
  for (const options of [{ head: 'b'.repeat(40) }, { head: '' }, { files: replay['3066'].files }]) {
    assert.equal((await check(recordDir, options)).verdict, 'FAIL')
  }
})

test('a majority-feature drive cannot cover another feature or an unmapped app file', async (t) => {
  const recordDir = seededRun(t)
  const inboxFiles = [...files, 'src/app/inbox/Inbox.tsx']
  assert.equal((await check(recordDir, { files: [...inboxFiles, 'docs/ci.md'] })).verdict, 'PASS')
  for (const extra of ['src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx', 'src/app/unmapped/page.tsx']) {
    assert.equal((await check(recordDir, { files: [...inboxFiles, extra] })).detail, 'proof does not cover the changed feature')
  }
})

test('exempt catalog paths cannot change the feature required by runtime changes', async (t) => {
  const boardFiles = ['src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx']
  const boardMap = '.claude/skills/verify-qa/reference/feature-map/boards-and-views.md'
  const recordDir = seededRun(t, { featureMap: boardMap, steps: ['open-board', 'switch-boards', 'drag-card'].map((name) => ({ name, pass: true })) })
  const mixedFiles = [...boardFiles, '.claude/skills/verify-qa/scripts/inbox-cycle-live.mjs']
  assert.equal((await check(recordDir, { files: mixedFiles })).detail, `seeded ${boardMap}`)
  assert.equal((await check(seededRun(t), { files: mixedFiles })).verdict, 'FAIL')
  assert.equal((await check(recordDir, { files: [...mixedFiles, ...files] })).verdict, 'FAIL')
})

test('replaying the eight merged pull requests without proof is red, including 3066', async () => {
  assert.deepEqual(Object.keys(replay).sort(), ['3042', '3044', '3050', '3058', '3062', '3066', '3067', '3076'])
  for (const [number, pull] of Object.entries(replay)) {
    assert.equal((await check(null, { files: pull.files })).verdict, 'FAIL', `${number} ${pull.title}`)
  }
})

test('failed, empty, wrong-feature, production and malformed evidence is refused', async (t) => {
  for (const overrides of [
    { verdict: 'FAIL' }, { verdict: 'UNREACHABLE' }, { steps: [] }, { steps: [{ pass: false }] },
    { featureMap: '../inbox.md' }, { featureMap: '.claude/skills/verify-qa/reference/feature-map/login.md' },
    { base: 'https://app.hypertask.ai' }, { screenshots: [] }, { screenshots: ['../outside.png'] },
    { screenshots: ['/tmp/outside.png'] }, { screenshots: ['missing.png'] },
  ]) assert.equal((await check(seededRun(t, overrides))).verdict, 'FAIL', JSON.stringify(overrides))
  const dir = seededRun(t)
  writeFileSync(path.join(dir, '01-inbox.png'), 'not a screenshot')
  assert.equal((await check(dir)).detail, 'invalid screenshot')
  writeFileSync(path.join(dir, 'result.json'), 'broken json')
  assert.equal((await check(dir)).verdict, 'FAIL')
})

test('report-only check reuses real seeded evidence, checks failed producers, and exercises a real control', () => {
  const yaml = require('js-yaml')
  const workflow = yaml.load(readFileSync(path.join(root, '.github/workflows/ci-tests.yml'), 'utf8'))
  const policy = yaml.load(readFileSync(path.join(root, 'docs/ci-policy.yml'), 'utf8'))
  const job = workflow.jobs['driven-proof']
  assert.equal(job.name, 'driven-proof')
  assert.deepEqual(job.needs, ['browser-smoke-flags'])
  assert.match(job.if, /always\(\)/)
  assert.equal(job['continue-on-error'], undefined)
  assert.equal(workflow.jobs['browser-smoke'].needs.includes('driven-proof'), false)
  assert.ok(job.steps.some((step) => step.with?.name === 'verify-qa-premerge'))
  assert.ok(job.steps.some((step) => String(step.run || '').includes('node scripts/driven-proof.cjs --control')))
  assert.equal(policy.driven_proof.required, false)
  assert.equal(policy.driven_proof.report_only, true)
  assert.equal(policy.required_checks.contexts.includes('driven-proof'), false)
  assert.match(readFileSync(path.join(root, 'docs/ci.md'), 'utf8'), /Docs: `docs\/\*\*` and any Markdown file outside `src\/`/)
  const smoke = workflow.jobs['browser-smoke-flags'].steps.find((step) => step.id === 'smoke')
  assert.match(smoke.run, /grep -Eq '\^scripts\/driven-proof\\\.cjs\$'/)
  assert.doesNotMatch(smoke.run, /tests\/driven-proof\.test\.cjs/)
})

test('a test-only edit does not ask for a seeded control the heavy lane will not produce', () => {
  assert.equal(controlNeeded(['tests/driven-proof.test.cjs']), false)
  assert.equal(controlNeeded(['tests/driven-proof.test.cjs', 'docs/ci.md']), false)
  assert.equal(controlNeeded(['scripts/driven-proof.cjs']), true)
  assert.equal(controlNeeded(['scripts/driven-proof.cjs', 'tests/driven-proof.test.cjs']), true)
})
