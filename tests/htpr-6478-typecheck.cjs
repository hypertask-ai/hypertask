const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const include = [
  'next-env.d.ts', 'src/**/*.d.ts', 'src/lib/mcp/operations/**/*.ts',
  'src/lib/mcp/inProcessClient.ts', 'src/lib/mcp/operationContext.ts',
  'src/lib/mcp/auth/session.ts', 'src/lib/mcp/auth/rateLimit.ts',
  'src/lib/mcp-server/handler.ts', 'src/lib/mcp-server/legacy-sse.ts',
  'src/lib/mcp-server/utils/executeWithService.ts', 'src/lib/mcp-server/tools/**/*.ts',
]
const baseResult = spawnSync('git', ['merge-base', 'HEAD', 'origin/production'], { cwd: root, encoding: 'utf8' })
assert.equal(baseResult.status, 0)
const base = baseResult.stdout.trim()
for (const args of [['diff', '--name-only', base], ['ls-files', '--others', '--exclude-standard']]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0)
  include.push(...result.stdout.trim().split('\n').filter((file) => file.endsWith('.ts') && fs.existsSync(path.join(root, file))))
}
const baseline = new Set([
  'src/app/api/ai/_lib/aiUsage.ts:26:TS2322',
  'src/components/Modals/Sheets/AppSheet.tsx:2:TS2305',
  'src/components/Modals/Sheets/AppSheet.tsx:147:TS2322',
  'src/components/Modals/Sheets/AppSheet.tsx:170:TS2322',
  'src/lib/redis.ts:45:TS2769',
  'src/lib/state.tsx:8:TS2305',
])
const config = path.join(root, '.htpr-6478-tsconfig.json')
fs.writeFileSync(config, JSON.stringify({ extends: './tsconfig.json', compilerOptions: { incremental: false }, include, exclude: ['node_modules'] }))
try {
  const result = spawnSync('npx', ['tsc', '--noEmit', '-p', config, '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 180000 })
  assert.equal(result.error, undefined)
  assert.ok([0, 2].includes(result.status), `Compiler exit ${result.status}`)
  const output = result.stdout + result.stderr
  const diagnostics = [...output.matchAll(/^([^\n]+)\((\d+),\d+\): error (TS\d+):/gm)]
  assert.ok(result.status === 0 || diagnostics.length, output)
  for (const [, file, line, code] of diagnostics) {
    assert.ok(baseline.has(`${file}:${line}:${code}`), `Unexpected diagnostic: ${file}:${line}:${code}\n${output}`)
    const original = spawnSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' })
    assert.equal(original.status, 0)
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), original.stdout, `Baseline file changed: ${file}`)
  }
  const summary = `Scoped typecheck passed: 0 changed-source diagnostics, ${diagnostics.length} unchanged baseline dependency diagnostics; raw tsc exit ${result.status}.`
  fs.mkdirSync(path.join(root, '.unlazy/htpr-6478'), { recursive: true })
  fs.writeFileSync(path.join(root, '.unlazy/htpr-6478/typecheck.log'), output + summary + '\n')
  console.log(summary)
} finally {
  fs.unlinkSync(config)
}
