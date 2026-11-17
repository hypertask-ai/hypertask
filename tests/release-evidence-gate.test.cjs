const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const script = path.join(process.cwd(), '.github/scripts/release-evidence-gate.mjs')

async function load() {
  return import(script)
}

test('an inbox change without the recorded video blocks the release and names the area', async () => {
  const { evaluate, failureMessage } = await load()
  const result = evaluate({
    files: ['src/app/inbox/page.tsx', 'src/app/inbox/actions.ts'],
    artifacts: [{ name: 'ci-test-shards', files: ['shard-0.json'] }],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, [{ page: 'inbox.md', artifact: 'verify-qa-video-inbox' }])
  const message = failureMessage(result, { pr: 3474, sha: 'abc123' })
  assert.match(message, /inbox\.md/)
  assert.match(message, /verify-qa-video-inbox/)
  assert.match(message, /PR #3474/)
})

test('the same inbox change passes once the recorded video is on the pull request', async () => {
  const { evaluate } = await load()
  const result = evaluate({
    files: ['src/app/inbox/page.tsx'],
    artifacts: [
      { name: 'verify-qa-premerge', files: ['result.json', '01-inbox.png'] },
      { name: 'verify-qa-video-inbox', files: ['test-results/inbox-cycle/video.webm'] },
    ],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.covered, [{ page: 'inbox.md', artifact: 'verify-qa-video-inbox' }])
})

test('an artifact with no recording inside it never counts as evidence', async () => {
  const { evaluate } = await load()
  const result = evaluate({
    files: ['src/pages/api/notifications/getAll.ts'],
    artifacts: [{ name: 'verify-qa-video-inbox', files: ['result.json', 'summary.md'] }],
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, [{ page: 'inbox.md', artifact: 'verify-qa-video-inbox' }])
})

test('changes outside a page with a recording rule are listed, never blocked', async () => {
  const { evaluate } = await load()
  const result = evaluate({
    files: ['docs/ci.md', '.github/workflows/prod-health.yml', 'tests/release-evidence-gate.test.cjs'],
    artifacts: [],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.pages, [])
  assert.deepEqual(result.gated, [])
})

test('a page with no recording rule is reported as ungated and does not block', async () => {
  const { evaluate } = await load()
  const result = evaluate({ files: ['src/lib/auth/session.ts'], artifacts: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.gated, [])
  assert.deepEqual(result.ungated, ['login.md'])
})

test('the command line reads a pull request and a commit sha', async () => {
  const { parseArgs } = await load()
  const previous = process.env.GITHUB_REPOSITORY
  delete process.env.GITHUB_REPOSITORY
  try {
    assert.deepEqual(parseArgs(['--repo', 'hypertask-ai/hypertask', '--pr', '3474']), {
      repo: 'hypertask-ai/hypertask', pr: 3474, sha: null,
    })
    assert.deepEqual(parseArgs(['--sha', 'abc123']), { repo: '', pr: null, sha: 'abc123' })
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY
    else process.env.GITHUB_REPOSITORY = previous
  }
})

test('artifact lookup uses the pull request head, not the production merge commit', async () => {
  const { evidenceSha } = await load()
  assert.equal(evidenceSha({ headSha: 'head-sha' }, 'merge-sha'), 'head-sha')
  assert.equal(evidenceSha({ headSha: '' }, 'merge-sha'), 'merge-sha')
  assert.equal(evidenceSha(null, 'merge-sha'), 'merge-sha')
})

test('a saved zip lists its recording names', async () => {
  const { listZipEntries } = await load()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-evidence-test-'))
  try {
    const zip = path.join(dir, 'artifact.zip')
    const packed = spawnSync('python3', ['-c', [
      'import sys, zipfile',
      'with zipfile.ZipFile(sys.argv[1], "w") as archive:',
      '    archive.writestr("test-results/inbox-cycle/video.webm", b"pixels")',
    ].join('\n'), zip], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
    assert.deepEqual(listZipEntries(zip), ['test-results/inbox-cycle/video.webm'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
