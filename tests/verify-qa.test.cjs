const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const load = () => import(pathToFileURL(path.join(root, 'scripts/verify-qa-run.mjs')).href)
const runnerEnv = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  VERIFY_QA_BASE: 'http://127.0.0.1:3100',
  DATABASE_URL: 'postgresql://browser_smoke:disposable@127.0.0.1:5432/hypertask_smoke',
  REDIS_URL: 'redis://127.0.0.1:6379', VERIFY_QA_JOURNEY: 'inbox-cycle',
}

test('runner boundary accepts isolated hosted execution and refuses VPS, remote data, and unknown journeys', async () => {
  const { assertRunner } = await load()
  assert.equal(assertRunner(runnerEnv), 'http://127.0.0.1:3100')
  assert.equal(assertRunner({ ...runnerEnv, VERIFY_QA_JOURNEY: 'inbox-cycle-broken' }), 'http://127.0.0.1:3100')
  for (const override of [
    { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { VERIFY_QA_BASE: 'https://app.hypertask.ai' },
    { DATABASE_URL: 'postgresql://browser_smoke@db.example/hypertask_smoke' },
    { DATABASE_URL: 'postgresql://browser_smoke:x@127.0.0.1/production' },
    { REDIS_URL: 'redis://cache.example:6379' }, { VERIFY_QA_JOURNEY: 'unknown' },
  ]) assert.throws(() => assertRunner({ ...runnerEnv, ...override }))
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-qa-run.mjs')], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /never the VPS/)
})

test('named dispatcher selects inbox without a diff and rejects unknown names before driving', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-qa-named-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [journey, failure, selected] of [
    ['inbox-cycle', /refuses non-loopback base app\.hypertask\.ai/, ['inbox-cycle']],
    ['unknown', /Unknown named verify-qa journey/, null],
  ]) {
    const out = path.join(dir, journey)
    const result = spawnSync(process.execPath, [path.join(root, '.github/scripts/verify-qa-premerge.mjs')], {
      encoding: 'utf8', env: { ...process.env, VERIFY_QA_OUT: out,
        VERIFY_QA_CHANGED_FILES: '', VERIFY_QA_NAMED_JOURNEY: journey,
        VERIFY_QA_BASE: 'https://app.hypertask.ai', VERIFY_QA_REPORT_ONLY: '0', GITHUB_STEP_SUMMARY: '' },
    })
    assert.equal(result.status, 1)
    const evidence = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'))
    assert.equal(evidence.verdict, 'FAIL')
    assert.deepEqual(evidence.journey, selected)
    assert.match(evidence.failure, failure)
  }
})

test('doctor requires a matching authenticated disposable account, not just an HTTP 200', async () => {
  const { doctorIdentity } = await load()
  const state = id => ({ cookies: [{ name: 'nookies_user', value: encodeURIComponent(JSON.stringify({ id })) }] })
  const payload = id => ({ slices: { user: { data: { id } } } })
  assert.equal(doctorIdentity(state(42), 200, payload(42)), 42)
  for (const args of [
    [state(42), 401, payload(42)], [state(42), 200, payload(43)],
    [state(42), 200, {}], [state(6), 200, payload(6)], [state(985), 200, payload(985)],
  ]) assert.throws(() => doctorIdentity(...args), /Doctor failed/)
})

test('artifact logs redact credentials, cookies, bearer tokens, and JWTs but keep diagnostics', async () => {
  const { sanitizeLog } = await load()
  assert.equal(sanitizeLog('HTTP 500 secret-value cookie%2Fvalue Bearer token-value eyJhbGci.abc.def', ['secret-value', 'cookie/value']),
    'HTTP 500 [REDACTED] [REDACTED] Bearer [REDACTED] [REDACTED]')
  assert.equal(sanitizeLog('HTTP 200 ready', []), 'HTTP 200 ready')
})

test('summary entry point never restores credential-bearing failures into uploaded evidence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-qa-summary-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const out = path.join(dir, 'verify-qa')
  fs.mkdirSync(out)
  fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify({ verdict: 'FAIL', failure: 'HTTP 500 fixture-session-secret' }))
  const summary = path.join(dir, 'step-summary.md')
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-qa-run.mjs'), '--summary'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, SESSION_SECRET: 'fixture-session-secret',
      VERIFY_QA_JOB_STATUS: 'success', VERIFY_QA_JOURNEY: 'inbox-cycle', GITHUB_STEP_SUMMARY: summary },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'run.json'), 'utf8')), {
    verdict: 'FAIL', failure: 'HTTP 500 [REDACTED]', journey: 'inbox-cycle',
  })
  for (const file of [path.join(out, 'summary.md'), summary]) {
    const text = fs.readFileSync(file, 'utf8')
    assert.match(text, /Failure: HTTP 500 \[REDACTED\]/)
    assert.doesNotMatch(text, /fixture-session-secret/)
  }
})

function helperFixture(t, ghStatus = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-qa-helper-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const sha = 'a'.repeat(40)
  fs.writeFileSync(path.join(dir, 'git'), `#!/usr/bin/env bash\ncase "$1" in\ncheck-ref-format) exit 0 ;;\nls-remote) printf '%s\\trefs/heads/feature/test\\n' '${sha}' ;;\n*) exit 99 ;;\nesac\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh-app-token'), '#!/bin/sh\nprintf fixture-runner-app-token\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env node\nif (process.env.GH_TOKEN !== 'fixture-runner-app-token') process.exit(99); require('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))); console.log('https://github.com/hypertask-ai/hypertask/actions/runs/123'); process.exit(${ghStatus})\n`, { mode: 0o755 })
  const capture = path.join(dir, 'args.json')
  return { dir, sha, capture, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CAPTURE: capture } }
}

test('launch helper dispatches the pushed SHA, prints the run URL, and never starts an app', t => {
  const { env, sha, capture } = helperFixture(t)
  const result = spawnSync('bash', [path.join(root, 'scripts/verify-qa'), 'feature/test', 'inbox-cycle'], { env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /actions\/runs\/123/)
  assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')), [
    'workflow', 'run', 'visual-regression.yml', '--repo', 'hypertask-ai/hypertask', '--ref', 'production',
    '-f', `head=${sha}`, '-f', 'journey=inbox-cycle',
  ])
})

test('launch helper refuses failed or empty App tokens without falling back to a saved login', t => {
  const { dir, env, capture } = helperFixture(t)
  for (const tokenCommand of ['exit 17', 'exit 0']) {
    fs.writeFileSync(path.join(dir, 'gh-app-token'), `#!/bin/sh\n${tokenCommand}\n`, { mode: 0o755 })
    const result = spawnSync('bash', [path.join(root, 'scripts/verify-qa'), 'feature/test'], {
      env: { ...env, GH_TOKEN: 'saved-human-login' }, encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Runner App token unavailable/)
    assert.equal(fs.existsSync(capture), false)
  }
})

test('launch helper rejects unsupported journeys and propagates dispatch failures', t => {
  const { env, capture } = helperFixture(t, 17)
  const invalid = spawnSync('bash', [path.join(root, 'scripts/verify-qa'), 'feature/test', 'unknown'], { env, encoding: 'utf8' })
  assert.equal(invalid.status, 2)
  assert.equal(fs.existsSync(capture), false)
  const failed = spawnSync('bash', [path.join(root, 'scripts/verify-qa'), 'feature/test', 'inbox-cycle-broken', 'ceo/YPER4-697'], { env, encoding: 'utf8' })
  assert.equal(failed.status, 17)
  assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')).slice(-6), [
    '--ref', 'ceo/YPER4-697', '-f', `head=${'a'.repeat(40)}`, '-f', 'journey=inbox-cycle-broken',
  ])
})
