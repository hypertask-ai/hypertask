const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const script = pathToFileURL(resolve('.github/scripts/production-gate.mjs')).href
const sha = 'a'.repeat(40)
const pushRun = (id, status = 'completed', conclusion = 'success') => ({ id, head_sha: sha, event: 'push', status, conclusion })

async function run({ freeze = '', runs, jobs, status = 200 } = {}) {
  const paths = []
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname + new URL(url).search
    paths.push(path)
    const value = path.includes('/commits/production') ? { sha }
      : path.includes('/actions/workflows?') ? { workflows: [{ id: 5, path: '.github/workflows/prod-health.yml' }] }
      : path.includes('/actions/workflows/5/runs?') ? { workflow_runs: runs === undefined ? [pushRun(9)] : runs }
      : { jobs: jobs === undefined ? [{ name: 'smoke', conclusion: 'success' }] : jobs }
    return { ok: status === 200, status, json: async () => value }
  }
  const { checkProductionGate } = await import(script)
  return { reason: await checkProductionGate({ repo: 'owner/repo', mergeFreeze: freeze, fetchImpl }), paths }
}

test('freeze blocks without reading production', async () => {
  const { reason, paths } = await run({ freeze: 'yes' })
  assert.match(reason, /MERGE_FREEZE/)
  assert.deepEqual(paths, [])
})

test('latest push run for production head blocks on smoke failure', async () => {
  const { reason, paths } = await run({
    runs: [pushRun(9), pushRun(8)],
    jobs: [{ name: 'health', conclusion: 'success' }, { name: 'smoke', conclusion: 'failure' }],
  })
  assert.match(reason, /smoke failure \(run 9\)/)
  assert.ok(paths.some((path) => path.includes(`head_sha=${sha}&event=push`)))
  assert.ok(paths.some((path) => path.includes('/actions/runs/9/jobs')))
})

test('only the newest push run for production head can permit merging', async () => {
  const unrelated = { id: 12, head_sha: sha, event: 'schedule', status: 'completed' }
  const oldHead = { id: 11, head_sha: 'b'.repeat(40), event: 'push', status: 'completed' }
  const { reason, paths } = await run({ runs: [unrelated, oldHead, pushRun(10)] })
  assert.equal(reason, null)
  assert.ok(paths.some((path) => path.includes('/actions/runs/10/jobs')))
  assert.ok(!paths.some((path) => path.includes('/actions/runs/12/jobs')))
  for (const runs of [
    [unrelated, oldHead],
    [pushRun(9), pushRun(10, 'in_progress')],
    [pushRun(10, 'queued'), pushRun(9)],
    [pushRun(9), pushRun(10, 'completed')],
  ]) {
    const result = await run({ runs, jobs: [{ name: 'smoke', conclusion: 'failure' }] })
    assert.match(result.reason, /no push prod-health run|run 10 is (in_progress|queued)|smoke failure \(run 10\)/)
    assert.ok(!result.paths.some((path) => path.includes('/actions/runs/9/jobs')))
  }
})

test('pending or missing push run blocks without checking older jobs', async () => {
  for (const runs of [[], [pushRun(9, 'in_progress')], [pushRun(9, 'cancelled')]]) {
    const { reason, paths } = await run({ runs })
    assert.match(reason, /no push prod-health run|is in_progress|is cancelled/)
    assert.ok(!paths.some((path) => path.includes('/jobs?')))
  }
})

test('completed but cancelled, skipped or unreadable runs block even if smoke succeeded earlier', async () => {
  for (const conclusion of ['cancelled', 'skipped', null]) {
    const { reason, paths } = await run({ runs: [pushRun(9, 'completed', conclusion)] })
    assert.match(reason, /run 9 concluded (cancelled|skipped|unreadable)/)
    assert.ok(!paths.some((path) => path.includes('/jobs?')))
  }
})

test('only successful smoke permits merging', async () => {
  assert.equal((await run()).reason, null)
  assert.equal((await run({ runs: [pushRun(9, 'completed', 'failure')] })).reason, null)
  for (const jobs of [
    [{ name: 'smoke', conclusion: 'skipped' }],
    [{ name: 'smoke', conclusion: 'cancelled' }],
    [{ name: 'smoke', conclusion: null }],
    [{ name: 'health', conclusion: 'success' }],
  ]) {
    assert.match((await run({ jobs })).reason, /smoke (skipped|cancelled|missing or unreadable)/)
  }
})

test('GitHub read failures and unreadable results fail closed', async () => {
  await assert.rejects(run({ status: 503 }), /GitHub read failed for commits\/production: HTTP 503/)
  await assert.rejects(run({ runs: null }), /prod-health runs are unreadable/)
  await assert.rejects(run({ jobs: null }), /jobs are unreadable/)
})
