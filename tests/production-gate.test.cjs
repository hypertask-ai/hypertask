const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { resolve } = require('node:path')

const script = pathToFileURL(resolve('.github/scripts/production-gate.mjs')).href
const sha = 'a'.repeat(40)

async function run({ freeze = '', runs, jobs, status = 200 } = {}) {
  const paths = []
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname + new URL(url).search
    paths.push(path)
    const value = path.includes('/commits/production') ? { sha }
      : path.includes('/actions/workflows?') ? { workflows: [{ id: 5, path: '.github/workflows/prod-health.yml' }] }
      : path.includes('/actions/workflows/5/runs?') ? { workflow_runs: runs ?? [{ id: 9, head_sha: sha, status: 'completed' }] }
      : { jobs: jobs ?? [{ name: 'smoke', conclusion: 'success' }] }
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

test('latest completed run for production head blocks on smoke failure', async () => {
  const { reason, paths } = await run({
    runs: [{ id: 9, head_sha: sha, status: 'completed' }, { id: 8, head_sha: sha, status: 'completed' }],
    jobs: [{ name: 'health', conclusion: 'success' }, { name: 'smoke', conclusion: 'failure' }],
  })
  assert.match(reason, /smoke failed \(run 9\)/)
  assert.ok(paths.some((path) => path.includes(`head_sha=${sha}&status=completed`)))
  assert.ok(paths.some((path) => path.includes('/actions/runs/9/jobs')))
})

test('pending or missing health run does not block', async () => {
  for (const runs of [[], [{ id: 9, head_sha: sha, status: 'in_progress' }]]) {
    const { reason, paths } = await run({ runs })
    assert.equal(reason, null)
    assert.ok(!paths.some((path) => path.includes('/jobs?')))
  }
})

test('green or skipped smoke does not block', async () => {
  for (const conclusion of ['success', 'skipped']) {
    assert.equal((await run({ jobs: [{ name: 'smoke', conclusion }] })).reason, null)
  }
})

test('GitHub read failures fail closed', async () => {
  await assert.rejects(run({ status: 503 }), /GitHub read failed: 503/)
})
