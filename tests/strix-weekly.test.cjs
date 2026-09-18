const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

async function mockCommand(bin, name, body) {
  const path = join(bin, name)
  await writeFile(path, `#!/bin/bash\nset -eu\n${body}`)
  await chmod(path, 0o755)
}

test('weekly Strix cleanup removes only its own sandbox', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'strix-weekly-'))
  const app = join(root, 'app')
  const bin = join(root, 'bin')
  const log = join(root, 'commands.log')
  t.after(() => rm(root, { force: true, recursive: true }))
  await mkdir(app)
  await mkdir(bin)

  await mockCommand(bin, 'systemctl', 'echo "systemctl $*" >> "$COMMAND_LOG"')
  await mockCommand(bin, 'curl', 'echo "curl $*" >> "$COMMAND_LOG"')
  await mockCommand(
    bin,
    'git',
    `echo "git $*" >> "$COMMAND_LOG"
if [[ "$1" == "rev-parse" ]]; then
  echo weekly-base
elif [[ "$1" == "diff" && "\${NO_CHANGED_FILES:-0}" != "1" ]]; then
  printf 'src/changed.ts\\nsrc/other.ts\\n'
fi`,
  )
  await mockCommand(
    bin,
    'docker',
    `echo "docker $*" >> "$COMMAND_LOG"
if [[ "$1" == "rm" && "\${FAIL_DOCKER_RM:-0}" == "1" ]]; then
  exit 1
elif [[ "$1" == "ps" && "$*" == *"network="* ]]; then
  echo weekly-sandbox
elif [[ "$1" == "ps" && "$*" == *"ancestor="* ]]; then
  echo unrelated-sandbox
fi`,
  )
  await mockCommand(
    bin,
    'strix',
    `echo "strix network=\${STRIX_DOCKER_SANDBOX_NETWORK:-} image=\${STRIX_IMAGE:-} args=$*" >> "$COMMAND_LOG"
[[ "\${FAIL_STRIX:-0}" != "1" ]] || exit 1
mkdir -p "$STRIX_APP/strix_runs/test"`,
  )
  await mockCommand(bin, 'python3', 'echo "python3 $*" >> "$COMMAND_LOG"')

  const env = {
    ...process.env,
    COMMAND_LOG: log,
    PATH: `${bin}:${process.env.PATH}`,
    STRIX_APP: app,
    STRIX_LOCK: join(root, 'strix.lock'),
    STRIX_LOG: join(root, 'strix.log'),
  }
  await execFileAsync('/bin/bash', ['scripts/strix-weekly.sh'], {
    cwd: process.cwd(),
    env,
  })

  const commands = await readFile(log, 'utf8')
  assert.doesNotMatch(commands, /docker rm -f unrelated-sandbox/)
  assert.match(commands, /docker rm -f weekly-sandbox/)
  assert.match(
    commands,
    /docker ps -aq --filter network=strix-weekly-\S+ --filter ancestor=ghcr\.io\/usestrix\/strix-sandbox:1\.1\.0/,
  )
  assert.match(
    commands,
    /strix network=strix-weekly-\S+ image=ghcr\.io\/usestrix\/strix-sandbox:1\.1\.0/,
  )
  assert.match(commands, /git rev-parse --verify production@\{7 days ago\}/)
  assert.match(commands, /git diff --name-only --diff-filter=ACMR weekly-base\.\.\.HEAD/)
  assert.match(commands, /args=-n -m standard --scope-mode diff --diff-base weekly-base --target \./)

  const healthChecks = commands
    .split('\n')
    .filter((line) => line.startsWith('curl ') && line.includes('/health'))
  assert.ok(healthChecks.length >= 2)
  for (const command of healthChecks) assert.match(command, /--max-time 2/)

  const noChangesLog = join(root, 'no-changes.log')
  await execFileAsync('/bin/bash', ['scripts/strix-weekly.sh'], {
    cwd: process.cwd(),
    env: { ...env, COMMAND_LOG: noChangesLog, NO_CHANGED_FILES: '1' },
  })
  const noChangesCommands = await readFile(noChangesLog, 'utf8')
  assert.doesNotMatch(noChangesCommands, /^strix /m)
  assert.doesNotMatch(noChangesCommands, /^python3 /m)

  const failedScanLog = join(root, 'failed-scan.log')
  await assert.rejects(
    execFileAsync('/bin/bash', ['scripts/strix-weekly.sh'], {
      cwd: process.cwd(),
      env: { ...env, COMMAND_LOG: failedScanLog, FAIL_STRIX: '1' },
    }),
  )
  const failedScanCommands = await readFile(failedScanLog, 'utf8')
  assert.doesNotMatch(failedScanCommands, /^python3 /m)

  await assert.rejects(
    execFileAsync('/bin/bash', ['scripts/strix-weekly.sh'], {
      cwd: process.cwd(),
      env: { ...env, FAIL_DOCKER_RM: '1' },
    }),
  )
})
