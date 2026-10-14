const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let enabled, globalEnabled, rows, created, updates, comments, commentCreates, descriptionWrites, retryEntries, retryOperations, labelCreated, taskQuery, userQuery, failWrite, configured, failFlag, partialWriteFailure
let bucketCounts, locks, counters, attempts, activeRedis, prismaCalls, flagCalls, onQuota, labelError, labelRace
const redis = {
  set: async (key, value, ...args) => {
    assert.deepEqual(args.slice(0, 2), ['EX', key.includes(':lock:') ? 30 : 30 * 86400])
    assert.ok(args.length === 2 || args[2] === 'NX')
    const store = key.includes(':lock:') ? locks : counters
    if (args[2] === 'NX' && store.has(key)) return null
    store.set(key, value)
    return 'OK'
  },
  incr: async (key) => { const count = Number(counters.get(key) ?? 0) + 1; counters.set(key, count); return count },
  expire: async (key, seconds) => { assert.equal(seconds, 30 * 86400); assert.ok(counters.has(key)); return 1 },
  get: async (key) => counters.get(key),
  lpop: async (key, limit) => { assert.equal(key, 'ai-feedback:retry'); assert.equal(limit, 5); return retryEntries.splice(0, limit) },
  multi: () => {
    const transaction = {
      rpush: (key, entry) => { assert.equal(key, 'ai-feedback:retry'); retryOperations.push(['rpush', entry]); retryEntries.push(entry); return transaction },
      ltrim: (key, start, stop) => { assert.equal(key, 'ai-feedback:retry'); assert.deepEqual([start, stop], [-500, -1]); retryOperations.push(['ltrim']); retryEntries = retryEntries.slice(-500); return transaction },
      expire: (key, ttl) => { assert.equal(key, 'ai-feedback:retry'); assert.equal(ttl, 86400); retryOperations.push(['expire', ttl]); return transaction },
      exec: async () => [[null, retryEntries.length], [null, 'OK'], [null, 1]],
    }
    return transaction
  },
  eval: async (script, _keys, key, now, limit, token) => {
    if (script.includes('30000')) return locks.get(key) === now ? 1 : 0
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
    if (locks.get(key) === now) locks.delete(key)
    return 1
  },
}
stub('src/lib/redis.ts', { getRedis: async () => activeRedis })
stub('src/lib/flags.ts', { isFeatureEnabled: async () => { flagCalls++; if (failFlag) throw new Error('flag storage failed'); return enabled }, featureFlagCandidateUserIds: async () => { flagCalls++; if (failFlag) throw new Error('flag storage failed'); return globalEnabled ? null : [6, 985] } })
const db = {
  user: { findUnique: async (query) => { userQuery = query; return { displayName: 'Kamil <Admin> customer@example.test' } } },
  project: {
    findFirst: async () => configured ? { ownerId: 6, uniqueIdentifier: 'HTPR', section: [{ id: 111, section_title: 'Bugs' }] } : null,
  },
  section: { findMany: async () => [{ id: 222, section_title: 'Done' }, { id: 333, section_title: 'Shipped' }] },
  label: {
    findFirst: async (query) => { assert.deepEqual(query.where, { projectId: 15, value: 'ai-feedback' }); return labelCreated ? { id: 'label-ai' } : null },
    create: async (query) => { assert.deepEqual(query.data, { projectId: 15, value: 'ai-feedback' }); if (labelRace && labelCreated) throw Object.assign(new Error('label already exists'), { code: 'P2002' }); labelCreated++; if (labelError) throw labelError; return { id: 'label-ai' } },
  },
  comment: { findFirst: async ({ where }) => comments.find((comment) => comment.taskId === where.taskId && comment.creatorId === where.creatorId && comment.agentId === where.agentId && comment.text.includes(where.text.contains)) ?? null },
  description: { findUnique: async ({ where }) => ({ content: rows.find((row) => row.id === where.taskId).description_.content }) },
  task: { findFirst: async (query) => {
    taskQuery = query
    const row = rows.find((row) => row.status === query.where.status && ![222, 333].includes(row.sectionId) && !['Done', 'Shipped'].includes(row.section) && row.description_.content.includes(query.where.description_.is.content.contains))
    return row ? { ...row, description_: { ...row.description_ } } : null
  } },
}
for (const model of Object.values(db)) for (const [name, execute] of Object.entries(model)) model[name] = async (...args) => { prismaCalls++; return execute(...args) }
stub('src/lib/prisma.ts', { default: db })
stub('src/utils/controllers/tasks/createTaskCore.ts', { createTaskCore: async (options) => {
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
  commentCreates.push(options)
  const comment = { id: comments.length + 1, taskId: options.taskId, creatorId: options.creatorId, agentId: null, text: options.text }
  comments.push(comment)
  return comment
} })
stub('src/utils/controllers/comments/updateCommentService.ts', { updateCommentService: async (options) => {
  if (failWrite) throw new Error('write failed')
  const comment = comments.find((row) => row.id === options.commentId)
  assert.equal(options.userId, comment.creatorId)
  updates.push(options)
  comment.text = options.text
  return comment
} })
stub('src/lib/realtime/server.ts', { broadcastTaskChange: async () => {} })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { fileAiFeedback, aiFeedbackEnabled, FEEDBACK_RENEW_LEASE_SCRIPT } = jiti('../src/lib/aiFeedback/report.ts')
const { reserveFeedbackAttempt, reserveFeedbackQuota, FEEDBACK_QUOTA_SCRIPT } = jiti('../src/lib/aiFeedback/rateLimit.ts')
const { feedbackFingerprint } = jiti('../src/lib/aiFeedback/input.ts')
const input = { surface: 'mcp', client: 'claude', tool: 'hypertask_tasks', status: 503, errorCode: 'unavailable', error: 'Cannot save "Confidential task description" for customer@example.test' }

test.beforeEach(() => {
  enabled = true; globalEnabled = false; rows = []; created = []; updates = []; comments = []; commentCreates = []; descriptionWrites = 0; retryEntries = []; retryOperations = []; labelCreated = 0; bucketCounts = new Map(); locks = new Map(); counters = new Map(); attempts = new Map(); prismaCalls = 0; flagCalls = 0; onQuota = undefined; labelError = undefined; labelRace = false; activeRedis = redis; failWrite = false; configured = true; failFlag = false; partialWriteFailure = false; userQuery = undefined; taskQuery = undefined
})

test('creates scrubbed medium-priority report on board 15 Bugs through createTaskCore, never as the reporting account', async () => {
  const result = await fileAiFeedback(input, 42)
  assert.deepEqual(result, { success: true, ticketNumber: 'HTPR-7196', url: 'https://app.hypertask.ai/detail/project-15/7196', deduped: false, count: 1 })
  const options = created[0]
  assert.equal(options.projectId, 15); assert.equal(options.sectionTitle, 'Bugs'); assert.equal(options.priorityIndex, 3); assert.equal(options.userId, 6); assert.equal(options.createDrafts, false)
  assert.deepEqual(options.labelIds, ['label-ai']); assert.equal(labelCreated, 1)
  assert.equal(options.title, 'AI feedback: mcp hypertask_tasks')
  assert.match(options.description, /Fingerprint: ai-fb-[a-f0-9]{12}/)
  assert.match(options.description, /Seen 1 times/)
  assert.equal(userQuery.select.email, undefined)
  assert.equal(userQuery.select.id, undefined)
  for (const secret of ['Confidential', 'customer@example.test', 'userId', '<Admin>']) assert.equal(options.description.includes(secret), false)
  assert.match(options.description, /Kamil/)
})

test('tally comment is created on first repeat then edited in place by the creation actor, with capped scrubbed names and clients', async () => {
  await fileAiFeedback(input, 42)
  assert.equal(comments.length, 0)
  const original = rows[0].description_.content
  const result = await fileAiFeedback({ ...input, note: 'Different context', client: 'cursor' }, 43)
  assert.equal(created.length, 1); assert.equal(result.deduped, true); assert.equal(result.count, 2)
  assert.equal(commentCreates.length, 1); assert.equal(updates.length, 0)
  assert.match(comments[0].text, /AI feedback tally: ai-fb-[a-f0-9]{12}/)
  assert.match(comments[0].text, /Clients: claude, cursor/)
  assert.equal(comments[0].creatorId, 6)
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
  assert.equal(updates.length, 12)
  assert.ok(updates.every((update) => update.commentId === commentId && update.userId === 6))
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
    rows = []; created = []; updates = []
    await fileAiFeedback(input, 42)
    Object.assign(rows[0], closed)
    const result = await fileAiFeedback(input, 42)
    assert.equal(result.deduped, false)
    assert.equal(created.length, 2)
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
  assert.equal(commentCreates.length + updates.length, 30)
  assert.equal((await fileAiFeedback({ ...input, tool: 'tool-11' }, 43)).count, 1)
})

test('anonymous reports require Everyone and share one quota for new reports and bumps', async () => {
  await assert.rejects(fileAiFeedback(input), { status: 404 })
  assert.equal(created.length, 0)
  globalEnabled = true
  for (let index = 0; index < 20; index++) await fileAiFeedback(input)
  assert.equal(created.length, 1); assert.equal(commentCreates.length + updates.length, 19)
  await assert.rejects(fileAiFeedback({ ...input, tool: 'another-tool' }), { status: 429 })
  assert.equal(created.length, 1)
  assert.equal(userQuery, undefined)
})

test('flag-off and invalid input consume attempts but never write or consume filing quota; failed writes keep reservations', async () => {
  enabled = false
  assert.equal(await aiFeedbackEnabled(42), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  enabled = true
  await assert.rejects(fileAiFeedback({ ...input, arguments: { title: 'private' } }, 42), { status: 400 })
  assert.equal(created.length, 0); assert.equal(bucketCounts.size, 0)
  failWrite = true
  await assert.rejects(fileAiFeedback(input, 42), /write failed/)
  assert.equal([...bucketCounts.values()].flat().length, 1)
  assert.equal(locks.size, 0)
  failWrite = false
  assert.equal((await fileAiFeedback(input, 42)).count, 1)
})

test('titles use tool, errorCode or status and never exceed 80 characters; unconfigured destination fails closed', async () => {
  for (const report of [{ surface: 'api', errorCode: 'oops' }, { surface: 'cli', status: 500 }, { surface: 'agent', tool: ('x'.repeat(19) + '-').repeat(4).slice(0, 79) }]) await fileAiFeedback(report, 42)
  assert.equal(created[0].title, 'AI feedback: api oops'); assert.equal(created[1].title, 'AI feedback: cli 500'); assert.equal(created[2].title.length, 80)
  configured = false
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
})

test('real Redis quotas, attempts, lease renewal are atomic across clients and storage errors fail closed', async (t) => {
  const { spawn } = require('node:child_process')
  const fs = require('node:fs'), os = require('node:os')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-feedback-redis-'))
  const socket = path.join(folder, 'redis.sock')
  const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', () => reject(new Error('Redis exited before readiness'))); child.stdout.on('data', (data) => { if (/ready to accept connections/i.test(String(data))) resolve() }) })
  const Redis = require('ioredis')
  const one = new Redis(socket), two = new Redis(socket)
  t.after(async () => { one.disconnect(); two.disconnect(); child.kill(); await new Promise((resolve) => child.once('exit', resolve)); fs.rmSync(folder, { recursive: true, force: true }) })
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
  const lockKey = 'ai-feedback:lock:test'
  await one.set(lockKey, 'owner', 'PX', 1000)
  assert.equal(await one.eval(FEEDBACK_RENEW_LEASE_SCRIPT, 1, lockKey, 'intruder'), 0)
  assert.ok(await one.pttl(lockKey) <= 1000)
  assert.equal(await one.eval(FEEDBACK_RENEW_LEASE_SCRIPT, 1, lockKey, 'owner'), 1)
  assert.ok(await one.pttl(lockKey) > 29900)
  await two.set(lockKey, 'replacement', 'PX', 1000)
  assert.equal(await one.eval(FEEDBACK_RENEW_LEASE_SCRIPT, 1, lockKey, 'owner'), 0)
  assert.equal(await two.get(lockKey), 'replacement')
  assert.ok(await two.pttl(lockKey) <= 1000)
  activeRedis = one
  await fileAiFeedback(input, 45)
  await fileAiFeedback(input, 45)
  await fileAiFeedback(input, 45)
  const durableCountKey = `ai-feedback:count:${feedbackFingerprint(input)}`
  await one.expire(durableCountKey, 0)
  assert.equal((await fileAiFeedback(input, 45)).count, 4)
  assert.equal(await two.get(durableCountKey), '4')
  assert.match(comments[0].text, /Seen 4 times/)
  assert.equal(descriptionWrites, 0)
  const queuedInput = { ...input, tool: 'queued-tool' }
  const queuedLock = `ai-feedback:lock:${feedbackFingerprint(queuedInput)}`
  await two.set(queuedLock, 'another-owner', 'EX', 30)
  await assert.rejects(fileAiFeedback(queuedInput, 46, true), { status: 503 })
  assert.equal(await one.llen('ai-feedback:retry'), 1)
  assert.ok(await one.ttl('ai-feedback:retry') > 86390)
  const queued = JSON.parse((await two.lrange('ai-feedback:retry', 0, -1))[0])
  assert.equal(queued.input.error, undefined)
  await two.del(queuedLock)
  await fileAiFeedback({ ...input, tool: 'drain-trigger' }, 46)
  assert.equal(await one.llen('ai-feedback:retry'), 0)
  assert.equal(created.length, 3)
  activeRedis = { eval: async () => { throw new Error('storage unavailable') } }
  await assert.rejects(reserveFeedbackQuota(42, false), /storage unavailable/)
})


test('flag storage errors fail closed, and a held fingerprint lock bounds retries without database work', async () => {
  failFlag = true
  assert.equal(await aiFeedbackEnabled(42), false)
  assert.equal(await aiFeedbackEnabled(), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  assert.equal(created.length, 0)
  failFlag = false
  const lockKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  locks.set(lockKey, 'another-report')
  let attempts = 0
  activeRedis = { ...redis, set: async (...args) => { attempts++; return redis.set(...args) } }
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
  assert.equal(created.length, 0)
  assert.equal(bucketCounts.size, 0)
  assert.equal(locks.get(lockKey), 'another-report')
  assert.equal(attempts, 20)
})


test('description never written on repeat, including human edits after lookup and exact owned-looking metadata', async () => {
  await fileAiFeedback(input, 42)
  const human = '\n<h2 data-owner="human">Triage &amp; context</h2>\n<p>Keep  spacing, quotes "exactly", and &#39;entities&#39;.</p>\n<p>Seen 999 times</p><p>Clients: human</p>'
  const original = rows[0].description_.content
  onQuota = () => { rows[0].description_.content = original + human; onQuota = undefined }
  for (const count of [2, 3]) {
    const result = await fileAiFeedback({ ...input, client: 'cursor', category: 'slow', note: 'New private prose' }, 43)
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
    rows = []; created = []
    await fileAiFeedback({ surface: 'cli', category: 'user_reported_broken', ...text }, 42)
    assert.match(created[0].description, /Category: user_reported_broken/)
    assert.match(created[0].description, /Free text was supplied and not stored, for privacy\./)
    assert.equal(created[0].description.includes('Acme'), false)
    assert.equal(created[0].description.includes('supplier'), false)
    assert.equal(created[0].description.includes('<p>Note:'), false)
    assert.equal(created[0].description.includes('<p>Error:'), false)
  }
  rows = []; created = []
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
  assert.equal(locks.size, 0)
  rows = []; created = []
  const repeated = await Promise.all([fileAiFeedback(input, 44), fileAiFeedback(input, 45)])
  assert.deepEqual(repeated.map((result) => result.count), [1, 2])
  assert.deepEqual(repeated.map((result) => result.deduped), [false, true])
  assert.equal(created.length, 1)
  assert.equal(locks.size, 0)
})


test('partial core failures cannot create more than ten account reports in the hour', async () => {
  partialWriteFailure = true
  for (let index = 0; index < 10; index++) await assert.rejects(fileAiFeedback(input, 42), /post-create failure/)
  assert.equal(created.length, 10)
  await assert.rejects(fileAiFeedback(input, 42), { status: 429 })
  assert.equal(created.length, 10)
})

test('different fingerprints file without waiting for a blocked fingerprint', { timeout: 3000 }, async () => {
  const firstKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  let release, entered
  const blocked = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  activeRedis = { ...redis, set: async (key, ...args) => {
    const result = await redis.set(key, ...args)
    if (key === firstKey && result === 'OK') { entered(); await blocked }
    return result
  } }
  const first = fileAiFeedback(input, 42)
  try {
    await started
    const second = await fileAiFeedback({ ...input, tool: 'hypertask_hello' }, 43)
    assert.equal(second.success, true)
    assert.equal(created.length, 1)
    assert.equal(locks.size, 1)
  } finally { release(); await first }
  assert.equal(created.length, 2)
  assert.equal(locks.size, 0)
})

test('explicit same-fingerprint contention retains bounded 503 and makes no destination or count writes', async () => {
  await fileAiFeedback(input, 42)
  const fingerprint = feedbackFingerprint(input)
  const lockKey = `ai-feedback:lock:${fingerprint}`
  const countKey = `ai-feedback:count:${fingerprint}`
  locks.set(lockKey, 'other-owner')
  const databaseBefore = prismaCalls
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => fileAiFeedback(input, 50 + index)))
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason.status === 503))
  assert.equal(prismaCalls, databaseBefore)
  assert.equal(counters.get(countKey), 1)
  assert.equal(retryEntries.length, 0)
  locks.delete(lockKey)
  const bump = await fileAiFeedback(input, 42)
  assert.equal(bump.count, 2)
  assert.match(comments[0].text, /Seen 2 times/)
})

test('attempt limit rejects before any Prisma call, flag lookup, fingerprint count or lock, including malformed and anonymous attempts', async () => {
  for (const userId of [42, undefined]) {
    globalEnabled = true
    for (let index = 0; index < 60; index++) await assert.rejects(fileAiFeedback(null, userId), { status: 400 })
    flagCalls = 0
    await assert.rejects(fileAiFeedback(input, userId), { status: 429 })
    assert.equal(prismaCalls, 0)
    assert.equal(flagCalls, 0)
    assert.equal(locks.size, 0)
    assert.equal(counters.size, 0)
    assert.equal(bucketCounts.size, 0)
  }
  assert.equal(attempts.get('ai-feedback:attempt:42'), 61)
  assert.equal(attempts.get('ai-feedback:attempt:anonymous'), 61)
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
  assert.equal(locks.size, 0)
})

test('expired lock owner cannot delete a replacement lock in finally', async () => {
  const lockKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  onQuota = () => locks.set(lockKey, 'replacement-owner')
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
  assert.equal(created.length, 0)
  assert.equal(locks.get(lockKey), 'replacement-owner')
})

test('counter re-initialised from the tally comment after expiry, or from one before the first repeat', async () => {
  await fileAiFeedback(input, 42)
  const countKey = `ai-feedback:count:${feedbackFingerprint(input)}`
  counters.delete(countKey)
  assert.equal((await fileAiFeedback(input, 43)).count, 2)
  assert.equal((await fileAiFeedback(input, 43)).count, 3)
  comments[0].text = comments[0].text.replace('Seen 3 times', 'Seen 87 times')
  counters.delete(countKey)
  let initialised = false
  activeRedis = { ...redis,
    set: async (key, value, ...args) => {
      if (key === countKey) { assert.equal(value, 87); assert.deepEqual(args, ['EX', 30 * 86400, 'NX']); initialised = true }
      return redis.set(key, value, ...args)
    },
    incr: async (key) => { assert.ok(initialised); return redis.incr(key) },
  }
  assert.equal((await fileAiFeedback(input, 44)).count, 88)
  assert.equal(comments.length, 1)
  assert.match(comments[0].text, /Seen 88 times/)
  assert.equal(descriptionWrites, 0)
})

test('tally lookup never edits a human comment or another agent comment with the same marker', async () => {
  await fileAiFeedback(input, 42)
  const marker = `<p>AI feedback tally: ai-fb-${feedbackFingerprint(input).slice(0, 12)}</p>`
  const human = { id: 50, taskId: rows[0].id, creatorId: 42, agentId: null, text: marker + '<p>Seen 900 times</p>' }
  const agent = { id: 51, taskId: rows[0].id, creatorId: 6, agentId: 'another-agent', text: marker + '<p>Seen 800 times</p>' }
  comments.push(human, agent)
  await fileAiFeedback(input, 43)
  await fileAiFeedback(input, 44)
  assert.equal(comments.length, 3)
  assert.equal(commentCreates.length, 1)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].commentId, comments[2].id)
  assert.equal(human.text, marker + '<p>Seen 900 times</p>')
  assert.equal(agent.text, marker + '<p>Seen 800 times</p>')
})

test('queued automatic report is scrubbed and filed on the next explicit call, without counting it twice', async () => {
  const lockKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  locks.set(lockKey, 'other-owner')
  await assert.rejects(fileAiFeedback({ ...input, note: 'private note', client: 'CURSOR' }, 42, true), { status: 503 })
  assert.equal(created.length, 0)
  assert.equal(counters.size, 0)
  assert.equal(retryEntries.length, 1)
  const queued = JSON.parse(retryEntries[0])
  assert.equal(queued.userId, 42)
  assert.equal(queued.input.client, 'cursor')
  assert.equal(queued.input.error, undefined)
  assert.equal(queued.input.note, undefined)
  assert.equal(retryEntries[0].includes('private'), false)
  assert.deepEqual(retryOperations.map((operation) => operation[0]), ['rpush', 'ltrim', 'expire'])
  locks.delete(lockKey)
  assert.equal((await fileAiFeedback({ ...input, tool: 'hypertask_hello' }, 43)).success, true)
  assert.equal(created.length, 2)
  assert.equal(retryEntries.length, 0)
  assert.ok(created.every((options) => options.description.includes('Seen 1 times')))
  assert.equal((await fileAiFeedback(input, 43)).count, 2)
})

test('retry drain files at most five entries on automatic calls and pushes each failure back once', async () => {
  for (let index = 0; index < 7; index++) retryEntries.push(JSON.stringify({ input: { ...input, error: undefined, tool: `tool-${index}` }, userId: 42 }))
  failWrite = true
  await assert.rejects(fileAiFeedback({ ...input, tool: 'new-tool' }, 43, true), /write failed/)
  assert.equal(retryEntries.length, 7)
  assert.equal(retryOperations.filter((operation) => operation[0] === 'rpush').length, 5)
  assert.deepEqual(retryEntries.map((entry) => JSON.parse(entry).input.tool), ['tool-5', 'tool-6', 'tool-0', 'tool-1', 'tool-2', 'tool-3', 'tool-4'])
  failWrite = false
  await fileAiFeedback({ ...input, tool: 'next-tool' }, 43, true)
  assert.equal(created.length, 6)
  assert.equal(retryEntries.length, 2)
})

test('automatic contention caps the retry list at 500 and refreshes the one-day expiry', async () => {
  for (let index = 0; index < 500; index++) retryEntries.push(JSON.stringify({ input: { surface: 'api', tool: `tool-${index}` }, userId: 42 }))
  const prior = [...retryEntries]
  activeRedis = { ...redis, lpop: async () => [] }
  locks.set(`ai-feedback:lock:${feedbackFingerprint(input)}`, 'other-owner')
  await assert.rejects(fileAiFeedback(input, 42, true), { status: 503 })
  assert.equal(retryEntries.length, 500)
  assert.equal(retryEntries[0], prior[1])
  assert.deepEqual(retryOperations.at(-1), ['expire', 86400])
})

test('lease renewal runs every ten seconds, stops writes when the token is lost, and clears its timer in finally', async () => {
  const originalInterval = global.setInterval, originalClear = global.clearInterval
  let tick, cleared = false, unrefed = false, release, entered
  const held = new Promise((resolve) => { release = resolve })
  const started = new Promise((resolve) => { entered = resolve })
  const lockKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  const timer = { unref: () => { unrefed = true } }
  global.setInterval = (callback, milliseconds) => { assert.equal(milliseconds, 10000); tick = callback; return timer }
  global.clearInterval = (value) => { assert.equal(value, timer); cleared = true }
  const originalFind = db.task.findFirst
  db.task.findFirst = async (...args) => { entered(); await held; return originalFind(...args) }
  const originalEval = redis.eval
  let renewalCount = 0, renewed
  activeRedis = { ...redis, eval: async (...args) => {
    const value = await originalEval(...args)
    if (args[0].includes('30000')) { renewalCount++; if (renewed) renewed() }
    return value
  } }
  const filing = fileAiFeedback(input, 42)
  try {
    await started
    assert.equal(unrefed, true)
    await new Promise((resolve) => { renewed = resolve; tick() })
    assert.equal(renewalCount, 1)
    assert.equal(locks.has(lockKey), true)
    locks.set(lockKey, 'replacement-owner')
    await new Promise((resolve) => { renewed = resolve; tick() })
    release()
    await assert.rejects(filing, { status: 503 })
    assert.equal(renewalCount, 2)
    assert.equal(created.length, 0)
    assert.equal(commentCreates.length, 0)
    assert.equal(updates.length, 0)
    assert.equal(labelCreated, 0)
    assert.equal(counters.size, 0)
    assert.equal(bucketCounts.size, 0)
    assert.equal(locks.get(lockKey), 'replacement-owner')
    assert.equal(cleared, true)
  } finally {
    release()
    global.setInterval = originalInterval; global.clearInterval = originalClear; db.task.findFirst = originalFind
    await filing.catch(() => {})
  }
})

test('lease loss before a repeat prevents comment creation and update, and renewal errors fail closed', async () => {
  await fileAiFeedback(input, 42)
  const lockKey = `ai-feedback:lock:${feedbackFingerprint(input)}`
  const countKey = `ai-feedback:count:${feedbackFingerprint(input)}`
  for (const hasComment of [false, true]) {
    if (hasComment) { locks.delete(lockKey); await fileAiFeedback(input, 42) }
    const before = { creates: commentCreates.length, updates: updates.length, count: counters.get(countKey) }
    onQuota = () => { locks.set(lockKey, 'replacement-owner'); onQuota = undefined }
    await assert.rejects(fileAiFeedback(input, 43), { status: 503 })
    assert.equal(commentCreates.length, before.creates)
    assert.equal(updates.length, before.updates)
    assert.equal(counters.get(countKey), before.count)
  }
  locks.delete(lockKey)
  activeRedis = { ...redis, eval: async (...args) => {
    if (args[0].includes('30000')) throw new Error('Redis unavailable')
    return redis.eval(...args)
  } }
  await assert.rejects(fileAiFeedback(input, 43), { status: 503 })
  assert.equal(locks.size, 0)
})
