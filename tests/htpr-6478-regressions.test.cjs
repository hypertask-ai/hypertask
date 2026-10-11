const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/production'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const changed = spawnSync('git', ['diff', '--name-only', base, '--', 'tests'], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n')
const suites = [...new Set([
  ...fs.readdirSync(__dirname).filter((file) => /^mcp-.*\.test\.cjs$/.test(file)).map((file) => `tests/${file}`),
  ...changed.filter((file) => file.endsWith('.test.cjs') && !path.basename(file).startsWith('htpr-6478-')),
  'tests/board-rename-tools.test.cjs',
])].sort()
test('existing MCP and extracted REST operation regressions pass with their original behavioral assertions', () => {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  // Registry migrations touch many existing consumers, so the nested suite budget scales with its inventory.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=4', ...suites], {
    cwd: root, env, encoding: 'utf8', timeout: Math.max(300000, suites.length * 10000), maxBuffer: 32 * 1024 * 1024,
  })
  const output = result.stdout + result.stderr
  fs.mkdirSync(path.join(root, '.unlazy/htpr-6478'), { recursive: true })
  fs.writeFileSync(path.join(root, '.unlazy/htpr-6478/regressions.log'), output)
  assert.equal(result.error, undefined)
  const counts = [...output.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map((match) => `${match[1]}=${match[2]}`).join(', ')
  const failures = output.split('\n').filter((line) => /^not ok\b|^  error:/.test(line)).join('\n')
  assert.equal(result.status, 0, `${suites.length} suites: ${counts}\n${failures}`)
  assert.match(output, /^# tests [1-9]\d*$/m, 'Child test runner did not execute tests')
  assert.match(output, /^# fail 0$/m)
  console.log(`Existing regressions passed: ${suites.length} suites; ${counts}.`)
})
