const test = require('node:test')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

test('weekly Strix runner handles cron, source isolation, cleanup and failed reports', async () => {
  await execFileAsync('python3', ['scripts/test-strix-runner.py'], { timeout: 60000 })
})
