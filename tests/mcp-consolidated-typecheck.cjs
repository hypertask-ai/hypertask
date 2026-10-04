const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.mcp-6804.json')))
const owned = new Set(config.include.filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts')))
const baseline = new Set([
  'src/components/Modals/Sheets/AppSheet.tsx:2:TS2305',
  'src/components/Modals/Sheets/AppSheet.tsx:147:TS2322',
  'src/components/Modals/Sheets/AppSheet.tsx:170:TS2322',
  'src/lib/redis.ts:45:TS2769',
  'src/lib/state.tsx:8:TS2305',
])
const result = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.mcp-6804.json'], { cwd: root, encoding: 'utf8', timeout: 120000 })
assert.equal(result.error, undefined)
assert.ok([0, 2].includes(result.status), `Compiler exit ${result.status}`)
const output = result.stdout + result.stderr
const diagnostics = [...output.matchAll(/^([^\n]+)\((\d+),\d+\): error (TS\d+):/gm)]
assert.ok(result.status === 0 || diagnostics.length, output)
for (const [, file, line, code] of diagnostics) {
  assert.equal(owned.has(file), false, output)
  assert.ok(baseline.has(`${file}:${line}:${code}`), `Unexpected dependency diagnostic: ${file}:${line}:${code}`)
  const original = spawnSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' })
  assert.equal(original.status, 0)
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), original.stdout, `Baseline file changed: ${file}`)
}
console.log(`Scoped changed-source typecheck passed: ${owned.size} files, 0 diagnostics; ${diagnostics.length} unchanged baseline dependency diagnostics. Raw tsc exit: ${result.status}.`)
