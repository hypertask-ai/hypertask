const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0)
  return result.stdout.trim().split('\n').filter(Boolean)
}
const [base] = git('merge-base', 'HEAD', 'origin/production')
const files = [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])]
  .filter((file) => /\.(ts|tsx|cjs)$/.test(file) && !file.startsWith('.htpr-6478-') && fs.existsSync(path.join(root, file)))
assert.ok(files.length)
const result = spawnSync('npm', ['run', 'lint', '--', ...files], { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 })
const output = result.stdout + result.stderr
fs.mkdirSync(path.join(root, '.unlazy/htpr-6478'), { recursive: true })
fs.writeFileSync(path.join(root, '.unlazy/htpr-6478/lint.log'), output)
assert.equal(result.error, undefined)
assert.equal(result.status, 0, output)
const summary = output.match(/\d+ problems? \(\d+ errors?, \d+ warnings?\)/)?.[0] ?? '0 errors'
console.log(`changed-file lint passed: npm run lint with ${files.length} explicit changed files; ${summary}. The repository script also scans its default dot target.`)
