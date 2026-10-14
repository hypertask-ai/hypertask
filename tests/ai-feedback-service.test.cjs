const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let enabled, globalEnabled, rows, created, updates, comments, commentCreates, descriptionWrites, labelCreated, taskQuery, userQuery, failWrite, configured, failFlag, partialWriteFailure
let bucketCounts, lockQueue, lockKeys, attempts, activeRedis, prismaCalls, flagCalls, onQuota, labelError, labelRace, onLock, onTaskCreate, transactionError, onQueued, openTransactions, transactionRecords
const redis = {
  eval: async (script, _keys, key, now, limit, token) => {
    assert.equal(_keys, 1)
    assert.ok(key.startsWith('ai-feedback:attempt:') || key.startsWith('ai-feedback:quota:'))
    if (script.includes("redis.call('INCR'")) {
      const count = (attempts.get(key) ?? 0) + 1
      attempts.set(key, count)
      return count
    }
    if (script.includes('ZCARD')) {
      if (onQuota) onQuota()
      const entries = (bucketCounts.get(key) ?? []).filter((entry) => entry.now > now - 3600000)
      bucketCounts.set(key, entries)
      if (entries.length >= Number(limit)) return 0
      entries.push({ now, token })
      return 1
    }
    throw new Error('Unexpected Redis script')
  },
}
stub('src/lib/redis.ts', { getRedis: async () => activeRedis })
stub('src/lib/flags.ts', { isFeatureEnabled: async () => { flagCalls++; if (failFlag) throw new Error('flag storage failed'); return enabled }, featureFlagCandidateUserIds: async () => { flagCalls++; if (failFlag) throw new Error('flag storage failed'); return globalEnabled ? null : [6, 985] } })
const db = {
  user: { findUnique: async (query) => { userQuery = query; return { displayName: 'Kamil <Admin> customer@example.test' } } },
  project: {
    findFirst: async (query) => { assert.equal(query.select.ownerId, undefined); return configured ? { get ownerId() { throw new Error('Board owner must not author feedback') }, uniqueIdentifier: 'HTPR', section: [{ id: 111, section_title: 'Bugs' }] } : null },
  },
  section: { findMany: async () => [{ id: 222, section_title: 'Done' }, { id: 333, section_title: 'Shipped' }] },
  label: {
    findFirst: async (query) => { assert.deepEqual(query.where, { projectId: 15, value: 'ai-feedback' }); return labelCreated ? { id: 'label-ai' } : null },
    create: async (query) => { assert.deepEqual(query.data, { projectId: 15, value: 'ai-feedback' }); if (labelRace && labelCreated) throw Object.assign(new Error('label already exists'), { code: 'P2002' }); labelCreated++; if (labelError) throw labelError; return { id: 'label-ai' } },
  },
  comment: {
    findFirst: async ({ where }) => comments.find((comment) => comment.taskId === where.taskId && comment.creatorId === where.creatorId && comment.agentId === where.agentId && comment.text.includes(where.text.contains)) ?? null,
    update: async ({ where, data }) => {
      if (failWrite) throw new Error('write failed')
      const comment = comments.find((row) => row.id === where.id)
      assert.equal(data.summary, null)
      updates.push({ commentId: where.id, text: data.text })
      comment.text = data.text
      return comment
    },
  },
  description: { findUnique: async ({ where }) => ({ content: rows.find((row) => row.id === where.taskId).description_.content }) },
  task: { findFirst: async (query) => {
    taskQuery = query
    const row = rows.find((row) => row.status === query.where.status && ![222, 333].includes(row.sectionId) && !['Done', 'Shipped'].includes(row.section) && row.description_.content.includes(query.where.description_.is.content.contains))
    return row ? { ...row, description_: { ...row.description_ } } : null
  } },
}
for (const model of Object.values(db)) for (const [name, execute] of Object.entries(model)) model[name] = async (...args) => { prismaCalls++; return execute(...args) }
db.$transaction = async (callback, options) => {
  assert.equal(options.timeout, 30000)
  assert.ok(options.maxWait > 0 && options.maxWait <= 30000)
  if (transactionError) throw transactionError
  let key, held
  const record = { open: true, locked: false, maxWait: options.maxWait }
  transactionRecords.push(record)
  openTransactions++
  const tx = { ...db, $queryRaw: async (strings, value) => {
    assert.equal(strings.join('?'), 'SELECT pg_try_advisory_xact_lock(?) AS locked')
    assert.equal(typeof value, 'bigint')
    assert.equal(value, BigInt.asIntN(64, value))
    key = value
    lockKeys.push(key)
    if (onQueued) onQueued(key)
    if (lockQueue.has(key)) return [{ locked: false }]
    held = record
    lockQueue.set(key, held)
    record.locked = true
    if (onLock) await onLock(key)
    return [{ locked: true }]
  } }
  try { return await callback(tx) }
  finally {
    record.open = false
    openTransactions--
    if (held && lockQueue.get(key) === held) lockQueue.delete(key)
  }
}
stub('src/lib/prisma.ts', { default: db })
stub('src/utils/controllers/tasks/createTaskCore.ts', { createTaskCore: async (options) => {
  if (onTaskCreate) await onTaskCreate(options)
  if (failWrite) throw new Error('write failed')
  created.push(options)
  const task = { id: created.length, ticketNumber: `HTPR-${7195 + created.length}`, uniqueIndex: 7195 + created.length, status: 'Normal', sectionId: 111, section: 'Bugs', userId: options.userId, description_: { content: options.description } }
  rows.push(task)
  if (partialWriteFailure) { task.description_.content = ''; throw new Error('post-create failure') }
  return { task }
} })
stub('src/utils/controllers/description/common-description-create.ts', { default: async () => { descriptionWrites++; throw new Error('Repeat description write is forbidden') } })
stub('src/utils/controllers/comments/createCommentService.ts', { createCommentService: async (options) => {
  if (failWrite) throw new Error('write failed')
  assert.equal(options.creatorId, rows.find((row) => row.id === options.taskId).userId)
  assert.equal(options.currentUser.id, options.creatorId)
  assert.equal(options.trustedCaller, true)
  commentCreates.push(options)
  const comment = { id: comments.length + 1, taskId: options.taskId, creatorId: options.creatorId, agentId: null, text: options.text }
  comments.push(comment)
  return comment
} })
stub('src/lib/realtime/server.ts', { broadcastTaskChange: async () => {} })
let pending = []
const vercelPath = require.resolve('@vercel/functions')
require.cache[vercelPath] = { id: vercelPath, filename: vercelPath, loaded: true, exports: { waitUntil: (promise) => pending.push(promise) } }
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { fileAiFeedback, aiFeedbackEnabled } = jiti('../src/lib/aiFeedback/report.ts')
const { reserveFeedbackAttempt, reserveFeedbackQuota, FEEDBACK_QUOTA_SCRIPT } = jiti('../src/lib/aiFeedback/rateLimit.ts')
const { feedbackFingerprint } = jiti('../src/lib/aiFeedback/input.ts')
const { queueAiFeedback } = jiti('../src/lib/aiFeedback/automatic.ts')
const input = { surface: 'mcp', client: 'claude', tool: 'hypertask_tasks', status: 503, errorCode: 'unavailable', error: 'Cannot save "Confidential task description" for customer@example.test' }

test.beforeEach(() => {
  pending = []; enabled = true; globalEnabled = false; rows = []; created = []; updates = []; comments = []; commentCreates = []; descriptionWrites = 0; labelCreated = 0; bucketCounts = new Map(); lockQueue = new Map(); lockKeys = []; attempts = new Map(); prismaCalls = 0; flagCalls = 0; onQuota = undefined; labelError = undefined; labelRace = false; activeRedis = redis; failWrite = false; configured = true; failFlag = false; partialWriteFailure = false; onLock = undefined; onTaskCreate = undefined; transactionError = undefined; onQueued = undefined; openTransactions = 0; transactionRecords = []; userQuery = undefined; taskQuery = undefined
  delete process.env.AI_FEEDBACK_AGENT_USER_ID
})

test('creates scrubbed medium-priority report on board 15 Bugs through createTaskCore, authored by the reporter, not the board owner', async () => {
  const result = await fileAiFeedback(input, 42)
  assert.deepEqual(result, { success: true, ticketNumber: 'HTPR-7196', url: 'https://app.hypertask.ai/detail/project-15/7196', deduped: false, count: 1 })
  const options = created[0]
  assert.equal(options.projectId, 15); assert.equal(options.sectionTitle, 'Bugs'); assert.equal(options.priorityIndex, 3); assert.equal(options.userId, 42); assert.equal(options.createDrafts, false)
  assert.deepEqual(options.labelIds, ['label-ai']); assert.equal(labelCreated, 1)
  assert.equal(options.title, 'AI feedback: mcp hypertask_tasks')
  assert.deepEqual(lockKeys, [BigInt.asIntN(64, BigInt(`0x${feedbackFingerprint(input).slice(0, 16)}`))])
  assert.match(options.description, /Fingerprint: ai-fb-[a-f0-9]{12}/)
  assert.equal(options.description.includes('Seen '), false)
  assert.match(comments[0].text, /Seen 1 times/)
  assert.equal(comments[0].creatorId, 42)
  assert.equal(userQuery.select.email, undefined)
  assert.equal(userQuery.select.id, undefined)
  for (const secret of ['Confidential', 'customer@example.test', 'userId', '<Admin>']) assert.equal(options.description.includes(secret), false)
  assert.match(options.description, /Kamil/)
})

test('internal filing rejects caller-selected destinations, task IDs and authors before any storage work', async () => {
  for (const field of ['projectId', 'taskId', 'creatorId', 'userId', 'trustedCaller']) {
    await assert.rejects(fileAiFeedback({ ...input, [field]: 6 }, 42), { status: 400 })
  }
  assert.equal(prismaCalls, 0)
  assert.equal(attempts.size, 0)
  assert.equal(created.length, 0)
  assert.equal(commentCreates.length, 0)
  await fileAiFeedback(input, 42)
  assert.equal(created[0].projectId, 15)
  assert.equal(created[0].userId, 42)
  assert.equal(commentCreates[0].creatorId, 42)
  assert.equal(taskQuery.where.projectId, 15)
})

test('tally comment is created with the ticket then edited in place by the creation actor, with capped scrubbed names and clients', async () => {
  await fileAiFeedback(input, 42)
  assert.equal(comments.length, 1)
  const original = rows[0].description_.content
  const result = await fileAiFeedback({ ...input, note: 'Different context', client: 'cursor' }, 43)
  assert.equal(created.length, 1); assert.equal(result.deduped, true); assert.equal(result.count, 2)
  assert.equal(commentCreates.length, 1); assert.equal(updates.length, 1)
  assert.match(comments[0].text, /AI feedback tally: ai-fb-[a-f0-9]{12}/)
  assert.match(comments[0].text, /Clients: claude, cursor/)
  assert.equal(comments[0].creatorId, 42)
  assert.equal((comments[0].text.match(/Kamil/g) ?? []).length, 1)
  const commentId = comments[0].id
  for (let index = 0; index < 12; index++) {
    const originalFind = db.user.findUnique
    db.user.findUnique = async () => ({ displayName: `Name ${index} & Co <owner>` })
    try { await fileAiFeedback({ ...input, client: `client-${index}` }, 44) }
    finally { db.user.findUnique = originalFind }
  }
  const content = comments[0].text
  assert.equal(comments.length, 1); assert.equal(commentCreates.length, 1)
  assert.equal(updates.length, 13)
  assert.ok(updates.every((update) => update.commentId === commentId))
  assert.equal(content.match(/Reporting display names: ([^<]*)/)[1].split(', ').length, 10)
  assert.equal(content.match(/Clients: ([^<]*)/)[1].split(', ').length, 10)
  assert.match(content, /Seen 14 times/)
  assert.match(content, /Name 0 &amp; Co/)
  assert.equal(content.includes('<owner>'), false)
  assert.equal((content.match(/Seen /g) ?? []).length, 1)
  assert.equal(rows[0].description_.content, original)
  assert.equal(descriptionWrites, 0)
})

test('archived and Done reports do not absorb new reports, including isDone columns with other titles', async () => {
  for (const closed of [{ status: 'Archived' }, { sectionId: 222, section: 'Done' }, { sectionId: 333, section: 'Shipped' }]) {
    rows = []; created = []; updates = []; comments = []
    await fileAiFeedback(input, 42)
    Object.assign(rows[0], closed)
    const result = await fileAiFeedback(input, 42)
    assert.equal(result.deduped, false)
    assert.equal(created.length, 2)
    assert.equal(result.count, 1)
    assert.match(comments.at(-1).text, /Seen 1 times/)
  }
  assert.equal(taskQuery.where.projectId, 15)
  assert.equal(taskQuery.where.status, 'Normal')
  assert.deepEqual(taskQuery.where.AND[0].OR[1].sectionId.notIn, [222, 333])
})

test('account new and bump quotas are separate, inclusive and reject without writes', async () => {
  for (let index = 0; index < 10; index++) await fileAiFeedback({ ...input, tool: `tool-${index}` }, 42)
  await assert.rejects(fileAiFeedback({ ...input, tool: 'tool-11' }, 42), { status: 429 })
  assert.equal(created.length, 10)
  for (let index = 0; index < 30; index++) await fileAiFeedback({ ...input, tool: 'tool-0' }, 42)
  await assert.rejects(fileAiFeedback({ ...input, tool: 'tool-0' }, 42), { status: 429 })
  assert.equal(updates.length, 30)
  assert.equal((await fileAiFeedback({ ...input, tool: 'tool-11' }, 43)).count, 1)
})

test('anonymous reports require a dedicated bot and Everyone and share one quota for new reports and bumps', async () => {
  process.env.AI_FEEDBACK_AGENT_USER_ID = '77'
  await assert.rejects(fileAiFeedback(input), { status: 404 })
  assert.equal(created.length, 0)
  globalEnabled = true
  for (let index = 0; index < 20; index++) await fileAiFeedback(input)
  assert.equal(created.length, 1); assert.equal(updates.length, 19)
  await assert.rejects(fileAiFeedback({ ...input, tool: 'another-tool' }), { status: 429 })
  assert.equal(created.length, 1)
  assert.equal(userQuery, undefined)
  assert.equal(created[0].userId, 77)
  assert.equal(comments[0].creatorId, 77)
})

test('flag-off and invalid input precede attempts and never write or consume filing quota; failed writes keep reservations', async () => {
  enabled = false
  assert.equal(await aiFeedbackEnabled(42), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  enabled = true
  await assert.rejects(fileAiFeedback({ ...input, arguments: { title: 'private' } }, 42), { status: 400 })
  assert.equal(created.length, 0); assert.equal(bucketCounts.size, 0)
  failWrite = true
  await assert.rejects(fileAiFeedback(input, 42), /write failed/)
  assert.equal([...bucketCounts.values()].flat().length, 1)
  assert.equal(lockQueue.size, 0)
  failWrite = false
  assert.equal((await fileAiFeedback(input, 42)).count, 1)
})

test('titles use tool, errorCode or status and never exceed 80 characters; unconfigured destination fails closed', async () => {
  for (const report of [{ surface: 'api', errorCode: 'oops' }, { surface: 'cli', status: 500 }, { surface: 'agent', tool: ('x'.repeat(19) + '-').repeat(4).slice(0, 79) }]) await fileAiFeedback(report, 42)
  assert.equal(created[0].title, 'AI feedback: api oops'); assert.equal(created[1].title, 'AI feedback: cli 500'); assert.equal(created[2].title.length, 80)
  configured = false
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
})

test('real Redis quotas and attempts are atomic across clients and storage errors fail closed', { timeout: 60000 }, async (t) => {
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
  const container = `ai-feedback-redis-${process.pid}-${port}`
  const child = nativeRedis
    ? spawn('redis-server', args)
    : spawn('docker', ['run', '--rm', '--name', container, '--network', 'host',
      'ghcr.io/hypertask-ai/ci-redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf',
      'redis-server', ...args])
  const exited = new Promise((resolve) => child.once('close', resolve))
  let one, two
  t.after(async () => {
    one?.disconnect(); two?.disconnect()
    if (nativeRedis) child.kill()
    else execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
    await exited
  })
  t.diagnostic(`Redis fixture: ${nativeRedis ? 'local binary' : 'disposable Docker container'}`)
  await new Promise((resolve, reject) => {
    let output = ''
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Redis exited before readiness: ${code}`)))
    child.stdout.on('data', (data) => { output += data; if (/ready to accept connections/i.test(output)) resolve() })
  })
  const Redis = require('ioredis')
  one = new Redis(port, '127.0.0.1'); two = new Redis(port, '127.0.0.1')
  const now = 10_000_000
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => (index % 2 ? one : two).eval(FEEDBACK_QUOTA_SCRIPT, 1, 'test:quota', now, 10, `token-${index}`)))
  assert.equal(results.filter((value) => Number(value) === 1).length, 10)
  assert.equal(await one.zcard('test:quota'), 10)
  assert.equal(await one.eval(FEEDBACK_QUOTA_SCRIPT, 1, 'test:quota', now + 3599999, 10, 'too-soon'), 0)
  assert.equal(await one.eval(FEEDBACK_QUOTA_SCRIPT, 1, 'test:quota', now + 3600000, 10, 'next-hour'), 1)
  activeRedis = one
  const attemptResults = await Promise.all(Array.from({ length: 70 }, () => reserveFeedbackAttempt(42)))
  assert.equal(attemptResults.filter(Boolean).length, 60)
  assert.ok(await one.ttl('ai-feedback:attempt:42') > 3590)
  assert.equal(await reserveFeedbackAttempt(43), true)
  for (let index = 0; index < 60; index++) assert.equal(await reserveFeedbackAttempt(), true)
  assert.equal(await reserveFeedbackAttempt(), false)
  await one.expire('ai-feedback:attempt:42', 0)
  assert.equal(await reserveFeedbackAttempt(42), true)
  await fileAiFeedback(input, 45)
  await fileAiFeedback(input, 45)
  await fileAiFeedback(input, 45)
  await one.flushdb()
  assert.equal((await fileAiFeedback(input, 45)).count, 4)
  assert.match(comments[0].text, /Seen 4 times/)
  assert.equal(descriptionWrites, 0)
  activeRedis = { eval: async () => { throw new Error('storage unavailable') } }
  await assert.rejects(reserveFeedbackQuota(42, false), /storage unavailable/)
})


test('flag storage errors fail closed and transaction timeouts return explicit 503', async () => {
  failFlag = true
  assert.equal(await aiFeedbackEnabled(42), false)
  assert.equal(await aiFeedbackEnabled(), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  assert.equal(created.length, 0)
  assert.equal(attempts.size, 0)
  failFlag = false
  transactionError = Object.assign(new Error('Transaction expired'), { code: 'P2028' })
  await assert.rejects(fileAiFeedback(input, 42), { status: 503, message: 'Feedback timed out, try again shortly' })
  assert.equal(created.length, 0)
  assert.equal(comments.length, 0)
})

test('description never written on repeat, including human edits after lookup and exact owned-looking metadata', async () => {
  await fileAiFeedback(input, 42)
  const human = '\n<h2 data-owner="human">Triage &amp; context</h2>\n<p>Keep  spacing, quotes "exactly", and &#39;entities&#39;.</p>\n<p>Seen 999 times</p><p>Clients: human</p>'
  const original = rows[0].description_.content
  onQuota = () => { rows[0].description_.content = original + human; onQuota = undefined }
  for (const count of [2, 3]) {
    const result = await fileAiFeedback({ ...input, client: 'cursor', note: 'New private prose' }, 43)
    assert.equal(result.count, count)
    assert.equal(rows[0].description_.content, original + human)
    assert.equal(descriptionWrites, 0)
    const body = comments[0].text
    assert.equal(body.includes('New private prose'), false)
    assert.equal(body.includes('Triage'), false)
    assert.match(body, /Clients: claude, cursor/)
    const lastSeen = body.match(/<p>Last seen: ([^<]*)<\/p>/)[1]
    assert.equal(new Date(lastSeen).toISOString(), lastSeen)
    assert.equal((body.match(/Last seen:/g) ?? []).length, 1)
  }
})

test('free text is accepted but never persisted, including unquoted private prose and empty strings', async () => {
  for (const text of [{ note: 'pay Acme invoice tomorrow' }, { error: 'Private supplier discussion' }, { note: '', error: '' }]) {
    rows = []; created = []; comments = []
    await fileAiFeedback({ surface: 'cli', category: 'user_reported_broken', ...text }, 42)
    assert.match(created[0].description, /Category: user_reported_broken/)
    assert.match(created[0].description, /Free text was supplied and not stored, for privacy\./)
    assert.equal(created[0].description.includes('Acme'), false)
    assert.equal(created[0].description.includes('supplier'), false)
    assert.equal(created[0].description.includes('<p>Note:'), false)
    assert.equal(created[0].description.includes('<p>Error:'), false)
  }
  rows = []; created = []; comments = []
  await fileAiFeedback({ surface: 'cli' }, 42)
  assert.match(created[0].description, /Category: other/)
  assert.equal(created[0].description.includes('Free text was supplied'), false)
})

test('overlapping reports with different fingerprints both file, and identical reports dedupe', async () => {
  labelRace = true
  const results = await Promise.all([fileAiFeedback(input, 42), fileAiFeedback({ ...input, tool: 'hypertask_hello' }, 43)])
  assert.equal(results.length, 2)
  assert.ok(results.every((result) => result.success && !result.deduped))
  assert.equal(created.length, 2)
  assert.equal(labelCreated, 1)
  assert.equal(lockQueue.size, 0)
  rows = []; created = []; comments = []
  const repeated = await Promise.all([fileAiFeedback(input, 44), fileAiFeedback(input, 45)])
  assert.deepEqual(repeated.map((result) => result.count), [1, 2])
  assert.match(comments[0].text, /Seen 2 times/)
  assert.equal(lockKeys.at(-1), lockKeys.at(-2))
  assert.deepEqual(repeated.map((result) => result.deduped), [false, true])
  assert.equal(created.length, 1)
  assert.equal(lockQueue.size, 0)
})


test('partial core failures cannot create more than ten account reports in the hour', async () => {
  partialWriteFailure = true
  for (let index = 0; index < 10; index++) await assert.rejects(fileAiFeedback(input, 42), /post-create failure/)
  assert.equal(created.length, 10)
  await assert.rejects(fileAiFeedback(input, 42), { status: 429 })
  assert.equal(created.length, 10)
})

test('different fingerprints file without waiting for a blocked fingerprint', { timeout: 3000 }, async () => {
  const firstKey = BigInt.asIntN(64, BigInt(`0x${feedbackFingerprint(input).slice(0, 16)}`))
  let release, entered
  const blocked = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  onLock = async (key) => { if (key === firstKey) { entered(); await blocked } }
  const first = fileAiFeedback(input, 42)
  try {
    await started
    const second = await fileAiFeedback({ ...input, tool: 'hypertask_hello' }, 43)
    assert.equal(second.success, true)
    assert.equal(created.length, 1)
    assert.equal(lockQueue.size, 1)
    assert.notEqual(lockKeys[0], lockKeys[1])
  } finally { release(); await first }
  assert.equal(created.length, 2)
  assert.equal(lockQueue.size, 0)
})

test('attempt limit follows flag and validation but precedes any Prisma call or lock', async () => {
  attempts.set('ai-feedback:attempt:42', 60)
  await assert.rejects(fileAiFeedback(input, 42), { status: 429 })
  assert.equal(prismaCalls, 0)
  assert.equal(flagCalls, 1)
  assert.equal(lockKeys.length, 0)
  assert.equal(bucketCounts.size, 0)
  enabled = false
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  enabled = true
  await assert.rejects(fileAiFeedback(null, 42), { status: 400 })
  assert.equal(attempts.get('ai-feedback:attempt:42'), 61)
  assert.equal((await fileAiFeedback(input, 43)).success, true)
})

test('label creation errors re-read the concurrently created label, and rethrow if none exists', async () => {
  for (const error of [Object.assign(new Error('unique conflict'), { code: 'P2002' }), new Error('ambiguous create failure')]) {
    labelCreated = 0; labelError = error
    assert.equal((await fileAiFeedback({ ...input, errorCode: error.code ? 'unique' : 'ambiguous' }, 42)).success, true)
    assert.deepEqual(created.at(-1).labelIds, ['label-ai'])
  }
  labelCreated = 0
  const original = db.label.findFirst
  db.label.findFirst = async () => { prismaCalls++; return null }
  try { await assert.rejects(fileAiFeedback({ ...input, errorCode: 'missing-label' }, 42), /ambiguous create failure/) }
  finally { db.label.findFirst = original }
  assert.equal(lockQueue.size, 0)
})

test('tally comment is the only count source, including after Redis is cleared', async () => {
  await fileAiFeedback(input, 42)
  assert.equal((await fileAiFeedback(input, 43)).count, 2)
  comments[0].text = comments[0].text.replace('Seen 2 times', 'Seen 87 times')
  attempts.clear(); bucketCounts.clear()
  assert.equal((await fileAiFeedback(input, 44)).count, 88)
  assert.equal(comments.length, 1)
  assert.match(comments[0].text, /Seen 88 times/)
  assert.equal(descriptionWrites, 0)
})

test('tally lookup never edits a human comment or another agent comment with the same marker', async () => {
  await fileAiFeedback(input, 42)
  const marker = `<p>AI feedback tally: ai-fb-${feedbackFingerprint(input).slice(0, 12)}</p>`
  const human = { id: 50, taskId: rows[0].id, creatorId: 43, agentId: null, text: marker + '<p>Seen 900 times</p>' }
  const agent = { id: 51, taskId: rows[0].id, creatorId: 42, agentId: 'another-agent', text: marker + '<p>Seen 800 times</p>' }
  comments.push(human, agent)
  await fileAiFeedback(input, 43)
  await fileAiFeedback(input, 44)
  assert.equal(comments.length, 3)
  assert.equal(commentCreates.length, 1)
  assert.equal(updates.length, 2)
  assert.equal(updates[0].commentId, comments[0].id)
  assert.equal(human.text, marker + '<p>Seen 900 times</p>')
  assert.equal(agent.text, marker + '<p>Seen 800 times</p>')
})

test('anonymous automatic reports skip silently without a valid dedicated bot, without destination work', async () => {
  globalEnabled = true
  for (const value of [undefined, '', 'invalid', '0', '-1', '1.5']) {
    if (value === undefined) delete process.env.AI_FEEDBACK_AGENT_USER_ID
    else process.env.AI_FEEDBACK_AGENT_USER_ID = value
    assert.equal(await fileAiFeedback(input), undefined)
  }
  assert.equal(prismaCalls, 0)
  assert.equal(flagCalls, 6)
  assert.equal(lockQueue.size, 0)
  assert.equal(attempts.get('ai-feedback:attempt:anonymous'), 6)
  process.env.AI_FEEDBACK_AGENT_USER_ID = '77'
  await fileAiFeedback(input)
  assert.equal(created[0].userId, 77)
  delete process.env.AI_FEEDBACK_AGENT_USER_ID
  assert.equal(await fileAiFeedback(input), undefined)
  assert.equal(comments.length, 1)
  process.env.AI_FEEDBACK_AGENT_USER_ID = '78'
  await fileAiFeedback(input)
  await fileAiFeedback(input, 43)
  assert.equal(comments[0].creatorId, 77)
  assert.equal(updates.length, 2)
})

test('different categories create separate reports while omitted category matches other', async () => {
  await fileAiFeedback(input, 42)
  assert.equal((await fileAiFeedback({ ...input, category: 'other' }, 43)).deduped, true)
  assert.equal((await fileAiFeedback({ ...input, category: 'slow' }, 44)).deduped, false)
  assert.equal(created.length, 2)
  assert.match(created[1].description, /Category: slow/)
})

for (const holderFails of [false, true]) {
  test(`automatic same-fingerprint contender files after holder ${holderFails ? 'fails' : 'finishes'}`, { timeout: 3000 }, async () => {
    let release, entered, queued
    const blocked = new Promise((resolve) => { release = resolve })
    const started = new Promise((resolve) => { entered = resolve })
    const waiting = new Promise((resolve) => { queued = resolve })
    onTaskCreate = async () => {
      onTaskCreate = undefined
      entered()
      await blocked
      if (holderFails) throw new Error('holder failed')
    }
    const holder = fileAiFeedback(input, 42)
    const outcome = holderFails ? assert.rejects(holder, /holder failed/) : holder
    try {
      await started
      onQueued = queued
      queueAiFeedback({ ...input, category: 'other' }, 43)
      await waiting
      assert.equal(lockKeys.length, 2)
      assert.equal(lockKeys[0], lockKeys[1])
      assert.equal(created.length, 0)
      assert.equal(comments.length, 0)
    } finally {
      release()
      await outcome
      await Promise.all(pending)
    }
    assert.equal(created.length, 1)
    assert.equal(comments.length, 1)
    assert.match(comments[0].text, new RegExp(`Seen ${holderFails ? 1 : 2} times`))
    assert.equal(created[0].userId, holderFails ? 43 : 42)
    assert.equal(lockQueue.size, 0)
  })
}

test('quota 429 rejects inside the lock without writes or tally inflation', async () => {
  for (let index = 0; index < 10; index++) await fileAiFeedback({ ...input, tool: `tool-${index}` }, 42)
  const beforeNew = { locks: lockKeys.length, comments: comments.map((comment) => comment.text) }
  await assert.rejects(fileAiFeedback(input, 42), { status: 429 })
  assert.equal(lockKeys.length, beforeNew.locks + 1)
  assert.deepEqual(comments.map((comment) => comment.text), beforeNew.comments)
  for (let index = 0; index < 30; index++) await fileAiFeedback({ ...input, tool: 'tool-0' }, 42)
  const beforeBump = { locks: lockKeys.length, comments: comments.map((comment) => comment.text) }
  await assert.rejects(fileAiFeedback({ ...input, tool: 'tool-0' }, 42), { status: 429 })
  assert.equal(lockKeys.length, beforeBump.locks + 1)
  assert.deepEqual(comments.map((comment) => comment.text), beforeBump.comments)
  assert.equal((await fileAiFeedback({ ...input, tool: 'tool-0' }, 43)).count, 32)
  assert.equal((await fileAiFeedback(input, 43)).count, 1)
})

test('a changed new-vs-bump decision charges the correct quota bucket inside the lock', async () => {
  const results = await Promise.all([fileAiFeedback(input, 42), fileAiFeedback(input, 43)])
  assert.deepEqual(results.map((result) => result.count), [1, 2])
  assert.equal(bucketCounts.get('ai-feedback:quota:42:new').length, 1)
  assert.equal(bucketCounts.has('ai-feedback:quota:43:new'), false)
  assert.equal(bucketCounts.get('ai-feedback:quota:43:bump').length, 1)
  assert.equal(comments.length, 1)
})

test('a ticket closed before the locked lookup charges only the new-ticket bucket and resets tally', async () => {
  await fileAiFeedback(input, 42)
  await fileAiFeedback(input, 42)
  onLock = () => { rows[0].sectionId = 222; rows[0].section = 'Done'; onLock = undefined }
  const result = await fileAiFeedback(input, 43)
  assert.equal(result.deduped, false)
  assert.equal(result.count, 1)
  assert.equal(bucketCounts.has('ai-feedback:quota:43:bump'), false)
  assert.equal(bucketCounts.get('ai-feedback:quota:43:new').length, 1)
  assert.match(comments[0].text, /Seen 2 times/)
  assert.match(comments[1].text, /Seen 1 times/)
})

test('corrected quota rejection leaves the holder tally unchanged', async () => {
  bucketCounts.set('ai-feedback:quota:43:bump', Array.from({ length: 30 }, () => ({ now: Date.now() })))
  const results = await Promise.allSettled([fileAiFeedback(input, 42), fileAiFeedback(input, 43)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.status, 429)
  assert.equal(created.length, 1)
  assert.match(comments[0].text, /Seen 1 times/)
  assert.equal(updates.length, 0)
})

test('anonymous concurrent new-to-bump decisions reserve the shared bucket only once per report', async () => {
  globalEnabled = true
  process.env.AI_FEEDBACK_AGENT_USER_ID = '77'
  const results = await Promise.all([fileAiFeedback(input), fileAiFeedback(input)])
  assert.deepEqual(results.map((result) => result.count), [1, 2])
  assert.equal(bucketCounts.get('ai-feedback:quota:anonymous').length, 2)
  assert.equal(created.length, 1)
  assert.match(comments[0].text, /Seen 2 times/)
})

test('advisory keys retain the high hash bit as a signed 64-bit integer', async () => {
  const crypto = require('node:crypto')
  const report = { surface: 'mcp', tool: 'hypertask_hello', category: 'call_failed' }
  const hash = crypto.createHash('sha256').update('mcp|hypertask_hello|||call_failed').digest()
  const key = hash.readBigInt64BE()
  assert.ok(key < 0n)
  await fileAiFeedback(report, 42)
  assert.deepEqual(lockKeys, [key])
})

test('ten identical concurrent account reports reserve one new slot and nine bump slots, leaving room for a distinct report', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => fileAiFeedback(input, 42)))
  assert.deepEqual(results.map((result) => result.count).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(results.filter((result) => !result.deduped).length, 1)
  assert.equal(created.length, 1)
  assert.equal(bucketCounts.get('ai-feedback:quota:42:new').length, 1)
  assert.equal(bucketCounts.get('ai-feedback:quota:42:bump').length, 9)
  assert.match(comments[0].text, /Seen 10 times/)
  const distinct = await fileAiFeedback({ ...input, tool: 'hypertask_hello' }, 42)
  assert.equal(distinct.deduped, false)
  assert.equal(distinct.count, 1)
  assert.equal(created.length, 2)
  assert.equal(bucketCounts.get('ai-feedback:quota:42:new').length, 2)
  assert.equal(bucketCounts.get('ai-feedback:quota:42:bump').length, 9)
  assert.equal(attempts.get('ai-feedback:attempt:42'), 11)
  assert.equal(openTransactions, 0)
})

test('same-fingerprint waiter ends its transaction before sleeping, leaving only the holder connection open, then both reports land in order', { timeout: 3000 }, async (t) => {
  let release, entered, sleeps = 0
  const blocked = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  onTaskCreate = async () => { onTaskCreate = undefined; entered(); await blocked }
  const holder = fileAiFeedback(input, 42)
  await started
  const schedule = global.setTimeout
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    sleeps++
    assert.ok(delay >= 100 && delay <= 250)
    assert.equal(openTransactions, 1)
    assert.deepEqual(transactionRecords.map(({ open, locked }) => ({ open, locked })), [
      { open: true, locked: true }, { open: false, locked: false },
    ])
    assert.equal(bucketCounts.has('ai-feedback:quota:43:new'), false)
    assert.equal(bucketCounts.has('ai-feedback:quota:43:bump'), false)
    release()
    return schedule(callback, 0)
  })
  let results
  try { results = await Promise.all([holder, fileAiFeedback(input, 43)]) }
  finally { release(); await holder }
  assert.equal(sleeps, 1)
  assert.deepEqual(results.map((result) => result.count), [1, 2])
  assert.deepEqual(results.map((result) => result.deduped), [false, true])
  assert.equal(created.length, 1)
  assert.equal(comments.length, 1)
  assert.match(comments[0].text, /Seen 2 times/)
  assert.equal(updates.length, 1)
  assert.equal(openTransactions, 0)
  assert.ok(transactionRecords.every((record) => !record.open))
})

for (const automatic of [false, true]) {
  test(`${automatic ? 'automatic' : 'explicit'} contention retries with released connections for the full 30 seconds before ${automatic ? 'returning quietly' : '503'}`, async (t) => {
    const start = Date.now()
    let now = start, sleeps = 0
    const key = BigInt.asIntN(64, BigInt(`0x${feedbackFingerprint(automatic ? { ...input, category: 'call_failed' } : input).slice(0, 16)}`))
    lockQueue.set(key, 'external holder')
    t.mock.method(Date, 'now', () => now)
    t.mock.method(Math, 'random', () => automatic ? 1 - Number.EPSILON : 0)
    t.mock.method(global, 'setTimeout', (callback, delay) => {
      assert.equal(openTransactions, 0)
      assert.ok(transactionRecords.every((record) => !record.open && !record.locked))
      assert.equal(delay, automatic ? 250 : 100)
      assert.ok(now < start + 30000)
      assert.equal(bucketCounts.size, 0)
      sleeps++
      now += delay
      queueMicrotask(callback)
    })
    if (automatic) {
      queueAiFeedback(input, 42)
      assert.equal(pending.length, 1)
      assert.deepEqual(await Promise.all(pending), [undefined])
    } else {
      await assert.rejects(fileAiFeedback(input, 42), { status: 503, message: 'Feedback timed out, try again shortly' })
    }
    assert.equal(now - start, 30000)
    assert.equal(sleeps, automatic ? 120 : 300)
    assert.equal(lockKeys.length, sleeps)
    assert.deepEqual(transactionRecords.map((record) => record.maxWait), Array.from({ length: sleeps }, (_, index) => 30000 - index * (automatic ? 250 : 100)))
    assert.equal(attempts.get('ai-feedback:attempt:42'), 1)
    assert.equal(created.length, 0)
    assert.equal(comments.length, 0)
    assert.equal(bucketCounts.size, 0)
    assert.equal(openTransactions, 0)
    lockQueue.delete(key)
  })
}

test('automatic contention still files when the lock becomes free just before the 30-second deadline', async (t) => {
  const start = Date.now()
  let now = start, sleeps = 0
  const key = BigInt.asIntN(64, BigInt(`0x${feedbackFingerprint({ ...input, category: 'call_failed' }).slice(0, 16)}`))
  lockQueue.set(key, 'external holder')
  t.mock.method(Date, 'now', () => now)
  t.mock.method(Math, 'random', () => 1 - Number.EPSILON)
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    assert.equal(openTransactions, 0)
    assert.equal(delay, 250)
    sleeps++
    now += delay
    if (now - start === 29750) lockQueue.delete(key)
    queueMicrotask(callback)
  })
  queueAiFeedback(input, 42)
  await Promise.all(pending)
  assert.equal(now - start, 29750)
  assert.equal(sleeps, 119)
  assert.equal(created.length, 1)
  assert.equal(comments.length, 1)
  assert.match(comments[0].text, /Seen 1 times/)
  assert.equal(bucketCounts.get('ai-feedback:quota:42:new').length, 1)
  assert.equal(bucketCounts.has('ai-feedback:quota:42:bump'), false)
  assert.equal(openTransactions, 0)
  assert.equal(lockQueue.size, 0)
})
