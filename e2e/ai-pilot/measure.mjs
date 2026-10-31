import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pilot = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(pilot, '../..')
const results = path.join(pilot, 'results')
mkdirSync(results, { recursive: true })
rmSync(path.join(pilot, '.e2e', 'cache'), { recursive: true, force: true })
const requestLog = path.join(results, 'requests.jsonl')
const replayLog = path.join(results, 'replays.jsonl')
writeFileSync(requestLog, '')
writeFileSync(replayLog, '')
const common = { ...process.env, E2E_TELEMETRY_DISABLED: '1', PILOT_REQUEST_LOG: requestLog, PILOT_REPLAY_LOG: replayLog, PILOT_SESSION_ID: randomUUID(), BROWSER_SMOKE_STATE_FILE: path.join(root, 'e2e/smoke/.state/smoke-state.json') }
const noKey = { ...common }
delete noKey.OPENCODE_API_KEY
delete noKey.PILOT_RECORD
const knownNames = ['ticket layout after AI board card entry', 'ticket layout after AI hovercard and comment expansion', 'layout baseline: ticket from board card', 'layout baseline: ticket']
const safeMessage = message => {
  const text = String(message || '')
  const fixed = ['Expected a complete model-free replay', 'Ticket landmark coverage changed', 'Unexpected viewport', 'Layout did not settle', 'Layout lock: ticket scroll did not stabilize across two animation frames', 'Recording requires OPENCODE_API_KEY']
  const match = fixed.find(item => text.includes(item))
  if (match) return match
  const assertion = text.match(/(?:expect(?:\.[a-zA-Z]+)?\([^\n]{0,100}\)\.)?(toHaveValue|toHaveCount|toBeVisible|toBeAttached|toHaveURL|toHaveAttribute|toBe)/)
  if (assertion) return `Assertion failed: ${assertion[1]}`
  const layout = text.match(/ticket\/Desktop: (title|description|first-comment|last-comment|composer|properties): (landmark missing or hidden|(?:x|y|width|height) moved\/resized beyond [0-9.]+px|vertical order changed: expected (?:title|description|first-comment|last-comment|composer|properties) before (?:title|description|first-comment|last-comment|composer|properties))/)
  if (layout) return `Ticket layout: ${layout[1]}: ${layout[2]}`
  if (/ticket\/Desktop:/.test(text)) return 'Ticket desktop layout differs from baseline'
  if (/cache/i.test(text)) return 'Replay cache failure'
  return 'Failure details withheld; see error code'
}
const safeCodes = new Set(['ASSERTION_FAILED', 'EVALUATE_FAILED', 'LOCATOR_NOT_FOUND', 'MODEL_UNAVAILABLE', 'MODEL_REFUSED', 'MODEL_PROVIDER_FAILED', 'MODEL_OUTPUT_INVALID', 'AUTHENTICATION_FAILED', 'AUTH_CREDENTIAL_INVALID', 'AUTH_CREDENTIAL_UNAVAILABLE', 'TEST_SETUP_FAILED', 'APP_UNREACHABLE', 'APP_NOT_OPEN', 'TIMEOUT', 'ETIMEDOUT', 'ENOENT', 'ENOBUFS', 'POLICY_DENIED', 'INVALID_ARGUMENT', 'INVALID_CONFIG'])
const safeCode = code => safeCodes.has(code) ? code : undefined
const run = (command, args, cwd, env, kind) => {
  const start = performance.now()
  const reportPath = path.join(pilot, '.e2e/report.json')
  if (kind === 'new') rmSync(reportPath, { force: true })
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240000, killSignal: 'SIGKILL' })
  const diagnostics = []
  const expected = kind === 'new' ? knownNames.slice(0, 2) : knownNames.slice(2)
  const counts = { discovered: 0, executed: 0, passed: 0, skipped: 0, notRun: 0 }
  let valid = false
  try {
    const report = JSON.parse(kind === 'new' ? readFileSync(reportPath, 'utf8') : result.stdout)
    const rows = []
    if (kind === 'new') {
      if (!Array.isArray(report.run?.results)) throw new Error('Invalid report')
      for (const row of report.run.results) {
        const title = row.titlePath?.join(' > ') || 'Pilot setup'
        const attempts = row.attempts || []
        rows.push({ title, status: row.status, selected: row.selected, attempts })
        for (const attempt of attempts) if (attempt.error) diagnostics.push({ test: knownNames.includes(title) ? title : 'Pilot setup', code: safeCode(attempt.error.code), message: safeMessage(attempt.error.message) })
      }
      for (const error of report.run.errors || []) diagnostics.push({ test: 'Pilot setup', code: safeCode(error.code), message: safeMessage(error.message) })
    } else {
      if (!Array.isArray(report.suites)) throw new Error('Invalid report')
      const visit = suite => {
        for (const spec of suite.specs || []) for (const test of spec.tests || []) {
          const attempts = test.results || []
          rows.push({ title: spec.title, status: test.status, expectedStatus: test.expectedStatus, attempts })
          for (const attempt of attempts) for (const error of attempt.errors || []) diagnostics.push({ test: knownNames.includes(spec.title) ? spec.title : 'Baseline setup', message: safeMessage(error.message) })
        }
        for (const child of suite.suites || []) visit(child)
      }
      for (const suite of report.suites) visit(suite)
      for (const error of report.errors || []) diagnostics.push({ test: 'Baseline setup', message: safeMessage(error.message) })
    }
    counts.discovered = rows.length
    counts.executed = rows.filter(row => row.attempts.some(attempt => attempt.status !== 'skipped')).length
    counts.passed = rows.filter(row => row.attempts.length === 1 && row.attempts[0].status === 'passed').length
    counts.skipped = rows.filter(row => row.attempts.length > 0 && row.attempts.every(attempt => attempt.status === 'skipped')).length
    counts.notRun = rows.filter(row => row.attempts.length === 0).length
    for (const name of expected) {
      const matches = rows.filter(row => row.title === name)
      if (matches.length !== 1) diagnostics.push({ test: name, message: `Expected one test result; found ${matches.length}` })
      else {
        const row = matches[0]
        if (row.attempts.length !== 1 || row.attempts[0].status !== 'passed' || (kind === 'new' ? row.selected !== true || row.status !== 'passed' : row.expectedStatus !== 'passed' || row.status !== 'expected')) {
          const attemptStatus = row.attempts.length === 0 ? 'not run' : row.attempts.every(attempt => attempt.status === 'skipped') ? 'skipped' : 'not passed exactly once'
          diagnostics.push({ test: name, message: `Test ${attemptStatus} (attempts: ${row.attempts.length})` })
        }
      }
    }
    if (rows.length !== 2) diagnostics.push({ test: kind === 'new' ? 'Pilot setup' : 'Baseline setup', message: `Expected two test results; found ${rows.length}` })
    valid = rows.length === 2 && counts.executed === 2 && counts.passed === 2 && expected.every(name => {
      const matches = rows.filter(row => row.title === name)
      if (matches.length !== 1) return false
      const row = matches[0]
      return row.attempts.length === 1 && row.attempts[0].status === 'passed' && (kind === 'new' ? row.selected === true && row.status === 'passed' : row.expectedStatus === 'passed' && row.status === 'expected')
    }) && diagnostics.length === 0
  } catch {
    diagnostics.push({ test: kind === 'new' ? 'Pilot setup' : 'Baseline setup', code: safeCode(result.error?.code), message: 'Missing or invalid test report' })
  }
  return { passed: result.status === 0 && !result.error && valid, exitCode: result.status, timedOut: result.error?.code === 'ETIMEDOUT', durationMs: Math.round(performance.now() - start), counts, diagnostics }
}
const jsonLines = file => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const recording = run(path.join(pilot, 'node_modules/.bin/e2e'), ['run', '--reporter', 'json'], pilot, { ...common, PILOT_RECORD: '1' }, 'new')
delete common.OPENCODE_API_KEY
delete process.env.OPENCODE_API_KEY
const trials = []
for (let i = 0; i < 20; i++) {
  const old = run(path.join(root, 'node_modules/.bin/playwright'), ['test', '-c', 'playwright.config.smoke.ts', 'e2e/smoke/layout-lock.spec.ts', '--project=Desktop', '--workers=1', '--retries=0', '--reporter=json', '--grep', 'layout baseline: ticket( from board card)?$'], root, noKey, 'old')
  const before = jsonLines(replayLog).length
  const newer = run(path.join(pilot, 'node_modules/.bin/e2e'), ['run', '--reporter', 'json'], pilot, noKey, 'new')
  const assertions = jsonLines(replayLog).slice(before)
  newer.modelCalls = assertions.length === 2 ? assertions.reduce((sum, row) => sum + row.modelCalls, 0) : null
  newer.replayAssertions = assertions
  newer.passed = newer.passed && assertions.length === 2 && assertions.every(row => row.modelCalls === 0 && row.mode === 'self-finalized' && row.replayedActions > 0)
  if (!newer.passed && assertions.length !== 2) newer.diagnostics.push({ test: 'Pilot replay', message: 'Expected two replay action records' })
  trials.push({ trial: i + 1, old, new: newer })
}
const stats = key => {
  const rows = trials.map(t => t[key]), times = rows.map(r => r.durationMs).sort((a, b) => a - b)
  return { runs: rows.length, failures: rows.filter(r => !r.passed).length, failureRate: rows.length ? rows.filter(r => !r.passed).length / rows.length : null, counts: Object.fromEntries(['discovered', 'executed', 'passed', 'skipped', 'notRun'].map(key => [key, rows.reduce((sum, row) => sum + row.counts[key], 0)])), durationMs: times.length ? { min: times[0], median: (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2, max: times.at(-1) } : null }
}
const requests = jsonLines(requestLog)
const summary = { recording: { ...recording, aiRequests: requests.length, successfulRequests: requests.filter(r => r.status >= 200 && r.status < 300).length }, old: stats('old'), new: stats('new'), consecutiveNewPasses: trials.reduce((count, trial) => trial.new.passed ? count + 1 : 0, 0), trials }
writeFileSync(path.join(results, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
if (!recording.passed || summary.consecutiveNewPasses !== 20 || !requests.length) process.exitCode = 1
