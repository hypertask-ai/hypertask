const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let enabled, globalEnabled, rows, created, updates, labelCreated, taskQuery, userQuery, failWrite, configured, failFlag, partialWriteFailure
let bucketCounts, locks, counters, attempts, activeRedis, prismaCalls, flagCalls, onQuota, labelError, labelRace
const redis = {
  set: async (key, value, ...args) => {
    assert.deepEqual(args, ['EX', key.includes(':lock:') ? 30 : 30 * 86400, 'NX'])
    const store = key.includes(':lock:') ? locks : counters
    if (store.has(key)) return null
    store.set(key, value)
    return 'OK'
  },
  incr: async (key) => { const count = Number(counters.get(key) ?? 0) + 1; counters.set(key, count); return count },
  expire: async (key, seconds) => { assert.equal(seconds, 30 * 86400); assert.ok(counters.has(key)); return 1 },
  get: async (key) => counters.get(key),
  eval: async (script, _keys, key, now, limit, token) => {
    if (script.includes('local acquired')) {
      const count = await redis.incr(key)
      await redis.expire(key, 30 * 86400)
      const acquired = await activeRedis.set(now, limit, 'EX', 30, 'NX')
      return [count, acquired === 'OK' ? 1 : 0]
    }
    if (script.includes('local waiting')) {
      const count = Number(counters.get(key)) - Number(now) + 1
      counters.set(key, count)
      return count
    }
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
  const task = { id: created.length, ticketNumber: `HTPR-${7195 + created.length}`, uniqueIndex: 7195 + created.length, status: 'Normal', sectionId: 111, section: 'Bugs', description_: { content: options.description } }
  rows.push(task)
  if (partialWriteFailure) { task.description_.content = ''; throw new Error('post-create failure') }
  return { task }
} })
stub('src/utils/controllers/description/common-description-create.ts', { default: async (options) => {
  if (failWrite) throw new Error('write failed')
  updates.push(options)
  rows.find((row) => row.id === options.taskId).description_.content = options.content
} })
stub('src/lib/realtime/server.ts', { broadcastTaskChange: async () => {} })
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false })
const { fileAiFeedback, bumpFeedbackDescription, aiFeedbackEnabled, FEEDBACK_COUNT_LOCK_SCRIPT, FEEDBACK_RESET_COUNT_SCRIPT } = jiti('../src/lib/aiFeedback/report.ts')
const { reserveFeedbackAttempt, reserveFeedbackQuota, FEEDBACK_QUOTA_SCRIPT } = jiti('../src/lib/aiFeedback/rateLimit.ts')
const { feedbackFingerprint } = jiti('../src/lib/aiFeedback/input.ts')
const input = { surface: 'mcp', client: 'claude', tool: 'hypertask_tasks', status: 503, errorCode: 'unavailable', error: 'Cannot save "Confidential task description" for customer@example.test' }

test.beforeEach(() => {
  enabled = true; globalEnabled = false; rows = []; created = []; updates = []; labelCreated = 0; bucketCounts = new Map(); locks = new Map(); counters = new Map(); attempts = new Map(); prismaCalls = 0; flagCalls = 0; onQuota = undefined; labelError = undefined; labelRace = false; activeRedis = redis; failWrite = false; configured = true; failFlag = false; partialWriteFailure = false; userQuery = undefined; taskQuery = undefined
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

test('same fingerprint across accounts and notes bumps one open report, deduping capped names and clients', async () => {
  await fileAiFeedback(input, 42)
  const result = await fileAiFeedback({ ...input, note: 'Different context', client: 'cursor' }, 43)
  assert.equal(created.length, 1); assert.equal(result.deduped, true); assert.equal(result.count, 2)
  assert.match(updates[0].content, /Clients: claude, cursor/)
  assert.equal(updates[0].creatorId, 6)
  assert.equal((updates[0].content.match(/Kamil/g) ?? []).length, 1)
  let content = updates[0].content
  for (let index = 0; index < 30; index++) content = bumpFeedbackDescription(content, index + 3, `Name ${index}`, `client-${index}`).description
  assert.equal(content.match(/Reporting display names: ([^<]*)/)[1].split(', ').length, 10)
  assert.equal(content.match(/Clients: ([^<]*)/)[1].split(', ').length, 10)
  assert.match(content, /Seen 32 times/)
  assert.equal((content.match(/Seen /g) ?? []).length, 1)
})

test('escaped reporting display names survive dedupe without injecting HTML', () => {
  const first = bumpFeedbackDescription('<p>Seen 1 times</p>', 2, 'Kamil & Co <owner>', 'claude').description
  const second = bumpFeedbackDescription(first, 3, 'Kamil & Co <owner>', 'claude').description
  assert.match(second, /Kamil &amp; Co/)
  assert.equal(second.includes('<owner>'), false)
  assert.equal((second.match(/Kamil/g) ?? []).length, 1)
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
  assert.equal(updates.length, 30)
  assert.equal((await fileAiFeedback({ ...input, tool: 'tool-11' }, 43)).count, 1)
})

test('anonymous reports require Everyone and share one quota for new reports and bumps', async () => {
  await assert.rejects(fileAiFeedback(input), { status: 404 })
  assert.equal(created.length, 0)
  globalEnabled = true
  for (let index = 0; index < 20; index++) await fileAiFeedback(input)
  assert.equal(created.length, 1); assert.equal(updates.length, 19)
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

test('real Redis quotas, attempts, counting and lock reset are atomic across clients and storage errors fail closed', async (t) => {
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
  const countKey = 'ai-feedback:count:test', lockKey = 'ai-feedback:lock:test'
  await one.set(countKey, 99)
  const counted = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? one : two).eval(FEEDBACK_COUNT_LOCK_SCRIPT, 2, countKey, lockKey, `owner-${index}`)))
  assert.equal(counted.filter((result) => result[1] === 1).length, 1)
  const winner = counted.find((result) => result[1] === 1)
  assert.equal(winner[0], 100)
  assert.equal(await one.get(countKey), '111')
  assert.equal(await one.eval(FEEDBACK_RESET_COUNT_SCRIPT, 1, countKey, winner[0]), 12)
  assert.equal(await two.get(countKey), '12')
  assert.ok(await one.ttl(countKey) > 2591990)
  assert.ok(await one.ttl(lockKey) > 20 && await one.ttl(lockKey) <= 30)
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


test('two bumps preserve original report and human triage exactly, updating only owned metadata', async () => {
  await fileAiFeedback(input, 42)
  const original = rows[0].description_.content + '<p>Error: Original technical failure</p><p>Note: Original report context</p>'
  const triage = '<h2>Human triage</h2><p>Keep customer account details for investigation.</p><p>Original report follow-up.</p>'
  rows[0].description_.content = triage + original
    .replace('Reporting display names: Kamil', 'Reporting display names: victim@example.test, Kamil')
    .replace('Clients: claude', 'Clients: victim@example.test, claude')
    .replace(/<p>Last seen: [^<]*<\/p>/, '<p>Last seen: 2000-01-01T00:00:00.000Z</p>')
  const metadata = /<p>(?:Seen \d+ times|Reporting display names: [^<]*|Clients: [^<]*|Last seen: [^<]*)<\/p>/g
  const reportBody = (triage + original).replace(metadata, '')
  for (const count of [2, 3]) {
    const result = await fileAiFeedback({ ...input, client: 'cursor', category: 'slow', note: 'New private prose' }, 43)
    assert.equal(result.count, count)
    const body = updates.at(-1).content
    assert.equal(body.replace(metadata, ''), reportBody)
    assert.equal(body.includes('victim@example.test'), false)
    assert.equal(body.includes('New private prose'), false)
    assert.match(body, /Clients: claude, cursor/)
    assert.match(body, /Category: other/)
    assert.match(body, /Fingerprint: ai-fb-[a-f0-9]{12}/)
    const lastSeen = body.match(/<p>Last seen: ([^<]*)<\/p>/)[1]
    assert.equal(new Date(lastSeen).toISOString(), lastSeen)
    assert.notEqual(lastSeen, '2000-01-01T00:00:00.000Z')
    assert.equal((body.match(/Last seen:/g) ?? []).length, 1)
  }
})

test('human-removed metadata lines are appended without changing remaining description', () => {
  const content = '<p>Original report</p><p>Human investigation</p>'
  const first = bumpFeedbackDescription(content, 2, 'Kamil', 'claude')
  assert.equal(first.count, 2)
  assert.ok(first.description.startsWith(content))
  for (const label of ['Seen 2 times', 'Reporting display names: Kamil', 'Clients: claude', 'Last seen:']) assert.ok(first.description.includes(label))
  const second = bumpFeedbackDescription(first.description, 3, 'Kamil', 'cursor')
  assert.equal(second.count, 3)
  assert.ok(second.description.startsWith(content))
  assert.equal((second.description.match(/Last seen:/g) ?? []).length, 1)
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
  assert.ok(repeated.every((result) => result.count === 2))
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

test('same-fingerprint contention counts every report even when all bounded retries fail', async () => {
  await fileAiFeedback(input, 42)
  const fingerprint = feedbackFingerprint(input)
  const lockKey = `ai-feedback:lock:${fingerprint}`
  const countKey = `ai-feedback:count:${fingerprint}`
  locks.set(lockKey, 'other-owner')
  const databaseBefore = prismaCalls
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => fileAiFeedback(input, 50 + index)))
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason.status === 503))
  assert.equal(prismaCalls, databaseBefore)
  assert.equal(counters.get(countKey), 5)
  locks.delete(lockKey)
  const bump = await fileAiFeedback(input, 42)
  assert.equal(bump.count, 6)
  assert.match(updates.at(-1).content, /Seen 6 times/)
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

test('bump re-reads human edits made after dedupe lookup and replaces only owned lines byte for byte', async () => {
  await fileAiFeedback(input, 42)
  const human = '\n<h2 data-owner="human">Triage &amp; context</h2>\n<p>Keep  spacing, quotes "exactly", and &#39;entities&#39;.</p>\n'
  onQuota = () => { rows[0].description_.content += human; onQuota = undefined }
  const result = await fileAiFeedback(input, 43)
  assert.equal(result.count, 2)
  assert.ok(updates[0].content.endsWith(human))
  assert.equal((updates[0].content.match(/Triage/g) ?? []).length, 1)
  rows[0].description_.content = rows[0].description_.content.replace('Seen 2 times', 'Seen 999 times')
  assert.equal((await fileAiFeedback(input, 43)).count, 3)
  assert.match(updates.at(-1).content, /Seen 3 times/)
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
  await fileAiFeedback(input, 42)
  assert.equal(locks.get(lockKey), 'replacement-owner')
})
