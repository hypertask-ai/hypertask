const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

async function workflowScript() {
  const workflow = await readFile('.github/workflows/automerge.yml', 'utf8')
  const marker = '        run: |\n'
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1)
  return workflow
    .slice(start + marker.length)
    .split('\n')
    .map((line) => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n')
}

async function runWorkflow({ failTemp = false, failList = false, failView = false, malformedView = false, failLabels = false, failMerge = false, failMergeability = false, unknownMergeability = false, speed = false, speedQa = true, speedQaCreator = 'owner', title, previousSpeedTitle = false, changedFile = 'src/safe.ts', comments } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'automerge-workflow-'))
  const bin = join(directory, 'bin')
  const runnerTemp = join(directory, 'runner-temp')
  await mkdir(bin)
  await mkdir(runnerTemp)

  const head = 'a'.repeat(40)
  const prTitle = title ?? (speed ? '[SPEED] Optimize the app' : 'Safe change')
  const commentsJson = JSON.stringify(comments ?? [{ body: `APPROVE\nreviewed-commit: ${head}` }])
  const gh = `#!/usr/bin/env bash
set -u
if [ "$1 $2" = "pr list" ]; then
  if [ "\${GH_STUB_FAIL_LIST:-}" = "1" ]; then echo "simulated PR discovery failure" >&2; exit 1; fi
  echo 42
  exit 0
fi
if [ "$1 $2" = "pr view" ]; then
  if [ "\${GH_STUB_FAIL_VIEW:-}" = "1" ]; then echo "simulated PR read failure" >&2; exit 1; fi
  if [ "\${GH_STUB_MALFORMED_VIEW:-}" = "1" ] && [[ " $* " != *" --json mergeable "* ]] && [[ " $* " != *" --json labels -q "* ]]; then echo '{"number":42}'; exit 0; fi
  if [[ " $* " == *" --json mergeable "* ]]; then
    if [ "\${GH_STUB_FAIL_MERGEABILITY:-}" = "1" ]; then echo "simulated mergeability failure" >&2; exit 1; fi
    if [ "\${GH_STUB_UNKNOWN_MERGEABILITY:-}" = "1" ]; then echo UNKNOWN; else echo MERGEABLE; fi
    exit 0
  fi
  if [[ " $* " == *" --json labels -q "* ]]; then
    if [ "\${GH_STUB_FAIL_LABELS:-}" = "1" ]; then echo "simulated label read failure" >&2; exit 1; fi
    exit 0
  fi
  cat <<'JSON'
{"number":42,"title":${JSON.stringify(prTitle)},"isDraft":false,"isCrossRepository":false,"mergeable":"${failMergeability || unknownMergeability ? 'UNKNOWN' : 'MERGEABLE'}","baseRefName":"production","headRefOid":"${head}","headRepositoryOwner":{"login":"owner"},"labels":[],"statusCheckRollup":[{"name":"ci-tests","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"claude-review","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"next-public-secrets","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"revert-guard","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"pr-title","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"visual-regression","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"speed-evidence","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"speed-qa","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"},{"name":"vercel-build","conclusion":"SUCCESS","startedAt":"2026-08-11T10:00:00Z"}],"comments":${commentsJson}}
JSON
  exit 0
fi
if [ "$1" = "api" ] && [[ " $* " == *"/issues/42/events"* ]]; then
  ${previousSpeedTitle ? "echo 'HTPR-5595 [SPEED] Optimize the app'" : "true"}
  exit 0
fi
if [ "$1" = "api" ] && [[ " $* " == *"/statuses"* ]]; then
  ${speed && speedQa ? `echo '[{"context":"speed-qa","state":"success","creator":{"login":"${speedQaCreator}"},"updated_at":"2026-08-11T10:00:00Z"}]'` : "echo '[]'"}
  exit 0
fi
if [ "$1 $2" = "pr diff" ]; then echo ${JSON.stringify(changedFile)}; exit 0; fi
if [ "$1 $2" = "pr merge" ]; then
  if [ "\${GH_STUB_FAIL_MERGE:-}" = "1" ]; then echo "simulated merge failure" >&2; exit 1; fi
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 2
`
  await writeFile(join(bin, 'gh'), gh)
  await writeFile(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n')
  if (failTemp) await writeFile(join(bin, 'mktemp'), '#!/usr/bin/env bash\nexit 1\n')
  await chmod(join(bin, 'gh'), 0o755)
  await chmod(join(bin, 'sleep'), 0o755)
  if (failTemp) await chmod(join(bin, 'mktemp'), 0o755)

  try {
    const result = spawnSync('bash', ['-e', '-c', await workflowScript()], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        REPO: 'owner/repository',
        EVENT: 'workflow_dispatch',
        DISP_PR: failList ? '' : '42',
        RUN_BRANCH: '',
        RUN_REPO: '',
        RUNNER_TEMP: runnerTemp,
        GH_STUB_FAIL_LIST: failList ? '1' : '',
        GH_STUB_FAIL_VIEW: failView ? '1' : '',
        GH_STUB_MALFORMED_VIEW: malformedView ? '1' : '',
        GH_STUB_FAIL_LABELS: failLabels ? '1' : '',
        GH_STUB_FAIL_MERGE: failMerge ? '1' : '',
        GH_STUB_FAIL_MERGEABILITY: failMergeability ? '1' : '',
        GH_STUB_UNKNOWN_MERGEABILITY: unknownMergeability ? '1' : '',
      },
    })
    return { result, scratchEntries: await readdir(runnerTemp) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('auto-merge uses job-private temporary files on shared runners', async () => {
  const workflow = await readFile('.github/workflows/automerge.yml', 'utf8')

  assert.match(workflow, /mktemp -d "\$\{RUNNER_TEMP:-\/tmp\}\/hypertask-automerge\.XXXXXX"/)
  assert.match(workflow, /trap 'rm -rf "\$AUTOMERGE_TMP"' EXIT/)
  assert.match(workflow, /PR_JSON="\$AUTOMERGE_TMP\/pr\.json"/)
  assert.match(workflow, /PR_FILES="\$AUTOMERGE_TMP\/pr\.files"/)
  assert.doesNotMatch(workflow, />\/tmp\/pr\.(?:json|files)/)
})

test('auto-merge fails before evaluation when private scratch space cannot be created', async () => {
  const { result, scratchEntries } = await runWorkflow({ failTemp: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Cannot create job-private auto-merge scratch space/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge fails visibly when GitHub rejects a ready PR merge', async () => {
  const { result, scratchEntries } = await runWorkflow({ failMerge: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Merge failed for PR #42; it will retry on the next trigger/)
  assert.match(result.stdout, /1 merge failure\(s\)/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge evaluates and merges a ready PR with isolated scratch state', async () => {
  const { result, scratchEntries } = await runWorkflow()

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /MERGED #42/)
  assert.match(result.stdout, /check pr-title = SUCCESS/)
  assert.deepEqual(scratchEntries, [])
})






// HTPR-6194: schema and migration changes are the manager's call and rollback is the
// safety net, so they no longer park. Auth, billing, CI, lockfile and env paths still do.
test('a Prisma migration auto-merges like any other change', async () => {
  const changedFile = 'src/prisma/migrations/20260901110000_example/migration.sql'
  const { result, scratchEntries } = await runWorkflow({ changedFile })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /PARK: risky paths/)
  assert.match(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('an auth change is still parked and cannot auto-merge', async () => {
  const changedFile = 'src/lib/auth/getSessionUser.ts'
  const { result, scratchEntries } = await runWorkflow({ changedFile })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PARK: risky paths/)
  assert.match(result.stdout, /src\/lib\/auth\//)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('a normal PR changing the trusted speed gate is parked for manual review', async () => {
  for (const changedFile of [
    'scripts/check-speed-pr-evidence.mjs',
    'config/app-project-performance-baseline.json',
  ]) {
    const { result, scratchEntries } = await runWorkflow({ changedFile })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /PARK: risky paths/)
    assert.match(result.stdout, new RegExp(changedFile.replaceAll('.', '\\.')))
    assert.doesNotMatch(result.stdout, /MERGED #42/)
    assert.deepEqual(scratchEntries, [])
  }
})

test('auto-merge fails visibly when PR metadata stays unreadable', async () => {
  const { result, scratchEntries } = await runWorkflow({ failView: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Cannot read PR #42 after retries/)
  assert.match(result.stdout, /1 infrastructure read failure\(s\)/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge fails visibly when PR metadata is malformed', async () => {
  const { result, scratchEntries } = await runWorkflow({ malformedView: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /PR #42 metadata is malformed or incomplete/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge fails visibly when PR discovery stays unavailable', async () => {
  const { result, scratchEntries } = await runWorkflow({ failList: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Cannot discover open production PRs after retries/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge refuses to merge when the final hold-label read fails', async () => {
  const { result, scratchEntries } = await runWorkflow({ failLabels: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Cannot recheck hold labels for PR #42 after retries/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge refuses to merge when mergeability reads keep failing', async () => {
  const { result, scratchEntries } = await runWorkflow({ failMergeability: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Cannot resolve mergeability for PR #42 after retries/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('auto-merge refuses to merge when GitHub never resolves UNKNOWN', async () => {
  const { result, scratchEntries } = await runWorkflow({ unknownMergeability: true })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /Mergeability for PR #42 stayed UNKNOWN after 5 polls/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

// HTPR-6149: PR 267 merged after an EARLIER commit's review flagged a MAJOR
// finding and a LATER commit's review came back APPROVE with only a MINOR --
// the major concern was never actually fixed, it just stopped being the
// current-commit review. A major/blocker finding on any review for the PR
// must park it for a human, even once a newer commit reviews clean.
test('a MAJOR finding on an older commit still parks the PR after a clean re-review', async () => {
  const head = 'a'.repeat(40)
  const comments = [
    { body: 'CONCERNS (1) - reviewed by gpt-5.6-sol\n\n- **MAJOR - Strict gate remounts SectionComp on every switch**\n\n<!-- reviewed-commit: 2acfbc8bd27898e80b45b284d034673b87f64e65 -->' },
    { body: `APPROVE (minors only: 1) - reviewed by gpt-5.6-sol\n\n- **MINOR - Missing speed evidence**\n\n<!-- reviewed-commit: ${head} -->` },
  ]
  const { result, scratchEntries } = await runWorkflow({ comments })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PARK: a review flagged a blocker or major-severity finding/)
  assert.doesNotMatch(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})

test('a summary mentioning "no major issues" does not falsely park the PR', async () => {
  const head = 'a'.repeat(40)
  const comments = [
    { body: `APPROVE (no major issues) - reviewed by gpt-5.6-sol\n\n<!-- reviewed-commit: ${head} -->` },
  ]
  const { result, scratchEntries } = await runWorkflow({ comments })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /PARK: a review flagged/)
  assert.match(result.stdout, /MERGED #42/)
  assert.deepEqual(scratchEntries, [])
})
