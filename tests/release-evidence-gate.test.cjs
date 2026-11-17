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

test('inbox evidence follows every inbox file, and downloads skip everything else', async () => {
  const { inboxRecordingPlan, artifactsToFetch, recordingRequired } = await load()
  const mixed = ['src/app/inbox/page.tsx', 'src/lib/auth/session.ts', 'src/lib/auth/token.ts', 'src/proxy.ts']
  const record = { required: true, recordNow: true, upload: true }
  assert.deepEqual(inboxRecordingPlan(mixed, 'login.md'), record)
  assert.deepEqual(inboxRecordingPlan(mixed, null), record)
  assert.deepEqual(inboxRecordingPlan(['src/app/inbox/page.tsx'], 'inbox.md'), { required: true, recordNow: false, upload: true })
  assert.deepEqual(inboxRecordingPlan(['src/lib/auth/session.ts'], 'login.md'), { required: false, recordNow: false, upload: false })
  const listed = [{ name: 'app-build', id: 1 }, { name: 'verify-qa-video-inbox', id: 2 }, { name: 'ci-test-shards', id: 3 }]
  assert.equal(recordingRequired(['src/app/inbox/page.tsx']), true)
  assert.deepEqual(artifactsToFetch(listed, ['src/app/inbox/page.tsx']).map((artifact) => artifact.name), ['verify-qa-video-inbox'])
  assert.equal(recordingRequired(['docs/ci.md']), false)
  assert.deepEqual(artifactsToFetch(listed, ['docs/ci.md']), [])
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
