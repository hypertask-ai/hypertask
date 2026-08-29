const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})
const { createAttachmentDownloadHandler } = jiti(
  path.join(root, 'src/lib/mcp/attachments/downloadHandler.ts')
)

const bytes = Buffer.from('native attachment')

function request(query = 'task_id=42&attachment_id=7') {
  return new NextRequest(`https://example.test/api/mcp/tasks/attachments?${query}`)
}

function handler(overrides = {}) {
  const calls = { scope: 0, task: [], attachment: [], fetch: [] }
  const context = { user: { id: 6 }, agentId: null }
  const dependencies = {
    checkRateLimit: async () => null,
    validateAuth: async () => context,
    authorizeRead: async () => { calls.scope += 1; return null },
    findTask: async (_context, taskId) => { calls.task.push(taskId); return { id: taskId } },
    findAttachment: async (taskId, attachmentId) => {
      calls.attachment.push([taskId, attachmentId])
      return {
        fileName: 'brief.pdf',
        fileType: 'application/pdf',
        fileSize: bytes.length,
        fileSource: 'https://storage.example.test/private-object',
      }
    },
    fetchAttachment: async (url) => {
      calls.fetch.push(url)
      return { buffer: bytes, contentType: 'application/pdf' }
    },
    normalizeMime: (value) => value || 'application/octet-stream',
    isStorageFetchError: () => false,
    ...overrides,
  }
  return { GET: createAttachmentDownloadHandler(dependencies), calls, context }
}

test('rejects unauthenticated downloads before task or storage access', async () => {
  const { GET, calls } = handler({ validateAuth: async () => null })
  const response = await GET(request())

  assert.equal(response.status, 401)
  assert.deepEqual(calls.task, [])
  assert.deepEqual(calls.fetch, [])
})

test('enforces managed-agent read scope before resolving the task', async () => {
  const denied = Response.json({ error: 'Insufficient role' }, { status: 403 })
  const { GET, calls } = handler({ authorizeRead: async () => denied })
  const response = await GET(request())

  assert.equal(response.status, 403)
  assert.deepEqual(calls.task, [])
  assert.deepEqual(calls.fetch, [])
})

test('returns not found for an inaccessible task', async () => {
  const { GET, calls } = handler({ findTask: async () => null })
  const response = await GET(request())

  assert.equal(response.status, 404)
  assert.deepEqual(calls.attachment, [])
  assert.deepEqual(calls.fetch, [])
})

test('scopes the attachment lookup to the authorized task', async () => {
  const { GET, calls } = handler({ findAttachment: async (taskId, attachmentId) => {
    calls.attachment.push([taskId, attachmentId])
    return null
  } })
  const response = await GET(request())

  assert.equal(response.status, 404)
  assert.deepEqual(calls.attachment, [[42, 7]])
  assert.deepEqual(calls.fetch, [])
})

test('returns bytes with private download and content-sniffing protections', async () => {
  const { GET, calls } = handler()
  const response = await GET(request())

  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="brief\.pdf"/)
  assert.equal(response.headers.get('content-type'), 'application/pdf')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(calls.fetch, ['https://storage.example.test/private-object'])
})

test('rejects storage results that fail size or MIME integrity checks', async () => {
  const wrongSize = handler({ fetchAttachment: async () => ({
    buffer: Buffer.from('short'),
    contentType: 'application/pdf',
  }) })
  assert.equal((await wrongSize.GET(request())).status, 409)

  const wrongType = handler({ fetchAttachment: async () => ({
    buffer: bytes,
    contentType: 'text/plain',
  }) })
  assert.equal((await wrongType.GET(request())).status, 409)

  const zeroMetadataWithBytes = handler({ findAttachment: async () => ({
    fileName: 'empty.txt',
    fileType: 'text/plain',
    fileSize: 0,
    fileSource: 'https://storage.example.test/not-empty',
  }) })
  assert.equal((await zeroMetadataWithBytes.GET(request())).status, 409)

  const invalidMetadata = handler({ findAttachment: async () => ({
    fileName: 'broken.txt',
    fileType: 'text/plain',
    fileSize: '-1',
    fileSource: 'https://storage.example.test/broken',
  }) })
  assert.equal((await invalidMetadata.GET(request())).status, 409)
})
