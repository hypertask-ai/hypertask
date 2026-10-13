const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const stub = (file, exports) => {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
let enabled, globalEnabled, rows, created, updates, labelCreated, taskQuery, userQuery, failWrite, configured, failFlag, partialWriteFailure
let bucketCounts, lock, activeRedis
const redis = {
  set: async (_key, token) => { if (lock) return null; lock = token; return 'OK' },
  eval: async (script, _keys, key, now, limit, token) => {
    if (script.includes('ZCARD')) {
      const entries = (bucketCounts.get(key) ?? []).filter((entry) => entry.now > now - 3600000)
      bucketCounts.set(key, entries)
      if (entries.length >= Number(limit)) return 0
      entries.push({ now, token })
      return 1
    }
    if (lock === now) lock = undefined
    return 1
  },
  zrem: async (key, token) => bucketCounts.set(key, (bucketCounts.get(key) ?? []).filter((entry) => entry.token !== token)),
}
stub('src/lib/redis.ts', { getRedis: async () => activeRedis })
stub('src/lib/flags.ts', { isFeatureEnabled: async () => { if (failFlag) throw new Error('flag storage failed'); return enabled }, featureFlagCandidateUserIds: async () => { if (failFlag) throw new Error('flag storage failed'); return globalEnabled ? null : [6, 985] } })
stub('src/lib/prisma.ts', { default: {
  user: { findUnique: async (query) => { userQuery = query; return { displayName: 'Kamil <Admin> customer@example.test' } } },
  project: { findFirst: async () => configured ? { ownerId: 6, uniqueIdentifier: 'HTPR', section: [{ id: 111, section_title: 'Bugs' }] } : null },
  section: { findMany: async () => [{ id: 222, section_title: 'Done' }, { id: 333, section_title: 'Shipped' }] },
  label: {
    findFirst: async (query) => { assert.deepEqual(query.where, { projectId: 15, value: 'ai-feedback' }); return labelCreated ? { id: 'label-ai' } : null },
    create: async (query) => { assert.deepEqual(query.data, { projectId: 15, value: 'ai-feedback' }); labelCreated++; return { id: 'label-ai' } },
  },
  task: { findFirst: async (query) => {
    taskQuery = query
    return rows.find((row) => row.status === query.where.status && ![222, 333].includes(row.sectionId) && !['Done', 'Shipped'].includes(row.section) && row.description_.content.includes(query.where.description_.is.content.contains)) ?? null
  } },
} })
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
const { fileAiFeedback, bumpFeedbackDescription, aiFeedbackEnabled } = jiti('../src/lib/aiFeedback/report.ts')
const { reserveFeedbackQuota, FEEDBACK_QUOTA_SCRIPT } = jiti('../src/lib/aiFeedback/rateLimit.ts')
const input = { surface: 'mcp', client: 'claude', tool: 'hypertask_tasks', status: 503, errorCode: 'unavailable', error: 'Cannot save "Confidential task description" for customer@example.test' }

test.beforeEach(() => {
  enabled = true; globalEnabled = false; rows = []; created = []; updates = []; labelCreated = 0; bucketCounts = new Map(); lock = undefined; activeRedis = redis; failWrite = false; configured = true; failFlag = false; partialWriteFailure = false; userQuery = undefined; taskQuery = undefined
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
  for (let index = 0; index < 30; index++) content = bumpFeedbackDescription(content, `Name ${index}`, `client-${index}`).description
  assert.equal(content.match(/Reporting display names: ([^<]*)/)[1].split(', ').length, 10)
  assert.equal(content.match(/Clients: ([^<]*)/)[1].split(', ').length, 10)
  assert.match(content, /Seen 32 times/)
  assert.equal((content.match(/Seen /g) ?? []).length, 1)
})

test('escaped reporting display names survive dedupe without injecting HTML', () => {
  const first = bumpFeedbackDescription('<p>Seen 1 times</p>', 'Kamil & Co <owner>', 'claude').description
  const second = bumpFeedbackDescription(first, 'Kamil & Co <owner>', 'claude').description
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

test('flag-off and invalid input never write or consume quota; failed writes keep reservations to bound partially committed reports', async () => {
  enabled = false
  assert.equal(await aiFeedbackEnabled(42), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  enabled = true
  await assert.rejects(fileAiFeedback({ ...input, arguments: { title: 'private' } }, 42), { status: 400 })
  assert.equal(created.length, 0); assert.equal(bucketCounts.size, 0)
  failWrite = true
  await assert.rejects(fileAiFeedback(input, 42), /write failed/)
  assert.equal([...bucketCounts.values()].flat().length, 1)
  assert.equal(lock, undefined)
  failWrite = false
  assert.equal((await fileAiFeedback(input, 42)).count, 1)
})

test('titles use tool, errorCode or status and never exceed 80 characters; unconfigured destination fails closed', async () => {
  for (const report of [{ surface: 'api', errorCode: 'oops' }, { surface: 'cli', status: 500 }, { surface: 'agent', tool: 'x'.repeat(80) }]) await fileAiFeedback(report, 42)
  assert.equal(created[0].title, 'AI feedback: api oops'); assert.equal(created[1].title, 'AI feedback: cli 500'); assert.equal(created[2].title.length, 80)
  configured = false
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
})

test('real Redis Lua quota is atomic across clients, rolling for an hour and storage errors fail closed', async (t) => {
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
  activeRedis = { eval: async () => { throw new Error('storage unavailable') } }
  await assert.rejects(reserveFeedbackQuota(42, false), /storage unavailable/)
})


test('flag storage errors fail closed, and a concurrent destination write cannot create duplicate tickets', async () => {
  failFlag = true
  assert.equal(await aiFeedbackEnabled(42), false)
  assert.equal(await aiFeedbackEnabled(), false)
  await assert.rejects(fileAiFeedback(input, 42), { status: 404 })
  assert.equal(created.length, 0)
  failFlag = false
  lock = 'another-report'
  await assert.rejects(fileAiFeedback(input, 42), { status: 503 })
  assert.equal(created.length, 0)
  assert.equal(bucketCounts.size, 0)
  assert.equal(lock, 'another-report')
})


test('dedupe descriptions are rebuilt from validated fields, never arbitrary existing ticket edits', async () => {
  await fileAiFeedback(input, 42)
  rows[0].description_.content += '<p>Private task contents: customer account details</p>'
  rows[0].description_.content = rows[0].description_.content.replace('Reporting display names: Kamil', 'Reporting display names: victim@example.test, Kamil').replace('Clients: claude', 'Clients: victim@example.test, claude')
  const result = await fileAiFeedback(input, 43)
  assert.equal(result.count, 2)
  const body = updates[0].content
  assert.equal(body.includes('customer account details'), false)
  assert.equal(body.includes('victim@example.test'), false)
  assert.match(body, /Clients: claude/)
  assert.match(body, /Fingerprint: ai-fb-[a-f0-9]{12}/)
})


test('partial core failures cannot create more than ten account reports in the hour', async () => {
  partialWriteFailure = true
  for (let index = 0; index < 10; index++) await assert.rejects(fileAiFeedback(input, 42), /post-create failure/)
  assert.equal(created.length, 10)
  await assert.rejects(fileAiFeedback(input, 42), { status: 429 })
  assert.equal(created.length, 10)
})
