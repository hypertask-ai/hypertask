const test = require('node:test')
const assert = require('node:assert/strict')
const { chmod, mkdir, mkdtemp, readFile, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const advisory = join(process.cwd(), 'scripts/vps-background-services/bin/ocr-advisory')

async function executable(path, body) {
  await writeFile(path, `#!/usr/bin/env bash\n${body}`)
  await chmod(path, 0o755)
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'ht-ocr-advisory-'))
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
      refs/ocr-advisory/230) printf '%s\\n' head-sha ;;
      *) printf 'unexpected rev-parse ref: %s\\n' "$2" >&2; exit 1 ;;
    esac
    ;;
  update-ref) [[ "$2" == -d && "$3" == refs/ocr-advisory/230 ]] || exit 1 ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 1 ;;
esac
printf '%s\\n' "$*" >> "$HOME/git.log"
`)
  await executable(join(fakeBin, 'gh'), `
if [[ "$1 $2" == "pr list" ]]; then
  printf '%s\\n' '230 feature head-sha'
else
  printf '%s\\n' "$*" >> "$HOME/gh.log"
fi
`)
  await executable(join(fakeBin, 'ocr-delegate-review'), `
printf '%s\\n' "$*" >> "$HOME/review.log"
printf '%s\\n' '{"comments":[],"summary":{"engine":"test"}}'
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

test('reviews public production PRs from the public checkout', async () => {
  const fixtureData = await fixture()
  const result = run(fixtureData)

  assert.equal(result.status, 0, result.stderr)
  const gitCalls = await readFile(join(fixtureData.home, 'git.log'), 'utf8')
  assert.match(gitCalls, /fetch -q agent-origin production/)
  assert.match(gitCalls, /fetch -q agent-origin pull\/230\/head:refs\/ocr-advisory\/230/)
  const reviewCalls = await readFile(join(fixtureData.home, 'review.log'), 'utf8')
  assert.match(reviewCalls, /--from base-sha --to head-sha --repo .*projects\/hypertask-oss/)
  const ghCalls = await readFile(join(fixtureData.home, 'gh.log'), 'utf8')
  assert.match(ghCalls, /pr comment 230 --repo hypertask-ai\/hypertask/)
  assert.match(ghCalls, /No findings/)
  await stat(join(fixtureData.home, '.local/state/ocr-advisory/head-sha'))
})

test('fails closed when the advisory checkout is not the public repository', async () => {
  const fixtureData = await fixture()
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
