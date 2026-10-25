const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')
const { loader } = require('./htpr-6927-fixtures.cjs')

const flag = 'htpr-7536-plain-ai-feedback'
const windowMs = 24 * 60 * 60 * 1000
const refusal = { surface: 'mcp', tool: 'hypertask_tasks', status: 400, category: 'call_failed', errorCode: 'unrecognized_keys', field: 'zzzznotafield' }

function setup({ plain = true, names = new Map([[42, 'Robin'], [43, 'Casey'], [44, 'Taylor'], [45, 'Morgan']]), redisClient } = {}) {
  const created = [], rows = [], comments = [], quotas = [], pending = [], redisCalls = []
  const sortedSets = new Map(), strings = new Map()
  let failWrite = false, failCommit = false, queue = Promise.resolve()
  const db = {
    section: { findMany: async () => [{ id: 2, section_title: 'Done' }] },
    project: { findFirst: async () => ({ uniqueIdentifier: 'HTPR', section: [{ id: 1, section_title: 'Bugs' }] }) },
    user: { findUnique: async ({ where }) => ({ displayName: names.get(where.id) ?? '' }) },
    label: { findFirst: async () => ({ id: 'ai-feedback' }) },
    task: { findFirst: async ({ where }) => rows.find(row => row.section !== 'Done' && row.description.includes(where.description_.is.content.contains)) ?? null },
    comment: {
      findFirst: async ({ where }) => comments.find(comment => comment.taskId === where.taskId && comment.text.includes(where.text.contains)) ?? null,
      update: async ({ where, data }) => Object.assign(comments.find(comment => comment.id === where.id), data),
    },
    $queryRaw: async () => [{ locked: true }],
    $transaction: run => {
      const work = queue.then(async () => {
        const result = await run(db)
        if (failCommit) throw new Error('Commit failed')
        return result
      })
      queue = work.catch(() => {})
      return work
    },
  }
  const redis = {
    eval: async (script, keyCount, ...args) => {
      redisCalls.push({ script, keyCount, args })
      const limits = load('src/lib/aiFeedback/rateLimit.ts')
      if (script === limits.FEEDBACK_ATTEMPT_SCRIPT) return 1
      if (script === limits.FEEDBACK_QUOTA_SCRIPT) {
        quotas.push(args[0])
        return 1
      }
      if (script === limits.RELEASE_VALIDATION_REFUSAL_SCRIPT) {
        const [key, token] = args
        if (strings.get(key)?.token === token) strings.delete(key)
        return 1
      }
      assert.equal(script, limits.VALIDATION_REFUSAL_SCRIPT)
      assert.equal(keyCount, 2)
      const [key, filedKey, now, reporter, token] = args
      assert.match(key, /^ai-feedback:validation-refusal:\{[a-f0-9]{64}\}:reporters$/)
      assert.equal(filedKey, key.replace(/:reporters$/, ':filed'))
      const reporters = sortedSets.get(key) ?? new Map()
      for (const [name, seen] of reporters) if (seen <= now - windowMs) reporters.delete(name)
      reporters.set(reporter, now)
      sortedSets.set(key, reporters)
      if (reporters.size < 3 || (strings.get(filedKey)?.expires ?? 0) > now) return []
      strings.set(filedKey, { token, expires: now + windowMs })
      return [...reporters].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([name]) => name)
    },
  }
  const load = loader({
    '@vercel/functions': { waitUntil: work => pending.push(work) },
    '@/lib/prisma': { __esModule: true, default: db },
    '@/lib/redis': { getRedis: async () => redisClient ?? redis },
    './enabled': { aiFeedbackEnabled: async () => true },
    '@/lib/flags': {
      isFeatureEnabled: async key => key !== flag || plain,
      featureFlagCandidateUserIds: async key => key !== flag || plain ? null : [],
    },
    '@/lib/mcp/auth': { validateMcpAuth: async () => ({ user: { id: 42 }, agentDisplayName: 'Fable' }) },
    '@/lib/mcp/operationContext': { getMcpExecutionContext: () => ({ user: { id: 42 }, agentDisplayName: 'Fable' }) },
    '@/lib/aiFeedback/clientInfo': { getFeedbackClient: async () => undefined },
    '../config/tool-metadata': { TOOL_METADATA: { REPORT_FEEDBACK: { name: 'hypertask_report_feedback' } } },
    '@/utils/controllers/tasks/createTaskCore': { createProvisionedTaskCore: async options => {
      if (failWrite) throw new Error('Write failed')
      created.push(options)
      const task = { ...options, id: created.length, ticketNumber: `HTPR-${8000 + created.length}`, uniqueIndex: 8000 + created.length }
      rows.push(task)
      return { task }
    } },
    '@/utils/controllers/comments/createCommentService': { createCommentService: async options => {
      const comment = { ...options, id: comments.length + 1 }
      comments.push(comment)
      return comment
    } },
    '@/lib/realtime/server': { broadcastTaskChange: async () => {} },
  })
  const report = (input = refusal, id = 42, agentName) => load('src/lib/aiFeedback/report.ts').fileAiFeedback(input, id, { origin: 'automatic', agentName })
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)) }
  return { load, report, drain, created, rows, comments, quotas, redisCalls, sortedSets, strings, setFailWrite: value => { failWrite = value }, setFailCommit: value => { failCommit = value } }
}

test.beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T12:00:00.000Z') }))

test('one and two distinct automatic reporters file nothing; the third escalates and the fourth stays quiet', async () => {
  const f = setup()
  for (const id of [42, 43]) {
    assert.equal((await f.report(refusal, id)).filed, false)
    assert.equal(f.created.length, 0)
    assert.equal(f.quotas.length, 0)
  }
  const result = await f.report(refusal, 44)
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].title, /same MCP input refusal keeps repeating/)
  assert.match(f.created[0].description, /schema drift/)
  assert.match(f.created[0].description, /Field: zzzznotafield/)
  for (const name of ['Robin', 'Casey', 'Taylor']) assert.ok(f.created[0].description.includes(name))
  assert.equal((await f.report(refusal, 45)).filed, false)
  assert.equal(f.created.length, 1)
  assert.equal(f.comments.length, 1)
  assert.equal(f.quotas.length, 1)
})

for (const errorCode of ['tool-exception', 'invalid_type', 'too_small', 'too_big', 'invalid_value', 'custom']) {
  test(`automatic 400 ${errorCode} is a validation refusal`, async () => {
    const f = setup()
    assert.equal((await f.report({ ...refusal, errorCode })).filed, false)
    assert.equal(f.created.length, 0)
  })
}

test('repeat reports and different user ids with the same reporter name do not manufacture distinct reporters', async () => {
  const f = setup({ names: new Map([[42, 'Robin'], [43, 'Robin'], [44, 'Casey']]) })
  for (const id of [42, 42, 43, 44]) assert.equal((await f.report(refusal, id)).filed, false)
  assert.equal(f.created.length, 0)
})

test('distinct agent names count separately even under the same owner and are safely rendered', async () => {
  const f = setup()
  for (const name of ['Fable & Team', 'Fable & Team', '<b>Codex</b>']) assert.equal((await f.report(refusal, 42, name)).filed, false)
  await f.report(refusal, 42, 'Claude')
  assert.equal(f.created.length, 1)
  for (const name of ['Fable &amp; Team', 'Codex', 'Claude', 'owned by Robin']) assert.ok(f.created[0].description.includes(name))
  assert.equal(f.created[0].description.includes('<b>'), false)
})

test('unnamed reporters fall back to distinct user ids', async () => {
  const f = setup({ names: new Map() })
  for (const id of [42, 42, 43]) assert.equal((await f.report(refusal, id)).filed, false)
  await f.report(refusal, 44)
  assert.equal(f.created.length, 1)
  for (const id of [42, 43, 44]) assert.ok(f.created[0].description.includes(`User ${id}`))
})

test('reporters outside the rolling 24-hour window are not counted', async t => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  t.mock.timers.tick(windowMs)
  assert.equal((await f.report(refusal, 44)).filed, false)
  assert.equal((await f.report(refusal, 45)).filed, false)
  assert.equal(f.created.length, 0)
  await f.report(refusal, 42)
  assert.equal(f.created.length, 1)
  assert.ok(f.created[0].description.includes('Morgan'))
  assert.equal(f.created[0].description.includes('Casey'), false)
})

test('a fresh report refreshes only that reporter in the rolling window', async t => {
  const f = setup()
  await f.report(refusal, 42)
  t.mock.timers.tick(windowMs / 2)
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  t.mock.timers.tick(windowMs / 2)
  await f.report(refusal, 44)
  assert.equal(f.created.length, 1)
})

test('filing cooldown survives more reports and a closed ticket until 24 hours after escalation', async t => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  await f.report(refusal, 44)
  f.rows[0].section = 'Done'
  t.mock.timers.tick(windowMs - 1)
  for (const id of [42, 43, 44, 45]) assert.equal((await f.report(refusal, id)).filed, false)
  assert.equal(f.created.length, 1)
  t.mock.timers.tick(1)
  await f.report(refusal, 45)
  assert.equal(f.created.length, 2)
})

test('different offending fields have separate fingerprints and reporter counters', async () => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  const other = { ...refusal, field: 'anotherfield' }
  assert.equal((await f.report(other, 44)).filed, false)
  assert.equal(f.created.length, 0)
  await f.report(refusal, 44)
  assert.equal(f.created.length, 1)
  assert.match(f.created[0].description, /Field: zzzznotafield/)
})

test('concurrent third and fourth reporters create only one ticket', async () => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  const results = await Promise.all([f.report(refusal, 44), f.report(refusal, 45)])
  assert.equal(results.filter(result => result.success).length, 1)
  assert.equal(f.created.length, 1)
})

test('a failed write releases the filing reservation so an immediate retry can escalate', async () => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  f.setFailWrite(true)
  await assert.rejects(f.report(refusal, 44), /Write failed/)
  assert.equal(f.strings.size, 0)
  f.setFailWrite(false)
  await f.report(refusal, 44)
  assert.equal(f.created.length, 1)
})

test('a failed transaction commit also releases the filing reservation', async () => {
  const f = setup()
  await f.report(refusal, 42)
  await f.report(refusal, 43)
  f.setFailCommit(true)
  await assert.rejects(f.report(refusal, 44), /Commit failed/)
  assert.equal(f.strings.size, 0)
})

test('an existing ticket is reused only on escalation, with the field and reporters in its tally', async () => {
  const f = setup()
  const { field, ...explicit } = refusal
  await f.load('src/lib/aiFeedback/report.ts').fileAiFeedback(explicit, 42)
  const fingerprint = f.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(refusal)
  f.rows[0].description += `<p>Fingerprint: ai-fb-${fingerprint.slice(0, 12)}</p>`
  const original = f.rows[0].description
  assert.equal(f.comments.length, 1)
  f.comments.length = 0
  assert.equal((await f.report(refusal, 42)).filed, false)
  assert.equal(f.comments.length, 0)
  assert.equal((await f.report(refusal, 43)).filed, false)
  assert.equal(f.comments.length, 0)
  assert.equal((await f.report(refusal, 44)).deduped, true)
  assert.equal(f.comments.length, 1)
  assert.equal((await f.report(refusal, 45)).filed, false)
  assert.equal(f.comments.length, 1)
  assert.equal(f.created.length, 1)
  assert.equal(f.rows[0].description, original)
  assert.match(f.comments[0].text, /same input refusal keeps repeating/)
  for (const value of ['zzzznotafield', 'Robin', 'Casey', 'Taylor']) assert.ok(f.comments[0].text.includes(value))
})

for (const input of [
  { ...refusal, status: 500 },
  { ...refusal, status: 503, errorCode: 'tool-exception' },
  { ...refusal, status: 401, errorCode: 'unauthorized', category: 'auth_failed' },
  { ...refusal, status: 403, errorCode: 'forbidden' },
  { ...refusal, status: 400, errorCode: 'upstream-failed' },
  { ...refusal, category: 'unexpected_result' },
]) {
  test(`unrelated automatic failures still file immediately: ${JSON.stringify(input)}`, async () => {
    const f = setup()
    assert.equal((await f.report(input)).success, true)
    assert.equal(f.created.length, 1)
    assert.equal(f.redisCalls.some(call => call.args[0].includes('validation-refusal')), false)
  })
}

test('explicit hypertask_report_feedback validation reports still file immediately and are not re-observed', async () => {
  const f = setup()
  const { reportFeedbackTool } = f.load('src/lib/mcp-server/tools/report-feedback.tool.ts')
  const { observeFeedbackTools } = f.load('src/lib/aiFeedback/automatic.ts')
  const [tool] = observeFeedbackTools([reportFeedbackTool], 42)
  const result = JSON.parse(await tool.execute({ status: 400, category: 'call_failed', errorCode: 'invalid_type', tool: 'hypertask_tasks' }, 'fixture'))
  await f.drain()
  assert.equal(result.success, true)
  assert.equal(f.created.length, 1)
  assert.equal(f.redisCalls.some(call => call.args[0].includes('validation-refusal')), false)
})

test('real automatic Zod rejection preserves the caller error and suppresses the feedback ticket', async () => {
  const f = setup()
  const schema = z.object({}).strict()
  const original = schema.safeParse({ zzzznotafield: true }).error
  const [tool] = f.load('src/lib/aiFeedback/automatic.ts').observeFeedbackTools([
    { name: 'hypertask_tasks', parameters: schema, execute: async () => { throw original } },
  ], 42)
  await assert.rejects(tool.execute({ zzzznotafield: true }, 'fixture'), error => error === original)
  await f.drain()
  assert.equal(f.created.length, 0)
  assert.equal(f.sortedSets.size, 1)
})

test('plain feedback flag Off keeps the legacy automatic 400 filing path', async () => {
  const f = setup({ plain: false })
  assert.equal((await f.report()).success, true)
  assert.equal(f.created.length, 1)
  assert.equal(f.redisCalls.some(call => call.args[0].includes('validation-refusal')), false)
})

test('real Redis shares reporter windows and an atomic filing guard across instances', { timeout: 60000 }, async t => {
  const { spawn, spawnSync, execFileSync } = require('node:child_process')
  const port = await new Promise((resolve, reject) => {
    const server = require('node:net').createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
  const args = ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no']
  const nativeRedis = spawnSync('redis-server', ['--version']).status === 0
  const container = `htpr-7887-redis-${process.pid}-${port}`
  const child = nativeRedis
    ? spawn('redis-server', args)
    : spawn('docker', ['run', '--rm', '--name', container, '--network', 'host',
      'ghcr.io/hypertask-ai/ci-redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf',
      'redis-server', ...args])
  const exited = new Promise(resolve => child.once('close', resolve))
  let one, two
  t.after(async () => {
    one?.disconnect(); two?.disconnect()
    if (nativeRedis) child.kill()
    else execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
    await exited
  })
  await new Promise((resolve, reject) => {
    let output = ''
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Redis exited before readiness: ${code}`)))
    child.stdout.on('data', data => { output += data; if (/ready to accept connections/i.test(output)) resolve() })
  })
  const Redis = require('ioredis')
  one = new Redis(port, '127.0.0.1'); two = new Redis(port, '127.0.0.1')
  const first = setup({ redisClient: one }), second = setup({ redisClient: two })
  assert.equal((await first.report(refusal, 42)).filed, false)
  assert.equal((await second.report(refusal, 43)).filed, false)
  await Promise.all([first.report(refusal, 44), second.report(refusal, 45)])
  assert.equal(first.created.length + second.created.length, 1)
  assert.equal((await second.report(refusal, 45)).filed, false)
  const ticket = [...first.created, ...second.created][0]
  for (const value of ['Robin', 'Casey', 'zzzznotafield']) assert.ok(ticket.description.includes(value))
  const fingerprint = first.load('src/lib/aiFeedback/input.ts').feedbackFingerprint(refusal)
  const key = `ai-feedback:validation-refusal:{${fingerprint}}`
  for (const suffix of ['reporters', 'filed']) assert.ok(await one.pttl(`${key}:${suffix}`) > windowMs - 10000)
  const { VALIDATION_REFUSAL_SCRIPT, RELEASE_VALIDATION_REFUSAL_SCRIPT } = first.load('src/lib/aiFeedback/rateLimit.ts')
  const keys = ['window:reporters', 'window:filed']
  const observe = (now, name, token) => one.eval(VALIDATION_REFUSAL_SCRIPT, 2, ...keys, now, name, token)
  assert.deepEqual(await observe(0, 'Robin', 'one'), [])
  assert.deepEqual(await observe(0, 'Casey', 'two'), [])
  assert.deepEqual(await observe(windowMs, 'Taylor', 'three'), [])
  assert.deepEqual(await observe(windowMs, 'Morgan', 'four'), [])
  assert.deepEqual((await observe(windowMs, 'Robin', 'five')).sort(), ['Morgan', 'Robin', 'Taylor'])
  assert.equal(await one.eval(RELEASE_VALIDATION_REFUSAL_SCRIPT, 1, keys[1], 'wrong-token'), 0)
  assert.equal(await one.get(keys[1]), 'five')
  assert.equal(await one.eval(RELEASE_VALIDATION_REFUSAL_SCRIPT, 1, keys[1], 'five'), 1)
  assert.deepEqual((await observe(windowMs, 'Robin', 'six')).sort(), ['Morgan', 'Robin', 'Taylor'])
})
