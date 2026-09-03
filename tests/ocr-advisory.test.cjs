const test = require('node:test')
const assert = require('node:assert/strict')
const { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const advisory = join(process.cwd(), 'scripts/vps-background-services/bin/ocr-advisory')

async function executable(path, body) {
  await writeFile(path, `#!/usr/bin/env bash\n${body}`)
  await chmod(path, 0o755)
}

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'ht-ocr-advisory-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const fakeBin = join(home, 'bin')
  const worktree = join(home, 'projects/hypertask-oss')
  await mkdir(fakeBin, { recursive: true })
  await mkdir(join(worktree, '.git'), { recursive: true })

  await executable(join(fakeBin, 'git'), `
case "$1" in
  remote) [[ "$2" == get-url && "$3" == agent-origin ]] || exit 1
    printf '%s\\n' 'https://github.com/hypertask-ai/hypertask.git' ;;
  fetch) ;;
  rev-parse)
    case "$2" in
      agent-origin/production) printf '%s\\n' base-sha ;;
      refs/ocr-advisory/230|refs/ocr-advisory/232) printf '%s\\n' head-sha ;;
      *) printf 'unexpected rev-parse ref: %s\\n' "$2" >&2; exit 1 ;;
    esac
    ;;
  merge-base) [[ "$2 $3" == "base-sha head-sha" ]] || exit 1; printf '%s\\n' merge-sha ;;
  update-ref) [[ "$2" == -d && "$3" =~ ^refs/ocr-advisory/(230|232)$ ]] || exit 1 ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 1 ;;
esac
printf '%s\\n' "$*" >> "$HOME/git.log"
`)
  await executable(join(fakeBin, 'gh'), `
if [[ "$1 $2" == "pr list" ]]; then
  [[ " $* " == *" --limit 1000 "* ]] || exit 1
  printf '%s\\n' '230 feature head-sha false' '231 draft draft-sha true'
  if [[ "\${DUPLICATE_HEAD:-}" == 1 ]]; then printf '%s\\n' '232 duplicate head-sha false'; fi
else
  printf '%s\\n' "$*" >> "$HOME/gh.log"
fi
`)
  await executable(join(fakeBin, 'ocr-delegate-review'), `
printf '%s\\n' "$*" >> "$HOME/review.log"
if [[ "\${MALFORMED_REVIEW:-}" == 1 ]]; then
  printf '%s\\n' 'not json'
elif [[ "\${LONG_REVIEW:-}" == 1 ]]; then
  python3 - <<'PY'
import json
print(json.dumps({"findings": [{"severity": "medium", "path": "@" * 100000,
                                "start_line": 4, "content": "Fix this"}]}))
PY
else
  printf '%s\\n' '{"findings":[{"severity":"medium","path":"src/\`@team.ts","start_line":4,"content":"Fix @team *now*"}],"summary":{"engine":"test"}}'
fi
`)
  return { home, fakeBin }
}

function run({ home, fakeBin }, extraEnv = {}) {
  return spawnSync('/bin/bash', [advisory], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, ...extraEnv },
  })
}

test('reviews public production PRs from the public checkout', async (t) => {
  const fixtureData = await fixture(t)
  const result = run(fixtureData, { DUPLICATE_HEAD: '1' })

  assert.equal(result.status, 0, result.stderr)
  const gitCalls = await readFile(join(fixtureData.home, 'git.log'), 'utf8')
  assert.match(gitCalls, /fetch -q agent-origin production/)
  assert.match(gitCalls, /fetch -q agent-origin \+pull\/230\/head:refs\/ocr-advisory\/230/)
  assert.match(gitCalls, /fetch -q agent-origin \+pull\/232\/head:refs\/ocr-advisory\/232/)
  assert.match(gitCalls, /merge-base base-sha head-sha/)
  const reviewCalls = await readFile(join(fixtureData.home, 'review.log'), 'utf8')
  assert.match(reviewCalls, /--from merge-sha --to head-sha --repo .*projects\/hypertask-oss/)
  const ghCalls = await readFile(join(fixtureData.home, 'gh.log'), 'utf8')
  assert.match(ghCalls, /pr comment 230 --repo hypertask-ai\/hypertask/)
  assert.match(ghCalls, /pr comment 232 --repo hypertask-ai\/hypertask/)
  assert.match(ghCalls, /<strong>MEDIUM<\/strong>.*src\/&#96;&#64;team&#46;ts:4.*Fix &#64;team &#42;now&#42;/)
  assert.doesNotMatch(ghCalls, /@team|No findings/)
  await stat(join(fixtureData.home, '.local/state/ocr-advisory/230-head-sha'))
  await stat(join(fixtureData.home, '.local/state/ocr-advisory/232-head-sha'))
})

test('bounds escaped finding paths before posting', async (t) => {
  const fixtureData = await fixture(t)

  const result = run(fixtureData, { LONG_REVIEW: '1' })

  assert.equal(result.status, 0, result.stderr)
  const ghCalls = await readFile(join(fixtureData.home, 'gh.log'), 'utf8')
  assert.ok(ghCalls.length < 5000)
  assert.match(ghCalls, /&#64;/)
  assert.doesNotMatch(ghCalls, /@/)
})

test('retains old markers for ready and draft heads, then removes closed-head markers', async (t) => {
  const fixtureData = await fixture(t)
  const state = join(fixtureData.home, '.local/state/ocr-advisory')
  await mkdir(state, { recursive: true })
  const legacyOpenMarker = join(state, 'head-sha')
  const legacyDraftMarker = join(state, 'draft-sha')
  const openMarker = join(state, '230-head-sha')
  const previousOpenMarker = join(state, '230-previous-sha')
  const draftMarker = join(state, '231-draft-sha')
  const closedMarker = join(state, '999-closed-sha')
  await writeFile(legacyOpenMarker, '')
  await writeFile(legacyDraftMarker, '')
  await writeFile(previousOpenMarker, '')
  await writeFile(closedMarker, '')
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
  await utimes(legacyOpenMarker, old, old)
  await utimes(legacyDraftMarker, old, old)
  await utimes(previousOpenMarker, old, old)
  await utimes(closedMarker, old, old)
  const openBefore = await stat(legacyOpenMarker)
  const draftBefore = await stat(legacyDraftMarker)

  const result = run(fixtureData)

  assert.equal(result.status, 0, result.stderr)
  assert.equal((await stat(openMarker)).ino, openBefore.ino)
  await stat(previousOpenMarker)
  assert.equal((await stat(draftMarker)).ino, draftBefore.ino)
  await assert.rejects(stat(legacyOpenMarker), { code: 'ENOENT' })
  await assert.rejects(stat(legacyDraftMarker), { code: 'ENOENT' })
  await assert.rejects(stat(closedMarker), { code: 'ENOENT' })
  await assert.rejects(readFile(join(fixtureData.home, 'review.log')), { code: 'ENOENT' })
})

test('continues cleanly when a review returns malformed JSON', async (t) => {
  const fixtureData = await fixture(t)

  const result = run(fixtureData, { MALFORMED_REVIEW: '1' })

  assert.equal(result.status, 0, result.stderr)
  await assert.rejects(readFile(join(fixtureData.home, 'gh.log')), { code: 'ENOENT' })
  await assert.rejects(
    stat(join(fixtureData.home, '.local/state/ocr-advisory/230-head-sha')),
    { code: 'ENOENT' },
  )
  assert.match(await readFile(join(fixtureData.home, 'git.log'), 'utf8'), /update-ref -d refs\/ocr-advisory\/230/)
})

test('fails closed when the advisory checkout is not the public repository', async (t) => {
  const fixtureData = await fixture(t)
  await executable(join(fixtureData.fakeBin, 'git'), `
if [[ "$1 $2" == "remote get-url" ]]; then
  printf '%s\\n' 'https://github.com/hypertask-ai/hypertasks.git'
  exit 0
fi
exit 1
`)

  const result = run(fixtureData)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unexpected repository/)
})
