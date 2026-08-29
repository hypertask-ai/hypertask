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

test('review discovery skips terminal heads after the broker records them', async (t) => {
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
    printf '%s\\n' '{"state":"open","base":{"ref":"staging"},"head":{"sha":"${terminalSha}","repo":{"full_name":"valentinyeo/hypertasks"}}}'
    ;;
  */commits/${terminalSha}/status)
    printf '%s\\n' '{"statuses":[{"context":"claude-review","state":"success"}]}'
    ;;
  *'/pulls?state=open&base=staging&per_page=100')
    printf '%s\\n' '[{"number":101,"draft":false,"head":{"sha":"${terminalSha}","repo":{"full_name":"valentinyeo/hypertasks"}}},{"number":102,"draft":false,"head":{"sha":"${pendingSha}","repo":{"full_name":"valentinyeo/hypertasks"}}}]'
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
  assert.match(urls[2], /pulls\?state=open&base=staging&per_page=100$/)
})
