const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { decide, classify } = require('../scripts/driven-proof.cjs')
const { writeRecord } = require('../scripts/driven-proof-record.cjs')

const root = path.join(__dirname, '..')
const head = 'a'.repeat(40)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const replay = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/driven-proof/replay.json'), 'utf8'))

function temp(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'driven-proof-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function seededRun(t, { verdict = 'PASS', base = 'http://127.0.0.1:3100', featureMap = '.claude/skills/verify-qa/reference/feature-map/inbox.md', screenshot = true, steps = [{ name: 'inbox-cycle', pass: true }] } = {}) {
  const dir = temp(t)
  const out = path.join(dir, 'out')
  const dest = path.join(dir, 'record')
  mkdirSync(out, { recursive: true })
  if (screenshot) writeFileSync(path.join(out, '01-inbox.png'), png)
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    verdict,
    featureMap,
    base,
    failure: verdict === 'PASS' ? null : 'journey failed',
    selectionReason: verdict === 'PASS' ? 'matched' : 'no driver',
    steps,
    screenshots: screenshot ? ['01-inbox.png'] : [],
  }))
  writeRecord({ out, dest, head, root, run: '2026-11-11-qa-run-1' })
  return dest
}

test('docs, tests, and CI pass with no drive, and a screen file does not', () => {
  assert.equal(decide({ files: ['docs/ci.md', 'tests/driven-proof.test.cjs', '.github/workflows/ci-tests.yml', 'scripts/driven-proof.cjs'], recordDir: null, head, root }).detail, 'exempt: ci, docs, test')
  assert.equal(classify(['src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx']).exempt, false)
  assert.equal(classify(['README.md']).kinds.join(','), 'docs')
  assert.equal(classify(['src/app/wiki/agents/agents.md']).exempt, false)
  assert.equal(classify([]).reason, 'empty or unknown diff')
  assert.equal(decide({ files: [], recordDir: null, head, root }).detail, 'empty or unknown diff')
})

test('a screen change with no proof record fails, and the same change with a seeded run passes', (t) => {
  const files = replay['3066'].files
  const missing = decide({ files, recordDir: null, head, root })
  assert.equal(missing.verdict, 'FAIL')
  assert.match(missing.detail, /^no proof record/)
  const recordDir = seededRun(t)
  const present = decide({ files, recordDir, head, root })
  assert.equal(present.verdict, 'PASS')
  assert.equal(present.detail, 'seeded .claude/skills/verify-qa/reference/feature-map/inbox.md')
})

test('replaying the eight merged pull requests without a proof record is red', () => {
  assert.deepEqual(Object.keys(replay).sort(), ['3042', '3044', '3050', '3058', '3062', '3066', '3067', '3076'])
  for (const [number, pull] of Object.entries(replay)) {
    const result = decide({ files: pull.files, recordDir: null, head, root })
    assert.equal(result.verdict, 'FAIL', number)
    assert.match(result.detail, /^no proof record/, `${number} ${pull.title}`)
  }
})

test('a failed, production, or screenshot-free drive does not become a proof record', (t) => {
  const files = ['src/app/inbox/page.tsx']
  const failed = seededRun(t, { verdict: 'FAIL' })
  assert.match(decide({ files, recordDir: failed, head, root }).detail, /no proof record \(FAIL:/)
  const production = seededRun(t, { base: 'https://app.hypertask.ai' })
  assert.equal(decide({ files, recordDir: production, head, root }).detail, 'no proof record (FAIL: drive was not the seeded loopback app)')
  const blind = seededRun(t, { screenshot: false })
  assert.equal(decide({ files, recordDir: blind, head, root }).detail, 'no proof record (FAIL: drive produced no screenshot)')
})

test('a proof record aimed at production is red', (t) => {
  const dir = temp(t)
  const run = path.join(dir, '2026-11-11-qa-run-1')
  mkdirSync(run, { recursive: true })
  writeFileSync(path.join(run, '01.png'), png)
  const featureMap = '.claude/skills/verify-qa/reference/feature-map/inbox.md'
  writeFileSync(path.join(dir, 'proof.md'), `Feature map: ${featureMap}\nSource: preview\nHead: ${head}\nRun: 2026-11-11-qa-run-1\n\n## Cases\n- PASS: open -> 01.png\n`)
  writeFileSync(path.join(dir, 'decision.json'), JSON.stringify({
    verdict: 'PASS', head, featureMap, source: 'preview', base: 'https://app.hypertask.ai', reason: null,
  }))
  assert.equal(decide({ files: ['src/app/inbox/page.tsx'], recordDir: dir, head, root }).detail, 'proof drives production')
})

test('the check is report-only and is not part of the required browser-smoke result', () => {
  const yaml = require('js-yaml')
  const workflow = yaml.load(readFileSync(path.join(root, '.github/workflows/ci-tests.yml'), 'utf8'))
  const policy = yaml.load(readFileSync(path.join(root, 'docs/ci-policy.yml'), 'utf8'))
  const job = workflow.jobs['driven-proof']
  assert.equal(job.name, 'driven-proof')
  assert.equal(job['continue-on-error'], undefined)
  assert.deepEqual(job.needs, ['browser-smoke-flags'])
  assert.equal(job['timeout-minutes'], 10)
  assert.equal(workflow.jobs['browser-smoke'].needs.includes('driven-proof'), false)
  const flags = workflow.jobs['browser-smoke-flags']
  assert.ok(flags.steps.some((step) => String(step.run || '').includes('node scripts/driven-proof-record.cjs')))
  assert.ok(flags.steps.some((step) => step.with && step.with.name === 'driven-proof-record'))
  assert.equal(policy.driven_proof.required, false)
  assert.equal(policy.driven_proof.report_only, true)
  assert.equal(policy.driven_proof.blocks_merge, false)
  assert.equal(policy.required_checks.contexts.includes('driven-proof'), false)
  assert.match(readFileSync(path.join(root, 'docs/ci.md'), 'utf8'), /Docs: `docs\/\*\*` and any Markdown file outside `src\/`/)
})
