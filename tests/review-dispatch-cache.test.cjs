const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const dispatchReview = '.github/scripts/subscription-review/dispatch-review'
const dispatchScan = '.github/scripts/subscription-review/dispatch-scan'

for (const context of ['claude-review']) {
  test(`review discovery skips terminal ${context} heads after the broker records them`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'review-dispatch-cache-'))
    t.after(() => rm(root, { force: true, recursive: true }))

    const bin = join(root, 'bin')
    const stateRoot = join(root, 'state')
    const completed = join(stateRoot, 'completed')
    const curlLog = join(root, 'curl.log')
    const dispatchLog = join(root, 'dispatch.log')
    const curlConfig = join(root, 'reviewer-curl.conf')
    const terminalSha = 'a'.repeat(40)
    const pendingSha = 'b'.repeat(40)

    await mkdir(bin)
    await Promise.all([
      mkdir(join(stateRoot, 'locks'), { recursive: true }),
      mkdir(join(stateRoot, 'dispatched'), { recursive: true }),
      mkdir(completed, { recursive: true }),
      writeFile(curlConfig, 'silent\n'),
    ])

    const curlStub = join(bin, 'curl')
    await writeFile(
      curlStub,
      `#!/usr/bin/env bash
  set -euo pipefail
  url=\${!#}
  printf '%s\\n' "$url" >> "$CURL_LOG"
  case "$url" in
    */pulls/101)
      printf '%s\\n' '{"state":"open","base":{"ref":"production"},"head":{"sha":"${terminalSha}","repo":{"full_name":"hypertask-ai/hypertask"}}}'
      ;;
    */commits/${terminalSha}/status)
      printf '%s\\n' '{"statuses":[{"context":"${context}","state":"success"},{"context":"ai-review","state":"failure"}]}'
      ;;
    *'/pulls?state=open&base=production&per_page=100')
      printf '%s\\n' '[{"number":101,"draft":false,"head":{"sha":"${terminalSha}","repo":{"full_name":"hypertask-ai/hypertask"}}},{"number":102,"draft":false,"head":{"sha":"${pendingSha}","repo":{"full_name":"hypertask-ai/hypertask"}}}]'
      ;;
    *)
      echo "unexpected curl URL: $url" >&2
      exit 70
      ;;
  esac
  `,
    )
    await chmod(curlStub, 0o755)

    const dispatchStub = join(bin, 'dispatch-review')
    await writeFile(
      dispatchStub,
      `#!/usr/bin/env bash
  set -euo pipefail
  printf '%s\\t%s\\n' "$1" "$2" >> "$DISPATCH_LOG"
  `,
    )
    await chmod(dispatchStub, 0o755)

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CURL_LOG: curlLog,
      DISPATCH_LOG: dispatchLog,
      HYPERTASK_REVIEW_CURL_CONFIG: curlConfig,
      HYPERTASK_REVIEW_STATE_ROOT: stateRoot,
      HYPERTASK_DISPATCH_REVIEW_BIN: dispatchStub,
    }

    await execFileAsync(dispatchReview, ['101', terminalSha], { env })
    assert.equal(await readFile(join(completed, terminalSha), 'utf8'), 'success\n')

    await execFileAsync(dispatchScan, { env })
    assert.equal(await readFile(dispatchLog, 'utf8'), `102\t${pendingSha}\n`)

    const urls = (await readFile(curlLog, 'utf8')).trim().split('\n')
    assert.equal(urls.length, 3)
    assert.match(urls[0], /pulls\/101$/)
    assert.match(urls[1], new RegExp(`commits/${terminalSha}/status$`))
    assert.match(urls[2], /pulls\?state=open&base=production&per_page=100$/)
  })
}

test('review discovery uses a conditional list request and rescans only changed pull requests', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'review-scan-etag-'))
  t.after(() => rm(root, { force: true, recursive: true }))

  const bin = join(root, 'bin')
  const stateRoot = join(root, 'state')
  const curlLog = join(root, 'curl.log')
  const dispatchLog = join(root, 'dispatch.log')
  const curlConfig = join(root, 'reviewer-curl.conf')
  const listFile = join(root, 'list.json')
  const shaA = 'c'.repeat(40)
  const shaB = 'd'.repeat(40)
  const listOf = (updatedB) =>
    JSON.stringify([
      { number: 201, draft: false, updated_at: '2026-10-11T07:00:00Z', head: { sha: shaA, repo: { full_name: 'hypertask-ai/hypertask' } } },
      { number: 202, draft: false, updated_at: updatedB, head: { sha: shaB, repo: { full_name: 'hypertask-ai/hypertask' } } },
    ])

  await mkdir(bin)
  await mkdir(stateRoot)
  await Promise.all([writeFile(curlConfig, 'silent\n'), writeFile(listFile, listOf('2026-10-11T07:01:00Z'))])

  // Fake GitHub: serves the list from LIST_FILE with ETag "v1"; answers 304 when If-None-Match matches.
  const curlStub = join(bin, 'curl')
  await writeFile(
    curlStub,
    `#!/usr/bin/env bash
set -euo pipefail
url=\${!#}
printf '%s\\n' "$*" >> "$CURL_LOG"
hdr=""; inm=""; prev=""
for a in "$@"; do
  [ "$prev" = "-D" ] && hdr=$a
  case "$a" in If-None-Match:*) inm=\${a#If-None-Match: } ;; esac
  prev=$a
done
etag="\"$(cksum < "$LIST_FILE" | cut -d' ' -f1)\""
if [ "$inm" = "$etag" ]; then
  printf 'HTTP/2 304 \\r\\nx-ratelimit-remaining: 4990\\r\\n\\r\\n' > "$hdr"
  exit 0
fi
printf 'HTTP/2 200 \\r\\netag: %s\\r\\nx-ratelimit-remaining: 4991\\r\\n\\r\\n' "$etag" > "$hdr"
cat "$LIST_FILE"
`,
  )
  await chmod(curlStub, 0o755)

  const dispatchStub = join(bin, 'dispatch-review')
  await writeFile(dispatchStub, `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\t%s\\n' "$1" "$2" >> "$DISPATCH_LOG"\n`)
  await chmod(dispatchStub, 0o755)

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CURL_LOG: curlLog,
    DISPATCH_LOG: dispatchLog,
    LIST_FILE: listFile,
    HYPERTASK_REVIEW_CURL_CONFIG: curlConfig,
    HYPERTASK_REVIEW_STATE_ROOT: stateRoot,
    HYPERTASK_DISPATCH_REVIEW_BIN: dispatchStub,
  }
  const dispatched = async () => (await readFile(dispatchLog, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
  const curlCalls = async () => (await readFile(curlLog, 'utf8')).trim().split('\n').length

  // Scan 1: full list (200), both PRs are new.
  let { stdout } = await execFileAsync(dispatchScan, { env })
  assert.match(stdout, /list_status=200 rescanned_prs=2 skipped_prs=0 ratelimit_remaining=4991/)
  assert.equal((await dispatched()).length, 2)
  assert.doesNotMatch(await readFile(curlLog, 'utf8'), /If-None-Match/)

  // Scan 2: nothing changed. The list call answers 304 and no PR is rescanned.
  ;({ stdout } = await execFileAsync(dispatchScan, { env }))
  assert.match(stdout, /list_status=304 rescanned_prs=0 skipped_prs=2 ratelimit_remaining=4990/)
  assert.equal((await dispatched()).length, 2)
  assert.equal(await curlCalls(), 2)
  assert.match(await readFile(curlLog, 'utf8'), /If-None-Match: \S+/)

  // Scan 3: PR 202 got an update. Only that PR is rescanned.
  await writeFile(listFile, listOf('2026-10-11T07:05:00Z'))
  ;({ stdout } = await execFileAsync(dispatchScan, { env }))
  assert.match(stdout, /list_status=200 rescanned_prs=1 skipped_prs=1/)
  assert.deepEqual((await dispatched()).slice(2), [`202\t${shaB}`])

  // Scan 4: unchanged again but the recheck window has passed (0 seconds), so retries still happen.
  ;({ stdout } = await execFileAsync(dispatchScan, { env: { ...env, HYPERTASK_REVIEW_RECHECK_SECONDS: '0' } }))
  assert.match(stdout, /list_status=304 rescanned_prs=2 skipped_prs=0/)
  assert.doesNotMatch(stdout + (await readFile(curlLog, 'utf8')), /ghp_|Bearer/)
})
